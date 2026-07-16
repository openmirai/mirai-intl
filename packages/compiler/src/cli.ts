#!/usr/bin/env node

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

function assertConventionOnly(): void {
  const legacy = removedOptions.find((name) => process.argv.includes(name));
  if (legacy) {
    throw new Error(
      `${legacy} is not supported; mirai-intl uses convention discovery and compact production generation`
    );
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (!command || !commands.includes(command)) {
    throw new Error(
      "Usage: mirai-intl <generate|ensure|check|contract|explain> [--path <message>]"
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
    process.stdout.write(`${canonicalJson(result)}\n`);
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
