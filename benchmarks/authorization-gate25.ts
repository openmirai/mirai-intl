import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { cpus, hostname, tmpdir, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import type { DependencyTopologyIdentity } from "./authorization-gate25-workspace";
import { dependencyTopologyIdentity } from "./authorization-gate25-workspace";
import type {
  Gate25Sample,
  ProductionCandidateIdentity,
} from "./authorization-methodology";
import {
  EVALUATOR_SOURCE_PATHS,
  GATE_25_LIMITS,
  gate25PoolAssessment,
  productionCandidateIdentity,
  smallestPassingGate25Pool,
} from "./authorization-methodology";

type JsonObject = Readonly<Record<string, unknown>>;

type ChildResult = Readonly<{
  catalogPayloadHash: string;
  childElapsedMilliseconds: number;
  completeMilliseconds: number;
  generationMilliseconds: number;
  inputHash: string;
  packages: ReadonlyArray<JsonObject>;
  parityHash: string;
  peakRssBytes: number;
  poolSize: number;
  programCount: number;
  receiptHash: string;
  semanticMilliseconds: number;
  setupMilliseconds: number;
  sourceCount: number;
  topology: DependencyTopologyIdentity;
  workers: ReadonlyArray<JsonObject>;
  workspace: string | null;
}>;

const repositoryRoot = resolve(import.meta.dirname, "..");
const candidateCli = resolve(repositoryRoot, "packages/compiler/dist/cli.js");
const childPath = resolve(import.meta.dirname, "authorization-gate25-child.ts");
const defaultTurboRoot = resolve(repositoryRoot, "../../fe-mirai-org-turbo");
const requiredWarmups = 5;
const requiredSamples = 10;
const semanticEngineEnvironment = "MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE";

type Gate25Engine = "candidate" | "reference";

export const GATE_25_CHILD_ENVIRONMENT = Object.freeze({
  CI: "1",
  FORCE_COLOR: "0",
  NODE_ENV: "production",
  TURBO_CACHE: "0",
  TURBO_REMOTE_ONLY: "false",
});

export function gate25EngineConfiguration(
  cliPath: string
): Readonly<
  Record<
    Gate25Engine,
    Readonly<{ cliPath: string; environment: Readonly<Record<string, string>> }>
  >
> {
  return Object.freeze({
    candidate: Object.freeze({
      cliPath,
      environment: Object.freeze({
        [semanticEngineEnvironment]: "owner-batch",
      }),
    }),
    reference: Object.freeze({
      cliPath,
      environment: Object.freeze({
        [semanticEngineEnvironment]: "reference",
      }),
    }),
  });
}

export type Gate25Attempt = "candidate" | "reference" | "warmup";

export function gate25AttemptSchedule(
  warmups: number,
  samples: number
): ReadonlyArray<Gate25Attempt> {
  if (
    !Number.isSafeInteger(warmups) ||
    warmups < 0 ||
    !Number.isSafeInteger(samples) ||
    samples < 1
  ) {
    throw new Error(
      "Gate 2.5 attempt schedule requires non-negative warmups and positive samples"
    );
  }
  return Object.freeze([
    ...Array.from({ length: warmups }, () => "warmup" as const),
    "reference" as const,
    ...Array.from({ length: samples }, () => "candidate" as const),
  ]);
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function stringOption(
  args: ReadonlyArray<string>,
  name: string
): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  const index = args.indexOf(name);
  return (
    inline?.slice(prefix.length) ?? (index >= 0 ? args[index + 1] : undefined)
  );
}

function integerOption(
  args: ReadonlyArray<string>,
  name: string,
  fallback: number
): number {
  const value = Number(stringOption(args, name) ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function commandOutput(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string
): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      [
        `Gate 2.5 command failed: ${command} ${args.join(" ")}`,
        `status=${String(result.status)} signal=${String(result.signal)}`,
        result.error?.message ?? "",
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }
  return result.stdout.trim();
}

function requiredCommand(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string
): void {
  commandOutput(command, args, cwd);
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

async function evaluatorIdentity(): Promise<JsonObject> {
  const sources = await Promise.all(
    EVALUATOR_SOURCE_PATHS.map(
      async (path) =>
        [path, await fileHash(join(repositoryRoot, path))] as const
    )
  );
  return {
    childArgumentVector: [
      process.execPath,
      "--import",
      "tsx",
      relative(repositoryRoot, childPath),
      "--engine=<engine>",
      "--cli=<cli>",
      "--seed-root=<root>",
      "--pool-size=<1..4>",
      "--input-hash=<sha256>",
    ],
    sourceHash: sha256(canonicalJson(sources)),
    sources,
  };
}

async function prepareInstalledTurboSeed(turboRoot: string): Promise<
  Readonly<{
    containerRoot: string;
    root: string;
    topology: DependencyTopologyIdentity;
  }>
> {
  const containerRoot = await mkdtemp(
    join(tmpdir(), "mirai-intl-gate25-seed-")
  );
  const archive = join(containerRoot, "turbo-head.tar");
  const root = join(containerRoot, "workspace");
  try {
    await mkdir(root, { recursive: true });
    requiredCommand(
      "git",
      ["archive", "--format=tar", "HEAD", "-o", archive],
      turboRoot
    );
    requiredCommand("tar", ["-xf", archive, "-C", root], turboRoot);
    await rm(archive, { force: true });
    requiredCommand(
      "corepack",
      ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--offline"],
      root
    );
    return {
      containerRoot,
      root,
      topology: await dependencyTopologyIdentity(root),
    };
  } catch (error) {
    await rm(containerRoot, { force: true, recursive: true });
    throw error;
  }
}

function turboIdentity(turboRoot: string): JsonObject {
  const status = commandOutput("git", ["status", "--porcelain=v1"], turboRoot);
  if (status !== "") {
    throw new Error(
      `Gate 2.5 requires an exact clean Turbo head; status:\n${status}`
    );
  }
  return {
    commit: commandOutput("git", ["rev-parse", "HEAD"], turboRoot),
    tree: commandOutput("git", ["rev-parse", "HEAD^{tree}"], turboRoot),
  };
}

function parseChild(stdout: string): ChildResult {
  const value = JSON.parse(stdout) as Readonly<Record<string, unknown>>;
  if (value.success === false || typeof value.error === "string") {
    throw new Error(String(value.error ?? "Gate 2.5 child failed"));
  }
  const requiredNumbers = [
    "childElapsedMilliseconds",
    "completeMilliseconds",
    "generationMilliseconds",
    "peakRssBytes",
    "poolSize",
    "programCount",
    "semanticMilliseconds",
    "setupMilliseconds",
    "sourceCount",
  ] as const;
  for (const property of requiredNumbers) {
    if (typeof value[property] !== "number") {
      throw new Error(`Gate 2.5 child lacks numeric ${property}`);
    }
  }
  if (
    typeof value.catalogPayloadHash !== "string" ||
    typeof value.inputHash !== "string" ||
    typeof value.parityHash !== "string" ||
    typeof value.receiptHash !== "string" ||
    !value.topology ||
    typeof value.topology !== "object" ||
    !("hash" in value.topology) ||
    typeof value.topology.hash !== "string" ||
    !Array.isArray(value.packages) ||
    !Array.isArray(value.workers) ||
    (value.workspace !== null && typeof value.workspace !== "string")
  ) {
    throw new Error("Gate 2.5 child result shape is invalid");
  }
  return value as ChildResult;
}

function runColdChild(
  engine: Gate25Engine,
  configuration: ReturnType<typeof gate25EngineConfiguration>[Gate25Engine],
  seedRoot: string,
  poolSize: number,
  inputHash: string,
  topologyHash: string,
  retainRoot?: string
): ChildResult {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      childPath,
      `--engine=${engine}`,
      `--cli=${configuration.cliPath}`,
      `--seed-root=${seedRoot}`,
      `--pool-size=${poolSize}`,
      `--input-hash=${inputHash}`,
      ...(retainRoot ? [`--retain-root=${retainRoot}`] : []),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...GATE_25_CHILD_ENVIRONMENT,
        ...configuration.environment,
      },
      killSignal: "SIGKILL",
      maxBuffer: 32 * 1024 * 1024,
      shell: false,
      timeout: 10 * 60_000,
    }
  );
  if (result.error || result.status !== 0 || result.signal) {
    let detail = result.stdout.trim();
    try {
      const parsed = JSON.parse(detail) as Readonly<Record<string, unknown>>;
      if (typeof parsed.error === "string") {
        detail = [
          parsed.error,
          `childElapsedMilliseconds=${String(parsed.elapsedMilliseconds)}`,
          `childPeakRssBytes=${String(parsed.peakRssBytes)}`,
          `setupMilliseconds=${String(parsed.setupMilliseconds)}`,
          `childTopology=${canonicalJson(parsed.topology)}`,
        ].join("\n");
      }
    } catch {
      // Preserve the raw child output.
    }
    throw new Error(
      [
        `Gate 2.5 ${engine} cold child failed without retry or replacement`,
        `poolSize=${poolSize}`,
        `status=${String(result.status)} signal=${String(result.signal)}`,
        result.error?.message ?? "",
        detail,
        result.stderr,
      ].join("\n")
    );
  }
  const child = parseChild(result.stdout);
  if (child.topology.hash !== topologyHash) {
    throw new Error(
      `Gate 2.5 ${engine} transaction topology changed: expected ${topologyHash}, received ${child.topology.hash}`
    );
  }
  return child;
}

