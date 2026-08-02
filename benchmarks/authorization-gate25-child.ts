import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import {
  cloneInstalledWorkspace,
  dependencyTopologyIdentity,
  GATE_25_PACKAGE_PATHS,
  gate25WorkerGroups,
} from "./authorization-gate25-workspace";
import {
  gate25CanonicalHash,
  gate25CompilerIdentity,
  gate25SemanticEvidence,
  verifyGate25ReceiptIdentity,
} from "./authorization-gate25-parity";

type JsonObject = Readonly<Record<string, unknown>>;

type PackageResult = Readonly<{
  catalogPayloadHash: string;
  ensureMilliseconds: number;
  identity: ReturnType<typeof verifyGate25ReceiptIdentity>;
  packagePath: string;
  semantic: ReturnType<typeof gate25SemanticEvidence>;
  peakRssBytes: number;
  programCount: number;
  proveMilliseconds: number;
  receiptHash: string;
  sourceCount: number;
}>;

type SemanticWorkerResult = Readonly<{
  invocations: ReadonlyArray<
    Readonly<{
      packagePath: string;
      result: Awaited<ReturnType<typeof runCli>>;
    }>
  >;
  packagePaths: ReadonlyArray<string>;
  peakRssBytes: number;
  programCount: number;
  workerIndex: number;
}>;

const packagePaths = GATE_25_PACKAGE_PATHS;
const childStarted = performance.now();
let transactionSetupMilliseconds: number | undefined;
let transactionTopology:
  | Awaited<ReturnType<typeof dependencyTopologyIdentity>>
  | undefined;

function stringOption(name: string): string {
  const prefix = `${name}=`;
  const value = process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix));
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value.slice(prefix.length);
}

