#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

import { compileCatalog } from "./compile";
import {
  CatalogValidationError,
  generateConventionCatalog,
  loadConventionCatalog,
  verifyConventionCatalog,
} from "./catalog";
import { parseCanonicalCatalogCurrentPointer } from "./generation-snapshot";
import { ensureMiraiIntlCatalog } from "./lifecycle";
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
  CliSummary,
  ReporterOptions,
} from "./reporter";
import type {
  IntlBuildVerificationCountersV2,
  IntlBuildProofTargetV1,
  IntlSemanticAuthorizationObservationV2,
} from "@openmirai/intl-abi";

type Command =
  | "catalog-check"
  | "check"
  | "contract"
  | "ensure"
  | "explain"
  | "finalize-proof"
  | "generate"
  | "prove-artifact"
  | "prove"
  | "verify";

const commands = [
  "generate",
  "ensure",
  "check",
  "catalog-check",
  "prove",
  "verify",
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

function authorizationSummary(
  counters: IntlSemanticAuthorizationObservationV2
): string {
  return ` · ${counters.semanticAuthorizationRuns} authorization · ${counters.semanticFilesAnalyzed} files`;
}

function workspaceAuthorizationCounters(
  observations: ReadonlyArray<
    IntlSemanticAuthorizationObservationV2 &
      Readonly<{
        checkerProjects?: number;
        ownerProjects?: number;
      }>
  >
): IntlSemanticAuthorizationObservationV2 &
  Readonly<{ checkerProjects: number; ownerProjects: number }> {
  return {
    checkerProjects: observations.reduce(
      (total, observation) =>
        total + (finiteNumber(observation.checkerProjects) ?? 0),
      0
    ),
    ownerProjects: observations.reduce(
      (total, observation) =>
        total + (finiteNumber(observation.ownerProjects) ?? 0),
      0
    ),
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: observations.reduce(
      (total, observation) => total + observation.semanticFilesAnalyzed,
      0
    ),
  };
}

function buildVerificationCounters(): IntlBuildVerificationCountersV2 {
  return {
    buildReceiptVerifications: 1,
    buildSemanticAnalysisRuns: 0,
  };
}

function buildVerificationSummary(
  counters: IntlBuildVerificationCountersV2
): string {
  return ` · ${counters.buildReceiptVerifications} receipt verification · ${counters.buildSemanticAnalysisRuns} semantic builds`;
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
    command !== "catalog-check" &&
    command !== "verify"
  ) {
    throw new CliUsageError(
      "--workspace is only supported by check, catalog-check, and verify"
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
  const workspaceRoot = await realpath(
    await nearestWorkspaceRoot(process.cwd())
  );
  const roots = await discoverWorkspaceCatalogs(workspaceRoot);
  const diagnostics: Array<CliDiagnostic> = [];
  const catalogs: Array<{
    authorization?: IntlSemanticAuthorizationObservationV2 &
      Readonly<{ checkerProjects: number; ownerProjects: number }>;
    diagnostics: Array<CliDiagnostic>;
    receipt?: unknown;
    report?: unknown;
    root: string;
  }> = [];
  const messageCount: number | undefined = undefined;
  const weightedRoots = await Promise.all(
    roots.map(async (root, index) => {
      const workspacePath = relative(workspaceRoot, root).split("\\").join("/");
      return {
        index,
        root,
        weight:
          (workspacePath.startsWith("packages/") ? 1_000_000_000 : 0) +
          (await workspaceCatalogSourceWeight(root)),
      };
    })
  );
  const ordered = weightedRoots.toSorted(
    (left, right) => right.weight - left.weight || left.index - right.index
  );
  const workerCount = Math.min(
    ordered.length,
    workspaceAuthorizationWorkerCount()
  );
  const authorized = Array.from({ length: roots.length }) as Array<
    Awaited<ReturnType<typeof authorizeWorkspaceCatalogChild>>
  >;
  if (ordered.length === 1) {
    const [entry] = ordered;
    if (entry) {
      authorized[entry.index] = await authorizeWorkspaceCatalogInProcess(
        entry.root,
        workspaceRoot
      );
    }
  } else {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        for (;;) {
          const entry = ordered[cursor];
          cursor += 1;
          if (!entry) {
            return;
          }
          authorized[entry.index] = await authorizeWorkspaceCatalogChild(
            entry.root,
            workspaceRoot
          );
        }
      })
    );
  }
  for (const catalog of authorized) {
    catalogs.push(catalog);
    diagnostics.push(...catalog.diagnostics);
  }

  const observations = catalogs.flatMap(({ authorization, receipt }) => {
    if (authorization) {
      return [authorization];
    }
    if (
      receipt &&
      typeof receipt === "object" &&
      "counters" in receipt &&
      receipt.counters &&
      typeof receipt.counters === "object"
    ) {
      return [
        (
          receipt as Readonly<{
            counters: IntlSemanticAuthorizationObservationV2;
          }>
        ).counters,
      ];
    }
    return [];
  });
  const result = {
    authorization: workspaceAuthorizationCounters(observations),
    catalogs: catalogs.map(
      ({
        diagnostics: catalogDiagnostics,
        receipt,
        report: verification,
        root,
      }) => ({
        diagnostics: catalogDiagnostics,
        ...(receipt ? { receipt } : {}),
        ...(verification ? { report: verification } : {}),
        root,
        valid: catalogDiagnostics.length === 0,
      })
    ),
    valid: diagnostics.length === 0,
  };
  await report(
    "check",
    result,
    output,
    `${catalogs.length} catalogs${messageSummary(messageCount)}${authorizationSummary(
      result.authorization
    )}`,
    diagnostics
  );
  if (diagnostics.length > 0) {
    process.exitCode = 1;
  }
}

