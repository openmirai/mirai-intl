#!/usr/bin/env node

import { analyzeConventionSources } from "./analyze-sources";
import { canonicalJson } from "./canonical";
import { compileCatalog } from "./compile";
import {
  generateConventionCatalog,
  loadConventionCatalog,
  verifyConventionCatalog,
} from "./catalog";
import {
  discoverEmittedModules,
  finalizeBuildProof,
  proveConventionCatalog,
  writeProvisionalBuildProof,
} from "./proof";
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
    throw new Error(
      `${legacy} is not supported; mirai-intl uses convention discovery and compact production generation`
    );
  }
}

function assertNoSourceBypass(): void {
  if (hasFlag("--skip-sources")) {
    throw new Error(
      "--skip-sources is not supported: source analysis is required for an authorizing check"
    );
  }
}

function writeCheckReport(payload: unknown): void {
  if (hasFlag("--json")) {
    process.stdout.write(`${canonicalJson(payload)}\n`);
    return;
  }

  const report =
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
  const catalog = report?.catalog;
  const catalogId = catalog?.catalogId ?? "catalog";
  const locales = catalog?.locales?.join("+") ?? "unknown";
  const messageCount = catalog?.messageCounts
    ? Object.values(catalog.messageCounts).reduce(
        (total, count) => total + count,
        0
      )
    : undefined;
  const valid =
    payload &&
    typeof payload === "object" &&
    "valid" in payload &&
    (payload as { valid?: boolean }).valid === false
      ? false
      : (report?.valid ?? true);

  const summary = [
    valid ? "ok" : "failed",
    catalogId,
    locales,
    messageCount === undefined ? undefined : `${messageCount} messages`,
  ]
    .filter((part): part is string => typeof part === "string")
    .join(" · ");

  process.stdout.write(`mirai-intl check ${summary}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !commands.includes(command)) {
    throw new Error(
      "Usage: mirai-intl <generate|ensure|check|catalog-check|prove|prove-artifact|finalize-proof|contract|explain> [--path <message>] [--json]"
    );
  }
  assertConventionOnly();
  assertNoSourceBypass();

  if (command === "generate") {
    const result = await generateConventionCatalog(process.cwd());
    process.stdout.write(`${canonicalJson(result)}\n`);
    return;
  }
  if (command === "ensure") {
    const result = await generateConventionCatalog(process.cwd(), {
      collectEnvironment: false,
    });
    process.stdout.write(
      `${canonicalJson({
        changed: result.write.changed,
        contentHash: result.write.contentHash,
        directory: result.write.directory,
      })}\n`
    );
    return;
  }
  if (command === "check") {
    const result = await verifyConventionCatalog(process.cwd());
    const sourceAnalysis = await analyzeConventionSources(process.cwd());
    if (sourceAnalysis.diagnostics.length > 0) {
      for (const diagnostic of sourceAnalysis.diagnostics) {
        process.stderr.write(`${diagnostic.file}: ${diagnostic.message}\n`);
      }
      process.stderr.write(
        `mirai-intl check failed: ${String(sourceAnalysis.diagnostics.length)} source diagnostic(s)\n`
      );
      writeCheckReport({
        ...result,
        sourceAnalysis,
        valid: false,
      });
      process.exitCode = 1;
      return;
    }
    writeCheckReport({
      ...result,
      sourceAnalysis,
    });
    return;
  }
  if (command === "catalog-check") {
    const result = await verifyConventionCatalog(process.cwd());
    writeCheckReport(result);
    return;
  }
  if (command === "prove") {
    process.stdout.write(
      `${canonicalJson(await proveConventionCatalog(process.cwd()))}\n`
    );
    return;
  }
  if (command === "finalize-proof") {
    const target = option("--target");
    const artifactRoot = option("--artifact-root");
    const mapRoot = option("--map-root") ?? artifactRoot;
    if (
      (target !== "client" && target !== "nitro" && target !== "worker") ||
      !artifactRoot
    ) {
      throw new Error(
        "finalize-proof requires --target <client|nitro|worker> and --artifact-root <directory>"
      );
    }
    const modules = await discoverEmittedModules(artifactRoot, mapRoot);
    process.stdout.write(
      `${canonicalJson(
        await finalizeBuildProof(
          process.cwd(),
          artifactRoot,
          target as IntlBuildProofTargetV1,
          modules,
          mapRoot
        )
      )}\n`
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
      throw new Error(
        "prove-artifact requires --target <client|nitro|worker> and --artifact-root <directory>"
      );
    }
    const modules = await discoverEmittedModules(artifactRoot, mapRoot);
    process.stdout.write(
      `${canonicalJson(
        await writeProvisionalBuildProof(
          process.cwd(),
          artifactRoot,
          target as IntlBuildProofTargetV1,
          modules,
          mapRoot
        )
      )}\n`
    );
    return;
  }

  const source = (await loadConventionCatalog(process.cwd())).source;
  const output = compileCatalog(source);
  if (command === "contract") {
    process.stdout.write(`${canonicalJson(output.catalog.manifest)}\n`);
    return;
  }

  const path = option("--path");
  const descriptor = output.descriptors.find((entry) => entry.path === path);
  if (!descriptor) {
    throw new Error(`Unknown descriptor path ${path ?? ""}`);
  }
  const provenance = output.composition.provenance.find(
    (entry) => entry.path === path
  );
  process.stdout.write(`${canonicalJson({ descriptor, provenance })}\n`);
}

await main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "mirai-intl failed unexpectedly";
  process.stderr.write(`mirai-intl: ${message}\n`);
  process.exitCode = 1;
});