function optionalStringOption(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function integerOption(name: string): number {
  const value = Number(stringOption(name));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function asObject(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value as JsonObject;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

async function materializeColdWorkspace(
  seedRoot: string,
  runRoot: string
): Promise<Awaited<ReturnType<typeof dependencyTopologyIdentity>>> {
  const workspace = join(runRoot, "workspace");
  cloneInstalledWorkspace(seedRoot, workspace);
  const topology = await dependencyTopologyIdentity(workspace);
  await Promise.all(
    packagePaths.flatMap((packagePath) => [
      rm(join(workspace, packagePath, ".mirai-intl"), {
        force: true,
        recursive: true,
      }),
      rm(join(workspace, packagePath, "src/i18n/generated"), {
        force: true,
        recursive: true,
      }),
    ])
  );
  return topology;
}

function parseProfile(stderr: string): Readonly<{
  maxRssBytes: number;
  programCount: number;
}> {
  const match = /MIRAI_INTL_BENCHMARK_PROFILE=(\{[^\n]+\})/u.exec(stderr);
  if (!match?.[1]) {
    throw new Error(`TypeScript profiler evidence is missing:\n${stderr}`);
  }
  const profile = asObject(JSON.parse(match[1]), "profiler output");
  const counters = asObject(profile.counters, "profiler counters");
  const programCount = Object.values(counters).reduce<number>(
    (total, value) => {
      if (typeof value !== "number") {
        throw new Error("Profiler counter must be numeric");
      }
      return total + value;
    },
    0
  );
  if (typeof profile.maxRssBytes !== "number") {
    throw new Error("Profiler maxRssBytes must be numeric");
  }
  return { maxRssBytes: profile.maxRssBytes, programCount };
}

async function runCli(
  cli: string,
  cwd: string,
  reportPath: string,
  command: "check-workspace" | "ensure" | "prove"
): Promise<
  Readonly<{
    milliseconds: number;
    output: JsonObject;
    peakRssBytes: number;
    programCount: number;
  }>
> {
  await mkdir(dirname(reportPath), { recursive: true });
  const typescript = resolve(
    dirname(cli),
    "../node_modules/typescript/lib/typescript.js"
  );
  const profiler = resolve(import.meta.dirname, "authorization-profiler.mjs");
  const started = performance.now();
  const child = spawn(
    process.execPath,
    [
      "--import",
      profiler,
      cli,
      ...(command === "check-workspace" ? ["check", "--workspace"] : [command]),
      "--format=json",
      `--report-file=${reportPath}`,
    ],
    {
      cwd,
      env: {
        ...process.env,
        CI: "1",
        FORCE_COLOR: "0",
        MIRAI_INTL_BENCHMARK_TYPESCRIPT: typescript,
        NODE_ENV: "production",
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
    Readonly<{ code: number | null; signal: string | null }>
  >((resolveStatus, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolveStatus({ code, signal }));
  });
  const milliseconds = performance.now() - started;
  if (status.code !== 0 || status.signal) {
    throw new Error(
      [
        `Gate 2.5 ${command} failed in ${cwd}`,
        `status=${String(status.code)} signal=${String(status.signal)}`,
        `stdout=${stdout}`,
        `stderr=${stderr}`,
      ].join("\n")
    );
  }
  const output = asObject(JSON.parse(stdout), `${command} stdout`);
  if (
    output.success === false ||
    (Array.isArray(output.diagnostics) &&
      output.diagnostics.some(
        (diagnostic) =>
          diagnostic &&
          typeof diagnostic === "object" &&
          "severity" in diagnostic &&
          diagnostic.severity === "error"
      ))
  ) {
    throw new Error(`Gate 2.5 ${command} reported a failed result`);
  }
  const profile = parseProfile(stderr);
  return {
    milliseconds,
    output,
    peakRssBytes: profile.maxRssBytes,
    programCount: profile.programCount,
  };
}

async function regularFiles(
  root: string,
  directory: string
): Promise<Array<string>> {
  const result: Array<string> = [];
  if (!(await exists(directory))) {
    return result;
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await regularFiles(root, path)));
    } else if (entry.isFile()) {
      result.push(relative(root, path).split("\\").join("/"));
    }
  }
  return result;
}

async function catalogPayloadHash(packageRoot: string): Promise<string> {
  const outputRoot = join(packageRoot, "src/i18n/generated");
  const paths = (await regularFiles(packageRoot, outputRoot))
    .filter(
      (path) =>
        !path.endsWith("/current.json") &&
        !path.endsWith("catalog-generation-receipt.v1.json")
    )
    .toSorted();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readFile(join(packageRoot, path)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

async function mapPool<Input, Output>(
  inputs: ReadonlyArray<Input>,
  poolSize: number,
  action: (input: Input) => Promise<Output>
): Promise<ReadonlyArray<Output>> {
  const output = Array.from({ length: inputs.length }) as Array<Output>;
  let cursor = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(poolSize, inputs.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const input = inputs[index];
        if (input === undefined) {
          return;
        }
        output[index] = await action(input);
      }
    })
  );
  const failures = workers.flatMap((worker) =>
    worker.status === "rejected"
      ? [
          worker.reason instanceof Error
            ? worker.reason.message
            : String(worker.reason),
        ]
      : []
  );
  if (failures.length > 0) {
    throw new Error(
      [
        "Gate 2.5 bounded workers failed without retry or replacement",
        ...failures,
      ].join("\n---\n")
    );
  }
  return output;
}

function concurrentPeak(
  values: ReadonlyArray<number>,
  poolSize: number
): number {
  return values
    .toSorted((left, right) => right - left)
    .slice(0, poolSize)
    .reduce((total, value) => total + value, 0);
}

function assertExactSemanticMerge(
  workers: ReadonlyArray<SemanticWorkerResult>
): ReadonlyMap<string, Awaited<ReturnType<typeof runCli>>> {
  const results = workers.flatMap(({ invocations }) => invocations);
  const observed = results.map(({ packagePath }) => packagePath).toSorted();
  const expected = [...packagePaths].toSorted();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error(
      `Gate 2.5 semantic worker merge is incomplete: expected ${JSON.stringify(expected)}, received ${JSON.stringify(observed)}`
    );
  }
  const merged = new Map(
    results.map(({ packagePath, result }) => [packagePath, result])
  );
  if (merged.size !== packagePaths.length) {
    throw new Error(
      "Gate 2.5 semantic worker merge contains duplicate projects"
    );
  }
  return merged;
}

async function runEngine(
  cli: string,
  seedRoot: string,
  poolSize: number,
  label: string,
  retainedRunRoot?: string
): Promise<
  Readonly<{
    catalogPayloadHash: string;
    completeMilliseconds: number;
    generationMilliseconds: number;
    packages: ReadonlyArray<PackageResult>;
    parityHash: string;
    peakRssBytes: number;
    programCount: number;
    receiptHash: string;
    semanticMilliseconds: number;
    setupMilliseconds: number;
    sourceCount: number;
    topology: Awaited<ReturnType<typeof dependencyTopologyIdentity>>;
    workspace: string | null;
    workers: ReadonlyArray<
      Readonly<{
        packagePaths: ReadonlyArray<string>;
        peakRssBytes: number;
        programCount: number;
        workerIndex: number;
      }>
    >;
  }>