function workspaceAuthorizationWorkerCount(): number {
  const raw = process.env.MIRAI_INTL_WORKSPACE_WORKERS;
  if (raw === undefined) {
    return 5;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 8) {
    throw new CliUsageError(
      "MIRAI_INTL_WORKSPACE_WORKERS must be an integer from 1 through 8"
    );
  }
  return value;
}

async function workspaceCatalogSourceWeight(root: string): Promise<number> {
  let count = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isSymbolicLink()) {
          return;
        }
        if (entry.isDirectory()) {
          if (!workspaceSkipDirectories.has(entry.name)) {
            await visit(join(directory, entry.name));
          }
          return;
        }
        if (entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name)) {
          count += 1;
        }
      })
    );
  };
  await visit(root);
  return count;
}

async function authorizeWorkspaceCatalogChild(
  root: string,
  workspaceRoot: string
): Promise<{
  authorization?: IntlSemanticAuthorizationObservationV2 &
    Readonly<{ checkerProjects: number; ownerProjects: number }>;
  diagnostics: Array<CliDiagnostic>;
  root: string;
}> {
  const workspacePath = relative(workspaceRoot, root).split("\\").join("/");
  const cli = process.argv[1];
  if (!cli) {
    throw new Error("Mirai Intl CLI executable path is unavailable");
  }
  const reportFile = join(root, ".mirai-intl", "check.json");
  const child = spawn(
    process.execPath,
    [
      ...process.execArgv,
      cli,
      "prove",
      "--format=json",
      `--report-file=${reportFile}`,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        MIRAI_INTL_WORKSPACE_CHILD: "1",
        // Workspace authorization already owns process-level parallelism.
        // One libuv worker per child prevents five catalogs from multiplying
        // filesystem thread-pool contention while preserving the exact same
        // fail-closed reads, hashes, and publication barriers.
        UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? "1",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const status = await new Promise<
    Readonly<{ code: number | null; signal: NodeJS.Signals | null }>
  >((resolveStatus, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveStatus({ code, signal }));
  });
  let childReport: CliReport | undefined;
  try {
    childReport = JSON.parse(stdout) as CliReport;
  } catch {
    // The explicit process failure below retains stderr when the child could
    // not reach the canonical reporter.
  }
  const childDiagnostics = (childReport?.diagnostics ?? []).map(
    (diagnostic) => ({
      ...diagnostic,
      ...(diagnostic.file
        ? {
            file:
              workspacePath === "."
                ? diagnostic.file
                : `${workspacePath}/${diagnostic.file}`,
          }
        : {}),
    })
  );
  if (
    status.code !== 0 ||
    status.signal !== null ||
    childReport?.success !== true
  ) {
    return {
      diagnostics:
        childDiagnostics.length > 0
          ? childDiagnostics
          : [
              catalogDiagnostic(
                new Error(
                  `authorization worker failed (status=${String(status.code)}, signal=${String(status.signal)}): ${stderr.trim() || stdout.trim() || "no output"}`
                ),
                "check --workspace",
                workspacePath
              ),
            ],
      root: workspacePath,
    };
  }
  const summary = childReport.summary ?? {};
  return {
    authorization: {
      checkerProjects: finiteNumber(summary.checkerProjects) ?? 0,
      ownerProjects: finiteNumber(summary.ownerProjects) ?? 0,
      semanticAuthorizationRuns:
        finiteNumber(summary.semanticAuthorizationRuns) ?? 0,
      semanticFilesAnalyzed: finiteNumber(summary.semanticFilesAnalyzed) ?? 0,
    },
    diagnostics: [],
    root: workspacePath,
  };
}

async function authorizeWorkspaceCatalogInProcess(
  root: string,
  workspaceRoot: string
): ReturnType<typeof authorizeWorkspaceCatalogChild> {
  const workspacePath = relative(workspaceRoot, root).split("\\").join("/");
  const { authorizeConventionCatalog, IntlSourceAuthorizationError } =
    await import("./proof");
  try {
    const { receipt } = await authorizeConventionCatalog(root, {
      collectEnvironment: false,
      validateEnvironment: true,
    });
    return {
      authorization: {
        checkerProjects: receipt.counters.checkerProjects,
        ownerProjects: receipt.counters.ownerProjects,
        semanticAuthorizationRuns: receipt.counters.semanticAuthorizationRuns,
        semanticFilesAnalyzed: receipt.counters.semanticFilesAnalyzed,
      },
      diagnostics: [],
      root: workspacePath,
    };
  } catch (error) {
    if (error instanceof IntlSourceAuthorizationError) {
      return {
        authorization: error.observation,
        diagnostics: sourceDiagnostics(error.diagnostics, root).map(
          (diagnostic) => ({
            ...diagnostic,
            ...(diagnostic.file && workspacePath !== "."
              ? { file: `${workspacePath}/${diagnostic.file}` }
              : {}),
          })
        ),
        root: workspacePath,
      };
    }
    return {
      diagnostics: [
        catalogDiagnostic(error, "check --workspace", workspacePath),
      ],
      root: workspacePath,
    };
  }
}

async function verifyWorkspace(output: ReporterOptions): Promise<void> {
  const { verifyConventionBuildReceipt } = await import("./check-receipt");
  const workspaceRoot = await realpath(
    await nearestWorkspaceRoot(process.cwd())
  );
  const roots = await discoverWorkspaceCatalogs(workspaceRoot);
  const diagnostics: Array<CliDiagnostic> = [];
  const catalogs: Array<{
    build?: IntlBuildVerificationCountersV2;
    diagnostics: Array<CliDiagnostic>;
    root: string;
  }> = [];
  for (const root of roots) {
    const workspacePath = relative(workspaceRoot, root).split("\\").join("/");
    try {
      const verification = await verifyConventionBuildReceipt(root);
      catalogs.push({
        build: verification,
        diagnostics: [],
        root: workspacePath,
      });
    } catch (error) {
      const catalogDiagnostics = [
        catalogDiagnostic(error, "verify --workspace", workspacePath),
      ];
      diagnostics.push(...catalogDiagnostics);
      catalogs.push({ diagnostics: catalogDiagnostics, root: workspacePath });
    }
  }
  const semanticBuildRuns = catalogs.reduce<number>(
    (total, catalog) => total + (catalog.build?.buildSemanticAnalysisRuns ?? 0),
    0
  );
  if (semanticBuildRuns !== 0) {
    throw new Error("Mirai Intl build verification invoked semantic analysis");
  }
  const build: IntlBuildVerificationCountersV2 = {
    buildReceiptVerifications: catalogs.reduce<number>(
      (total, catalog) =>
        total + (catalog.build?.buildReceiptVerifications ?? 0),
      0
    ),
    buildSemanticAnalysisRuns: 0,
  };
  await report(
    "verify",
    {
      build,
      catalogs: catalogs.map((catalog) => ({
        diagnostics: catalog.diagnostics,
        root: catalog.root,
        valid: catalog.diagnostics.length === 0,
      })),
      valid: diagnostics.length === 0,
    },
    output,
    `${catalogs.length} catalogs${buildVerificationSummary(build)}`,
    diagnostics
  );
  if (diagnostics.length > 0) {
    process.exitCode = 1;
  }
}

function sourceDiagnostics(
  diagnostics: ReadonlyArray<{ file: string; message: string }>,
  root: string
): Array<CliDiagnostic> {
  return diagnostics
    .map((diagnostic) => {
      const location = /^(\d+)(?::(\d+))?:\s*(.*)$/u.exec(diagnostic.message);
      const relativeFile = relative(root, resolve(root, diagnostic.file))
        .split("\\")
        .join("/");
      const file =
        relativeFile === "" ||
        relativeFile === ".." ||
        relativeFile.startsWith("../") ||
        isAbsolute(relativeFile)
          ? basename(diagnostic.file)
          : relativeFile;
      return {
        code: "INTL_SOURCE_INVALID",
        ...(location?.[2] ? { column: Number(location[2]) } : {}),
        file,
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

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
  return value && typeof value === "object"
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function reportSummary(
  command: Command,
  result: unknown,
  success: boolean
): CliSummary {
  const value = objectValue(result);
  const authorization = objectValue(value.authorization);
  const build = objectValue(value.build);
  const catalog = catalogSummary(result);
  const summary: Record<
    string,
    | boolean
    | number
    | string
    | ReadonlyArray<Readonly<Record<string, boolean | number | string>>>
  > = {
    valid: success,
  };
  const copyNumber = (
    destination: string,
    source: Readonly<Record<string, unknown>>,
    property: string = destination
  ): void => {
    const number = finiteNumber(source[property]);
    if (number !== undefined) {
      summary[destination] = number;
    }
  };

  if (command === "generate" || command === "catalog-check") {
    summary.catalogId = catalog.catalogId;
    summary.locales = catalog.locales;
    if (catalog.messageCount !== undefined) {
      summary.messageCount = catalog.messageCount;
    }
  }
  if (command === "ensure" && typeof value.changed === "boolean") {
    summary.changed = value.changed;
  }
  if (command === "check" || command === "prove") {
    copyNumber("semanticAuthorizationRuns", authorization);
    copyNumber("semanticFilesAnalyzed", authorization);
    copyNumber("ownerProjects", authorization);
    copyNumber("checkerProjects", authorization);
    if (Array.isArray(value.catalogs)) {
      summary.catalogCount = value.catalogs.length;
      summary.projects = value.catalogs.map((entry) => {
        const projectCatalog = objectValue(entry);
        const catalogDiagnostics = Array.isArray(projectCatalog.diagnostics)
          ? projectCatalog.diagnostics
          : [];
        return {
          findings: catalogDiagnostics.length,
          path:
            typeof projectCatalog.root === "string" ? projectCatalog.root : ".",
          valid: projectCatalog.valid === true,
        };
      });
    }
  }
  if (
    command === "prove-artifact" ||
    command === "finalize-proof" ||
    command === "verify"
  ) {
    copyNumber("buildReceiptVerifications", build);
    copyNumber("buildSemanticAnalysisRuns", build);
  }
  return summary;
}

async function report(
  command: Command,
  result: unknown,
  options: ReporterOptions,
  detail: string,
  diagnostics: ReadonlyArray<CliDiagnostic> = [],
  summary?: CliSummary
): Promise<void> {
  const success = diagnostics.every(
    (diagnostic) => diagnostic.severity !== "error"
  );
  const payload: CliReport = {
    command,
    diagnostics,
    ...(command === "contract" ? { rawJson: result } : {}),
    schemaVersion: 1,
    success,
    summary: summary ?? reportSummary(command, result, success),
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
      "Usage: mirai-intl <generate|ensure|check|catalog-check|prove|verify|prove-artifact|finalize-proof|contract|explain> [--format <stylish|json>] [--json]"
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
  if (command === "verify" && hasFlag("--workspace")) {
    await verifyWorkspace(reporter);
    return;
  }
  if (command === "verify") {
    const { verifyConventionBuildReceipt } = await import("./check-receipt");
    const result = await verifyConventionBuildReceipt(process.cwd());
    await report(
      command,
      { build: result, receipt: result.receipt },
      reporter,
      buildVerificationSummary(result).slice(3)
    );
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
    const result = await ensureMiraiIntlCatalog({ root: process.cwd() });
    const pointer = parseCanonicalCatalogCurrentPointer(
      await readFile(join(result.loaded.outputRoot, "current.json"), "utf8")
    );
    const payload = {
      changed: result.changed,
      contentHash: pointer.contentHash,
      directory: join(result.loaded.outputRoot, pointer.directory),
    };
    await report(
      command,
      payload,
      reporter,
      result.changed ? "catalog updated" : "catalog current"
    );
    return;
  }
  if (command === "check") {
    const projectRoot = await realpath(process.cwd());
    const result = await verifyConventionCatalog(projectRoot);
    const { analyzeConventionSources } = await import("./analyze-sources");
    const sourceAnalysis = await analyzeConventionSources(projectRoot);
    const authorization: IntlSemanticAuthorizationObservationV2 = {
      semanticAuthorizationRuns: 1,
      semanticFilesAnalyzed: sourceAnalysis.filesAnalyzed,
    };
    if (sourceAnalysis.diagnostics.length > 0) {
      await report(
        command,
        {
          ...result,
          authorization,
          sourceAnalysis,
          valid: false,
        },
        reporter,
        "",
        sourceDiagnostics(sourceAnalysis.diagnostics, projectRoot)
      );
      process.exitCode = 1;
      return;
    }
    const payload = {
      ...result,
      authorization,
      sourceAnalysis,
    };
    const summary = catalogSummary(payload);
    await report(
      command,
      payload,
      reporter,
      `${summary.catalogId} · ${summary.locales}${messageSummary(
        summary.messageCount
      )}${authorizationSummary(authorization)}`
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
    const { proveConventionCatalog } = await import("./proof");
    const result = await proveConventionCatalog(process.cwd());
    await report(
      command,
      {
        authorization: result.counters,
        receipt: result,
      },
      reporter,
      `${result.sources.length} source${result.sources.length === 1 ? "" : "s"} authorized${authorizationSummary(
        result.counters
      )}`
    );
    return;
  }
  if (command === "finalize-proof") {
    const {
      discoverEmittedModules,
      finalizeBuildProof,
      finalizeBuildProofTargets,
    } = await import("./proof");
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
      const build = buildVerificationCounters();
      await report(
        command,
        { build, proofs: result },
        reporter,
        `${result.length} targets · ${modules} module${modules === 1 ? "" : "s"} finalized${buildVerificationSummary(
          build
        )}`
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
    const build = buildVerificationCounters();
    await report(
      command,
      { build, proof: result },
      reporter,
      `${validatedTarget} · ${modules.length} module${modules.length === 1 ? "" : "s"} finalized${buildVerificationSummary(
        build
      )}`
    );
    return;
  }
  if (command === "prove-artifact") {
    const { discoverEmittedModules, writeProvisionalBuildProof } =
      await import("./proof");
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
    const build = buildVerificationCounters();
    await report(
      command,
      { build, proof: result },
      reporter,
      `${target} · ${modules.length} module${modules.length === 1 ? "" : "s"} proven${buildVerificationSummary(
        build
      )}`
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
    command === "verify" ||
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
      schemaVersion: 1,
      success: false,
      summary: { valid: false },
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
      summary: {},
    }).catch(() => undefined);
  }
  process.stderr.write(`mirai-intl: ${message}\n`);
  process.exitCode = 2;
});
