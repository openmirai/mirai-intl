#!/usr/bin/env node

import { analyzeConventionSources } from "./analyze-sources";
import { canonicalJson } from "./canonical";
import { compileCatalog } from "./compile";
import {
  generateConventionCatalog,
  loadConventionCatalog,
  verifyConventionCatalog,
} from "./catalog";

type Command = "check" | "contract" | "ensure" | "explain" | "generate";

const commands = [
  "generate",
  "ensure",
  "check",
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
      "Usage: mirai-intl <generate|ensure|check|contract|explain> [--path <message>] [--skip-sources] [--json]"
    );
  }
  assertConventionOnly();

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
    const sourceAnalysis = await analyzeConventionSources(process.cwd(), {
      skipSources: hasFlag("--skip-sources"),
    });
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

await main();
