import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { cpus, hostname, tmpdir, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const benchmarkRoot = resolve(repositoryRoot, ".tmp", "benchmarks");
const fixtureRoot = resolve(tmpdir(), "mirai-intl-performance-fixtures");
const defaultReportPath = resolve(benchmarkRoot, "performance.json");
const candidateCli = resolve(repositoryRoot, "packages/compiler/dist/cli.js");
const profiler = resolve(
  repositoryRoot,
  "benchmarks/authorization-profiler.mjs"
);
const referenceCommit = "89e362b";
const referenceTree = "1e58d4cc11439a4ef4f383954d60f8845b003c76";
const referenceDistHash =
  "sha256:648606df1507421aab9ca7114fec5123c6028571866ac971136cf80392781751";
const minimumAcceptanceSamples = 30;
const acceptanceWarmups = 5;
const acceptanceBatchSize = 6;
const acceptanceUnchangedPairs = 12;
const childOutputLimit = 16 * 1024 * 1024;
const schemaVersion = 3;

type JsonObject = Readonly<Record<string, unknown>>;
type Engine = "candidate" | "reference";
type ScenarioName = "admin-613" | "shared-workspace" | "smoke-18";

type FixtureDefinition = Readonly<{
  checkerCount: number;
  fileCount: number;
  name: ScenarioName;
  ownerCount: number;
}>;

const fixtureDefinitions: ReadonlyArray<FixtureDefinition> = [
  { checkerCount: 0, fileCount: 18, name: "smoke-18", ownerCount: 1 },
  { checkerCount: 0, fileCount: 613, name: "admin-613", ownerCount: 1 },
  {
    checkerCount: 4,
    fileCount: 40,
    name: "shared-workspace",
    ownerCount: 1,
  },
];

type Profile = Readonly<{
  counters: Readonly<Record<string, number>>;
  maxRssBytes: number;
  rssBytes: number;
}>;

type CliInvocation = Readonly<{
  milliseconds: number;
  profile: Profile;
  report: JsonObject;
  result: JsonObject;
}>;

type ParityEvidence = Readonly<{
  ambientTypeFileLimits: ReadonlyArray<number>;
  artifactFileCount: number;
  artifactHash: string;
  authorizedSourceCount: number;
  compilerBoundGenerationReceiptHash: string;
  compilerBoundReceiptHash: string;
  diagnosticsHash: string;
  generationReceiptHash: string;
  providerBudgetExceededCount: number;
  providerRootLimits: ReadonlyArray<number>;
  providerRootsObserved: number;
  receiptHash: string;
  resultHash: string;
}>;

type Workflow = Readonly<{
  completeGateMilliseconds: number;
  engine: Engine;
  factoryCounts: Readonly<Record<string, number>>;
  checkerCount: number;
  filesAnalyzed: number;
  index: number;
  ownerCount: number;
  parity: ParityEvidence;
  peakRssBytes: number;
  phaseTimings: Readonly<{
    coldEnsureMilliseconds: number;
    workspaceAuthorizationMilliseconds: number;
  }>;
  programCount: number;
  scenario: ScenarioName;
}>;

type UnchangedPair = Readonly<{
  candidateMilliseconds: number;
  candidatePeakRssBytes: number;
  candidateRawMilliseconds: ReadonlyArray<number>;
  index: number;
  order: ReadonlyArray<Engine>;
  referenceMilliseconds: number;
  referencePeakRssBytes: number;
  referenceRawMilliseconds: ReadonlyArray<number>;
  scenario: ScenarioName;
}>;

type Options = Readonly<{
  batchSize: number;
  jsonPath: string;
  referenceCli: string | undefined;
  samples: number;
  scenario: "turbo-workspace";
  seed: number;
  unchangedPairs: number;
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
  name: string
): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  const index = args.indexOf(name);
  return (
    inline?.slice(prefix.length) ?? (index >= 0 ? args[index + 1] : undefined)
  );
}