> {
  const setupStarted = performance.now();
  const runRoot = retainedRunRoot
    ? resolve(retainedRunRoot)
    : await mkdtemp(join(tmpdir(), `mirai-intl-gate25-${label}-`));
  if (retainedRunRoot) {
    await rm(runRoot, { force: true, recursive: true });
    await mkdir(runRoot, { recursive: true });
  }
  try {
    const topology = await materializeColdWorkspace(seedRoot, runRoot);
    transactionTopology = topology;
    const workspace = join(runRoot, "workspace");
    const setupMilliseconds = performance.now() - setupStarted;
    transactionSetupMilliseconds = setupMilliseconds;
    const completeStarted = performance.now();
    const generationStarted = completeStarted;
    const ensures = await mapPool(
      packagePaths,
      poolSize,
      async (packagePath) => {
        const packageRoot = join(workspace, packagePath);
        const result = await runCli(
          cli,
          packageRoot,
          join(packageRoot, ".benchmark/ensure.json"),
          "ensure"
        );
        const summary =
          result.output.summary &&
          typeof result.output.summary === "object" &&
          !Array.isArray(result.output.summary)
            ? asObject(result.output.summary, "ensure summary")
            : result.output;
        if (summary.changed !== true) {
          throw new Error(
            `Artifact-cold Gate 2.5 ensure did not recreate ${packagePath}`
          );
        }
        return result;
      }
    );
    const generationMilliseconds = performance.now() - generationStarted;
    const semanticStarted = performance.now();
    const semanticWorkers: ReadonlyArray<SemanticWorkerResult> =
      poolSize === 1
        ? [
            {
              invocations: [
                {
                  packagePath: "<workspace>",
                  result: await runCli(
                    cli,
                    workspace,
                    join(workspace, ".benchmark/check-workspace.json"),
                    "check-workspace"
                  ),
                },
              ],
              packagePaths,
              peakRssBytes: 0,
              programCount: 0,
              workerIndex: 0,
            },
          ].map((worker) => ({
            ...worker,
            peakRssBytes: Math.max(
              ...worker.invocations.map(({ result }) => result.peakRssBytes)
            ),
            programCount: worker.invocations.reduce(
              (total, { result }) => total + result.programCount,
              0
            ),
          }))
        : await mapPool(
            gate25WorkerGroups(poolSize),
            poolSize,
            async ({ packagePaths: workerPackagePaths, workerIndex }) => {
              const invocations: Array<
                Readonly<{
                  packagePath: string;
                  result: Awaited<ReturnType<typeof runCli>>;
                }>
              > = [];
              for (const packagePath of workerPackagePaths) {
                invocations.push({
                  packagePath,
                  result: await runCli(
                    cli,
                    join(workspace, packagePath),
                    join(workspace, packagePath, ".benchmark/prove.json"),
                    "prove"
                  ),
                });
              }
              return {
                invocations,
                packagePaths: workerPackagePaths,
                peakRssBytes: Math.max(
                  ...invocations.map(({ result }) => result.peakRssBytes)
                ),
                programCount: invocations.reduce(
                  (total, { result }) => total + result.programCount,
                  0
                ),
                workerIndex,
              };
            }
          );
    const semanticMilliseconds = performance.now() - semanticStarted;
    const semanticInvocations = semanticWorkers.flatMap(
      ({ invocations }) => invocations
    );
    const programCount = semanticWorkers.reduce(
      (total, worker) => total + worker.programCount,
      0
    );
    if (programCount <= 0) {
      throw new Error("Gate 2.5 did not observe any TypeScript Program");
    }
    const semanticByPackage =
      poolSize === 1 ? undefined : assertExactSemanticMerge(semanticWorkers);
    const compilerIdentity = await gate25CompilerIdentity(cli);
    const proves = await Promise.all(
      packagePaths.map(async (packagePath, packageIndex) => {
        const packageRoot = join(workspace, packagePath);
        const semanticResult =
          poolSize === 1
            ? semanticInvocations[0]?.result
            : semanticByPackage?.get(packagePath);
        if (!semanticResult) {
          throw new Error(
            `Gate 2.5 semantic result is missing for ${packagePath}`
          );
        }
        const receiptPath = join(
          packageRoot,
          ".mirai-intl/check-receipt.v2.json"
        );
        const receiptBytes = await readFile(receiptPath);
        const receipt = asObject(
          JSON.parse(receiptBytes.toString("utf8")),
          "receipt"
        );
        const generationReceiptSource = await readFile(
          join(
            packageRoot,
            "src/i18n/generated/catalog-generation-receipt.v1.json"
          )
        );
        const sources = receipt.sources;
        if (!Array.isArray(sources) || sources.length === 0) {
          throw new Error(`Gate 2.5 receipt has no sources for ${packagePath}`);
        }
        return {
          catalogPayloadHash: await catalogPayloadHash(packageRoot),
          ensureMilliseconds:
            ensures[packagePaths.indexOf(packagePath)]?.milliseconds ?? 0,
          identity: verifyGate25ReceiptIdentity(
            receipt,
            generationReceiptSource,
            compilerIdentity
          ),
          packagePath,
          semantic: gate25SemanticEvidence(
            receipt,
            Array.isArray(semanticResult.output.diagnostics)
              ? semanticResult.output.diagnostics
              : []
          ),
          peakRssBytes: Math.max(
            semanticResult.peakRssBytes,
            ensures[packagePaths.indexOf(packagePath)]?.peakRssBytes ?? 0
          ),
          programCount:
            poolSize === 1 && packageIndex > 0
              ? 0
              : semanticResult.programCount,
          proveMilliseconds: semanticResult.milliseconds,
          receiptHash: sha256(receiptBytes),
          sourceCount: sources.length,
        } satisfies PackageResult;
      })
    );
    return {
      catalogPayloadHash: gate25CanonicalHash(
        proves.map((result) => ({
          catalogPayloadHash: result.catalogPayloadHash,
          packagePath: result.packagePath,
        }))
      ),
      completeMilliseconds: performance.now() - completeStarted,
      generationMilliseconds,
      packages: proves,
      parityHash: gate25CanonicalHash(
        proves.map(({ packagePath, semantic }) => ({
          packagePath,
          semantic,
        }))
      ),
      peakRssBytes: Math.max(
        concurrentPeak(
          ensures.map(({ peakRssBytes }) => peakRssBytes),
          poolSize
        ),
        concurrentPeak(
          semanticWorkers.map(({ peakRssBytes }) => peakRssBytes),
          semanticWorkers.length
        ),
        process.resourceUsage().maxRSS * 1024
      ),
      programCount,
      receiptHash: gate25CanonicalHash(
        proves.map(({ packagePath, receiptHash }) => ({
          packagePath,
          receiptHash,
        }))
      ),
      semanticMilliseconds,
      setupMilliseconds,
      sourceCount: proves.reduce(
        (total, result) => total + result.sourceCount,
        0
      ),
      topology,
      workers: semanticWorkers.map(
        ({
          packagePaths: workerPackagePaths,
          peakRssBytes,
          programCount: workerProgramCount,
          workerIndex,
        }) => ({
          packagePaths: workerPackagePaths,
          peakRssBytes,
          programCount: workerProgramCount,
          workerIndex,
        })
      ),
      workspace: retainedRunRoot ? workspace : null,
    };
  } finally {
    if (!retainedRunRoot) {
      await rm(runRoot, { force: true, recursive: true });
    }
  }
}

async function main(): Promise<void> {
  if (process.versions.node !== "24.18.0") {
    throw new Error(
      `Gate 2.5 requires Node 24.18.0; received ${process.version}`
    );
  }
  const cli = resolve(stringOption("--cli"));
  const seedRoot = resolve(stringOption("--seed-root"));
  const poolSize = integerOption("--pool-size");
  const inputHash = stringOption("--input-hash");
  const engine = stringOption("--engine");
  const retainRoot = optionalStringOption("--retain-root");
  const result = await runEngine(cli, seedRoot, poolSize, engine, retainRoot);
  process.stdout.write(
    `${JSON.stringify({
      childElapsedMilliseconds: performance.now() - childStarted,
      engine,
      inputHash,
      poolSize,
      ...result,
    })}\n`
  );
}

main().catch((error: unknown) => {
  process.stdout.write(
    `${JSON.stringify({
      elapsedMilliseconds: performance.now() - childStarted,
      error: error instanceof Error ? error.message : String(error),
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      setupMilliseconds: transactionSetupMilliseconds ?? null,
      success: false,
      topology: transactionTopology ?? null,
    })}\n`
  );
  process.exitCode = 1;
});
