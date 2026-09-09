import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing ${name}`);
  }
  return value;
};
const catalogs = ["apps/a", "apps/b", "apps/c", "apps/d", "apps/e"];
const samples = 20;
const warmups = 5;

async function worker() {
  const started = performance.now();
  const repository = option("--repository");
  const root = option("--root");
  const module = (await import(
    pathToFileURL(join(repository, "packages/compiler/dist/verify.js")).href
  )) as {
    verifyWorkspaceBuildReceipts?: (root: string) => Promise<
      Array<{
        buildSemanticAnalysisRuns: number;
        catalogCompilations: number;
        artifactEmissions: number;
        verifiedCatalogs: number;
      }>
    >;
    verifyConventionBuildReceipt: (
      root: string
    ) => Promise<{ buildSemanticAnalysisRuns: number }>;
  };
  const verify = async () => {
    if (module.verifyWorkspaceBuildReceipts) {
      const results = await module.verifyWorkspaceBuildReceipts(root);
      if (
        results.length !== catalogs.length ||
        results.some(
          (result) =>
            result.buildSemanticAnalysisRuns !== 0 ||
            result.catalogCompilations !== 0 ||
            result.artifactEmissions !== 0 ||
            result.verifiedCatalogs !== 1
        )
      ) {
        throw new Error("Incomplete workspace verification");
      }
      return;
    }
    for (const catalog of catalogs) {
      const result = await module.verifyConventionBuildReceipt(
        join(root, catalog)
      );
      if (result.buildSemanticAnalysisRuns !== 0) {
        throw new Error("Unexpected semantic analysis");
      }
    }
  };
  if (args.includes("--probe")) {
    try {
      await verify();
      return { accepted: true };
    } catch (error) {
      return {
        accepted: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
  if (args.includes("--warm")) {
    for (let index = 0; index < warmups; index++) {
      await verify();
    }
    const milliseconds: Array<number> = [];
    for (let index = 0; index < samples; index++) {
      const start = performance.now();
      await verify();
      milliseconds.push(performance.now() - start);
    }
    return milliseconds;
  }
  await verify();
  return [performance.now() - started];
}

const statistics = (values: ReadonlyArray<number>) => {
  const ordered = values.toSorted((left, right) => left - right);
  const percentile = (fraction: number) =>
    ordered[Math.ceil(ordered.length * fraction) - 1];
  return {
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    samplesMs: values,
  };
};

export async function fixture(
  root: string,
  repository: string,
  authorize = true
) {
  await mkdir(root);
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'\nimporters:\n${catalogs.map((catalog) => `\n  ${catalog}:\n    dependencies: {}\n`).join("")}`
  );
  for (const [index, catalog] of catalogs.entries()) {
    const app = join(root, catalog);
    await mkdir(join(app, "src/locales"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({
        name: `@benchmark/app-${index}`,
        version: "1.0.0",
        dependencies: { vite: "8.1.4" },
      })
    );
    await writeFile(
      join(app, "tsconfig.json"),
      '{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}'
    );
    await writeFile(join(app, "src/page.ts"), "export const answer = 42;\n");
    for (const locale of ["en", "th"]) {
      const messages = Object.fromEntries(
        Array.from({ length: 1000 }, (_, key) => [
          `message${key}`,
          locale === "en"
            ? `Message ${key} for {name}`
            : `ข้อความ ${key} สำหรับ {name}`,
        ])
      );
      await writeFile(
        join(app, `src/locales/${locale}.json`),
        JSON.stringify(messages)
      );
    }
  }
  if (authorize) {
    await execute(
      process.execPath,
      [
        join(repository, "packages/compiler/dist/cli.js"),
        "check",
        "--workspace",
        "--format=json",
      ],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 }
    );
  }
}

async function benchmark() {
  const reference = resolve(option("--reference"));
  const candidate = resolve(option("--candidate"));
  const output = resolve(option("--out"));
  const temporary = await mkdtemp(join(tmpdir(), "intl-verify-benchmark-"));
  try {
    const engines = [
      { name: "reference", repository: reference },
      { name: "candidate", repository: candidate },
    ];
    for (const engine of engines) {
      await fixture(join(temporary, engine.name), engine.repository);
    }
    const run = async (engine: (typeof engines)[number], warm: boolean) => {
      const { stdout } = await execute(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          import.meta.filename,
          "--worker",
          "--repository",
          engine.repository,
          "--root",
          join(temporary, engine.name),
          ...(warm ? ["--warm"] : []),
        ],
        { maxBuffer: 16 * 1024 * 1024 }
      );
      return JSON.parse(stdout) as Array<number>;
    };
    const cold: Record<string, Array<number>> = {
      reference: [],
      candidate: [],
    };
    // Alternate paired engine order to reduce systematic temperature/order bias.
    for (let index = 0; index < samples; index++) {
      for (const engine of index % 2 === 0 ? engines : engines.toReversed()) {
        cold[engine.name]?.push(...(await run(engine, false)));
      }
    }
    const results = [];
    for (const engine of engines) {
      const { stdout } = await execute("git", ["rev-parse", "HEAD"], {
        cwd: engine.repository,
      });
      const { stdout: dirty } = await execute(
        "git",
        ["status", "--porcelain"],
        { cwd: engine.repository }
      );
      results.push({
        engine: engine.name,
        commit: stdout.trim(),
        dirty: Boolean(dirty.trim()),
        cold: statistics(cold[engine.name] ?? []),
        warm: statistics(await run(engine, true)),
      });
    }
    const report = {
      schemaVersion: 1,
      node: process.version,
      cpu: cpus()[0]?.model,
      samples,
      warmups,
      fixture: {
        catalogs: catalogs.length,
        keysPerCatalog: 1000,
        locales: 2,
        sourceFilesPerCatalog: 1,
      },
      scope:
        "Synthetic whole-workspace V3 verification only, not semantic authorization or full CI. Cold means fresh process plus compiler import; OS filesystem cache is not cleared. Warm excludes process/import startup. Each engine proves its own identical authored inputs with its own compiler identity.",
      results,
    };
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(await readFile(output, "utf8"));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] ?? "") === import.meta.filename) {
  if (args.includes("--worker")) {
    console.log(JSON.stringify(await worker()));
  } else {
    await benchmark();
  }
}