function options(args: ReadonlyArray<string>): Options {
  if (stringOption(args, "--scenario") !== "turbo-workspace") {
    throw new Error(
      "Use --scenario turbo-workspace; it is the release-gating performance scenario"
    );
  }
  const samples = integerOption(args, "--samples", minimumAcceptanceSamples);
  const acceptance = samples >= minimumAcceptanceSamples;
  return {
    batchSize: integerOption(
      args,
      "--batch-size",
      acceptance ? acceptanceBatchSize : 1
    ),
    jsonPath: resolve(
      repositoryRoot,
      stringOption(args, "--json") ?? defaultReportPath
    ),
    referenceCli: stringOption(args, "--reference-cli"),
    samples,
    scenario: "turbo-workspace",
    seed: integerOption(args, "--seed", 2_026_072_7),
    unchangedPairs: integerOption(
      args,
      "--unchanged-pairs",
      acceptance ? acceptanceUnchangedPairs : 1
    ),
    warmups: integerOption(
      args,
      "--warmups",
      acceptance ? acceptanceWarmups : 0
    ),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

async function writeSourceFiles(
  root: string,
  directory: string,
  count: number,
  offset = 0,
  provider = "benchmark-provider"
): Promise<void> {
  await mkdir(join(root, directory), { recursive: true });
  await Promise.all(
    Array.from({ length: count }, (_, index) => {
      const id = String(index + offset).padStart(4, "0");
      const patterns = [
        [
          `import { useTranslations } from "${provider}";`,
          'const { t } = useTranslations("pages.home");',
          `export const page_${id} = t("greeting");`,
        ],
        [
          `import { useTranslations as useI18n } from "${provider}";`,
          'const { t } = useI18n("pages.home");',
          `export const page_${id} = t("greeting");`,
        ],
        [
          `import { useTranslations } from "${provider}";`,
          'const { t: translate } = useTranslations("pages.home");',
          `export const page_${id} = translate("greeting");`,
        ],
        [
          `import { useTranslations } from "${provider}";`,
          'const { t } = useTranslations("pages.home");',
          `export const page_${id} = (() => t("greeting"))();`,
        ],
        [
          `import { useTranslations } from "${provider}";`,
          'const key: "greeting" = "greeting";',
          'const { t } = useTranslations("pages.home");',
          `export const page_${id} = t(key);`,
        ],
        [
          `import { useTranslations } from "${provider}";`,
          'const { t } = useTranslations("pages.home");',
          `export const page_${id} = [1].map(() => t("greeting"))[0];`,
        ],
      ];
      const source = patterns[index % patterns.length];
      if (!source) {
        throw new Error("Benchmark source pattern is missing");
      }
      return writeFile(
        join(root, directory, `page-${id}.ts`),
        [...source, ""].join("\n"),
        "utf8"
      );
    })
  );
}

async function createProviderPackage(directory: string): Promise<void> {
  await mkdir(join(directory, "node_modules/benchmark-provider"), {
    recursive: true,
  });
  await Promise.all([
    writeJson(join(directory, "node_modules/benchmark-provider/package.json"), {
      name: "benchmark-provider",
      types: "index.d.ts",
      version: "1.0.0",
    }),
    writeFile(
      join(directory, "node_modules/benchmark-provider/index.d.ts"),
      "export declare function useTranslations(namespace?: string): { t(key: string): string };\n",
      "utf8"
    ),
  ]);
}

async function createBudgetProvider(
  directory: string,
  importedFileCount: number
): Promise<void> {
  const root = join(directory, "node_modules/budget-provider");
  await mkdir(root, { recursive: true });
  await writeJson(join(root, "package.json"), {
    name: "budget-provider",
    types: "index.d.ts",
    version: "1.0.0",
  });
  await writeFile(join(root, "index.d.ts"), 'export { key } from "./p0";\n');
  await Promise.all(
    Array.from({ length: importedFileCount }, (_, index) =>
      writeFile(
        join(root, `p${index}.d.ts`),
        index === importedFileCount - 1
          ? 'export declare const key: "greeting";\n'
          : `export { key } from "./p${index + 1}";\n`,
        "utf8"
      )
    )
  );
}

async function createSingleOwnerFixture(
  directory: string,
  fileCount: number
): Promise<void> {
  await mkdir(join(directory, "src"), { recursive: true });
  await createProviderPackage(directory);
  await Promise.all([
    writeJson(join(directory, "package.json"), {
      dependencies: { "benchmark-provider": "1.0.0", vite: "7.3.6" },
      name: "@mirai/authorization-benchmark",
      private: true,
      version: "1.0.0",
    }),
    writeFile(
      join(directory, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n",
      "utf8"
    ),
    writeJson(join(directory, "src/locales/global/en.json"), {
      pages: { home: { greeting: "Hello" } },
    }),
    writeJson(join(directory, "tsconfig.base.json"), {
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        target: "ES2024",
      },
    }),
    writeJson(join(directory, "tsconfig.reference.json"), {
      compilerOptions: { composite: true },
      files: [],
    }),
    writeJson(join(directory, "mirai-intl.config.json"), {
      checkProjects: [{ path: "tsconfig.json", role: "owner" }],
    }),
    writeJson(join(directory, "tsconfig.json"), {
      extends: "./tsconfig.base.json",
      include: ["src/pages/**/*.ts"],
      references: [{ path: "./tsconfig.reference.json" }],
    }),
  ]);
  await writeSourceFiles(directory, "src/pages", fileCount);
}

async function createSharedWorkspaceFixture(directory: string): Promise<void> {
  const owner = join(directory, "packages/shared-i18n");
  await mkdir(join(owner, "src"), { recursive: true });
  await createProviderPackage(directory);
  await Promise.all([
    writeJson(join(directory, "package.json"), {
      name: "@mirai/shared-owner-workspace",
      private: true,
      version: "1.0.0",
    }),
    writeFile(
      join(directory, "pnpm-lock.yaml"),
      [
        "lockfileVersion: '9.0'",
        "importers:",
        "  packages/shared-i18n:",
        "    dependencies: {}",
        "  apps/consumer-1:",
        "    dependencies: {}",
        "  apps/consumer-2:",
        "    dependencies: {}",
        "  apps/consumer-3:",
        "    dependencies: {}",
        "  apps/consumer-4:",
        "    dependencies: {}",
        "",
      ].join("\n"),
      "utf8"
    ),
    writeFile(
      join(directory, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n  - apps/*\n",
      "utf8"
    ),
    writeJson(join(owner, "package.json"), {
      dependencies: { "benchmark-provider": "1.0.0", vite: "7.3.6" },
      name: "@mirai/shared-i18n",
      private: true,
      version: "1.0.0",
    }),
    writeJson(join(owner, "src/locales/global/en.json"), {
      pages: { home: { greeting: "Hello" } },
    }),
    writeJson(join(owner, "tsconfig.base.json"), {
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        target: "ES2024",
      },
    }),
  ]);
  const projects: Array<Readonly<{ path: string; role: string }>> = [
    { path: "tsconfig.owner.json", role: "owner" },
  ];
  const ownerIncludes: Array<string> = [];
  for (let consumer = 0; consumer < 4; consumer += 1) {
    const app = join(directory, `apps/consumer-${consumer + 1}`);
    const relativeApp = `../../apps/consumer-${consumer + 1}/src/**/*.ts`;
    ownerIncludes.push(relativeApp);
    const consumerFileCount = 10;
    await Promise.all([
      writeJson(join(app, "package.json"), {
        name: `@mirai/consumer-${consumer + 1}`,
        private: true,
        version: "1.0.0",
      }),
      writeSourceFiles(app, "src/pages", consumerFileCount, consumer * 10),
      writeJson(join(owner, `tsconfig.consumer-${consumer + 1}.json`), {
        extends: "./tsconfig.base.json",
        include: [relativeApp],
      }),
    ]);
    projects.push({
      path: `tsconfig.consumer-${consumer + 1}.json`,
      role: "checker",
    });
  }
  await Promise.all([
    writeJson(join(owner, "tsconfig.owner.json"), {
      extends: "./tsconfig.base.json",
      include: ownerIncludes,
    }),
    writeJson(join(owner, "mirai-intl.config.json"), {
      checkProjects: projects.toSorted((left, right) =>
        left.path.localeCompare(right.path)
      ),
    }),
  ]);
}

async function createFixture(
  directory: string,
  definition: FixtureDefinition
): Promise<void> {
  await rm(directory, { force: true, recursive: true });
  if (definition.name === "shared-workspace") {
    await createSharedWorkspaceFixture(directory);
  } else {
    await createSingleOwnerFixture(directory, definition.fileCount);
  }
}

function fixtureOwnerRoot(root: string, scenario: ScenarioName): string {
  return scenario === "shared-workspace"
    ? join(root, "packages/shared-i18n")
    : root;
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

const engineIdentityFields = new Set([
  "compiler",
  "compilerGit",
  "compilerHash",
  "compilerManifest",
  "compilerManifestHash",
  "environment",
  "generationInputHash",
  "generationReceiptHash",
  "sourceAuthorizationHash",
]);

function normalizeEngineIdentity(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeEngineIdentity);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !engineIdentityFields.has(key))
        .map(([key, entry]) => [key, normalizeEngineIdentity(entry)])
    );
  }
  return value;
}

function parseProfile(stderr: string): Profile {
  const match = /MIRAI_INTL_BENCHMARK_PROFILE=(\{[^\n]+\})/u.exec(stderr);
  if (!match?.[1]) {
    throw new Error(`Benchmark profiler evidence is unavailable:\n${stderr}`);
  }
  return asObject(JSON.parse(match[1]), "benchmark profile") as Profile;
}

function runCli(
  cli: string,
  cwd: string,
  reportPath: string,
  instrumented: boolean,
  ...args: ReadonlyArray<string>
): CliInvocation {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      ...(instrumented ? ["--import", profiler] : []),
      cli,
      ...args,
      "--format=json",
      `--report-file=${reportPath}`,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "1",
        FORCE_COLOR: "0",
        ...(instrumented
          ? {
              MIRAI_INTL_BENCHMARK_TYPESCRIPT: resolve(
                dirname(cli),
                "../node_modules/typescript/lib/typescript.js"
              ),
            }
          : {}),
        NODE_ENV: "production",
      },
      killSignal: "SIGKILL",
      maxBuffer: childOutputLimit,
      shell: false,
      timeout: 180_000,
    }
  );
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      [
        `Mirai Intl CLI benchmark invocation failed: ${args.join(" ")}`,
        `cli=${cli}`,
        `cwd=${cwd}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `error=${result.error?.message ?? "(none)"}`,
        `stdout=${result.stdout.slice(0, childOutputLimit)}`,
        `stderr=${result.stderr.slice(0, childOutputLimit)}`,
      ].join("\n")
    );
  }
  return {
    milliseconds: rounded(performance.now() - started),
    profile: instrumented
      ? parseProfile(result.stderr)
      : { counters: {}, maxRssBytes: 0, rssBytes: 0 },
    report: { reportPath },
    result: asObject(JSON.parse(result.stdout), "CLI stdout"),
  };
}

function runExpectedFailure(
  cli: string,
  cwd: string,
  args: ReadonlyArray<string>,
  environment: Readonly<Record<string, string>> = {}
): JsonObject {
  const result = spawnSync(
    process.execPath,
    ["--import", profiler, cli, ...args, "--format=json"],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        ...environment,
        CI: "1",
        FORCE_COLOR: "0",
        MIRAI_INTL_BENCHMARK_TYPESCRIPT: resolve(
          dirname(cli),
          "../node_modules/typescript/lib/typescript.js"
        ),
        NODE_ENV: "production",
      },
      maxBuffer: childOutputLimit,
      shell: false,
      timeout: 180_000,
    }
  );
  if (result.error || result.status === 0 || result.signal) {
    throw new Error(
      `Expected benchmark failure did not fail cleanly: ${args.join(" ")}\n${result.stderr}`
    );
  }
  const output = asObject(JSON.parse(result.stdout), "expected failure output");
  const diagnostics = output.diagnostics;
  if (!Array.isArray(diagnostics)) {
    throw new Error("Expected failure output lacks diagnostics");
  }
  const diagnosticObjects = diagnostics.map((value, index) =>
    asObject(value, `expected failure diagnostic ${index}`)
  );
  const profile = parseProfile(result.stderr);
  return {
    codes: diagnosticObjects.map((value) => value.code),
    messages: diagnosticObjects.map((value) => value.message),
    outputHash: sha256(
      canonicalJson(normalizeEngineIdentity(normalizeRoot(output, cwd)))
    ),
    programFactoryCalls: Object.values(profile.counters).reduce(
      (total, count) => total + count,
      0
    ),
    status: result.status,
  };
}

async function invoke(
  cli: string,
  cwd: string,
  reportPath: string,
  instrumented: boolean,
  ...args: ReadonlyArray<string>
): Promise<CliInvocation> {
  const invocation = runCli(cli, cwd, reportPath, instrumented, ...args);
  const report = asObject(
    JSON.parse(await readFile(reportPath, "utf8")),
    "CLI report"
  );
  if (
    canonicalJson(normalizeRoot(report.result, cwd)) !==
    canonicalJson(normalizeRoot(invocation.result, cwd))
  ) {
    throw new Error("CLI stdout and --report-file result differ");
  }
  return { ...invocation, report };
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

async function parityEvidence(
  workspaceRoot: string,
  ownerRoot: string,
  checked: CliInvocation
): Promise<ParityEvidence> {
  const generated = join(ownerRoot, "src/i18n/generated");
  const artifactEntries = (await treeEntries(workspaceRoot, generated)).filter(
    ([path]) =>
      !path.endsWith("/catalog-generation-receipt.v1.json") &&
      !path.endsWith("/current.json")
  );
  const receipt = JSON.parse(
    await readFile(join(ownerRoot, ".mirai-intl/check-receipt.v2.json"), "utf8")
  ) as unknown;
  const generationReceipt = JSON.parse(
    await readFile(
      join(generated, "catalog-generation-receipt.v1.json"),
      "utf8"
    )
  ) as unknown;
  const receiptObject = asObject(receipt, "check receipt");
  const sources = receiptObject.sources;
  const providerClosures = receiptObject.providerClosures;
  const diagnostics = checked.report.diagnostics;
  if (
    !Array.isArray(sources) ||
    !Array.isArray(providerClosures) ||
    !Array.isArray(diagnostics)
  ) {
    throw new Error(
      "Benchmark receipt/report lacks source or diagnostic arrays"
    );
  }
  const closureObjects = providerClosures.map((value, index) =>
    asObject(value, `provider closure ${index}`)
  );
  const normalizedResult = normalizeEngineIdentity(
    normalizeRoot(checked.result, workspaceRoot)
  );
  const normalizedGenerationReceipt = normalizeEngineIdentity(
    normalizeRoot(generationReceipt, workspaceRoot)
  );
  const normalizedReceipt = normalizeEngineIdentity(
    normalizeRoot(receipt, workspaceRoot)
  );
  return {
    ambientTypeFileLimits: [
      ...new Set(
        closureObjects.map((value) => Number(value.ambientTypeFileLimit))
      ),
    ],
    artifactFileCount: artifactEntries.length,
    artifactHash: sha256(canonicalJson(artifactEntries)),
    authorizedSourceCount: sources.length,
    compilerBoundGenerationReceiptHash: sha256(
      canonicalJson(normalizeRoot(generationReceipt, workspaceRoot))
    ),
    compilerBoundReceiptHash: sha256(
      canonicalJson(normalizeRoot(receipt, workspaceRoot))
    ),
    diagnosticsHash: sha256(canonicalJson(diagnostics)),
    generationReceiptHash: sha256(canonicalJson(normalizedGenerationReceipt)),
    providerBudgetExceededCount: closureObjects.filter(
      (value) => value.providerBudgetExceeded === true
    ).length,
    providerRootLimits: [
      ...new Set(
        closureObjects.map((value) => Number(value.providerRootLimit))
      ),
    ],
    providerRootsObserved: closureObjects.reduce(
      (total, value) =>
        total + (Array.isArray(value.providers) ? value.providers.length : 0),
      0
    ),
    receiptHash: sha256(canonicalJson(normalizedReceipt)),
    resultHash: sha256(canonicalJson(normalizedResult)),
  };
}

async function runWorkflow(
  engine: Engine,
  cli: string,
  seedFixture: string,
  sampleRoot: string,
  definition: FixtureDefinition,
  index: number,
  instrumented = true
): Promise<Workflow> {
  await rm(sampleRoot, { force: true, recursive: true });
  await cp(seedFixture, sampleRoot, { recursive: true });
  const ownerRoot = fixtureOwnerRoot(sampleRoot, definition.name);
  const generated = join(ownerRoot, "src/i18n/generated");
  if (await pathExists(generated)) {
    throw new Error("Process-cold fixture must not contain generated outputs");
  }
  const completeStarted = performance.now();
  const ensured = await invoke(
    cli,
    ownerRoot,
    join(sampleRoot, ".benchmark/cold-ensure.json"),
    instrumented,
    "ensure"
  );
  if (ensured.result.changed !== true) {
    throw new Error("Missing-output cold ensure must report changed=true");
  }
  const checked = await invoke(
    cli,
    definition.name === "shared-workspace" ? sampleRoot : ownerRoot,
    join(sampleRoot, ".benchmark/check.json"),
    instrumented,
    definition.name === "shared-workspace" ? "check" : "prove",
    ...(definition.name === "shared-workspace" ? ["--workspace"] : [])
  );
  const completeGateMilliseconds = rounded(performance.now() - completeStarted);
  const authorization = asObject(
    checked.result.authorization,
    "authorization counters"
  );
  const filesAnalyzed = Number(authorization.semanticFilesAnalyzed);
  let ownerCount = Number(authorization.ownerProjects);
  let checkerCount = Number(authorization.checkerProjects);
  if (!Number.isFinite(ownerCount) || !Number.isFinite(checkerCount)) {
    const catalogs = checked.result.catalogs;
    if (!Array.isArray(catalogs)) {
      throw new Error(
        "Workspace authorization lacks observed catalog counters"
      );
    }
    const counters = catalogs.map((catalog, catalogIndex) => {
      const receipt = asObject(
        asObject(catalog, `workspace catalog ${catalogIndex}`).receipt,
        `workspace catalog ${catalogIndex} receipt`
      );
      return asObject(
        receipt.counters,
        `workspace catalog ${catalogIndex} counters`
      );
    });
    ownerCount = counters.reduce(
      (total, value) => total + Number(value.ownerProjects),
      0
    );
    checkerCount = counters.reduce(
      (total, value) => total + Number(value.checkerProjects),
      0
    );
  }
  const authorizationSucceeded =
    definition.name === "shared-workspace"
      ? checked.result.valid === true
      : checked.result.receipt !== undefined;
  if (
    !authorizationSucceeded ||
    filesAnalyzed !== definition.fileCount ||
    ownerCount !== definition.ownerCount ||
    checkerCount !== definition.checkerCount
  ) {
    throw new Error(
      `${definition.name} observed counters differ from the fixture contract: ${canonicalJson({ checkerCount, filesAnalyzed, ownerCount })}`
    );
  }
  const programCount = [ensured.profile, checked.profile].reduce(
    (total, profile) =>
      total +
      Object.values(profile.counters).reduce(
        (subtotal, count) => subtotal + count,
        0
      ),
    0
  );
  const factoryCounts = Object.fromEntries(
    [
      ...new Set([
        ...Object.keys(ensured.profile.counters),
        ...Object.keys(checked.profile.counters),
      ]),
    ].map((name) => [
      name,
      (ensured.profile.counters[name] ?? 0) +
        (checked.profile.counters[name] ?? 0),
    ])
  );
  return {
    checkerCount,
    completeGateMilliseconds,
    engine,
    factoryCounts,
    filesAnalyzed,
    index,
    ownerCount,
    parity: await parityEvidence(sampleRoot, ownerRoot, checked),
    peakRssBytes: Math.max(
      ensured.profile.maxRssBytes,
      checked.profile.maxRssBytes
    ),
    phaseTimings: {
      coldEnsureMilliseconds: ensured.milliseconds,
      workspaceAuthorizationMilliseconds: checked.milliseconds,
    },
    programCount,
    scenario: definition.name,
  };
}

async function runUnchangedPair(
  referenceCli: string,
  seedFixture: string,
  pairRoot: string,
  definition: FixtureDefinition,
  index: number
): Promise<UnchangedPair> {
  const order: ReadonlyArray<Engine> =
    index % 2 === 0
      ? ["reference", "candidate", "candidate", "reference"]
      : ["candidate", "reference", "reference", "candidate"];
  const measurements: Record<Engine, Array<CliInvocation>> = {
    candidate: [],
    reference: [],
  };
  for (const [position, engine] of order.entries()) {
    const cli = engine === "reference" ? referenceCli : candidateCli;
    const root = join(pairRoot, `${position}-${engine}`);
    await rm(root, { force: true, recursive: true });
    await cp(seedFixture, root, { recursive: true });
    const ownerRoot = fixtureOwnerRoot(root, definition.name);
    const bootstrap = await invoke(
      cli,
      ownerRoot,
      join(root, ".benchmark/bootstrap.json"),
      true,
      "ensure"
    );
    if (bootstrap.result.changed !== true) {
      throw new Error("Unchanged owner-pair bootstrap must create outputs");
    }
    const unchanged = await invoke(
      cli,
      ownerRoot,
      join(root, ".benchmark/unchanged.json"),
      true,
      "ensure"
    );
    if (unchanged.result.changed !== false) {
      throw new Error("Unchanged owner-pair input bytes must remain unchanged");
    }
    measurements[engine].push(unchanged);
  }
  const reference = measurements.reference;
  const candidate = measurements.candidate;
  if (reference.length !== 2 || candidate.length !== 2) {
    throw new Error("Unchanged owner-pair evidence is incomplete");
  }
  const referenceRawMilliseconds = reference.map(
    ({ milliseconds }) => milliseconds
  );
  const candidateRawMilliseconds = candidate.map(
    ({ milliseconds }) => milliseconds
  );
  return {
    candidateMilliseconds: median(candidateRawMilliseconds),
    candidatePeakRssBytes: Math.max(
      ...candidate.map(({ profile }) => profile.maxRssBytes)
    ),
    candidateRawMilliseconds,
    index,
    order,
    referenceMilliseconds: median(referenceRawMilliseconds),
    referencePeakRssBytes: Math.max(
      ...reference.map(({ profile }) => profile.maxRssBytes)
    ),
    referenceRawMilliseconds,
    scenario: definition.name,
  };
}

async function verifyInstrumentationParity(
  seedFixture: string,
  definition: FixtureDefinition
): Promise<JsonObject> {
  const root = join(fixtureRoot, "instrumentation-parity");
  const instrumented = await runWorkflow(
    "candidate",
    candidateCli,
    seedFixture,
    root,
    definition,
    -1,
    true
  );
  const uninstrumented = await runWorkflow(
    "candidate",
    candidateCli,
    seedFixture,
    root,
    definition,
    -1,
    false
  );
  if (
    canonicalJson(instrumented.parity) !==
      canonicalJson(uninstrumented.parity) ||
    instrumented.filesAnalyzed !== uninstrumented.filesAnalyzed ||
    instrumented.ownerCount !== uninstrumented.ownerCount ||
    instrumented.checkerCount !== uninstrumented.checkerCount ||
    instrumented.programCount <= 0 ||
    (instrumented.factoryCounts.createProgram ?? 0) >
      instrumented.filesAnalyzed ||
    (instrumented.factoryCounts.createLanguageService ?? 0) >
      instrumented.ownerCount ||
    (instrumented.factoryCounts.createIncrementalProgram ?? 0) >
      instrumented.ownerCount ||
    (instrumented.factoryCounts.createSemanticDiagnosticsBuilderProgram ?? 0) >
      instrumented.ownerCount ||
    (instrumented.factoryCounts
      .createEmitAndSemanticDiagnosticsBuilderProgram ?? 0) >
      instrumented.ownerCount ||
    (instrumented.factoryCounts.createSolutionBuilder ?? 0) >
      instrumented.ownerCount ||
    (instrumented.factoryCounts.createWatchProgram ?? 0) >
      instrumented.ownerCount ||
    (instrumented.factoryCounts.createAbstractBuilder ?? 0) >
      instrumented.ownerCount
  ) {
    throw new Error(
      "Benchmark instrumentation changed CLI outputs or failed to observe semantic factories"
    );
  }
  return {
    factoryMix: instrumented.factoryCounts,
    observedFactoryCalls: instrumented.programCount,
    parityHash: sha256(canonicalJson(instrumented.parity)),
    pass: true,
    trackedFactories: [
      "createAbstractBuilder",
      "createEmitAndSemanticDiagnosticsBuilderProgram",
      "createIncrementalProgram",
      "createLanguageService",
      "createProgram",
      "createSemanticDiagnosticsBuilderProgram",
      "createSolutionBuilder",
      "createWatchProgram",
    ],
  };
}

async function verifySemanticIntegrityMatrix(
  referenceCli: string,
  smokeSeed: string
): Promise<JsonObject> {
  const matrixSeed = join(fixtureRoot, "seed-semantic-matrix");
  await createSingleOwnerFixture(matrixSeed, 6);
  await rm(join(matrixSeed, "src/pages/page-0001.ts"));
  await writeJson(join(matrixSeed, "tsconfig.json"), {
    extends: "./tsconfig.base.json",
    include: ["src/pages/**/*.ts", "src/pages/**/*.tsx"],
    references: [{ path: "./tsconfig.reference.json" }],
  });
  await Promise.all([
    writeFile(
      join(matrixSeed, "src/pages/page-0000.ts"),
      [
        'import { useTranslations } from "benchmark-provider";',
        "declare const namespace: string;",
        "const { t } = useTranslations(namespace);",
        'export const invalidDynamic = t("greeting");',
        "",
      ].join("\n"),
      "utf8"
    ),
    writeFile(
      join(matrixSeed, "src/pages/page-0001.tsx"),
      'export const invalidTitle = <button title="Hardcoded benchmark title" />;\n',
      "utf8"
    ),
  ]);
  const providerLimitSeed = join(fixtureRoot, "seed-provider-limit");
  const providerOverflowSeed = join(fixtureRoot, "seed-provider-overflow");
  await createSingleOwnerFixture(providerLimitSeed, 1);
  await createBudgetProvider(providerLimitSeed, 63);
  const providerSource = [
    'import { useTranslations } from "benchmark-provider";',
    'import { key } from "budget-provider";',
    'const { t } = useTranslations("pages.home");',
    "export const translated = t(key);",
    "",
  ].join("\n");
  await writeFile(
    join(providerLimitSeed, "src/pages/page-0000.ts"),
    providerSource,
    "utf8"
  );
  await createSingleOwnerFixture(providerOverflowSeed, 1);
  await createBudgetProvider(providerOverflowSeed, 64);
  await writeFile(
    join(providerOverflowSeed, "src/pages/page-0000.ts"),
    providerSource,
    "utf8"
  );
  const exceptionSeed = join(fixtureRoot, "seed-exact-exception");
  await createSingleOwnerFixture(exceptionSeed, 1);
  const exceptionSource = [
    'import { useTranslations } from "benchmark-provider";',
    "declare const namespace: string;",
    "const { t } = useTranslations(namespace);",
    'export const exceptedDynamic = t("greeting");',
    "",
  ].join("\n");
  await writeFile(
    join(exceptionSeed, "src/pages/page-0000.ts"),
    exceptionSource,
    "utf8"
  );
  await writeJson(join(exceptionSeed, "mirai-intl.config.json"), {
    checkExceptions: [
      {
        file: "src/pages/page-0000.ts",
        nodeHash: sha256("namespace"),
        reason: "benchmark exact exception coverage",
        rule: "source-analysis",
      },
    ],
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  const invalidEvidence: Array<JsonObject> = [];
  const corruptionEvidence: Array<JsonObject> = [];
  const receiptCorruptionEvidence: Array<JsonObject> = [];
  const mutationEvidence: Array<JsonObject> = [];
  const providerLimitEvidence: Array<ParityEvidence> = [];
  const providerOverflowEvidence: Array<JsonObject> = [];
  const exceptionEvidence: Array<ParityEvidence> = [];
  for (const engine of ["reference", "candidate"] as const) {
    const cli = engine === "reference" ? referenceCli : candidateCli;
    const invalidRoot = join(fixtureRoot, `matrix-invalid-${engine}`);
    await rm(invalidRoot, { force: true, recursive: true });
    await cp(matrixSeed, invalidRoot, { recursive: true });
    await invoke(
      cli,
      invalidRoot,
      join(invalidRoot, ".benchmark/ensure.json"),
      true,
      "ensure"
    );
    invalidEvidence.push(runExpectedFailure(cli, invalidRoot, ["prove"]));

    const corruptionRoot = join(fixtureRoot, `matrix-corruption-${engine}`);
    await rm(corruptionRoot, { force: true, recursive: true });
    await cp(smokeSeed, corruptionRoot, { recursive: true });
    await invoke(
      cli,
      corruptionRoot,
      join(corruptionRoot, ".benchmark/ensure.json"),
      true,
      "ensure"
    );
    const generated = join(corruptionRoot, "src/i18n/generated");
    const payload = (await treeEntries(generated, generated))
      .map(([path]) => path)
      .find((path) => path.includes("builds/") && path.endsWith(".mjs"));
    if (!payload) {
      throw new Error("Integrity matrix generated payload is missing");
    }
    await writeFile(
      join(generated, payload),
      `${await readFile(join(generated, payload), "utf8")}\n/* corruption */\n`,
      "utf8"
    );
    corruptionEvidence.push(runExpectedFailure(cli, corruptionRoot, ["prove"]));

    const receiptCorruptionRoot = join(
      fixtureRoot,
      `matrix-receipt-corruption-${engine}`
    );
    await rm(receiptCorruptionRoot, { force: true, recursive: true });
    await cp(smokeSeed, receiptCorruptionRoot, { recursive: true });
    await invoke(
      cli,
      receiptCorruptionRoot,
      join(receiptCorruptionRoot, ".benchmark/ensure.json"),
      true,
      "ensure"
    );
    await invoke(
      cli,
      receiptCorruptionRoot,
      join(receiptCorruptionRoot, ".benchmark/prove.json"),
      true,
      "prove"
    );
    await writeFile(
      join(receiptCorruptionRoot, ".mirai-intl/check-receipt.v2.json"),
      '{"schemaVersion":',
      "utf8"
    );
    const artifactRoot = join(receiptCorruptionRoot, ".benchmark/artifact");
    await mkdir(artifactRoot, { recursive: true });
    await writeFile(
      join(artifactRoot, "app.js"),
      "export const benchmarkArtifact = true;\n",
      "utf8"
    );
    receiptCorruptionEvidence.push(
      runExpectedFailure(cli, receiptCorruptionRoot, [
        "prove-artifact",
        "--target",
        "client",
        "--artifact-root",
        artifactRoot,
      ])
    );

    const mutationRoot = join(fixtureRoot, `matrix-mutation-${engine}`);
    await rm(mutationRoot, { force: true, recursive: true });
    await cp(smokeSeed, mutationRoot, { recursive: true });
    await invoke(
      cli,
      mutationRoot,
      join(mutationRoot, ".benchmark/ensure.json"),
      true,
      "ensure"
    );
    mutationEvidence.push(
      runExpectedFailure(cli, mutationRoot, ["prove"], {
        MIRAI_INTL_BENCHMARK_MUTATION_TARGET: join(
          mutationRoot,
          "src/pages/page-0000.ts"
        ),
      })
    );

    const providerLimit = await runWorkflow(
      engine,
      cli,
      providerLimitSeed,
      join(fixtureRoot, `matrix-provider-limit-${engine}`),
      { checkerCount: 0, fileCount: 1, name: "smoke-18", ownerCount: 1 },
      -3
    );
    providerLimitEvidence.push(providerLimit.parity);
    const overflowRoot = join(
      fixtureRoot,
      `matrix-provider-overflow-${engine}`
    );
    await rm(overflowRoot, { force: true, recursive: true });
    await cp(providerOverflowSeed, overflowRoot, { recursive: true });
    await invoke(
      cli,
      overflowRoot,
      join(overflowRoot, ".benchmark/ensure.json"),
      true,
      "ensure"
    );
    providerOverflowEvidence.push(
      runExpectedFailure(cli, overflowRoot, ["prove"])
    );
    const exceptionWorkflow = await runWorkflow(
      engine,
      cli,
      exceptionSeed,
      join(fixtureRoot, `matrix-exception-${engine}`),
      { checkerCount: 0, fileCount: 1, name: "smoke-18", ownerCount: 1 },
      -4
    );
    exceptionEvidence.push(exceptionWorkflow.parity);
  }
  const invalidParity =
    new Set(invalidEvidence.map((value) => value.outputHash)).size === 1;
  const corruptionParity =
    new Set(corruptionEvidence.map((value) => value.outputHash)).size === 1;
  const receiptCorruptionParity =
    new Set(receiptCorruptionEvidence.map((value) => value.outputHash)).size ===
    1;
  const receiptCorruptionDistinct = receiptCorruptionEvidence.every(
    (value, index) => value.outputHash !== corruptionEvidence[index]?.outputHash
  );
  const receiptCorruptionNonSemantic = receiptCorruptionEvidence.every(
    (value) => value.programFactoryCalls === 0
  );
  const mutationParity =
    new Set(mutationEvidence.map((value) => value.outputHash)).size === 1;
  const providerLimitParity =
    new Set(providerLimitEvidence.map((value) => value.receiptHash)).size === 1;
  const providerLimitExact = providerLimitEvidence.every(
    (value) =>
      value.providerRootsObserved === 64 &&
      value.providerBudgetExceededCount === 0
  );
  const providerOverflowParity =
    new Set(providerOverflowEvidence.map((value) => value.outputHash)).size ===
    1;
  const exceptionParity =
    new Set(exceptionEvidence.map((value) => value.receiptHash)).size === 1;
  const diagnosticCodesExact = [
    ...invalidEvidence,
    ...corruptionEvidence,
    ...receiptCorruptionEvidence,
    ...mutationEvidence,
    ...providerOverflowEvidence,
  ].every((value) => canonicalJson(value.codes) === '["INTL_CATALOG_INVALID"]');
  const invalidMessages = invalidEvidence.flatMap((value) =>
    Array.isArray(value.messages) ? value.messages : []
  );
  const corruptionMessages = corruptionEvidence.flatMap((value) =>
    Array.isArray(value.messages) ? value.messages : []
  );
  const receiptCorruptionMessages = receiptCorruptionEvidence.flatMap(
    (value) => (Array.isArray(value.messages) ? value.messages : [])
  );
  const mutationMessages = mutationEvidence.flatMap((value) =>
    Array.isArray(value.messages) ? value.messages : []
  );
  const providerOverflowMessages = providerOverflowEvidence.flatMap((value) =>
    Array.isArray(value.messages) ? value.messages : []
  );
  const diagnosticKindsExact =
    invalidMessages.some(
      (message) =>
        typeof message === "string" &&
        message.includes("Dynamic useTranslations namespace")
    ) &&
    invalidMessages.some(
      (message) =>
        typeof message === "string" &&
        message.includes("hardcoded title string")
    ) &&
    corruptionMessages.every(
      (message) =>
        typeof message === "string" &&
        message.includes("payload") &&
        message.includes("is corrupt")
    ) &&
    receiptCorruptionMessages.every(
      (message) =>
        typeof message === "string" &&
        message.includes("check receipt V2") &&
        message.includes("must contain valid JSON")
    ) &&
    mutationMessages.every(
      (message) =>
        typeof message === "string" &&
        message.includes("changed while source analysis ran")
    ) &&
    providerOverflowMessages.every(
      (message) =>
        typeof message === "string" &&
        message.includes("exceeded the 64-file provider budget")
    );
  if (
    !invalidParity ||
    !corruptionParity ||
    !receiptCorruptionParity ||
    !receiptCorruptionDistinct ||
    !receiptCorruptionNonSemantic ||
    !mutationParity ||
    !providerLimitParity ||
    !providerLimitExact ||
    !providerOverflowParity ||
    !exceptionParity ||
    !diagnosticCodesExact ||
    !diagnosticKindsExact
  ) {
    throw new Error(
      `Semantic integrity matrix reference parity failed: ${canonicalJson({
        corruptionParity,
        diagnosticCodesExact,
        diagnosticKindsExact,
        exceptionParity,
        invalidParity,
        mutationParity,
        providerLimitExact,
        providerLimitParity,
        providerOverflowParity,
        receiptCorruptionDistinct,
        receiptCorruptionNonSemantic,
        receiptCorruptionParity,
        providerRoots: providerLimitEvidence.map(
          (value) => value.providerRootsObserved
        ),
      })}`
    );
  }
  return {
    cases: {
      checkReceiptBytesCorruption: receiptCorruptionEvidence,
      dynamicAndHardcodedDiagnostics: invalidEvidence,
      exactSourceAnalysisException: exceptionEvidence,
      generatedPayloadCorruption: corruptionEvidence,
      providerLimit: providerLimitEvidence,
      providerLimitPlusOne: providerOverflowEvidence,
      sourceMutationDuringAuthorization: mutationEvidence,
    },
    coverage: [
      "aliased hook import",
      "destructured translator alias",
      "callback and map",
      "finite and rejected dynamic keys",
      "hardcoded-literal diagnostics",
      "exact source-analysis exception",
      "imported provider declarations and provider caps",
      "transitive tsconfig extends and references",
      "canonical check-receipt byte corruption through build verification",
      "generated payload corruption",
      "deterministic source mutation during authorization barrier",
    ],
    pass: true,
  };
}

function median(values: ReadonlyArray<number>): number {
  const sorted = [...values].toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) {
    throw new Error("At least one sample is required");
  }
  const left = sorted[middle - 1];
  return sorted.length % 2 === 0 && left !== undefined
    ? (left + value) / 2
    : value;
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

function statistics(
  values: ReadonlyArray<number>,
  unit: "Bytes" | "Count" | "Milliseconds" = "Milliseconds"
): JsonObject {
  const center = median(values);
  const mean =
    values.reduce((total, value) => total + value, 0) / values.length;
  const standardDeviation = Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
      values.length
  );
  return {
    coefficientOfVariation: rounded(mean === 0 ? 0 : standardDeviation / mean),
    [`mad${unit}`]: rounded(
      median(values.map((value) => Math.abs(value - center)))
    ),
    [`median${unit}`]: rounded(center),
    [`p95${unit}`]: rounded(percentile(values, 0.95)),
  };
}

function batchMeans(
  values: ReadonlyArray<number>,
  batchSize: number
): ReadonlyArray<number> {
  const result: Array<number> = [];
  for (let index = 0; index + batchSize <= values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize);
    result.push(
      batch.reduce((total, value) => total + value, 0) / batch.length
    );
  }
  if (result.length === 0) {
    throw new Error("At least one complete contiguous batch is required");
  }
  return result;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pairedStatistics(
  reference: ReadonlyArray<number>,
  candidate: ReadonlyArray<number>,
  seed: number
): JsonObject {
  if (reference.length !== candidate.length || reference.length === 0) {
    throw new Error("Paired measurements must have equal non-zero lengths");
  }
  const deltas = reference.map((value, index) => {
    const candidateValue = candidate[index];
    if (candidateValue === undefined || value === 0) {
      throw new Error("Paired measurement is incomplete or zero");
    }
    return ((candidateValue - value) / value) * 100;
  });
  const random = mulberry32(seed);
  const bootstrap = Array.from({ length: 10_000 }, () => {
    const resample = Array.from(
      { length: deltas.length },
      () => deltas[Math.floor(random() * deltas.length)] ?? 0
    );
    return median(resample);
  });
  return {
    bootstrap95ConfidenceIntervalPercent: [
      rounded(percentile(bootstrap, 0.025)),
      rounded(percentile(bootstrap, 0.975)),
    ],
    bootstrapIterations: 10_000,
    bootstrapSeed: seed,
    medianPairedDeltaPercent: rounded(median(deltas)),
    rawPairs: reference.map((referenceValue, index) => ({
      candidate: candidate[index],
      reference: referenceValue,
    })),
    rawPairedDeltasPercent: deltas.map(rounded),
  };
}

function favorableBootstrapConfidence(paired: JsonObject): boolean {
  const interval = paired.bootstrap95ConfidenceIntervalPercent;
  return (
    Array.isArray(interval) &&
    typeof interval[1] === "number" &&
    interval[1] < 0
  );
}

function strictParity(
  workflows: ReadonlyArray<Workflow>,
  definition: FixtureDefinition
): JsonObject {
  const fields = [
    "ambientTypeFileLimits",
    "artifactFileCount",
    "artifactHash",
    "authorizedSourceCount",
    "diagnosticsHash",
    "generationReceiptHash",
    "providerBudgetExceededCount",
    "providerRootLimits",
    "providerRootsObserved",
    "receiptHash",
    "resultHash",
  ] as const;
  const parity = Object.fromEntries(
    fields.map((field) => [
      field,
      new Set(
        workflows.map((workflow) => canonicalJson(workflow.parity[field]))
      ).size === 1,
    ])
  );
  const exactMetrics =
    workflows.every(
      ({ checkerCount, filesAnalyzed, ownerCount }) =>
        filesAnalyzed === definition.fileCount &&
        ownerCount === definition.ownerCount &&
        checkerCount === definition.checkerCount
    ) &&
    workflows.every(
      ({ parity: sampleParity }) =>
        canonicalJson(sampleParity.ambientTypeFileLimits) === "[16]" &&
        canonicalJson(sampleParity.providerRootLimits) === "[64]"
    );
  if (!Object.values(parity).every(Boolean) || !exactMetrics) {
    throw new Error(
      `${definition.name} strict reference/candidate parity failed: ${canonicalJson({ exactMetrics, parity })}`
    );
  }
  return {
    evidence: workflows[0]?.parity,
    exactMetrics,
    fields,
    identityBoundFieldsExcludedFromSemanticParity: [
      "compilerBoundGenerationReceiptHash",
      "compilerBoundReceiptHash",
    ],
    parity,
  };
}

function git(cwd: string, ...args: ReadonlyArray<string>): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (
    result.error ||
    result.status !== 0 ||
    typeof result.stdout !== "string"
  ) {
    throw new Error(
      `Unable to capture benchmark Git metadata: ${
        typeof result.stderr === "string"
          ? result.stderr
          : (result.error?.message ?? "stdout unavailable")
      }`
    );
  }
  return result.stdout.trim();
}

function optionalCommandStdout(
  command: string,
  args: ReadonlyArray<string>,
  cwd?: string
): string | null {
  const result = spawnSync(command, args, {
    ...(cwd ? { cwd } : {}),
    encoding: "utf8",
    shell: false,
  });
  if (
    result.error ||
    result.status !== 0 ||
    typeof result.stdout !== "string"
  ) {
    return null;
  }
  return result.stdout.trim() || null;
}

function physicalCpuCount(): number | null {
  const stdout = optionalCommandStdout("sysctl", ["-n", "hw.physicalcpu"]);
  if (stdout === null) {
    return null;
  }
  const parsed = Number(stdout);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function assertReferenceCli(path: string | undefined): Promise<string> {
  if (!path || !(await pathExists(path))) {
    throw new Error(
      `Reference evidence is unavailable. Build ${referenceCommit} in a detached tree and pass --reference-cli=/absolute/path/to/packages/compiler/dist/cli.js`
    );
  }
  const canonical = await realpath(path);
  const referenceRoot = resolve(dirname(canonical), "../../..");
  const commit = git(referenceRoot, "rev-parse", "HEAD");
  if (commit !== git(repositoryRoot, "rev-parse", referenceCommit)) {
    throw new Error(
      `Reference CLI must come from pinned ${referenceCommit}; received ${commit}`
    );
  }
  const dirty = git(
    referenceRoot,
    "status",
    "--porcelain",
    "--untracked-files=all"
  );
  if (dirty) {
    throw new Error("Reference CLI tree must be clean");
  }
  const tree = git(referenceRoot, "rev-parse", "HEAD^{tree}");
  if (tree !== referenceTree) {
    throw new Error(
      `Reference source tree hash differs: expected ${referenceTree}, received ${tree}`
    );
  }
  const distRoot = join(referenceRoot, "packages/compiler/dist");
  const distHash = sha256(canonicalJson(await treeEntries(distRoot, distRoot)));
  if (distHash !== referenceDistHash) {
    throw new Error(
      `Reference dist is stale or was not built from the pinned detached source: expected ${referenceDistHash}, received ${distHash}`
    );
  }
  return canonical;
}

async function compilerTypescriptIdentity(cli: string): Promise<JsonObject> {
  const implementation = await realpath(
    resolve(dirname(cli), "../node_modules/typescript/lib/typescript.js")
  );
  const packageRoot = resolve(dirname(implementation), "..");
  const manifestPath = join(packageRoot, "package.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = asObject(
    JSON.parse(manifestBytes.toString("utf8")),
    manifestPath
  );
  if (manifest.name !== "typescript" || typeof manifest.version !== "string") {
    throw new Error(
      `Compiler TypeScript package identity is invalid: ${manifestPath}`
    );
  }
  return {
    implementation: relative(packageRoot, implementation).split("\\").join("/"),
    implementationHash: sha256(await readFile(implementation)),
    name: manifest.name,
    packageHash: sha256(
      canonicalJson(await treeEntries(packageRoot, packageRoot))
    ),
    packageManifestHash: sha256(manifestBytes),
    version: manifest.version,
  };
}

async function main(args: ReadonlyArray<string>): Promise<void> {
  if (process.versions.node !== "24.18.0") {
    throw new Error(
      `Performance benchmarks require Node 24.18.0; received ${process.version}`
    );
  }
  const configured = options(args);
  if (configured.samples < 1 || configured.batchSize < 1) {
    throw new Error("--samples and --batch-size must be at least 1");
  }
  const acceptanceEligible =
    configured.samples >= minimumAcceptanceSamples &&
    configured.warmups >= acceptanceWarmups &&
    configured.batchSize >= acceptanceBatchSize &&
    configured.unchangedPairs >= acceptanceUnchangedPairs;
  const referenceCli = await assertReferenceCli(configured.referenceCli);
  if (!(await pathExists(candidateCli)) || !(await pathExists(profiler))) {
    throw new Error("Built candidate CLI or benchmark profiler is missing");
  }
  const candidateTypescript = await compilerTypescriptIdentity(candidateCli);
  const referenceTypescript = await compilerTypescriptIdentity(referenceCli);
  if (
    candidateTypescript.packageHash !== referenceTypescript.packageHash ||
    candidateTypescript.implementationHash !==
      referenceTypescript.implementationHash
  ) {
    throw new Error(
      "Reference and candidate compiler TypeScript implementations differ"
    );
  }

  await rm(fixtureRoot, { force: true, recursive: true });
  await mkdir(fixtureRoot, { recursive: true });
  const seeds = new Map<ScenarioName, string>();
  for (const definition of fixtureDefinitions) {
    const seed = join(fixtureRoot, `seed-${definition.name}`);
    await createFixture(seed, definition);
    seeds.set(definition.name, seed);
  }
  const smokeDefinition = fixtureDefinitions.find(
    ({ name }) => name === "smoke-18"
  );
  const smokeSeed = seeds.get("smoke-18");
  if (!smokeDefinition || !smokeSeed) {
    throw new Error("Instrumentation parity fixture is missing");
  }
  const instrumentationParity = await verifyInstrumentationParity(
    smokeSeed,
    smokeDefinition
  );
  const semanticIntegrityMatrix = await verifySemanticIntegrityMatrix(
    referenceCli,
    smokeSeed
  );

  const workflows: Array<Workflow> = [];
  const unchangedPairs: Array<UnchangedPair> = [];
  let workflowIndex = 0;
  for (let warmup = 0; warmup < configured.warmups; warmup += 1) {
    for (const definition of fixtureDefinitions) {
      const seed = seeds.get(definition.name);
      if (!seed) {
        throw new Error("Fixture seed is missing");
      }
      for (const engine of ["reference", "candidate"] as const) {
        await runWorkflow(
          engine,
          engine === "reference" ? referenceCli : candidateCli,
          seed,
          join(fixtureRoot, `warmup-${warmup}-${definition.name}-${engine}`),
          definition,
          workflowIndex++
        );
      }
    }
  }

  for (let outer = 0; outer < configured.samples; outer += 1) {
    const order: ReadonlyArray<Engine> =
      outer % 2 === 0
        ? ["reference", "candidate", "candidate", "reference"]
        : ["candidate", "reference", "reference", "candidate"];
    for (const definition of fixtureDefinitions) {
      const seed = seeds.get(definition.name);
      if (!seed) {
        throw new Error("Fixture seed is missing");
      }
      for (const engine of order) {
        for (let batch = 0; batch < configured.batchSize; batch += 1) {
          workflows.push(
            await runWorkflow(
              engine,
              engine === "reference" ? referenceCli : candidateCli,
              seed,
              join(
                fixtureRoot,
                `outer-${outer}-${definition.name}-${engine}-${workflowIndex}`
              ),
              definition,
              workflowIndex++
            )
          );
        }
      }
      for (let pair = 0; pair < configured.unchangedPairs; pair += 1) {
        unchangedPairs.push(
          await runUnchangedPair(
            referenceCli,
            seed,
            join(fixtureRoot, `unchanged-${outer}-${definition.name}-${pair}`),
            definition,
            outer * configured.unchangedPairs + pair
          )
        );
      }
    }
  }

  const scenarioReports = Object.fromEntries(
    fixtureDefinitions.map((definition, scenarioIndex) => {
      const scenarioWorkflows = workflows.filter(
        ({ scenario }) => scenario === definition.name
      );
      const reference = scenarioWorkflows.filter(
        ({ engine }) => engine === "reference"
      );
      const candidate = scenarioWorkflows.filter(
        ({ engine }) => engine === "candidate"
      );
      const referenceRaw = reference.map(
        ({ completeGateMilliseconds }) => completeGateMilliseconds
      );
      const candidateRaw = candidate.map(
        ({ completeGateMilliseconds }) => completeGateMilliseconds
      );
      const referenceGateRaw =
        definition.name === "shared-workspace"
          ? referenceRaw
          : reference.map(
              ({ phaseTimings }) =>
                phaseTimings.workspaceAuthorizationMilliseconds
            );
      const candidateGateRaw =
        definition.name === "shared-workspace"
          ? candidateRaw
          : candidate.map(
              ({ phaseTimings }) =>
                phaseTimings.workspaceAuthorizationMilliseconds
            );
      const referenceBatches = batchMeans(
        referenceGateRaw,
        configured.batchSize
      );
      const candidateBatches = batchMeans(
        candidateGateRaw,
        configured.batchSize
      );
      const pairs = unchangedPairs.filter(
        ({ scenario }) => scenario === definition.name
      );
      const pairedRawCells = pairedStatistics(
        referenceGateRaw,
        candidateGateRaw,
        configured.seed + scenarioIndex
      );
      const candidateComplete = statistics(candidateRaw);
      const referenceComplete = statistics(referenceRaw);
      const candidateGatingLatency = statistics(candidateGateRaw);
      const referenceGatingLatency = statistics(referenceGateRaw);
      const candidateUnchanged = statistics(
        pairs.flatMap(
          ({ candidateRawMilliseconds }) => candidateRawMilliseconds
        )
      );
      const referenceUnchanged = statistics(
        pairs.flatMap(
          ({ referenceRawMilliseconds }) => referenceRawMilliseconds
        )
      );
      const unchangedPairedCells = pairedStatistics(
        pairs.map(({ referenceMilliseconds }) => referenceMilliseconds),
        pairs.map(({ candidateMilliseconds }) => candidateMilliseconds),
        configured.seed + 100 + scenarioIndex
      );
      const completeConfidencePass =
        favorableBootstrapConfidence(pairedRawCells);
      const unchangedConfidencePass =
        favorableBootstrapConfidence(unchangedPairedCells);
      let medianLimit = 10_000;
      let p95Limit = 20_000;
      let relativeLimit = 0.5;
      if (definition.name === "smoke-18") {
        medianLimit = 2_000;
        p95Limit = 2_500;
      } else if (definition.name === "admin-613") {
        p95Limit = 12_000;
        relativeLimit = 0.4;
      }
      const completeGatePass =
        Number(candidateGatingLatency.medianMilliseconds) <= medianLimit &&
        Number(candidateGatingLatency.p95Milliseconds) <= p95Limit &&
        Number(candidateGatingLatency.medianMilliseconds) <=
          Number(referenceGatingLatency.medianMilliseconds) * relativeLimit &&
        Number(candidateGatingLatency.p95Milliseconds) <=
          Number(referenceGatingLatency.p95Milliseconds) * relativeLimit &&
        completeConfidencePass;
      const unchangedGatePass =
        Number(candidateUnchanged.medianMilliseconds) <= 400 &&
        Number(candidateUnchanged.p95Milliseconds) <= 600 &&
        Number(candidateUnchanged.medianMilliseconds) <=
          Number(referenceUnchanged.medianMilliseconds) * 0.3 &&
        Number(candidateUnchanged.p95Milliseconds) <=
          Number(referenceUnchanged.p95Milliseconds) * 0.3 &&
        unchangedConfidencePass;
      const rawStabilityPass =
        Number(candidateGatingLatency.coefficientOfVariation) <= 0.1 &&
        Number(referenceGatingLatency.coefficientOfVariation) <= 0.1 &&
        Number(candidateUnchanged.coefficientOfVariation) <= 0.1 &&
        Number(referenceUnchanged.coefficientOfVariation) <= 0.1;
      return [
        definition.name,
        {
          completeGate: {
            candidateBatchMeans: statistics(candidateBatches),
            candidateRaw: candidateComplete,
            pairedRawCells,
            referenceBatchMeans: statistics(referenceBatches),
            referenceRaw: referenceComplete,
          },
          counters: {
            candidate: {
              checkerCount: [
                ...new Set(candidate.map((run) => run.checkerCount)),
              ],
              filesAnalyzed: [
                ...new Set(candidate.map((run) => run.filesAnalyzed)),
              ],
              factoryMix: Object.fromEntries(
                [
                  ...new Set(
                    candidate.flatMap((run) => Object.keys(run.factoryCounts))
                  ),
                ].map((name) => [
                  name,
                  statistics(
                    candidate.map((run) => run.factoryCounts[name] ?? 0),
                    "Count"
                  ),
                ])
              ),
              ownerCount: [...new Set(candidate.map((run) => run.ownerCount))],
              programCount: statistics(
                candidate.map((run) => run.programCount),
                "Count"
              ),
            },
            expected: definition,
            reference: {
              checkerCount: [
                ...new Set(reference.map((run) => run.checkerCount)),
              ],
              filesAnalyzed: [
                ...new Set(reference.map((run) => run.filesAnalyzed)),
              ],
              factoryMix: Object.fromEntries(
                [
                  ...new Set(
                    reference.flatMap((run) => Object.keys(run.factoryCounts))
                  ),
                ].map((name) => [
                  name,
                  statistics(
                    reference.map((run) => run.factoryCounts[name] ?? 0),
                    "Count"
                  ),
                ])
              ),
              ownerCount: [...new Set(reference.map((run) => run.ownerCount))],
              programCount: statistics(
                reference.map((run) => run.programCount),
                "Count"
              ),
            },
          },
          gates: {
            completeGate: {
              measuredPhase:
                definition.name === "shared-workspace"
                  ? "completeGate"
                  : "processColdAuthorization",
              medianLimitMilliseconds: medianLimit,
              p95LimitMilliseconds: p95Limit,
              pass: completeGatePass,
              pairedBootstrapConfidencePass: completeConfidencePass,
              relativeLimit,
            },
            rawStability: { cvLimit: 0.1, pass: rawStabilityPass },
            unchangedEnsure: {
              medianLimitMilliseconds: 400,
              p95LimitMilliseconds: 600,
              pass: unchangedGatePass,
              pairedBootstrapConfidencePass: unchangedConfidencePass,
              relativeLimit: 0.3,
            },
          },
          parity: strictParity(scenarioWorkflows, definition),
          gatingLatency: {
            candidateRaw: candidateGatingLatency,
            referenceRaw: referenceGatingLatency,
          },
          peakRssBytes: {
            candidate: statistics(
              candidate.map((run) => run.peakRssBytes),
              "Bytes"
            ),
            reference: statistics(
              reference.map((run) => run.peakRssBytes),
              "Bytes"
            ),
          },
          phaseTimings: {
            candidate: {
              coldEnsure: statistics(
                candidate.map(
                  ({ phaseTimings }) => phaseTimings.coldEnsureMilliseconds
                )
              ),
              workspaceAuthorization: statistics(
                candidate.map(
                  ({ phaseTimings }) =>
                    phaseTimings.workspaceAuthorizationMilliseconds
                )
              ),
            },
            reference: {
              coldEnsure: statistics(
                reference.map(
                  ({ phaseTimings }) => phaseTimings.coldEnsureMilliseconds
                )
              ),
              workspaceAuthorization: statistics(
                reference.map(
                  ({ phaseTimings }) =>
                    phaseTimings.workspaceAuthorizationMilliseconds
                )
              ),
            },
          },
          unchangedEnsure: {
            candidate: candidateUnchanged,
            pairedRawCells: unchangedPairedCells,
            rawP95AcrossAllFreshOwnerPairs: {
              candidateMilliseconds: rounded(
                percentile(
                  pairs
                    .map(
                      ({ candidateRawMilliseconds }) => candidateRawMilliseconds
                    )
                    .flat(),
                  0.95
                )
              ),
              referenceMilliseconds: rounded(
                percentile(
                  pairs
                    .map(
                      ({ referenceRawMilliseconds }) => referenceRawMilliseconds
                    )
                    .flat(),
                  0.95
                )
              ),
            },
            reference: referenceUnchanged,
          },
        },
      ];
    })
  );

  const scenarioValues = Object.values(scenarioReports).map((value) =>
    asObject(value, "scenario report")
  );
  const confidencePass = scenarioValues.every((scenario) => {
    const gates = asObject(scenario.gates, "scenario gates");
    return (
      asObject(gates.completeGate, "complete gate")
        .pairedBootstrapConfidencePass === true &&
      asObject(gates.unchangedEnsure, "unchanged ensure gate")
        .pairedBootstrapConfidencePass === true
    );
  });
  const stabilityPass = scenarioValues.every((scenario) => {
    const gates = asObject(scenario.gates, "scenario gates");
    return asObject(gates.rawStability, "raw stability gate").pass === true;
  });
  const scenarioPerformancePass = scenarioValues.every((scenario) => {
    const gates = asObject(scenario.gates, "scenario gates");
    return (
      asObject(gates.completeGate, "complete gate").pass === true &&
      asObject(gates.unchangedEnsure, "unchanged ensure gate").pass === true
    );
  });
  const candidatePeak = Math.max(
    ...workflows
      .filter(({ engine }) => engine === "candidate")
      .map(({ peakRssBytes }) => peakRssBytes)
  );
  const referencePeak = Math.max(
    ...workflows
      .filter(({ engine }) => engine === "reference")
      .map(({ peakRssBytes }) => peakRssBytes)
  );
  const rssPass =
    candidatePeak <= referencePeak * 1.5 &&
    candidatePeak <= 2 * 1024 * 1024 * 1024;
  const latencyWorkflows = workflows.filter(
    ({ engine, scenario }) =>
      scenario === "shared-workspace" && engine === "candidate"
  );
  const latencyMedian = median(
    latencyWorkflows.map(
      ({ completeGateMilliseconds }) => completeGateMilliseconds
    )
  );
  const latencyP95 = percentile(
    latencyWorkflows.map(
      ({ completeGateMilliseconds }) => completeGateMilliseconds
    ),
    0.95
  );
  const latencyPass = latencyMedian <= 10_000 && latencyP95 <= 20_000;
  const unchangedCandidate = unchangedPairs.map(
    ({ candidateMilliseconds }) => candidateMilliseconds
  );
  const unchangedAbsolutePass =
    median(unchangedCandidate) <= 400 &&
    percentile(unchangedCandidate, 0.95) <= 600;
  const unchangedRelativeConfidencePass = scenarioValues.every((scenario) => {
    const gates = asObject(scenario.gates, "scenario gates");
    return (
      asObject(gates.unchangedEnsure, "unchanged ensure gate").pass === true
    );
  });
  const unchangedPass =
    unchangedAbsolutePass && unchangedRelativeConfidencePass;
  const pass =
    acceptanceEligible &&
    confidencePass &&
    stabilityPass &&
    scenarioPerformancePass &&
    rssPass &&
    latencyPass &&
    unchangedPass;
  let acceptanceReason =
    "smoke only: reduced samples/batching are ineligible for acceptance";
  if (acceptanceEligible) {
    acceptanceReason = pass
      ? "all release evaluator gates passed"
      : "one or more release evaluator gates failed";
  }
  const acceptance = {
    confidenceIntervalExcludesZeroForImprovement: confidencePass,
    eligible: acceptanceEligible,
    latencyGate: {
      median: { actualMilliseconds: rounded(latencyMedian), limit: 10_000 },
      p95: { actualMilliseconds: rounded(latencyP95), limit: 20_000 },
      pass: latencyPass,
    },
    minimums: {
      batchSize: acceptanceBatchSize,
      samples: minimumAcceptanceSamples,
      unchangedOwnerPairsPerOuterSample: acceptanceUnchangedPairs,
      warmups: acceptanceWarmups,
    },
    pass,
    reason: acceptanceReason,
    rssGate: {
      candidatePeakBytes: candidatePeak,
      limitBytes: Math.min(referencePeak * 1.5, 2 * 1024 * 1024 * 1024),
      pass: rssPass,
      referencePeakBytes: referencePeak,
    },
    stabilityCvGate: { limit: 0.1, pass: stabilityPass },
    scenarioPerformanceGatesPass: scenarioPerformancePass,
    unchangedEnsureGate: {
      absolutePass: unchangedAbsolutePass,
      medianLimitMilliseconds: 400,
      p95LimitMilliseconds: 600,
      pass: unchangedPass,
      relativeAndConfidencePass: unchangedRelativeConfidencePass,
    },
  };

  const dirtyPatch = git(repositoryRoot, "diff", "--binary", "HEAD");
  const report = {
    acceptance,
    environment: {
      architecture: process.arch,
      candidateCommit: git(repositoryRoot, "rev-parse", "HEAD"),
      cpuModels: [...new Set(cpus().map(({ model }) => model))],
      dirtyPatchHash: dirtyPatch ? sha256(dirtyPatch) : null,
      hostname: hostname(),
      icu: process.versions.icu,
      lockfileHash: sha256(
        await readFile(join(repositoryRoot, "pnpm-lock.yaml"))
      ),
      logicalCpuCount: cpus().length,
      node: process.version,
      physicalCpuCount: physicalCpuCount(),
      platform: process.platform,
      pnpm: optionalCommandStdout(
        "corepack",
        ["pnpm", "--version"],
        repositoryRoot
      ),
      referenceCommit: git(
        resolve(dirname(referenceCli), "../../.."),
        "rev-parse",
        "HEAD"
      ),
      runnerImage: process.env.ImageOS ?? process.env.RUNNER_OS ?? "local",
      runnerName: process.env.RUNNER_NAME ?? "local",
      totalMemoryBytes: totalmem(),
      typescript: {
        candidate: candidateTypescript,
        reference: referenceTypescript,
      },
      workerCount: 1,
      workerEnvironment: Object.fromEntries(
        [
          "CI",
          "GITHUB_ACTIONS",
          "NODE_OPTIONS",
          "TURBO_CONCURRENCY",
          "UV_THREADPOOL_SIZE",
        ].map((name) => [name, process.env[name] ?? null])
      ),
    },
    fixtures: fixtureDefinitions,
    generatedAt: new Date().toISOString(),
    methodology: {
      cacheState:
        "process-cold/dependency-hot: every measured full workflow uses a new Node process and copied input tree with fresh generated/report/cache directories; installed dependencies and the OS page cache remain hot",
      comparison:
        "paired interleaved ABBA reference/candidate ordering; even outer samples use ABBA and odd samples use BAAB",
      confidenceAuthority:
        "bootstrap confidence gates use every explicitly paired raw ABBA/BAAB cell for full workflows and every fresh-root ABBA/BAAB median cell for unchanged ensure; batch means are reporting context only",
      completeGate:
        "parent wall clock around missing-output ensure followed by a fresh complete authorization check",
      fullWorkflowAggregation:
        "contiguous six-run batch means are reported only as scheduler-noise context; every acceptance stability gate uses the untrimmed raw full-workflow or raw unchanged-owner-cell CV and fails above 10%",
      instrumentation:
        "benchmark-only Node loader redirects only compiler-dist TypeScript imports through a transparent factory-counting shim and records process.resourceUsage().maxRSS at exit; production compiler/runtime modules are unchanged",
      mode: acceptanceEligible ? "acceptance" : "smoke",
      processCold:
        "new CLI process per phase and fresh Mirai temporary/cache/output directories",
      rawLatencyGatesUntouched: true,
      referenceBaseline:
        "reconciled strict per-file engine at 89e362b with provider-frontier authority, immediately before owner batching",
      samples: configured.samples,
      scenario: configured.scenario,
      seed: configured.seed,
      unchangedEnsure:
        "fresh copied owner pair per repetition; each engine first creates outputs, then measures one byte-identical unchanged ensure; no trim, retries, or discarded samples",
      warmups: configured.warmups,
    },
    instrumentationParity,
    rawSamples: {
      unchangedOwnerPairs: unchangedPairs,
      workflows,
    },
    semanticIntegrityMatrix,
    scenarios: scenarioReports,
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
  if (acceptanceEligible && !pass) {
    process.exitCode = 1;
  }
}

await main(process.argv.slice(2));
