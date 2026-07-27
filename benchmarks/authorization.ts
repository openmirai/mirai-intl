import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const benchmarkRoot = resolve(repositoryRoot, ".tmp", "benchmarks");
const fixtureRoot = resolve(benchmarkRoot, "performance-fixtures");
const defaultReportPath = resolve(benchmarkRoot, "performance.json");
const compilerCli = resolve(repositoryRoot, "packages/compiler/dist/cli.js");
const childOutputLimit = 16 * 1024 * 1024;
const minimumAcceptanceSamples = 30;
const defaultWarmups = 5;
const schemaVersion = 2;
const ownerDefinitions = [
  { fileCount: 9, name: "owner-admin" },
  { fileCount: 9, name: "owner-learner" },
] as const;

type JsonObject = Readonly<Record<string, unknown>>;

type CliInvocation = Readonly<{
  milliseconds: number;
  report: JsonObject;
  result: JsonObject;
  stderr: string;
}>;

type ParityEvidence = Readonly<{
  artifactFileCount: number;
  artifactHash: string;
  authorizedSourceCount: number;
  catalogCount: number;
  diagnosticsCount: number;
  diagnosticsHash: string;
  outputReportParityHash: string;
  receiptCount: number;
  receiptFileReportParityHash: string;
  receiptHash: string;
  reportHash: string;
}>;

type Sample = Readonly<{
  completeGateMilliseconds: number;
  coldEnsureMilliseconds: number;
  index: number;
  parity: ParityEvidence;
  unchangedEnsureMilliseconds: number;
  workspaceAuthorizationMilliseconds: number;
}>;

type Options = Readonly<{
  jsonPath: string;
  samples: number;
  scenario: "turbo-workspace";
  seed: number;
  warmups: number;
}>;

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

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function asObject(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value as JsonObject;
}

function integerOption(
  args: ReadonlyArray<string>,
  name: string,
  fallback: number
): number {
  const prefix = `${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  const index = args.indexOf(name);
  const raw =
    inline?.slice(prefix.length) ?? (index >= 0 ? args[index + 1] : undefined);
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function stringOption(
  args: ReadonlyArray<string>,
  name: string,
  fallback: string
): string {
  const prefix = `${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  const index = args.indexOf(name);
  return (
    inline?.slice(prefix.length) ??
    (index >= 0 ? args[index + 1] : undefined) ??
    fallback
  );
}

function options(args: ReadonlyArray<string>): Options {
  const scenario = stringOption(args, "--scenario", "");
  if (scenario !== "turbo-workspace") {
    throw new Error(
      "Use --scenario turbo-workspace; it is the release-gating performance scenario"
    );
  }
  return {
    jsonPath: resolve(
      repositoryRoot,
      stringOption(args, "--json", defaultReportPath)
    ),
    samples: integerOption(args, "--samples", minimumAcceptanceSamples),
    scenario,
    seed: integerOption(args, "--seed", 2_026_072_7),
    warmups: integerOption(args, "--warmups", defaultWarmups),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

async function createOwner(
  workspaceRoot: string,
  definition: (typeof ownerDefinitions)[number]
): Promise<void> {
  const root = join(workspaceRoot, "packages", definition.name);
  await mkdir(root, { recursive: true });
  await Promise.all([
    writeJson(join(root, "package.json"), {
      dependencies: { vite: "7.3.6" },
      name: `@mirai/${definition.name}`,
      private: true,
      version: "1.0.0",
    }),
    writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8"),
    writeJson(join(root, "src/locales/global/en.json"), {
      greeting: "Hello",
    }),
    writeJson(join(root, "mirai-intl.config.json"), {
      checkProjects: [{ path: "tsconfig.json", role: "owner" }],
    }),
    writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        target: "ES2024",
      },
      include: ["src/**/*.ts"],
    }),
  ]);
  await mkdir(join(root, "src/pages"), { recursive: true });
  await Promise.all(
    Array.from({ length: definition.fileCount }, (_, index) => {
      const suffix = String(index).padStart(4, "0");
      return writeFile(
        join(root, `src/pages/page-${suffix}.ts`),
        [
          'import { useTranslations } from "x";',
          "const { t } = useTranslations();",
          `export const ${definition.name.replace("-", "_")}_${suffix} = t("greeting");`,
          "",
        ].join("\n"),
        "utf8"
      );
    })
  );
}

