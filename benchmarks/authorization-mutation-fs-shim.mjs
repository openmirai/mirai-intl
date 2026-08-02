import * as actual from "node:fs/promises";
import { resolve } from "node:path";

export * from "node:fs/promises";

const targetInput = resolve(
  process.env.MIRAI_INTL_BENCHMARK_MUTATION_TARGET ?? "/missing"
);
const target = await actual.realpath(targetInput).catch(() => targetInput);
let matchingReads = 0;

process.once("exit", () => {
  process.stderr.write(
    `\nMIRAI_INTL_BENCHMARK_MUTATION_READS=${matchingReads}\n`
  );
});

export async function readFile(path, ...args) {
  const value = await actual.readFile(path, ...args);
  const input = resolve(String(path));
  const canonical = await actual.realpath(input).catch(() => input);
  if (canonical !== target) {
    return value;
  }
  matchingReads += 1;
  if (matchingReads < 2) {
    return value;
  }
  return typeof value === "string"
    ? `${value}\n/* deterministic mid-authorization mutation */\n`
    : Buffer.concat([
        value,
        Buffer.from("\n/* deterministic mid-authorization mutation */\n"),
      ]);
}
