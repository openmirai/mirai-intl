import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { fixture } from "./receipt-verification";

const execute = promisify(execFile);
const args = process.argv.slice(2);
const option = (name: string) => {
  const value = args[args.indexOf(name) + 1];
  if (args.indexOf(name) < 0 || !value) {
    throw new Error(`Missing ${name}`);
  }
  return resolve(value);
};
const catalogs = ["apps/a", "apps/b", "apps/c", "apps/d", "apps/e"];

async function pipeline() {
  const repository = option("--repository");
  const compiler = (await import(
    pathToFileURL(join(repository, "packages/compiler/dist/index.js")).href
  )) as {
    generateConventionCatalog: (root: string) => Promise<unknown>;
    proveConventionCatalog: (root: string) => Promise<unknown>;
  };
  const transfer = (await import(
    pathToFileURL(join(repository, "packages/compiler/dist/verify.js")).href
  )) as {
    exportAuthorityBundle: (options: {
      root: string;
      archive: string;
    }) => Promise<{ bytes: number }>;
    importAuthorityBundle: (options: {
      root: string;
      archive: string;
    }) => Promise<unknown>;
    verifyConventionBuildReceipt: (root: string) => Promise<unknown>;
    verifyWorkspaceBuildReceipts?: (root: string) => Promise<Array<unknown>>;
  };
  const temporary = await mkdtemp(join(tmpdir(), "intl-pipeline-sample-"));
  try {
    const producer = join(temporary, "producer");
    const consumer = join(temporary, "consumer");
    const archive = join(temporary, "authority.tar");
    await fixture(producer, repository, false);
    await cp(producer, consumer, { recursive: true });
    const measure = async (operation: () => Promise<unknown>) => {
      const start = performance.now();
      await operation();
      return performance.now() - start;
    };
    const started = performance.now();
    const generationMs = await measure(async () => {
      for (const catalog of catalogs) {
        await compiler.generateConventionCatalog(join(producer, catalog));
      }
    });
    const authorizationMs = await measure(async () => {
      for (const catalog of catalogs) {
        await compiler.proveConventionCatalog(join(producer, catalog));
      }
    });
    let selectedBytes = 0;
    const exportMs = await measure(async () => {
      selectedBytes = (
        await transfer.exportAuthorityBundle({ root: producer, archive })
      ).bytes;
    });
    const importMs = await measure(() =>
      transfer.importAuthorityBundle({ root: consumer, archive })
    );
    const verificationMs = await measure(async () => {
      if (transfer.verifyWorkspaceBuildReceipts) {
        const results = await transfer.verifyWorkspaceBuildReceipts(consumer);
        if (results.length !== catalogs.length) {
          throw new Error("Incomplete verification");
        }
      } else {
        for (const catalog of catalogs) {
          await transfer.verifyConventionBuildReceipt(join(consumer, catalog));
        }
      }
    });
    return {
      generationMs,
      authorizationMs,
      exportMs,
      importMs,
      verificationMs,
      totalMs: performance.now() - started,
      selectedBytes,
      archiveBytes: (await stat(archive)).size,
      resourceUsage: process.resourceUsage(),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (args.includes("--worker")) {
  console.log(JSON.stringify(await pipeline()));
} else {
  const engines = [
    { name: "reference", repository: option("--reference") },
    { name: "candidate", repository: option("--candidate") },
  ];
  const observations: Array<{
    engine: string;
    sample: number;
    values: Awaited<ReturnType<typeof pipeline>>;
  }> = [];
  for (let sample = 0; sample < 20; sample++) {
    for (const engine of sample % 2 === 0 ? engines : engines.toReversed()) {
      const { stdout } = await execute(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          import.meta.filename,
          "--worker",
          "--repository",
          engine.repository,
        ],
        { maxBuffer: 16 * 1024 * 1024 }
      );
      observations.push({
        engine: engine.name,
        sample,
        values: JSON.parse(stdout) as Awaited<ReturnType<typeof pipeline>>,
      });
    }
  }
  const metrics = [
    "generationMs",
    "authorizationMs",
    "exportMs",
    "importMs",
    "verificationMs",
    "totalMs",
  ] as const;
  const summary = engines.map((engine) => ({
    engine: engine.name,
    metrics: Object.fromEntries(
      metrics.map((metric) => {
        const sorted = observations
          .filter((entry) => entry.engine === engine.name)
          .map((entry) => entry.values[metric])
          .toSorted((a, b) => a - b);
        return [metric, { median: sorted[9], p95: sorted[18] }];
      })
    ),
  }));
  const revisions = await Promise.all(
    engines.map(async (engine) => {
      const { stdout: commit } = await execute("git", ["rev-parse", "HEAD"], {
        cwd: engine.repository,
      });
      return { ...engine, commit: commit.trim() };
    })
  );
  const output = option("--out");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ node: process.version, platform: process.platform, scope: "20 fresh-process samples per engine; five synthetic catalogs, 1000 keys, two locales, one source file each. Module loading and authored fixture setup excluded. Includes native resourceUsage (maxRSS) and artifact byte sizes. Not frontend bundling or complete CI.", revisions, summary, observations }, null, 2)}\n`
  );
  console.log(JSON.stringify({ output, summary }));
  await readFile(output);
}