async function createWorkspaceFixture(directory: string): Promise<void> {
  await rm(directory, { force: true, recursive: true });
  await Promise.all([
    writeJson(join(directory, "package.json"), {
      name: "@mirai/authorization-benchmark-workspace",
      private: true,
      version: "1.0.0",
    }),
    writeFile(
      join(directory, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8"
    ),
    writeFile(
      join(directory, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n",
      "utf8"
    ),
    ...ownerDefinitions.map((definition) => createOwner(directory, definition)),
  ]);
}

async function copyFixture(source: string, destination: string): Promise<void> {
  await rm(destination, { force: true, recursive: true });
  await cp(source, destination, { recursive: true });
}

function normalizeRoot(value: unknown, root: string): unknown {
  if (typeof value === "string") {
    return value.split(root).join("<workspace>");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeRoot(entry, root));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        normalizeRoot(entry, root),
      ])
    );
  }
  return value;
}

async function treeEntries(
  root: string,
  directory: string
): Promise<Array<readonly [string, string]>> {
  const entries: Array<readonly [string, string]> = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (
      await readdir(current, { withFileTypes: true })
    ).toSorted((left, right) => left.name.localeCompare(right.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        entries.push([
          relative(root, path).split("\\").join("/"),
          sha256(await readFile(path)),
        ]);
      }
    }
  };
  await visit(directory);
  return entries;
}

async function actualOutputEvidence(
  workspaceRoot: string,
  relativePaths: ReadonlyArray<string>
): Promise<Readonly<{ fileCount: number; hash: string }>> {
  const entries: Array<readonly [string, string]> = [];
  for (const relativePath of relativePaths) {
    const path = join(workspaceRoot, relativePath);
    if (!(await pathExists(path))) {
      throw new Error(`Expected benchmark output is missing: ${relativePath}`);
    }
    entries.push(...(await treeEntries(workspaceRoot, path)));
  }
  return {
    fileCount: entries.length,
    hash: sha256(canonicalJson(entries)),
  };
}

