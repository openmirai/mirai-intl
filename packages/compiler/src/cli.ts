#!/usr/bin/env node

import { lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { analyzeConventionSources } from "./analyze-sources";
import { compileCatalog } from "./compile";
import {
  CatalogValidationError,
  generateConventionCatalog,
  loadConventionCatalog,
  verifyConventionCatalog,
} from "./catalog";
import {
  authorizeConventionCatalog,
  discoverEmittedModules,
  finalizeBuildProof,
  finalizeBuildProofTargets,
  proveConventionCatalog,
  writeProvisionalBuildProof,
} from "./proof";
import {
  colorEnabled,
  emitReport,
  failedSummary,
  successfulSummary,
  writeReportFile,
} from "./reporter";
import type {
  CliDiagnostic,
  CliFormat,
  CliReport,
  ReporterOptions,
} from "./reporter";
import type { IntlBuildProofTargetV1 } from "@openmirai/intl-abi";

type Command =
  | "catalog-check"
  | "check"
  | "contract"
  | "ensure"
  | "explain"
  | "finalize-proof"
  | "generate"
  | "prove-artifact"
  | "prove";

const commands = [
  "generate",
  "ensure",
  "check",
  "catalog-check",
  "prove",
  "prove-artifact",
  "finalize-proof",
  "contract",
  "explain",
] as const;
const removedOptions = ["--config", "--out", "--representation"] as const;
const workspaceSkipDirectories = new Set([
  ".git",
  ".mirai-intl",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

class CliUsageError extends Error {
  override readonly name = "CliUsageError";
}

let activeCommand: Command | undefined;
let activeReportFile: string | undefined;
let activeReporter: ReporterOptions | undefined;

function buildTarget(value: string): IntlBuildProofTargetV1 {
  if (value !== "client" && value !== "nitro" && value !== "worker") {
    throw new CliUsageError(
      "Build proof target must be client, nitro, or worker"
    );
  }
  return value;
}

function namedRoots(
  name: string,
  values: ReadonlyArray<string>
): Map<IntlBuildProofTargetV1, string> {
  const roots = new Map<IntlBuildProofTargetV1, string>();
  for (const value of values) {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new CliUsageError(`${name} requires <target>=<directory>`);
    }
    const target = buildTarget(value.slice(0, separator));
    if (roots.has(target)) {
      throw new CliUsageError(`${name} target ${target} must be unique`);
    }
    roots.set(target, value.slice(separator + 1));
  }
  return roots;
}

function messageSummary(count: number | undefined): string {
  return count === undefined
    ? ""
    : ` · ${count} message${count === 1 ? "" : "s"}`;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function assertConventionOnly(): void {
  const legacy = removedOptions.find((name) => process.argv.includes(name));
  if (legacy) {
    throw new CliUsageError(
      `${legacy} is not supported; mirai-intl uses convention discovery and compact production generation`
    );
  }
}

function assertNoSourceBypass(): void {
  if (hasFlag("--skip-sources")) {
    throw new CliUsageError(
      "--skip-sources is not supported: source analysis is required for an authorizing check"
    );
  }
}

function optionValues(name: string): Array<string> {
  const values: Array<string> = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === name) {
      const value = process.argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CliUsageError(`${name} requires a value`);
      }
      values.push(value);
      index += 1;
      continue;
    }
    if (argument?.startsWith(`${name}=`)) {
      values.push(argument.slice(name.length + 1));
    }
  }
  return values;
}

function singleOption(name: string): string | undefined {
  const values = optionValues(name);
  if (values.length > 1) {
    throw new CliUsageError(`${name} may only be specified once`);
  }
  return values[0];
}

