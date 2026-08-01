import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

export const SEMANTIC_REFERENCE = {
  commit: "89e362b",
  role: "semantic",
  tree: "1e58d4cc11439a4ef4f383954d60f8845b003c76",
} as const;

export const PERFORMANCE_REFERENCE = {
  commit: "f9f2df6b22a0b6f8f1b8fbefa4578e2d5ee432c7",
  role: "performance",
  tree: "0b34cd884e0c8c84c853a1f9539f326685e93bc5",
} as const;

export const EVALUATOR_SOURCE_PATHS = [
  "benchmarks/authorization.ts",
  "benchmarks/authorization-methodology.ts",
  "benchmarks/authorization-ensure-client.ts",
  "benchmarks/authorization-ensure-worker.ts",
  "benchmarks/authorization-gate25.ts",
  "benchmarks/authorization-gate25-child.ts",
  "benchmarks/authorization-gate25-parity.ts",
  "benchmarks/authorization-gate25-workspace.ts",
  "benchmarks/authorization-profiler.mjs",
  "benchmarks/authorization-profiler-loader.mjs",
  "benchmarks/authorization-typescript-shim.mjs",
  "benchmarks/authorization-mutation-fs-shim.mjs",
  "benchmarks/authorization-rss-probe.mjs",
] as const;

export const GATE_25_LIMITS = {
  completeMaximumMilliseconds: 16_000,
  completeMedianMilliseconds: 8_000,
  peakRssBytes: Math.floor(1.75 * 1024 * 1024 * 1024),
  semanticP95Milliseconds: 8_000,
} as const;

export type Gate25Sample = Readonly<{
  completeMilliseconds: number;
  inputHash: string;
  parityPass: boolean;
  peakRssBytes: number;
  programCount: number;
  semanticMilliseconds: number;
  sourceCount: number;
}>;

export type Gate25PoolAssessment = Readonly<{
  completeMaximumMilliseconds: number;
  completeMedianMilliseconds: number;
  completePass: boolean;
  inputHashPass: boolean;
  parityPass: boolean;
  pass: boolean;
  peakRssBytes: number;
  programCountPass: boolean;
  rssPass: boolean;
  semanticP95Milliseconds: number;
  semanticPass: boolean;
  sourceCountPass: boolean;
}>;

const PRODUCTION_PACKAGES = [
  "abi",
  "compiler",
  "intl",
  "intl-i18next",
  "runtime",
] as const;

export const FROZEN_PRODUCTION_CANDIDATE = {
  compilerCliHash:
    "sha256:4006f442b3e7430f2ecd0d2c680b429261a18d4621ea7729a14d2e58280fc607",
  dist: {
    fileCount: 122,
    hash: "sha256:f32c9cfd28243077f1483aa7a6864222ffe1b9369265eee734823a83a84492e1",
  },
  lockfileHash:
    "sha256:b3b8c41512bbabdf6dda03ee6cfc4de6b62617f2fa0e87577859b588a5c38de8",
  source: {
    fileCount: 93,
    hash: "sha256:c37b2e5203c1c36fb20a48e28f7ffa77e346fdea04f8b2b37d04ef5f334ed059",
  },
} as const;

export type EngineName = "candidate" | "reference";
export type MeasurementSurface = "rss" | "timing" | "typescript";

export type PerformanceGate = Readonly<{
  absoluteMedianPass: boolean;
  absoluteP95Pass: boolean;
  confidencePass: boolean;
  pass: boolean;
  relativeMedianPass: boolean;
}>;

export type ReleaseAcceptanceInput = Readonly<{
  auditProvenancePass: boolean;
  eligible: boolean;
  instrumentationParityPass: boolean;
  latencyPass: boolean;
  positiveSemanticParityPass: boolean;
  rssPass: boolean;
  scenarioCompleteContractPass: boolean;
  semanticIntegrityMatrixPass: boolean;
  unchangedEnsureLegacyCompositePass: boolean;
  workerCliEquivalencePass: boolean;
  workloadParityPass: boolean;
}>;

export type ProductionCandidateIdentity = Readonly<{
  compilerCliHash: string;
  dist: Readonly<{ fileCount: number; hash: string }>;
  lockfileHash: string;
  source: Readonly<{ fileCount: number; hash: string }>;
}>;

export type ChildArgumentVectorOptions = Readonly<{
  cli: string;
  commandArguments: ReadonlyArray<string>;
  node: string;
  profiler: string;
  reportPath: string;
  rssProbe: string;
  surface: MeasurementSurface;
}>;

export type RssScheduleEntry<Scenario extends string = string> = Readonly<{
  fixture: Scenario;
  order: readonly [EngineName, EngineName];
  pair: number;
}>;