function runCli(
  cwd: string,
  reportPath: string,
  ...args: ReadonlyArray<string>
): CliInvocation {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [compilerCli, ...args, "--format=json", `--report-file=${reportPath}`],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        FORCE_COLOR: "0",
        NODE_ENV: "production",
      },
      killSignal: "SIGKILL",
      maxBuffer: childOutputLimit,
      shell: false,
      timeout: 180_000,
    }
  );
  const milliseconds = performance.now() - started;
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      [
        `Mirai Intl CLI benchmark invocation failed: ${args.join(" ")}`,
        `cwd=${cwd}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `error=${result.error?.message ?? "(none)"}`,
        `stdout=${result.stdout.slice(0, childOutputLimit)}`,
        `stderr=${result.stderr.slice(0, childOutputLimit)}`,
      ].join("\n")
    );
  }
  const output = asObject(JSON.parse(result.stdout), "CLI stdout");
  return {
    milliseconds: rounded(milliseconds),
    report: { reportPath },
    result: output,
    stderr: result.stderr,
  };
}

async function readInvocationReport(
  invocation: CliInvocation,
  workspaceRoot: string
): Promise<CliInvocation> {
  const reportPath = String(invocation.report.reportPath);
  const report = asObject(
    JSON.parse(await readFile(reportPath, "utf8")),
    "CLI report"
  );
  if (
    canonicalJson(normalizeRoot(report.result, workspaceRoot)) !==
    canonicalJson(normalizeRoot(invocation.result, workspaceRoot))
  ) {
    throw new Error("CLI stdout and --report-file result differ");
  }
  return { ...invocation, report };
}

async function invoke(
  cwd: string,
  reportPath: string,
  ...args: ReadonlyArray<string>
): Promise<CliInvocation> {
  return readInvocationReport(runCli(cwd, reportPath, ...args), cwd);
}

async function receiptFileValues(
  workspaceRoot: string
): Promise<Array<unknown>> {
  return Promise.all(
    ownerDefinitions.map(async ({ name }) =>
      JSON.parse(
        await readFile(
          join(
            workspaceRoot,
            "packages",
            name,
            ".mirai-intl/check-receipt.v1.json"
          ),
          "utf8"
        )
      )
    )
  );
}

function workspaceCatalogs(invocation: CliInvocation): Array<JsonObject> {
  const catalogs = invocation.result.catalogs;
  if (!Array.isArray(catalogs)) {
    throw new Error("Workspace check output must contain catalogs");
  }
  return catalogs.map((catalog, index) =>
    asObject(catalog, `workspace catalog ${index}`)
  );
}

async function runSample(
  seedFixture: string,
  sampleRoot: string,
  index: number
): Promise<Sample> {
  await copyFixture(seedFixture, sampleRoot);
  const generatedPaths = ownerDefinitions.map(
    ({ name }) => `packages/${name}/src/i18n/generated`
  );
  for (const path of generatedPaths) {
    if (await pathExists(join(sampleRoot, path))) {
      throw new Error(`Cold ensure fixture unexpectedly contains ${path}`);
    }
  }

  const completeStarted = performance.now();
  const coldEnsures: Array<CliInvocation> = [];
  for (const { name } of ownerDefinitions) {
    coldEnsures.push(
      await invoke(
        join(sampleRoot, "packages", name),
        join(sampleRoot, `.benchmark/cold-${name}.json`),
        "ensure"
      )
    );
  }
  const coldEnsureMilliseconds = coldEnsures.reduce(
    (total, invocation) => total + invocation.milliseconds,
    0
  );
  if (!coldEnsures.every(({ result }) => result.changed === true)) {
    throw new Error("Missing-output cold ensure must report changed=true");
  }

  const workspaceCheck = await invoke(
    sampleRoot,
    join(sampleRoot, ".benchmark/workspace-check.json"),
    "check",
    "--workspace"
  );
  const completeGateMilliseconds = rounded(performance.now() - completeStarted);
  const catalogs = workspaceCatalogs(workspaceCheck);
  if (
    workspaceCheck.result.valid !== true ||
    catalogs.length !== ownerDefinitions.length ||
    catalogs.some((catalog) => catalog.receipt === undefined)
  ) {
    throw new Error(
      "Workspace authorization must prove and check every owner catalog"
    );
  }

  const unchangedEnsures: Array<CliInvocation> = [];
  for (const { name } of ownerDefinitions) {
    unchangedEnsures.push(
      await invoke(
        join(sampleRoot, "packages", name),
        join(sampleRoot, `.benchmark/unchanged-${name}.json`),
        "ensure"
      )
    );
  }
  if (!unchangedEnsures.every(({ result }) => result.changed === false)) {
    throw new Error("Unchanged ensure must report changed=false");
  }

  const receiptFiles = await receiptFileValues(sampleRoot);
  const reportReceipts = catalogs.map(({ receipt }) => receipt);
  const normalizedReceiptFiles = normalizeRoot(receiptFiles, sampleRoot);
  const normalizedReportReceipts = normalizeRoot(reportReceipts, sampleRoot);
  if (
    canonicalJson(normalizedReceiptFiles) !==
    canonicalJson(normalizedReportReceipts)
  ) {
    throw new Error(
      "Workspace report receipts differ from persisted receipt outputs"
    );
  }

  const normalizedReport = normalizeRoot(workspaceCheck.report, sampleRoot);
  const diagnostics = workspaceCheck.report.diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length !== 0) {
    throw new Error(
      "Successful workspace authorization must emit no diagnostics"
    );
  }
  const artifact = await actualOutputEvidence(sampleRoot, generatedPaths);
  const authorizedSourceCount = receiptFiles.reduce<number>(
    (total, receipt, receiptIndex) => {
      const sources = asObject(receipt, `receipt ${receiptIndex}`).sources;
      if (!Array.isArray(sources)) {
        throw new Error(
          `receipt ${receiptIndex} must contain authorized sources`
        );
      }
      return total + sources.length;
    },
    0
  );
  const outputReportParity = {
    reportResult: normalizeRoot(workspaceCheck.report.result, sampleRoot),
    stdoutResult: normalizeRoot(workspaceCheck.result, sampleRoot),
  };
  const parity: ParityEvidence = {
    artifactFileCount: artifact.fileCount,
    artifactHash: artifact.hash,
    authorizedSourceCount,
    catalogCount: catalogs.length,
    diagnosticsCount: diagnostics.length,
    diagnosticsHash: sha256(canonicalJson(diagnostics)),
    outputReportParityHash: sha256(canonicalJson(outputReportParity)),
    receiptCount: receiptFiles.length,
    receiptFileReportParityHash: sha256(
      canonicalJson({
        files: normalizedReceiptFiles,
        report: normalizedReportReceipts,
      })
    ),
    receiptHash: sha256(canonicalJson(normalizedReceiptFiles)),
    reportHash: sha256(canonicalJson(normalizedReport)),
  };
  return {
    completeGateMilliseconds,
    coldEnsureMilliseconds: rounded(coldEnsureMilliseconds),
    index,
    parity,
    unchangedEnsureMilliseconds: rounded(
      unchangedEnsures.reduce(
        (total, invocation) => total + invocation.milliseconds,
        0
      )
    ),
    workspaceAuthorizationMilliseconds: workspaceCheck.milliseconds,
  };
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

function percentile(values: ReadonlyArray<number>, fraction: number): number {
  const sorted = [...values].toSorted((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  );
  const value = sorted[index];
  if (value === undefined) {
    throw new Error("At least one sample is required");
  }
  return value;
}

function statistics(values: ReadonlyArray<number>): JsonObject {
  const center = median(values);
  const mean =
    values.reduce((total, value) => total + value, 0) / values.length;
  const standardDeviation = Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
      values.length
  );
  return {
    coefficientOfVariation: rounded(mean === 0 ? 0 : standardDeviation / mean),
    madMilliseconds: rounded(
      median(values.map((value) => Math.abs(value - center)))
    ),
    medianMilliseconds: rounded(center),
    p95Milliseconds: rounded(percentile(values, 0.95)),
  };
}

function assertDeterministic(samples: ReadonlyArray<Sample>): JsonObject {
  const fields = [
    "artifactFileCount",
    "artifactHash",
    "authorizedSourceCount",
    "catalogCount",
    "diagnosticsCount",
    "diagnosticsHash",
    "outputReportParityHash",
    "receiptCount",
    "receiptFileReportParityHash",
    "receiptHash",
    "reportHash",
  ] as const;
  const parity = Object.fromEntries(
    fields.map((field) => [
      field,
      new Set(samples.map((sample) => sample.parity[field])).size === 1,
    ])
  );
  if (!Object.values(parity).every(Boolean)) {
    throw new Error(
      `Turbo workspace benchmark emitted non-deterministic outputs: ${canonicalJson(parity)}`
    );
  }
  return {
    evidence: samples[0]?.parity,
    fields,
    parity,
  };
}

function git(...args: ReadonlyArray<string>): string {
  const result = spawnSync("git", [...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to capture benchmark Git metadata: ${result.stderr || result.error?.message}`
    );
  }
  return result.stdout.trim();
}