function reporterOptions(command: Command): ReporterOptions {
  if (
    hasFlag("--workspace") &&
    command !== "check" &&
    command !== "catalog-check"
  ) {
    throw new CliUsageError(
      "--workspace is only supported by check and catalog-check"
    );
  }
  const formats = optionValues("--format");
  if (formats.length > 1) {
    throw new CliUsageError("--format may only be specified once");
  }
  const requestedFormat = formats[0];
  if (
    requestedFormat !== undefined &&
    requestedFormat !== "stylish" &&
    requestedFormat !== "json"
  ) {
    throw new CliUsageError("--format must be stylish or json");
  }
  const json = hasFlag("--json");
  if (json && requestedFormat === "stylish") {
    throw new CliUsageError("--json cannot be combined with --format=stylish");
  }
  let format: CliFormat = command === "contract" ? "json" : "stylish";
  if (json || requestedFormat === "json") {
    format = "json";
  } else if (requestedFormat === "stylish") {
    format = "stylish";
  }

  const annotations = singleOption("--annotations");
  if (annotations !== undefined && annotations !== "github") {
    throw new CliUsageError("--annotations must be github");
  }
  if (annotations === "github" && format === "json") {
    throw new CliUsageError(
      "--annotations=github can only be used with stylish output"
    );
  }
  const enableColor = hasFlag("--color");
  const disableColor = hasFlag("--no-color");
  if (enableColor && disableColor) {
    throw new CliUsageError("--color and --no-color cannot be combined");
  }
  let explicitColor: boolean | undefined;
  if (enableColor) {
    explicitColor = true;
  } else if (disableColor) {
    explicitColor = false;
  }
  return {
    annotations,
    color: colorEnabled(explicitColor),
    format,
    reportFile: singleOption("--report-file"),
  };
}

function catalogSummary(payload: unknown): {
  catalogId: string;
  locales: string;
  messageCount: number | undefined;
} {
  const catalogReport =
    payload && typeof payload === "object" && "report" in payload
      ? (
          payload as {
            report?: {
              catalog?: {
                catalogId?: string;
                locales?: Array<string>;
                messageCounts?: Record<string, number>;
              };
              valid?: boolean;
            };
          }
        ).report
      : undefined;
  const catalog = catalogReport?.catalog;
  const messageCount = catalog?.messageCounts
    ? Object.values(catalog.messageCounts).reduce(
        (total, count) => total + count,
        0
      )
    : undefined;
  return {
    catalogId: catalog?.catalogId ?? "catalog",
    locales: catalog?.locales?.join("+") ?? "unknown",
    messageCount,
  };
}

async function nearestWorkspaceRoot(start: string): Promise<string> {
  let directory = resolve(start);
  while (true) {
    const marker = await lstat(join(directory, "pnpm-workspace.yaml")).catch(
      () => undefined
    );
    if (marker?.isFile() && !marker.isSymbolicLink()) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new CliUsageError(
        "--workspace requires a parent pnpm-workspace.yaml"
      );
    }
    directory = parent;
  }
}

async function hasConventionCatalog(directory: string): Promise<boolean> {
  const config = await lstat(join(directory, "mirai-intl.config.json")).catch(
    () => undefined
  );
  if (config?.isFile() && !config.isSymbolicLink()) {
    return true;
  }
  const locales = await lstat(join(directory, "src/locales")).catch(
    () => undefined
  );
  return locales?.isDirectory() === true && !locales.isSymbolicLink();
}

async function discoverWorkspaceCatalogs(root: string): Promise<Array<string>> {
  const catalogs: Array<string> = [];
  const visit = async (directory: string): Promise<void> => {
    if (directory !== root && (await hasConventionCatalog(directory))) {
      catalogs.push(directory);
      return;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        workspaceSkipDirectories.has(entry.name)
      ) {
        continue;
      }
      await visit(join(directory, entry.name));
    }
  };
  await visit(root);
  if (catalogs.length === 0) {
    throw new CliUsageError(
      "No Mirai Intl catalogs were discovered in the pnpm workspace"
    );
  }
  return catalogs.toSorted((left, right) => left.localeCompare(right));
}

function catalogRepairHint(
  location: Readonly<{
    file?: string;
    locale?: string;
    path?: string;
  }>,
  command: string
): string {
  const locale = location.locale ? ` for locale ${location.locale}` : "";
  if (location.file && location.path) {
    return `Correct ${location.path} in ${location.file}${locale}, then rerun mirai-intl ${command}.`;
  }
  if (location.file) {
    return `Create or correct ${location.file}${locale}, then rerun mirai-intl ${command}.`;
  }
  return `Fix the catalog or proof finding, then rerun mirai-intl ${command}.`;
}