export type RawBlock = Readonly<{
  cells: readonly [
    Readonly<{ engine: EngineName; milliseconds: number }>,
    Readonly<{ engine: EngineName; milliseconds: number }>,
    Readonly<{ engine: EngineName; milliseconds: number }>,
    Readonly<{ engine: EngineName; milliseconds: number }>,
  ];
  index: number;
  order: "ABBA" | "BAAB";
}>;

export type WorkloadIdentity = Readonly<{
  checkerProjects: number;
  eligibleSourceLedgerHash: string;
  eligibleSources: number;
  fixtureHash: string;
  operation: "authorization" | "ensure";
  ownerProjects: number;
  outcome: Readonly<{
    changed: boolean;
    diagnosticsHash: string;
    success: boolean;
  }>;
  semanticAuthorizationRuns: number;
  semanticFilesAnalyzed: number;
}>;

export function assertDistinctReferenceRoles(
  semantic: Readonly<{ commit: string; role: string; tree: string }>,
  performance: Readonly<{ commit: string; role: string; tree: string }>
): void {
  if (
    semantic.role !== "semantic" ||
    performance.role !== "performance" ||
    semantic.commit === performance.commit ||
    semantic.tree === performance.tree
  ) {
    throw new Error(
      "Semantic and performance reference roles must be immutable and distinct"
    );
  }
}

export function acceptanceEligibility(
  samples: number,
  warmups: number
): boolean {
  return samples === 30 && warmups >= 5;
}

export function completeContractPass(gate: PerformanceGate): boolean {
  return gate.absoluteMedianPass && gate.absoluteP95Pass && gate.confidencePass;
}

export function measurementTimeoutMilliseconds(
  surface: MeasurementSurface
): number {
  return surface === "rss" ? 600_000 : 180_000;
}

export function releaseAcceptance(input: ReleaseAcceptanceInput): boolean {
  return (
    input.eligible &&
    input.auditProvenancePass &&
    input.latencyPass &&
    input.rssPass &&
    input.scenarioCompleteContractPass &&
    input.unchangedEnsureLegacyCompositePass &&
    input.semanticIntegrityMatrixPass &&
    input.positiveSemanticParityPass &&
    input.instrumentationParityPass &&
    input.workerCliEquivalencePass &&
    input.workloadParityPass
  );
}

function normalizedRelativePath(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

async function regularFiles(
  root: string,
  directory: string
): Promise<Array<string>> {
  const files: Array<string> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `Production identity does not follow symlinks: ${normalizedRelativePath(root, path)}`
      );
    }
    if (entry.isDirectory()) {
      files.push(...(await regularFiles(root, path)));
    } else if (entry.isFile()) {
      files.push(normalizedRelativePath(root, path));
    }
  }
  return files;
}