export function gate25ExactParity(
  candidate: Readonly<{
    catalogPayloadHash: string;
    parityHash: string;
    sourceCount: number;
  }>,
  reference: Readonly<{
    catalogPayloadHash: string;
    parityHash: string;
    sourceCount: number;
  }>
): boolean {
  return (
    candidate.catalogPayloadHash === reference.catalogPayloadHash &&
    candidate.parityHash === reference.parityHash &&
    candidate.sourceCount === reference.sourceCount
  );
}

function gate25ParityMismatch(
  candidate: ChildResult,
  reference: ChildResult
): JsonObject {
  const firstPackage = candidate.packages.find((candidatePackage) => {
    const packagePath = candidatePackage.packagePath;
    const referencePackage = reference.packages.find(
      (entry) => entry.packagePath === packagePath
    );
    return (
      !referencePackage ||
      canonicalJson(candidatePackage.semantic) !==
        canonicalJson(referencePackage.semantic)
    );
  });
  const referencePackage = firstPackage
    ? reference.packages.find(
        (entry) => entry.packagePath === firstPackage.packagePath
      )
    : undefined;
  return {
    candidate: {
      catalogPayloadHash: candidate.catalogPayloadHash,
      parityHash: candidate.parityHash,
      sourceCount: candidate.sourceCount,
    },
    firstPackage: firstPackage
      ? {
          candidateSemanticProjection: firstPackage.semantic,
          packagePath: firstPackage.packagePath,
          referenceSemanticProjection: referencePackage?.semantic ?? null,
        }
      : null,
    reference: {
      catalogPayloadHash: reference.catalogPayloadHash,
      parityHash: reference.parityHash,
      sourceCount: reference.sourceCount,
    },
  };
}