function catalogDiagnostic(
  error: unknown,
  command: string,
  workspacePath?: string
): CliDiagnostic {
  const location: {
    file?: string;
    locale?: string;
    path?: string;
  } = {};
  if (error instanceof CatalogValidationError) {
    const file =
      error.file && workspacePath && workspacePath !== "."
        ? `${workspacePath}/${error.file}`
        : (error.file ?? workspacePath);
    if (file) {
      location.file = file;
    }
    if (error.locale) {
      location.locale = error.locale;
    }
    if (error.path) {
      location.path = error.path;
    }
  } else if (workspacePath) {
    location.file = workspacePath;
  }
  return {
    code: "INTL_CATALOG_INVALID",
    ...(location.file ? { file: location.file } : {}),
    hint: catalogRepairHint(location, command),
    ...(location.locale ? { locale: location.locale } : {}),
    message: error instanceof Error ? error.message : String(error),
    ...(location.path ? { path: location.path } : {}),
    severity: "error",
  };
}

async function checkWorkspace(output: ReporterOptions): Promise<void> {
  const workspaceRoot = await nearestWorkspaceRoot(process.cwd());
  const roots = await discoverWorkspaceCatalogs(workspaceRoot);
  const diagnostics: Array<CliDiagnostic> = [];
  const catalogs: Array<{
    receipt?: unknown;
    report?: unknown;
    root: string;
    sourceAnalysis?: unknown;
  }> = [];
  let messageCount = 0;

  for (const root of roots) {
    const workspacePath = relative(workspaceRoot, root).split("\\").join("/");
    try {
      const { receipt, verification } = await authorizeConventionCatalog(root);
      const summary = catalogSummary(verification);
      messageCount += summary.messageCount ?? 0;
      catalogs.push({
        report: verification,
        receipt,
        root: workspacePath,
      });
    } catch (error) {
      try {
        const analysis = await analyzeConventionSources(root);
        const sourceFindings = sourceDiagnostics(analysis.diagnostics).map(
          (diagnostic) => {
            if (!diagnostic.file) {
              return diagnostic;
            }
            const file = isAbsolute(diagnostic.file)
              ? relative(workspaceRoot, diagnostic.file).split("\\").join("/")
              : `${workspacePath}/${diagnostic.file}`;
            return { ...diagnostic, file };
          }
        );
        if (sourceFindings.length > 0) {
          diagnostics.push(...sourceFindings);
          catalogs.push({ root: workspacePath, sourceAnalysis: analysis });
          continue;
        }
      } catch {
        // Keep the authorization error below when the catalog cannot load.
      }
      diagnostics.push(
        catalogDiagnostic(error, "check --workspace", workspacePath)
      );
      catalogs.push({ root: workspacePath });
    }
  }

  const result = {
    catalogs,
    valid: diagnostics.length === 0,
  };
  await report(
    "check",
    result,
    output,
    `${catalogs.length} catalogs${messageSummary(messageCount)}`,
    diagnostics
  );
  if (diagnostics.length > 0) {
    process.exitCode = 1;
  }
}

function sourceDiagnostics(
  diagnostics: ReadonlyArray<{ file: string; message: string }>
): Array<CliDiagnostic> {
  return diagnostics
    .map((diagnostic) => {
      const location = /^(\d+):(\d+):\s*(.*)$/u.exec(diagnostic.message);
      return {
        code: "INTL_SOURCE_INVALID",
        ...(location ? { column: Number(location[2]) } : {}),
        file: diagnostic.file,
        hint: "Fix the source usage, then rerun mirai-intl check.",
        ...(location ? { line: Number(location[1]) } : {}),
        message: location?.[3] ?? diagnostic.message,
        severity: "error" as const,
      };
    })
    .toSorted((left, right) => {
      const file = (left.file ?? "").localeCompare(right.file ?? "");
      if (file !== 0) {
        return file;
      }
      return (
        (left.line ?? 0) - (right.line ?? 0) ||
        (left.column ?? 0) - (right.column ?? 0) ||
        left.message.localeCompare(right.message)
      );
    });
}

