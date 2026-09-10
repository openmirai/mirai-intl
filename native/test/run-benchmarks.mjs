import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const output = resolve(process.argv[2] ?? ".tmp/native-benchmark-streaming");
mkdirSync(output, { recursive: true });
const commands = [];
for (let block = 0; block < 3; block++) {
  for (const scenario of ["receipt", "hash"]) {
    for (const mode of ["cold", "warm"]) {
      const order = ["node", "addon", "worker"];
      for (let offset = 0; offset < 3; offset++) {
        const backend = order[(block + offset) % 3];
        const label = `${scenario}-${mode}-${backend}-${block}`;
        const args = [
          "benchmarks/ci-operation.mjs",
          "--label",
          label,
          "--mode",
          mode,
          "--samples",
          "10",
          "--timeout-ms",
          "120000",
          "--total-timeout-ms",
          "300000",
          "--input",
          ".tmp/native-corpus",
          "--input",
          "native/target/release/mirai_intl_engine.node",
          "--input",
          "native/target/release/mirai-intl-worker",
          "--input",
          "native/test/benchmark-operation.mjs",
          "--input",
          "packages/compiler/src/canonical.ts",
          "--output",
          `${output}/${label}.json`,
        ];
        if (mode === "warm") {
          args.push("--warmups", "2");
        }
        args.push(
          "--",
          process.execPath,
          "--import",
          "tsx",
          "native/test/benchmark-operation.mjs",
          backend,
          scenario,
          ".tmp/native-corpus/manifest.json",
          mode
        );
        commands.push({
          label,
          executable: process.execPath,
          args,
          env: { UV_THREADPOOL_SIZE: "4" },
        });
        writeFileSync(
          `${output}/commands.json`,
          `${JSON.stringify(commands, null, 2)}\n`
        );
        process.stdout.write(`Measuring ${label}\n`);
        const result = spawnSync(process.execPath, args, {
          env: { ...process.env, UV_THREADPOOL_SIZE: "4" },
          encoding: "utf8",
          timeout: 330_000,
          maxBuffer: 1024 * 1024,
        });
        writeFileSync(
          `${output}/${label}.log`,
          `${result.stdout ?? ""}${result.stderr ?? ""}`
        );
        if (result.error || result.signal || result.status !== 0) {
          throw new Error(
            `Benchmark failed: ${label}: ${result.error ?? result.signal ?? result.status}`
          );
        }
      }
    }
  }
}