export function gate25PoolSequence(
  startPool: number,
  endPool = 4
): ReadonlyArray<number> {
  if (
    !Number.isSafeInteger(startPool) ||
    startPool < 1 ||
    startPool > 4 ||
    !Number.isSafeInteger(endPool) ||
    endPool < startPool ||
    endPool > 4
  ) {
    throw new Error(
      "Gate 2.5 pool bounds must be integers from 1 through 4 with start <= end"
    );
  }
  return Object.freeze(
    [1, 2, 3, 4].filter((value) => value >= startPool && value <= endPool)
  );
}

function sample(candidate: ChildResult, reference: ChildResult): Gate25Sample {
  return {
    completeMilliseconds: candidate.completeMilliseconds,
    inputHash: candidate.inputHash,
    parityPass: gate25ExactParity(candidate, reference),
    peakRssBytes: candidate.peakRssBytes,
    programCount: candidate.programCount,
    semanticMilliseconds: candidate.semanticMilliseconds,
    sourceCount: candidate.sourceCount,
  };
}

async function writeReport(path: string, report: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${canonicalJson(report)}\n`, "utf8");
  await rename(temporary, path);
}

function sameCandidate(
  left: ProductionCandidateIdentity,
  right: ProductionCandidateIdentity
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export async function runGate25(args: ReadonlyArray<string>): Promise<void> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 24) {
    throw new Error(
      `Gate 2.5 requires Node >= 24; received ${process.version}`
    );
  }
  const turboRoot = resolve(
    stringOption(args, "--turbo-root") ?? defaultTurboRoot
  );
  if (stringOption(args, "--semantic-reference-cli")) {
    throw new Error(
      "Gate 2.5 reference must use the exact candidate CLI with only the internal semantic engine changed"
    );
  }
  const warmups = integerOption(args, "--warmups", requiredWarmups);
  const samples = integerOption(args, "--samples", requiredSamples);
  const startPool = integerOption(args, "--start-pool", 1);
  const endPool = integerOption(args, "--end-pool", 4);
  const retainRootOption = stringOption(args, "--retain-root");
  const retainRoot = retainRootOption ? resolve(retainRootOption) : undefined;
  const diagnosticCliOption = stringOption(args, "--diagnostic-cli");
  if (diagnosticCliOption && endPool === 4) {
    throw new Error(
      "--diagnostic-cli is restricted to bounded non-authoritative diagnostics"
    );
  }
  const engineCli = diagnosticCliOption
    ? resolve(diagnosticCliOption)
    : candidateCli;
  const engines = gate25EngineConfiguration(engineCli);
  gate25PoolSequence(startPool, endPool);
  const jsonPath = resolve(
    repositoryRoot,
    stringOption(args, "--json") ?? ".tmp/benchmarks/gate25-feasibility.json"
  );
  if (samples < 1) {
    throw new Error("--samples must be at least 1");
  }
  for (const path of [engineCli, childPath]) {
    if (!(await exists(path))) {
      throw new Error(`Gate 2.5 prerequisite is missing: ${path}`);
    }
  }
  const evaluator = await evaluatorIdentity();
  const turbo = turboIdentity(turboRoot);
  const installedSeed = await prepareInstalledTurboSeed(turboRoot);
  const seedTopologyBefore = installedSeed.topology;
  const compilerCliHash = await fileHash(engineCli);
  const engineIdentity = {
    candidate: {
      cliHash: compilerCliHash,
      environment: engines.candidate.environment,
    },
    reference: {
      cliHash: compilerCliHash,
      environment: engines.reference.environment,
    },
  };
  const candidateBefore = await productionCandidateIdentity(repositoryRoot);
  const lockfileHash = await fileHash(join(turboRoot, "pnpm-lock.yaml"));
  const inputHash = sha256(
    canonicalJson({
      candidate: candidateBefore,
      evaluator,
      lockfileHash,
      engines: engineIdentity,
      seedTopology: seedTopologyBefore,
      turbo,
    })
  );
  const pools: Array<JsonObject> = [];
  let selectedPool: number | undefined;
  let failure: string | undefined;
  for (const poolSize of gate25PoolSequence(startPool, endPool)) {
    const warmupResults: Array<ChildResult> = [];
    const candidates: Array<ChildResult> = [];
    let reference: ChildResult | undefined;
    try {
      for (const attempt of gate25AttemptSchedule(warmups, samples)) {
        if (attempt === "reference") {
          reference = runColdChild(
            "reference",
            engines.reference,
            installedSeed.root,
            poolSize,
            inputHash,
            seedTopologyBefore.hash,
            retainRoot
              ? join(retainRoot, `pool-${String(poolSize)}-reference`)
              : undefined
          );
          for (const [index, warmup] of warmupResults.entries()) {
            if (!gate25ExactParity(warmup, reference)) {
              throw new Error(
                `Gate 2.5 warmup ${index} failed exact reference parity`
              );
            }
          }
          continue;
        }
        const result = runColdChild(
          "candidate",
          engines.candidate,
          installedSeed.root,
          poolSize,
          inputHash,
          seedTopologyBefore.hash,
          retainRoot
            ? join(
                retainRoot,
                `pool-${String(poolSize)}-candidate-${String(candidates.length)}`
              )
            : undefined
        );
        if (attempt === "warmup") {
          warmupResults.push(result);
        } else {
          candidates.push(result);
          if (reference && !gate25ExactParity(result, reference)) {
            throw new Error(
              `Gate 2.5 candidate ${String(candidates.length - 1)} failed exact reference parity`
            );
          }
        }
      }
      if (!reference) {
        throw new Error("Gate 2.5 attempt schedule omitted its reference");
      }
      const completedReference = reference;
      const raw: Array<
        Readonly<{ candidate: ChildResult; sample: Gate25Sample }>
      > = candidates.map((candidate) => ({
        candidate,
        sample: sample(candidate, completedReference),
      }));
      const assessment = gate25PoolAssessment(
        raw.map(({ sample: measured }) => measured)
      );
      pools.push({
        assessment,
        poolSize,
        raw,
        reference: completedReference,
        warmups: warmupResults,
      });
      if (!assessment.parityPass) {
        failure = `pool ${poolSize} failed exact reference parity`;
        break;
      }
      if (assessment.pass) {
        selectedPool = poolSize;
        failure = undefined;
        break;
      }
      failure = `pool ${poolSize} missed Gate 2.5 headroom`;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      const failedReference = reference;
      const firstMismatch = failedReference
        ? [...warmupResults, ...candidates].find(
            (result) => !gate25ExactParity(result, failedReference)
          )
        : undefined;
      pools.push({
        error: failure,
        firstParityMismatch:
          failedReference && firstMismatch
            ? gate25ParityMismatch(firstMismatch, failedReference)
            : null,
        poolSize,
        raw: failedReference
          ? candidates.map((candidate) => ({
              candidate,
              sample: sample(candidate, failedReference),
            }))
          : candidates.map((candidate) => ({ candidate })),
        reference: failedReference,
        warmups: warmupResults,
      });
      if (failure.includes("failed exact reference parity") || poolSize === 4) {
        break;
      }
    }
  }
  const candidateAfter = await productionCandidateIdentity(repositoryRoot);
  const candidateIdentityPass = sameCandidate(candidateBefore, candidateAfter);
  const seedTopologyAfter = await dependencyTopologyIdentity(
    installedSeed.root
  );
  const seedIdentityPass =
    canonicalJson(seedTopologyBefore) === canonicalJson(seedTopologyAfter);
  const eligible =
    startPool === 1 &&
    endPool === 4 &&
    warmups === requiredWarmups &&
    samples === requiredSamples;
  const assessed = pools.flatMap((entry) => {
    const poolSize = entry.poolSize;
    const assessment = entry.assessment;
    return typeof poolSize === "number" &&
      assessment &&
      typeof assessment === "object"
      ? [
          {
            assessment: assessment as ReturnType<typeof gate25PoolAssessment>,
            poolSize,
          },
        ]
      : [];
  });
  const smallestPassing = smallestPassingGate25Pool(assessed);
  const pass =
    eligible &&
    candidateIdentityPass &&
    seedIdentityPass &&
    selectedPool !== undefined &&
    selectedPool === smallestPassing;
  const report = {
    environment: {
      architecture: process.arch,
      candidateCommit: commandOutput(
        "git",
        ["rev-parse", "HEAD"],
        repositoryRoot
      ),
      candidateProduction: candidateBefore,
      evaluatorPid: process.pid,
      hostname: hostname(),
      inputHash,
      lockfileHash,
      logicalCpuCount: cpus().length,
      node: process.version,
      platform: process.platform,
      engines: engineIdentity,
      seedTopology: seedTopologyBefore,
      endPool,
      startPool,
      totalMemoryBytes: totalmem(),
      turbo,
    },
    evaluator,
    feasibility: {
      candidateIdentityPass,
      eligible,
      failure: failure ?? null,
      limits: GATE_25_LIMITS,
      pass,
      reason: pass
        ? `smallest passing sealed pool is ${String(selectedPool)}`
        : "NOT MET REQUIREMENTS: Gate 2.5 feasibility is incomplete or failed",
      requiredSamples,
      requiredWarmups,
      seedIdentityPass,
      selectedPool: selectedPool ?? null,
    },
    methodology: {
      cache: "Turbo and Mirai Intl cache reads/writes disabled",
      candidateIdentity:
        "frozen at evaluator start and rechecked byte-for-byte after all children; no production hash constant updated",
      cold: "every sample is one fresh Node child and a fresh hardlink clone of the frozen clean-install seed with all five generated catalogs and receipts removed",
      dependencyTopology:
        "one frozen offline pnpm install seed is fully confined and hashed; every timed transaction hardlink-clones that seed, revalidates canonical dependency roots, and must reproduce the exact topology hash",
      coverage:
        "five real Turbo package roots; source count is dynamic from the exact reference receipts",
      pools:
        "pool 1 first; pools 2-4 only after a complete parity-valid smaller pool misses headroom",
      retries:
        "none; failed children are retained as failure and never replaced",
      rss: "conservative sum of the largest concurrently eligible child maxRSS values plus evaluator-child maxRSS",
      semanticParity:
        "canonical per-source receipt observations and generated catalog payload hashes against the frozen semantic reference",
      timing:
        "completeMilliseconds measures exact artifact-cold generation plus semantic authorization; setupMilliseconds records mandatory topology materialization separately; childElapsedMilliseconds preserves full child wall time",
    },
    pools,
    schemaVersion: 1,
  };
  await writeReport(jsonPath, report);
  await rm(installedSeed.containerRoot, { force: true, recursive: true });
  process.stdout.write(
    `${JSON.stringify(
      {
        output: relative(repositoryRoot, jsonPath),
        pass,
        reason: report.feasibility.reason,
        selectedPool: selectedPool ?? null,
      },
      null,
      2
    )}\n`
  );
  if (!pass) {
    process.exitCode = 1;
  }
}