async function report(
  command: Command,
  result: unknown,
  options: ReporterOptions,
  detail: string,
  diagnostics: ReadonlyArray<CliDiagnostic> = []
): Promise<void> {
  const success = diagnostics.every(
    (diagnostic) => diagnostic.severity !== "error"
  );
  const payload: CliReport = {
    command,
    diagnostics,
    result,
    schemaVersion: 1,
    success,
  };
  await emitReport(
    payload,
    options,
    success
      ? successfulSummary(command, detail, options.color)
      : failedSummary(command, diagnostics.length, options.color)
  );
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !commands.includes(command)) {
    throw new CliUsageError(
      "Usage: mirai-intl <generate|ensure|check|catalog-check|prove|prove-artifact|finalize-proof|contract|explain> [--format <stylish|json>] [--json]"
    );
  }
  activeCommand = command;
  activeReportFile = singleOption("--report-file");
  assertConventionOnly();
  assertNoSourceBypass();
  const reporter = reporterOptions(command);
  activeReporter = reporter;
  if (command === "check" && hasFlag("--workspace")) {
    await checkWorkspace(reporter);
    return;
  }

  if (command === "generate") {
    const result = await generateConventionCatalog(process.cwd());
    const summary = catalogSummary(result);
    await report(
      command,
      result,
      reporter,
      `${summary.catalogId} · ${summary.locales}${messageSummary(
        summary.messageCount
      )}`
    );
    return;
  }
  if (command === "ensure") {
    const result = await generateConventionCatalog(process.cwd(), {
      collectEnvironment: false,
    });
    const payload = {
      changed: result.write.changed,
      contentHash: result.write.contentHash,
      directory: result.write.directory,
    };
    await report(
      command,
      payload,
      reporter,
      result.write.changed ? "catalog updated" : "catalog current"
    );
    return;
  }
  if (command === "check") {
    const result = await verifyConventionCatalog(process.cwd());
    const sourceAnalysis = await analyzeConventionSources(process.cwd());
    if (sourceAnalysis.diagnostics.length > 0) {
      await report(
        command,
        {
          ...result,
          sourceAnalysis,
          valid: false,
        },
        reporter,
        "",
        sourceDiagnostics(sourceAnalysis.diagnostics)
      );
      process.exitCode = 1;
      return;
    }
    const payload = {
      ...result,
      sourceAnalysis,
    };
    const summary = catalogSummary(payload);
    await report(
      command,
      payload,
      reporter,
      `${summary.catalogId} · ${summary.locales}${messageSummary(
        summary.messageCount
      )}`
    );
    return;
  }
  if (command === "catalog-check") {
    const result = await verifyConventionCatalog(process.cwd());
    const summary = catalogSummary(result);
    await report(
      command,
      result,
      reporter,
      `${summary.catalogId} · ${summary.locales}${messageSummary(
        summary.messageCount
      )}`
    );
    return;
  }
  if (command === "prove") {
    const result = await proveConventionCatalog(process.cwd());
    await report(
      command,
      result,
      reporter,
      `${result.sources.length} source${result.sources.length === 1 ? "" : "s"} authorized`
    );
    return;
  }
  if (command === "finalize-proof") {
    const targetValues = optionValues("--target");
    const multiTarget =
      targetValues.length > 1 ||
      targetValues.some((value) => value.includes("="));
    if (multiTarget) {
      if (option("--artifact-root")) {
        throw new CliUsageError(
          "--artifact-root cannot be combined with named multi-target finalization"
        );
      }
      const targets = namedRoots("--target", targetValues);
      const mapRoots = namedRoots("--map-root", optionValues("--map-root"));
      for (const target of mapRoots.keys()) {
        if (!targets.has(target)) {
          throw new CliUsageError(
            `--map-root target ${target} has no matching --target`
          );
        }
      }
      const result = await finalizeBuildProofTargets(
        process.cwd(),
        [...targets].map(([target, artifactRoot]) => ({
          artifactRoot,
          ...(mapRoots.get(target)
            ? { mapRoot: mapRoots.get(target) as string }
            : {}),
          target,
        }))
      );
      const modules = result.reduce(
        (total, proof) => total + proof.emitted.length,
        0
      );
      await report(
        command,
        result,
        reporter,
        `${result.length} targets · ${modules} module${modules === 1 ? "" : "s"} finalized`
      );
      return;
    }
    const target = targetValues[0];
    const artifactRoot = option("--artifact-root");
    const mapRoot = option("--map-root") ?? artifactRoot;
    if (!target || !artifactRoot) {
      throw new CliUsageError(
        "finalize-proof requires --target <client|nitro|worker> and --artifact-root <directory>"
      );
    }
    const validatedTarget = buildTarget(target);
    const modules = await discoverEmittedModules(artifactRoot, mapRoot);
    const result = await finalizeBuildProof(
      process.cwd(),
      artifactRoot,
      validatedTarget,
      modules,
      mapRoot
    );
    await report(
      command,
      result,
      reporter,
      `${validatedTarget} · ${modules.length} module${modules.length === 1 ? "" : "s"} finalized`
    );
    return;
  }
  if (command === "prove-artifact") {
    const target = option("--target");
    const artifactRoot = option("--artifact-root");
    const mapRoot = option("--map-root") ?? artifactRoot;
    if (
      (target !== "client" && target !== "nitro" && target !== "worker") ||
      !artifactRoot
    ) {
      throw new CliUsageError(
        "prove-artifact requires --target <client|nitro|worker> and --artifact-root <directory>"
      );
    }
    const modules = await discoverEmittedModules(artifactRoot, mapRoot);
    const result = await writeProvisionalBuildProof(
      process.cwd(),
      artifactRoot,
      target as IntlBuildProofTargetV1,
      modules,
      mapRoot
    );
    await report(
      command,
      result,
      reporter,
      `${target} · ${modules.length} module${modules.length === 1 ? "" : "s"} proven`
    );
    return;
  }

  const source = (await loadConventionCatalog(process.cwd())).source;
  const compiled = compileCatalog(source);
  if (command === "contract") {
    await report(command, compiled.catalog.manifest, reporter, "manifest");
    return;
  }

  const path = option("--path");
  const descriptor = compiled.descriptors.find((entry) => entry.path === path);
  if (!descriptor) {
    throw new CliUsageError(`Unknown descriptor path ${path ?? ""}`);
  }
  const provenance = compiled.composition.provenance.find(
    (entry) => entry.path === path
  );
  await report(
    command,
    { descriptor, provenance },
    reporter,
    `${descriptor.path} · ${descriptor.kind}`
  );
}