function byteHash(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function aggregateFileIdentity(
  root: string,
  paths: ReadonlyArray<string>
): Promise<Readonly<{ fileCount: number; hash: string }>> {
  const members = [
    ...new Set(paths.map((path) => path.split("\\").join("/"))),
  ].toSorted();
  const aggregate = createHash("sha256");
  for (const path of members) {
    const hash = byteHash(await readFile(join(root, path)));
    aggregate.update(path, "utf8");
    aggregate.update("\0", "utf8");
    aggregate.update(hash, "utf8");
    aggregate.update("\0", "utf8");
  }
  return {
    fileCount: members.length,
    hash: `sha256:${aggregate.digest("hex")}`,
  };
}

export async function productionCandidateIdentity(
  root: string
): Promise<ProductionCandidateIdentity> {
  const sourcePaths = [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.base.json",
    "tsdown.config.ts",
  ];
  const distPaths: Array<string> = [];
  for (const packageName of PRODUCTION_PACKAGES) {
    const packageRoot = join(root, "packages", packageName);
    sourcePaths.push(
      `packages/${packageName}/package.json`,
      `packages/${packageName}/tsconfig.json`,
      ...(await regularFiles(root, join(packageRoot, "src")))
    );
    distPaths.push(...(await regularFiles(root, join(packageRoot, "dist"))));
  }
  return {
    compilerCliHash: byteHash(
      await readFile(join(root, "packages/compiler/dist/cli.js"))
    ),
    dist: await aggregateFileIdentity(root, distPaths),
    lockfileHash: byteHash(await readFile(join(root, "pnpm-lock.yaml"))),
    source: await aggregateFileIdentity(root, sourcePaths),
  };
}

export function assertFrozenProductionCandidate(
  identity: ProductionCandidateIdentity
): void {
  if (
    JSON.stringify(identity) !== JSON.stringify(FROZEN_PRODUCTION_CANDIDATE)
  ) {
    throw new Error(
      `Production candidate identity changed during evaluator recomposition: ${JSON.stringify(identity)}`
    );
  }
}

export function assertWorkloadEquivalent(
  baseline: WorkloadIdentity,
  candidate: WorkloadIdentity
): void {
  if (JSON.stringify(baseline) !== JSON.stringify(candidate)) {
    throw new Error("V1/V2 workload adapters are not equivalent");
  }
}

export function blockOrder(index: number): "ABBA" | "BAAB" {
  return index % 2 === 0 ? "ABBA" : "BAAB";
}

export function engineOrder(
  index: number
): readonly [EngineName, EngineName, EngineName, EngineName] {
  return blockOrder(index) === "ABBA"
    ? ["reference", "candidate", "candidate", "reference"]
    : ["candidate", "reference", "reference", "candidate"];
}

export function childArgumentVector({
  cli,
  commandArguments,
  node,
  profiler,
  reportPath,
  rssProbe,
  surface,
}: ChildArgumentVectorOptions): ReadonlyArray<string> {
  let preload: ReadonlyArray<string> = [];
  if (surface === "typescript") {
    preload = ["--import", profiler];
  } else if (surface === "rss") {
    preload = ["--import", rssProbe];
  }
  return [
    node,
    ...preload,
    cli,
    ...commandArguments,
    "--format=json",
    `--report-file=${reportPath}`,
  ];
}

export function rssPairOrder(pair: number): readonly [EngineName, EngineName] {
  return pair % 2 === 0
    ? ["reference", "candidate"]
    : ["candidate", "reference"];
}

export function rssSamplingSchedule<Scenario extends string>(
  fixtures: ReadonlyArray<Scenario>,
  pairCount = 5
): ReadonlyArray<RssScheduleEntry<Scenario>> {
  return fixtures.flatMap((fixture) =>
    Array.from({ length: pairCount }, (_, pair) => ({
      fixture,
      order: rssPairOrder(pair),
      pair,
    }))
  );
}

export function rssWorkflowPeak(
  coldEnsurePeakBytes: number,
  authorizationPeakBytes: number
): number {
  return Math.max(coldEnsurePeakBytes, authorizationPeakBytes);
}

export function assertTimedWorkflowShape(
  workflow: Readonly<Record<string, unknown>>
): void {
  const forbidden = [
    "factoryCounts",
    "peakRssBytes",
    "programCount",
    "profile",
    "rssBytes",
  ];
  const present = forbidden.filter((key) =>
    Object.prototype.hasOwnProperty.call(workflow, key)
  );
  if (present.length > 0) {
    throw new Error(
      `Timed workflow contains audit-only fields: ${present.join(", ")}`
    );
  }
}

export function twoCellMedian(values: readonly [number, number]): number {
  return (values[0] + values[1]) / 2;
}

export function blockDeltaPercent(block: RawBlock): number {
  const candidate = block.cells
    .filter(({ engine }) => engine === "candidate")
    .map(({ milliseconds }) => milliseconds);
  const reference = block.cells
    .filter(({ engine }) => engine === "reference")
    .map(({ milliseconds }) => milliseconds);
  if (candidate.length !== 2 || reference.length !== 2) {
    throw new Error(
      "Each block must retain two candidate and two reference cells"
    );
  }
  const [candidateFirst, candidateSecond] = candidate;
  const [referenceFirst, referenceSecond] = reference;
  if (
    candidateFirst === undefined ||
    candidateSecond === undefined ||
    referenceFirst === undefined ||
    referenceSecond === undefined
  ) {
    throw new Error(
      "Each block must retain two candidate and two reference cells"
    );
  }
  const candidateMedian = twoCellMedian([candidateFirst, candidateSecond]);
  const referenceMedian = twoCellMedian([referenceFirst, referenceSecond]);
  if (referenceMedian === 0) {
    throw new Error("Reference block median must be non-zero");
  }
  return ((candidateMedian - referenceMedian) / referenceMedian) * 100;
}

function percentile(values: ReadonlyArray<number>, fraction: number): number {
  const sorted = [...values].toSorted((left, right) => left - right);
  const value =
    sorted[
      Math.max(
        0,
        Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
      )
    ];
  if (value === undefined) {
    throw new Error("At least one sample is required");
  }
  return value;
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const right = sorted[middle];
  if (right === undefined) {
    throw new Error("At least one sample is required");
  }
  const left = sorted[middle - 1];
  return sorted.length % 2 === 0 && left !== undefined
    ? (left + right) / 2
    : right;
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function pairedBlockStatistics(
  blocks: ReadonlyArray<RawBlock>,
  seed: number
): Readonly<Record<string, unknown>> {
  if (blocks.length === 0) {
    throw new Error("At least one paired block is required");
  }
  const deltas = blocks.map(blockDeltaPercent);
  const random = randomGenerator(seed);
  const bootstrap = Array.from({ length: 10_000 }, () =>
    median(
      Array.from(
        { length: deltas.length },
        () => deltas[Math.floor(random() * deltas.length)] ?? 0
      )
    )
  );
  return {
    bootstrap95ConfidenceIntervalPercent: [
      percentile(bootstrap, 0.025),
      percentile(bootstrap, 0.975),
    ],
    bootstrapIterations: 10_000,
    bootstrapN: blocks.length,
    bootstrapSeed: seed,
    medianPairedDeltaPercent: median(deltas),
    rawBlocks: blocks,
    rawPairedDeltasPercent: deltas,
  };
}

export function rawStatistics(values: ReadonlyArray<number>): Readonly<{
  coefficientOfVariation: number;
  medianMilliseconds: number;
  p95Milliseconds: number;
}> {
  const mean =
    values.reduce((total, value) => total + value, 0) / values.length;
  const deviation = Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
      values.length
  );
  return {
    coefficientOfVariation: mean === 0 ? 0 : deviation / mean,
    medianMilliseconds: median(values),
    p95Milliseconds: percentile(values, 0.95),
  };
}

export function gate25PoolAssessment(
  samples: ReadonlyArray<Gate25Sample>
): Gate25PoolAssessment {
  if (samples.length === 0) {
    throw new Error("Gate 2.5 requires at least one unretried cold sample");
  }
  const inputHashes = new Set(samples.map(({ inputHash }) => inputHash));
  const sourceCounts = new Set(samples.map(({ sourceCount }) => sourceCount));
  const complete = samples.map(
    ({ completeMilliseconds }) => completeMilliseconds
  );
  const semantic = samples.map(
    ({ semanticMilliseconds }) => semanticMilliseconds
  );
  const completeMedianMilliseconds = median(complete);
  const completeMaximumMilliseconds = Math.max(...complete);
  const semanticP95Milliseconds = percentile(semantic, 0.95);
  const peakRssBytes = Math.max(
    ...samples.map((sample) => sample.peakRssBytes)
  );
  const parityPass = samples.every((sample) => sample.parityPass);
  const inputHashPass = inputHashes.size === 1;
  const sourceCountPass =
    sourceCounts.size === 1 && (samples[0]?.sourceCount ?? 0) > 0;
  const programCountPass = samples.every(
    ({ programCount }) => programCount > 0
  );
  const semanticPass =
    semanticP95Milliseconds <= GATE_25_LIMITS.semanticP95Milliseconds;
  const completePass =
    completeMedianMilliseconds <= GATE_25_LIMITS.completeMedianMilliseconds &&
    completeMaximumMilliseconds <= GATE_25_LIMITS.completeMaximumMilliseconds;
  const rssPass = peakRssBytes <= GATE_25_LIMITS.peakRssBytes;
  return {
    completeMaximumMilliseconds,
    completeMedianMilliseconds,
    completePass,
    inputHashPass,
    parityPass,
    pass:
      parityPass &&
      inputHashPass &&
      sourceCountPass &&
      programCountPass &&
      semanticPass &&
      completePass &&
      rssPass,
    peakRssBytes,
    programCountPass,
    rssPass,
    semanticP95Milliseconds,
    semanticPass,
    sourceCountPass,
  };
}

export function smallestPassingGate25Pool(
  assessments: ReadonlyArray<
    Readonly<{ assessment: Gate25PoolAssessment; poolSize: number }>
  >
): number | undefined {
  return assessments
    .filter(({ assessment, poolSize }) => assessment.pass && poolSize >= 1)
    .toSorted((left, right) => left.poolSize - right.poolSize)[0]?.poolSize;
}

export function performanceGate(
  input: Readonly<{
    absoluteMedianLimit: number;
    absoluteP95Limit: number;
    baseline: ReturnType<typeof rawStatistics>;
    candidate: ReturnType<typeof rawStatistics>;
    confidenceUpperPercent: number;
    relativeMedianLimit: number;
  }>
): PerformanceGate {
  const absoluteMedianPass =
    input.candidate.medianMilliseconds <= input.absoluteMedianLimit;
  const absoluteP95Pass =
    input.candidate.p95Milliseconds <= input.absoluteP95Limit;
  const confidencePass = input.confidenceUpperPercent < 0;
  const relativeMedianPass =
    input.candidate.medianMilliseconds <=
    input.baseline.medianMilliseconds * input.relativeMedianLimit;
  return {
    absoluteMedianPass,
    absoluteP95Pass,
    confidencePass,
    pass:
      absoluteMedianPass &&
      absoluteP95Pass &&
      relativeMedianPass &&
      confidencePass,
    relativeMedianPass,
  };
}

export function fixtureHash(
  entries: ReadonlyArray<readonly [string, string]>
): string {
  const canonical = JSON.stringify(
    [...entries].toSorted(([left], [right]) => left.localeCompare(right))
  );
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}