async function main(args: ReadonlyArray<string>): Promise<void> {
  if (process.versions.node !== "24.18.0") {
    throw new Error(
      `Performance benchmarks require Node 24.18.0; received ${process.version}`
    );
  }
  const configured = options(args);
  if (configured.samples < 1) {
    throw new Error("--samples must be at least 1");
  }
  const mode =
    configured.samples >= minimumAcceptanceSamples ? "acceptance" : "smoke";
  if (mode === "acceptance" && configured.warmups < defaultWarmups) {
    throw new Error(
      `Acceptance mode requires at least ${defaultWarmups} warmups`
    );
  }
  if (!(await pathExists(compilerCli))) {
    throw new Error(
      `Built compiler CLI is missing at ${relative(repositoryRoot, compilerCli)}`
    );
  }

  await rm(fixtureRoot, { force: true, recursive: true });
  await mkdir(fixtureRoot, { recursive: true });
  const seedFixture = join(fixtureRoot, "seed-turbo-workspace");
  await createWorkspaceFixture(seedFixture);

  for (let warmup = 0; warmup < configured.warmups; warmup += 1) {
    await runSample(
      seedFixture,
      join(fixtureRoot, `warmup-${String(warmup).padStart(3, "0")}`),
      warmup
    );
  }
  const samples: Array<Sample> = [];
  for (let sample = 0; sample < configured.samples; sample += 1) {
    samples.push(
      await runSample(
        seedFixture,
        join(fixtureRoot, `sample-${String(sample).padStart(3, "0")}`),
        sample
      )
    );
  }

  const completeStatistics = statistics(
    samples.map(({ completeGateMilliseconds }) => completeGateMilliseconds)
  );
  const medianMilliseconds = Number(completeStatistics.medianMilliseconds);
  const p95Milliseconds = Number(completeStatistics.p95Milliseconds);
  const latencyGate = {
    median: {
      actualMilliseconds: medianMilliseconds,
      limitMilliseconds: 10_000,
      pass: medianMilliseconds <= 10_000,
    },
    p95: {
      actualMilliseconds: p95Milliseconds,
      limitMilliseconds: 20_000,
      pass: p95Milliseconds <= 20_000,
    },
  };
  const latencyPass = latencyGate.median.pass && latencyGate.p95.pass;
  let acceptanceReason: string;
  if (mode !== "acceptance") {
    acceptanceReason = `smoke only: ${configured.samples} samples cannot count as acceptance`;
  } else if (latencyPass) {
    acceptanceReason = "acceptance thresholds passed";
  } else {
    acceptanceReason = "acceptance latency thresholds failed";
  }
  const acceptance = {
    eligible: mode === "acceptance",
    latencyGate,
    minimumSamples: minimumAcceptanceSamples,
    pass: mode === "acceptance" && latencyPass,
    reason: acceptanceReason,
  };

  const dirtyPatch = git("diff", "--binary", "HEAD");
  const report = {
    acceptance,
    environment: {
      architecture: process.arch,
      commit: git("rev-parse", "HEAD"),
      cpuModel: cpus()[0]?.model ?? "unknown",
      dirtyPatchHash: dirtyPatch ? sha256(dirtyPatch) : null,
      icu: process.versions.icu,
      lockfileHash: sha256(
        await readFile(resolve(repositoryRoot, "pnpm-lock.yaml"))
      ),
      logicalCpuCount: cpus().length,
      node: process.version,
      platform: process.platform,
      totalMemoryBytes: totalmem(),
    },
    fixture: {
      ownerCount: ownerDefinitions.length,
      owners: ownerDefinitions,
      totalFiles: ownerDefinitions.reduce(
        (total, owner) => total + owner.fileCount,
        0
      ),
    },
    generatedAt: new Date().toISOString(),
    methodology: {
      cacheState: "process-cold/dependency-hot",
      completeGate:
        "parent wall clock around missing-output owner ensures followed by one fresh workspace check that proves and verifies every owner",
      mode,
      samples: configured.samples,
      scenario: configured.scenario,
      seed: configured.seed,
      unchangedEnsure:
        "separate post-authorization CLI invocations over byte-identical generated outputs",
      warmups: configured.warmups,
    },
    parity: assertDeterministic(samples),
    rawSamples: samples,
    scenario: {
      completeGate: completeStatistics,
      coldEnsure: statistics(
        samples.map(({ coldEnsureMilliseconds }) => coldEnsureMilliseconds)
      ),
      unchangedEnsure: statistics(
        samples.map(
          ({ unchangedEnsureMilliseconds }) => unchangedEnsureMilliseconds
        )
      ),
      workspaceAuthorization: statistics(
        samples.map(
          ({ workspaceAuthorizationMilliseconds }) =>
            workspaceAuthorizationMilliseconds
        )
      ),
    },
    schemaVersion,
  };
  await mkdir(dirname(configured.jsonPath), { recursive: true });
  const temporary = `${configured.jsonPath}.tmp`;
  await writeFile(temporary, `${canonicalJson(report)}\n`, "utf8");
  await rename(temporary, configured.jsonPath);

  process.stdout.write(
    `${JSON.stringify(
      {
        acceptance,
        output: relative(repositoryRoot, configured.jsonPath),
        samples: configured.samples,
        scenario: configured.scenario,
        warmups: configured.warmups,
      },
      null,
      2
    )}\n`
  );
  if (mode === "acceptance" && !latencyPass) {
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