function validationFailure(command: Command, message: string): boolean {
  if (
    /(?:config|tsconfig|pnpm-lock|lockfile|package\.json|Unable to resolve|EACCES|ENOENT)/iu.test(
      message
    )
  ) {
    return false;
  }
  if (
    command === "check" ||
    command === "catalog-check" ||
    command === "prove" ||
    command === "prove-artifact" ||
    command === "finalize-proof"
  ) {
    return true;
  }
  return /(?:missing locale|locale keys differ|non-empty translation|cross-locale|cannot be null|incompatible parsed|unsupported ICU|catalog .*mismatch|translation path)/iu.test(
    message
  );
}

await main().catch(async (error: unknown) => {
  const message =
    error instanceof Error ? error.message : "mirai-intl failed unexpectedly";
  if (
    activeCommand &&
    activeReporter &&
    !(error instanceof CliUsageError) &&
    (error instanceof CatalogValidationError ||
      validationFailure(activeCommand, message))
  ) {
    const diagnostic = catalogDiagnostic(error, activeCommand);
    const failure: CliReport = {
      command: activeCommand,
      diagnostics: [diagnostic],
      result: { diagnostics: [diagnostic], valid: false },
      schemaVersion: 1,
      success: false,
    };
    await emitReport(
      failure,
      activeReporter,
      failedSummary(activeCommand, 1, activeReporter.color)
    );
    process.exitCode = 1;
    return;
  }
  if (activeCommand && activeReportFile) {
    const diagnostic: CliDiagnostic = {
      code: "INTL_CLI_FAILURE",
      hint:
        error instanceof CliUsageError
          ? "Correct the command arguments and rerun Mirai Intl."
          : "Fix the configuration or reported internal failure, then rerun Mirai Intl.",
      message,
      severity: "error",
    };
    await writeReportFile(activeReportFile, {
      command: activeCommand,
      diagnostics: [diagnostic],
      schemaVersion: 1,
      success: false,
    }).catch(() => undefined);
  }
  process.stderr.write(`mirai-intl: ${message}\n`);
  process.exitCode = 2;
});
