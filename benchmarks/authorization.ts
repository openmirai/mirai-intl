import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
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

import { EnsureWorker } from "./authorization-ensure-client";
import type {
  MeasurementSurface,
  RawBlock,
  WorkloadIdentity,
} from "./authorization-methodology";
import {
  acceptanceEligibility,
  assertDistinctReferenceRoles,
  assertFrozenProductionCandidate,
  assertTimedWorkflowShape,
  assertWorkloadEquivalent,
  childArgumentVector,
  completeContractPass,
  engineOrder,
  EVALUATOR_SOURCE_PATHS,
  pairedBlockStatistics,
  PERFORMANCE_REFERENCE,
  performanceGate,
  productionCandidateIdentity,
  rawStatistics,
  releaseAcceptance,
  rssSamplingSchedule,
  rssWorkflowPeak,
  SEMANTIC_REFERENCE,
} from "./authorization-methodology";

const repositoryRoot = resolve(import.meta.dirname, "..");
const benchmarkRoot = resolve(repositoryRoot, ".tmp", "benchmarks");
const fixtureRoot = resolve(tmpdir(), "mirai-intl-performance-fixtures");
const defaultReportPath = resolve(benchmarkRoot, "performance.json");
const candidateCli = resolve(repositoryRoot, "packages/compiler/dist/cli.js");
const profiler = resolve(
  repositoryRoot,
  "benchmarks/authorization-profiler.mjs"
);
const rssProbe = resolve(
  repositoryRoot,
  "benchmarks/authorization-rss-probe.mjs"
);
const semanticReferenceDistHash =
  "sha256:648606df1507421aab9ca7114fec5123c6028571866ac971136cf80392781751";
const performanceReferenceDistHash =
  "sha256:4747fe2c0a4bdbbe38690d7af53d28944d179cdc0f625b2c71a4044f79517b86";
const minimumAcceptanceSamples = 30;
const acceptanceWarmups = 5;
const childOutputLimit = 16 * 1024 * 1024;
const schemaVersion = 6;

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
  childArguments: ReadonlyArray<string>;
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
  authorizedSourceLedgerHash: string;
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

type WorkflowBase = Readonly<{
  childArguments: Readonly<{
    authorization: ReadonlyArray<string>;
    coldEnsure: ReadonlyArray<string>;
  }>;
  checkerCount: number;
  engine: Engine;
  filesAnalyzed: number;
  index: number;
  ownerCount: number;
  parity: ParityEvidence;
  scenario: ScenarioName;
}>;

type Workflow = WorkflowBase &
  Readonly<{
    completeGateMilliseconds: number;
    phaseTimings: Readonly<{
      coldEnsureMilliseconds: number;
      workspaceAuthorizationMilliseconds: number;
    }>;
  }>;

type TypescriptAudit = WorkflowBase &
  Readonly<{
    factoryCounts: Readonly<Record<string, number>>;
    programCount: number;
  }>;

type RssAudit = WorkflowBase &
  Readonly<{
    peaks: Readonly<{
      authorizationBytes: number;
      coldEnsureBytes: number;
      workflowBytes: number;
    }>;
    pair: number;
  }>;

type UnchangedPair = Readonly<{
  block: RawBlock;
  candidateMilliseconds: number;
  candidatePeakRssBytes: number;
  candidateRawMilliseconds: ReadonlyArray<number>;
  contexts: Readonly<Record<Engine, string>>;
  fixtureHashes: Readonly<Record<Engine, string>>;
  index: number;
  order: ReadonlyArray<Engine>;
  pids: Readonly<Record<Engine, number>>;
  referenceMilliseconds: number;
  referencePeakRssBytes: number;
  referenceRawMilliseconds: ReadonlyArray<number>;
  scenario: ScenarioName;
  warmupCount: number;
  workerImplementations: Readonly<
    Record<Engine, Readonly<{ hash: string; lifecycle: string }>>
  >;
}>;

type Options = Readonly<{
  jsonPath: string;
  performanceReferenceCli: string | undefined;
  samples: number;
  scenario: "turbo-workspace";
  seed: number;
  semanticReferenceCli: string | undefined;
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
  return {
    jsonPath: resolve(
      repositoryRoot,
      stringOption(args, "--json") ?? defaultReportPath
    ),
    performanceReferenceCli:
      stringOption(args, "--performance-reference-cli") ??
      stringOption(args, "--reference-cli"),
    samples,
    scenario: "turbo-workspace",
    seed: integerOption(args, "--seed", 2_026_072_7),
    semanticReferenceCli: stringOption(args, "--semantic-reference-cli"),
    warmups: integerOption(
      args,
      "--warmups",
      samples >= minimumAcceptanceSamples ? acceptanceWarmups : 0
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

function normalizeWorkspacePath(value: unknown, root: string): unknown {
  const normalized = normalizeRoot(value, root);
  if (typeof normalized !== "string") {
    return normalized;
  }
  const relativeRoot = relative(repositoryRoot, root).split("\\").join("/");
  return relativeRoot.startsWith("../")
    ? normalized
    : normalized.split(relativeRoot).join("<workspace>");
}

const engineIdentityFields = new Set([
  "compiler",
  "compilerGit",
  "compilerHash",
  "compilerManifest",
  "compilerManifestHash",
  "discoveryPolicyHash",
  "environment",
  "exceptionsHash",
  "generationInputHash",
  "generationReceiptHash",
  "sourceAuthorizationHash",
]);

function normalizeEngineIdentity(
  value: unknown,
  withinContracts = false
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      normalizeEngineIdentity(entry, withinContracts)
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !engineIdentityFields.has(key) &&
            !(withinContracts && key === "hash")
        )
        .map(([key, entry]) => [
          key,
          normalizeEngineIdentity(
            entry,
            withinContracts || key === "contracts"
          ),
        ])
    );
  }
  return value;
}

function stripWorkspacePrefix(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replaceAll("<workspace>/", "");
  }
  if (Array.isArray(value)) {
    return value.map(stripWorkspacePrefix);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        stripWorkspacePrefix(entry),
      ])
    );
  }
  return value;
}

function normalizeFailureDiagnostics(
  diagnostics: ReadonlyArray<JsonObject>,
  cwd: string
): unknown {
  let normalized: unknown = diagnostics;
  if (cwd.startsWith("/var/")) {
    normalized = normalizeRoot(normalized, `/private${cwd}`);
  }
  normalized = normalizeRoot(normalized, realpathSync(cwd));
  normalized = normalizeRoot(normalized, cwd);
  return normalizeEngineIdentity(stripWorkspacePrefix(normalized));
}

function parseProfile(stderr: string): Profile {
  const match = /MIRAI_INTL_BENCHMARK_PROFILE=(\{[^\n]+\})/u.exec(stderr);
  if (!match?.[1]) {
    throw new Error(`Benchmark profiler evidence is unavailable:\n${stderr}`);
  }
  return asObject(JSON.parse(match[1]), "benchmark profile") as Profile;
}

function parseRssProfile(stderr: string): Profile {
  const match = /MIRAI_INTL_BENCHMARK_RSS=(\{[^\n]+\})/u.exec(stderr);
  if (!match?.[1]) {
    throw new Error(`Benchmark RSS evidence is unavailable:\n${stderr}`);
  }
  const value = asObject(JSON.parse(match[1]), "benchmark RSS profile");
  if (
    typeof value.maxRssBytes !== "number" ||
    typeof value.rssBytes !== "number"
  ) {
    throw new Error("Benchmark RSS evidence is invalid");
  }
  return {
    counters: {},
    maxRssBytes: value.maxRssBytes,
    rssBytes: value.rssBytes,
  };
}

function semanticCliResult(value: JsonObject): JsonObject {
  return {
    ...(typeof value.changed === "boolean" ? { changed: value.changed } : {}),
    ...(typeof value.checkerProjects === "number"
      ? { checkerProjects: value.checkerProjects }
      : {}),
    ...(typeof value.ownerProjects === "number"
      ? { ownerProjects: value.ownerProjects }
      : {}),
    ...(typeof value.semanticAuthorizationRuns === "number"
      ? { semanticAuthorizationRuns: value.semanticAuthorizationRuns }
      : {}),
    ...(typeof value.semanticFilesAnalyzed === "number"
      ? { semanticFilesAnalyzed: value.semanticFilesAnalyzed }
      : {}),
    ...(typeof value.valid === "boolean" ? { valid: value.valid } : {}),
  };
}

function legacyReceiptObjects(output: JsonObject): ReadonlyArray<JsonObject> {
  if (Array.isArray(output.sources) && Array.isArray(output.projects)) {
    return [output];
  }
  if (
    output.receipt &&
    typeof output.receipt === "object" &&
    !Array.isArray(output.receipt)
  ) {
    return [asObject(output.receipt, "legacy receipt")];
  }
  if (!Array.isArray(output.catalogs)) {
    return [];
  }
  return output.catalogs.map((catalog, catalogIndex) => {
    const catalogObject = asObject(catalog, `legacy catalog ${catalogIndex}`);
    return catalogObject.receipt &&
      typeof catalogObject.receipt === "object" &&
      !Array.isArray(catalogObject.receipt)
      ? asObject(
          catalogObject.receipt,
          `legacy catalog ${catalogIndex} receipt`
        )
      : catalogObject;
  });
}

function legacyReceiptCount(
  receipts: ReadonlyArray<JsonObject>,
  property: "projects" | "sources",
  role?: "checker" | "owner"
): number | undefined {
  if (receipts.length === 0) {
    return undefined;
  }
  return receipts.reduce((total, receipt, receiptIndex) => {
    const values = receipt[property];
    if (!Array.isArray(values)) {
      throw new Error(
        `legacy receipt ${receiptIndex} must contain ${property}`
      );
    }
    if (property === "sources") {
      return total + values.length;
    }
    return (
      total +
      values.filter((value, projectIndex) => {
        const project = asObject(
          value,
          `legacy receipt ${receiptIndex} project ${projectIndex}`
        );
        return project.role === role;
      }).length
    );
  }, 0);
}

function runCli(
  cli: string,
  cwd: string,
  reportPath: string,
  surface: MeasurementSurface,
  ...args: ReadonlyArray<string>
): CliInvocation {
  const childArguments = childArgumentVector({
    cli,
    commandArguments: args,
    node: process.execPath,
    profiler,
    reportPath,
    rssProbe,
    surface,
  });
  const started = performance.now();
  const [executable, ...childArgs] = childArguments;
  if (!executable) {
    throw new Error("Benchmark child argument vector is empty");
  }
  const result = spawnSync(executable, childArgs, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      FORCE_COLOR: "0",
      ...(surface === "typescript"
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
  });
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
  const output = asObject(JSON.parse(result.stdout), "CLI stdout");
  let summary: JsonObject;
  if (cli === candidateCli) {
    summary = asObject(output.summary, "CLI stdout summary");
    if (
      output.schemaVersion !== 1 ||
      output.command !== args[0] ||
      output.success !== true ||
      !Array.isArray(output.diagnostics) ||
      output.diagnostics.length !== 0 ||
      canonicalJson(Object.keys(output).toSorted()) !==
        canonicalJson([
          "command",
          "diagnostics",
          "schemaVersion",
          "success",
          "summary",
        ])
    ) {
      throw new Error("CLI stdout safe-envelope contract invalid");
    }
  } else {
    const authorization =
      output.authorization &&
      typeof output.authorization === "object" &&
      !Array.isArray(output.authorization)
        ? asObject(output.authorization, "legacy authorization")
        : {};
    const receipts = legacyReceiptObjects(output);
    const projectCount = (
      property: "checkerProjects" | "ownerProjects"
    ): number | undefined => {
      if (typeof authorization[property] === "number") {
        return authorization[property];
      }
      return legacyReceiptCount(
        receipts,
        "projects",
        property === "checkerProjects" ? "checker" : "owner"
      );
    };
    const checkerProjects = projectCount("checkerProjects");
    const ownerProjects = projectCount("ownerProjects");
    const semanticFilesAnalyzed =
      typeof authorization.semanticFilesAnalyzed === "number"
        ? authorization.semanticFilesAnalyzed
        : legacyReceiptCount(receipts, "sources");
    let semanticAuthorizationRuns: number | undefined;
    if (typeof authorization.semanticAuthorizationRuns === "number") {
      semanticAuthorizationRuns = authorization.semanticAuthorizationRuns;
    } else if (receipts.length > 0) {
      semanticAuthorizationRuns = 1;
    }
    summary = {
      ...(typeof output.changed === "boolean"
        ? { changed: output.changed }
        : {}),
      ...(checkerProjects === undefined ? {} : { checkerProjects }),
      ...(ownerProjects === undefined ? {} : { ownerProjects }),
      ...(semanticAuthorizationRuns === undefined
        ? {}
        : { semanticAuthorizationRuns }),
      ...(semanticFilesAnalyzed === undefined ? {} : { semanticFilesAnalyzed }),
      valid:
        typeof output.valid === "boolean"
          ? output.valid
          : receipts.length > 0 || args[0] === "ensure",
    };
  }
  let profile: Profile = { counters: {}, maxRssBytes: 0, rssBytes: 0 };
  if (surface === "typescript") {
    profile = parseProfile(result.stderr);
  } else if (surface === "rss") {
    profile = parseRssProfile(result.stderr);
  }
  return {
    childArguments,
    milliseconds: rounded(performance.now() - started),
    profile,
    report: { reportPath },
    result: semanticCliResult(summary),
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
  const codes = diagnosticObjects.map((value) => value.code);
  const messages = diagnosticObjects.map((value) => value.message);
  return {
    codes,
    messages,
    outputHash: sha256(
      canonicalJson({
        codes,
        diagnostics: normalizeFailureDiagnostics(diagnosticObjects, cwd),
        status: result.status,
      })
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
  surface: MeasurementSurface,
  ...args: ReadonlyArray<string>
): Promise<CliInvocation> {
  const invocation = runCli(cli, cwd, reportPath, surface, ...args);
  const rawReport = asObject(
    JSON.parse(await readFile(reportPath, "utf8")),
    "CLI report"
  );
  const report = {
    command: rawReport.command,
    diagnostics: rawReport.diagnostics,
    schemaVersion: rawReport.schemaVersion,
    success: rawReport.success,
  };
  if (
    report.command !== args[0] ||
    report.schemaVersion !== 1 ||
    report.success !== true ||
    !Array.isArray(report.diagnostics) ||
    report.diagnostics.length !== 0
  ) {
    throw new Error("CLI --report-file success contract is invalid");
  }
  if (
    cli === candidateCli &&
    canonicalJson(Object.keys(rawReport).toSorted()) !==
      canonicalJson(["command", "diagnostics", "schemaVersion", "success"])
  ) {
    throw new Error("Candidate CLI report exposed non-diagnostic payload data");
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
  const receiptV2 = join(ownerRoot, ".mirai-intl/check-receipt.v2.json");
  const receiptV1 = join(ownerRoot, ".mirai-intl/check-receipt.v1.json");
  const receiptPath = (await pathExists(receiptV2)) ? receiptV2 : receiptV1;
  if (!(await pathExists(receiptPath))) {
    throw new Error("Benchmark check receipt is missing");
  }
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as unknown;
  const generationReceiptPath = join(
    generated,
    "catalog-generation-receipt.v1.json"
  );
  const generationReceipt = (await pathExists(generationReceiptPath))
    ? (JSON.parse(await readFile(generationReceiptPath, "utf8")) as unknown)
    : {
        phase0PerformanceBaseline: true,
        schemaVersion: 0,
      };
  const receiptObject = asObject(receipt, "check receipt");
  const sources = receiptObject.sources;
  const providerClosures = Array.isArray(receiptObject.providerClosures)
    ? receiptObject.providerClosures
    : [];
  const diagnostics = checked.report.diagnostics;
  if (!Array.isArray(sources) || !Array.isArray(diagnostics)) {
    throw new Error(
      "Benchmark receipt/report lacks source or diagnostic arrays"
    );
  }
  const closureObjects = providerClosures.map((value, index) =>
    asObject(value, `provider closure ${index}`)
  );
  const authorizedSourceLedger = sources
    .map((value, index) => {
      const source = asObject(value, `authorized source ${index}`);
      return {
        file: normalizeWorkspacePath(source.file, workspaceRoot),
        hash: source.hash,
        owner: source.owner,
        verdict: source.verdict,
      };
    })
    .toSorted((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right))
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
    authorizedSourceLedgerHash: sha256(canonicalJson(authorizedSourceLedger)),
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

type WorkflowExecution = Readonly<{
  authorization: CliInvocation;
  base: WorkflowBase;
  coldEnsure: CliInvocation;
  completeGateMilliseconds: number;
}>;

async function executeWorkflow(
  engine: Engine,
  cli: string,
  seedFixture: string,
  sampleRoot: string,
  definition: FixtureDefinition,
  index: number,
  surface: MeasurementSurface
): Promise<WorkflowExecution> {
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
    surface,
    "ensure"
  );
  if (ensured.result.changed !== true) {
    throw new Error("Missing-output cold ensure must report changed=true");
  }
  const checked = await invoke(
    cli,
    definition.name === "shared-workspace" ? sampleRoot : ownerRoot,
    join(sampleRoot, ".benchmark/check.json"),
    surface,
    definition.name === "shared-workspace" ? "check" : "prove",
    ...(definition.name === "shared-workspace" ? ["--workspace"] : [])
  );
  const completeGateMilliseconds = rounded(performance.now() - completeStarted);
  const filesAnalyzed = Number(checked.result.semanticFilesAnalyzed);
  const ownerCount = Number(checked.result.ownerProjects);
  const checkerCount = Number(checked.result.checkerProjects);
  const authorizationSucceeded = checked.result.valid === true;
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
  return {
    authorization: checked,
    base: {
      checkerCount,
      childArguments: {
        authorization: checked.childArguments,
        coldEnsure: ensured.childArguments,
      },
      engine,
      filesAnalyzed,
      index,
      ownerCount,
      parity: await parityEvidence(sampleRoot, ownerRoot, checked),
      scenario: definition.name,
    },
    coldEnsure: ensured,
    completeGateMilliseconds,
  };
}

async function runWorkflow(
  engine: Engine,
  cli: string,
  seedFixture: string,
  sampleRoot: string,
  definition: FixtureDefinition,
  index: number
): Promise<Workflow> {
  const execution = await executeWorkflow(
    engine,
    cli,
    seedFixture,
    sampleRoot,
    definition,
    index,
    "timing"
  );
  const workflow: Workflow = {
    ...execution.base,
    completeGateMilliseconds: execution.completeGateMilliseconds,
    phaseTimings: {
      coldEnsureMilliseconds: execution.coldEnsure.milliseconds,
      workspaceAuthorizationMilliseconds: execution.authorization.milliseconds,
    },
  };
  assertTimedWorkflowShape(workflow);
  return workflow;
}

async function runTypescriptAudit(
  engine: Engine,
  cli: string,
  seedFixture: string,
  sampleRoot: string,
  definition: FixtureDefinition,
  index: number
): Promise<TypescriptAudit> {
  const execution = await executeWorkflow(
    engine,
    cli,
    seedFixture,
    sampleRoot,
    definition,
    index,
    "typescript"
  );
  const profiles = [
    execution.coldEnsure.profile,
    execution.authorization.profile,
  ];
  return {
    ...execution.base,
    factoryCounts: Object.fromEntries(
      [
        ...new Set(profiles.flatMap(({ counters }) => Object.keys(counters))),
      ].map((name) => [
        name,
        profiles.reduce(
          (total, { counters }) => total + (counters[name] ?? 0),
          0
        ),
      ])
    ),
    programCount: profiles.reduce(
      (total, { counters }) =>
        total +
        Object.values(counters).reduce(
          (subtotal, count) => subtotal + count,
          0
        ),
      0
    ),
  };
}

async function runRssAudit(
  engine: Engine,
  cli: string,
  seedFixture: string,
  sampleRoot: string,
  definition: FixtureDefinition,
  index: number,
  pair: number
): Promise<RssAudit> {
  const execution = await executeWorkflow(
    engine,
    cli,
    seedFixture,
    sampleRoot,
    definition,
    index,
    "rss"
  );
  const coldEnsureBytes = execution.coldEnsure.profile.maxRssBytes;
  const authorizationBytes = execution.authorization.profile.maxRssBytes;
  return {
    ...execution.base,
    pair,
    peaks: {
      authorizationBytes,
      coldEnsureBytes,
      workflowBytes: rssWorkflowPeak(coldEnsureBytes, authorizationBytes),
    },
  };
}

function workflowWorkload(
  workflow: Workflow,
  fixtureHash: string
): WorkloadIdentity {
  return {
    checkerProjects: workflow.checkerCount,
    eligibleSourceLedgerHash: workflow.parity.authorizedSourceLedgerHash,
    eligibleSources: workflow.parity.authorizedSourceCount,
    fixtureHash,
    operation: "authorization",
    outcome: {
      changed: false,
      diagnosticsHash: workflow.parity.diagnosticsHash,
      success: true,
    },
    ownerProjects: workflow.ownerCount,
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: workflow.filesAnalyzed,
  };
}

function semanticParityProjection(parity: ParityEvidence): JsonObject {
  return Object.fromEntries(
    Object.entries(parity).filter(
      ([key]) =>
        key !== "compilerBoundGenerationReceiptHash" &&
        key !== "compilerBoundReceiptHash"
    )
  );
}

async function verifyPositiveSemanticParity(
  semanticReferenceCli: string,
  seeds: ReadonlyMap<ScenarioName, string>
): Promise<JsonObject> {
  const evidence: Record<string, unknown> = {};
  for (const definition of fixtureDefinitions) {
    const seed = seeds.get(definition.name);
    if (!seed) {
      throw new Error("Positive semantic parity fixture is missing");
    }
    const reference = await runWorkflow(
      "reference",
      semanticReferenceCli,
      seed,
      join(fixtureRoot, `semantic-positive-${definition.name}-reference`),
      definition,
      -10
    );
    const candidate = await runWorkflow(
      "candidate",
      candidateCli,
      seed,
      join(fixtureRoot, `semantic-positive-${definition.name}-candidate`),
      definition,
      -10
    );
    const inputHash = await fixtureInputHash(seed);
    const referenceWorkload = workflowWorkload(reference, inputHash);
    const candidateWorkload = workflowWorkload(candidate, inputHash);
    assertWorkloadEquivalent(referenceWorkload, candidateWorkload);
    const referenceParity = semanticParityProjection(reference.parity);
    const candidateParity = semanticParityProjection(candidate.parity);
    if (canonicalJson(referenceParity) !== canonicalJson(candidateParity)) {
      throw new Error(
        `${definition.name} candidate differs from the pinned semantic reference`
      );
    }
    evidence[definition.name] = {
      parityHash: sha256(canonicalJson(candidateParity)),
      pass: true,
      workload: candidateWorkload,
    };
  }
  return evidence;
}

async function fixtureInputHash(root: string): Promise<string> {
  const entries = (await treeEntries(root, root)).filter(
    ([path]) =>
      !path.includes("/generated/") &&
      !path.startsWith(".mirai-intl/") &&
      !path.startsWith(".benchmark/")
  );
  const hash = createHash("sha256");
  for (const [path] of entries) {
    hash.update(path);
    hash.update(await readFile(join(root, path)));
  }
  return `sha256:${hash.digest("hex")}`;
}

function rawCells(
  values: ReadonlyArray<Readonly<{ engine: Engine; milliseconds: number }>>
): RawBlock["cells"] {
  if (values.length !== 4) {
    throw new Error("A paired block must contain exactly four raw cells");
  }
  const [first, second, third, fourth] = values;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  ) {
    throw new Error("A paired block must contain exactly four raw cells");
  }
  return [first, second, third, fourth];
}

async function runUnchangedScenario(
  referenceCli: string,
  seedFixture: string,
  scenarioRoot: string,
  definition: FixtureDefinition,
  samples: number,
  warmups: number
): Promise<Array<UnchangedPair>> {
  const roots = {
    candidate: join(scenarioRoot, "candidate"),
    reference: join(scenarioRoot, "reference"),
  } as const;
  const workers = {
    candidate: new EnsureWorker(candidateCli, `${definition.name}:candidate`),
    reference: new EnsureWorker(referenceCli, `${definition.name}:reference`),
  } as const;
  try {
    for (const engine of ["reference", "candidate"] as const) {
      const root = roots[engine];
      await rm(root, { force: true, recursive: true });
      await cp(seedFixture, root, { recursive: true });
    }
    const ready = {
      candidate: await workers.candidate.ready(),
      reference: await workers.reference.ready(),
    } as const;
    const hashes = {
      candidate: await fixtureInputHash(
        fixtureOwnerRoot(roots.candidate, definition.name)
      ),
      reference: await fixtureInputHash(
        fixtureOwnerRoot(roots.reference, definition.name)
      ),
    } as const;
    for (const engine of ["reference", "candidate"] as const) {
      await workers[engine].request(
        "bootstrap",
        fixtureOwnerRoot(roots[engine], definition.name),
        hashes[engine]
      );
    }
    for (let warmup = 0; warmup < warmups; warmup += 1) {
      for (const engine of ["reference", "candidate"] as const) {
        await workers[engine].request(
          "warmup",
          fixtureOwnerRoot(roots[engine], definition.name),
          hashes[engine]
        );
      }
    }
    const blocks: Array<UnchangedPair> = [];
    for (let index = 0; index < samples; index += 1) {
      const order = engineOrder(index);
      const measurements: Record<
        Engine,
        Array<Awaited<ReturnType<EnsureWorker["request"]>>>
      > = {
        candidate: [],
        reference: [],
      };
      const cells: Array<{
        engine: Engine;
        milliseconds: number;
      }> = [];
      for (const engine of order) {
        const result = await workers[engine].request(
          "measure",
          fixtureOwnerRoot(roots[engine], definition.name),
          hashes[engine]
        );
        measurements[engine].push(result);
        cells.push({ engine, milliseconds: result.milliseconds });
      }
      const reference = measurements.reference;
      const candidate = measurements.candidate;
      if (
        reference.length !== 2 ||
        candidate.length !== 2 ||
        cells.length !== 4
      ) {
        throw new Error("Unchanged worker block evidence is incomplete");
      }
      const referenceRawMilliseconds = reference.map(
        ({ milliseconds }) => milliseconds
      );
      const candidateRawMilliseconds = candidate.map(
        ({ milliseconds }) => milliseconds
      );
      blocks.push({
        block: {
          cells: rawCells(cells),
          index,
          order: index % 2 === 0 ? "ABBA" : "BAAB",
        },
        candidateMilliseconds: median(candidateRawMilliseconds),
        candidatePeakRssBytes: Math.max(
          ...candidate.map(({ peakRssBytes }) => peakRssBytes)
        ),
        candidateRawMilliseconds,
        contexts: {
          candidate: ready.candidate.contextId,
          reference: ready.reference.contextId,
        },
        fixtureHashes: hashes,
        index,
        order,
        pids: {
          candidate: ready.candidate.pid,
          reference: ready.reference.pid,
        },
        referenceMilliseconds: median(referenceRawMilliseconds),
        referencePeakRssBytes: Math.max(
          ...reference.map(({ peakRssBytes }) => peakRssBytes)
        ),
        referenceRawMilliseconds,
        scenario: definition.name,
        warmupCount: warmups,
        workerImplementations: {
          candidate: {
            hash: ready.candidate.implementationHash,
            lifecycle: ready.candidate.lifecycle,
          },
          reference: {
            hash: ready.reference.implementationHash,
            lifecycle: ready.reference.lifecycle,
          },
        },
      });
    }
    return blocks;
  } finally {
    await Promise.all([workers.candidate.close(), workers.reference.close()]);
  }
}

async function verifyWorkerCliEquivalence(
  referenceCli: string,
  seedFixture: string,
  definition: FixtureDefinition
): Promise<JsonObject> {
  const evidence: Record<string, unknown> = {};
  for (const engine of ["reference", "candidate"] as const) {
    const cli = engine === "reference" ? referenceCli : candidateCli;
    const root = join(fixtureRoot, `worker-cli-equivalence-${engine}`);
    const cliRoot = join(root, "cli");
    const workerRoot = join(root, "worker");
    await rm(root, { force: true, recursive: true });
    await Promise.all([
      cp(seedFixture, cliRoot, { recursive: true }),
      cp(seedFixture, workerRoot, { recursive: true }),
    ]);
    const cliOwnerRoot = fixtureOwnerRoot(cliRoot, definition.name);
    const workerOwnerRoot = fixtureOwnerRoot(workerRoot, definition.name);
    const expectedFixtureHash = await fixtureInputHash(workerOwnerRoot);
    if ((await fixtureInputHash(cliOwnerRoot)) !== expectedFixtureHash) {
      throw new Error("CLI and worker fixture inputs differ");
    }
    const cliBootstrap = await invoke(
      cli,
      cliOwnerRoot,
      join(cliRoot, ".benchmark/bootstrap.json"),
      "timing",
      "ensure"
    );
    const cliUnchanged = await invoke(
      cli,
      cliOwnerRoot,
      join(cliRoot, ".benchmark/unchanged.json"),
      "timing",
      "ensure"
    );
    const worker = new EnsureWorker(
      cli,
      `${definition.name}:${engine}:equivalence`
    );
    try {
      const ready = await worker.ready();
      const workerBootstrap = await worker.request(
        "bootstrap",
        workerOwnerRoot,
        expectedFixtureHash
      );
      const workerUnchanged = await worker.request(
        "measure",
        workerOwnerRoot,
        expectedFixtureHash
      );
      if (
        cliBootstrap.result.changed !== workerBootstrap.changed ||
        cliUnchanged.result.changed !== workerUnchanged.changed
      ) {
        throw new Error(`${engine} CLI and worker ensure outcomes differ`);
      }
      evidence[engine] = {
        contextId: ready.contextId,
        fixtureHash: expectedFixtureHash,
        implementationHash: ready.implementationHash,
        lifecycle: ready.lifecycle,
        outcomes: {
          bootstrapChanged: workerBootstrap.changed,
          unchangedChanged: workerUnchanged.changed,
        },
        pass: true,
        pid: ready.pid,
      };
    } finally {
      await worker.close();
    }
  }
  return evidence;
}

async function runTypescriptAudits(
  referenceCli: string,
  seeds: ReadonlyMap<ScenarioName, string>,
  timedWorkflows: ReadonlyArray<Workflow>
): Promise<ReadonlyArray<TypescriptAudit>> {
  const audits: Array<TypescriptAudit> = [];
  for (const definition of fixtureDefinitions) {
    const seed = seeds.get(definition.name);
    if (!seed) {
      throw new Error("TypeScript audit fixture is missing");
    }
    for (const engine of ["reference", "candidate"] as const) {
      const audit = await runTypescriptAudit(
        engine,
        engine === "reference" ? referenceCli : candidateCli,
        seed,
        join(fixtureRoot, `typescript-audit-${definition.name}-${engine}`),
        definition,
        -1
      );
      const timed = timedWorkflows.find(
        (workflow) =>
          workflow.engine === engine && workflow.scenario === definition.name
      );
      if (
        !timed ||
        canonicalJson(audit.parity) !== canonicalJson(timed.parity) ||
        audit.filesAnalyzed !== timed.filesAnalyzed ||
        audit.ownerCount !== timed.ownerCount ||
        audit.checkerCount !== timed.checkerCount ||
        audit.programCount <= 0 ||
        (audit.factoryCounts.createProgram ?? 0) > audit.filesAnalyzed ||
        (audit.factoryCounts.createLanguageService ?? 0) > audit.ownerCount ||
        (audit.factoryCounts.createIncrementalProgram ?? 0) >
          audit.ownerCount ||
        (audit.factoryCounts.createSemanticDiagnosticsBuilderProgram ?? 0) >
          audit.ownerCount ||
        (audit.factoryCounts.createEmitAndSemanticDiagnosticsBuilderProgram ??
          0) > audit.ownerCount ||
        (audit.factoryCounts.createSolutionBuilder ?? 0) > audit.ownerCount ||
        (audit.factoryCounts.createWatchProgram ?? 0) > audit.ownerCount ||
        (audit.factoryCounts.createAbstractBuilder ?? 0) > audit.ownerCount
      ) {
        throw new Error(
          "Benchmark instrumentation changed CLI outputs or failed to observe semantic factories"
        );
      }
      audits.push(audit);
    }
  }
  return audits;
}

function instrumentationParityReport(
  audits: ReadonlyArray<TypescriptAudit>
): JsonObject {
  return {
    audits: audits.map((audit) => ({
      engine: audit.engine,
      factoryMix: audit.factoryCounts,
      observedFactoryCalls: audit.programCount,
      parityHash: sha256(canonicalJson(audit.parity)),
      scenario: audit.scenario,
    })),
    pass: audits.length === fixtureDefinitions.length * 2,
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

async function runRssAudits(
  referenceCli: string,
  seeds: ReadonlyMap<ScenarioName, string>
): Promise<ReadonlyArray<RssAudit>> {
  const audits: Array<RssAudit> = [];
  let index = 0;
  for (const entry of rssSamplingSchedule(
    fixtureDefinitions.map(({ name }) => name)
  )) {
    const definition = fixtureDefinitions.find(
      ({ name }) => name === entry.fixture
    );
    const seed = seeds.get(entry.fixture);
    if (!definition || !seed) {
      throw new Error("RSS audit fixture is missing");
    }
    for (const engine of entry.order) {
      audits.push(
        await runRssAudit(
          engine,
          engine === "reference" ? referenceCli : candidateCli,
          seed,
          join(
            fixtureRoot,
            `rss-audit-${entry.fixture}-${entry.pair}-${engine}`
          ),
          definition,
          index++,
          entry.pair
        )
      );
    }
  }
  return audits;
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
      "typescript",
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
      "typescript",
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
      "typescript",
      "ensure"
    );
    await invoke(
      cli,
      receiptCorruptionRoot,
      join(receiptCorruptionRoot, ".benchmark/prove.json"),
      "typescript",
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
      "typescript",
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
      "typescript",
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

function favorableBootstrapConfidence(paired: JsonObject): boolean {
  const interval = paired.bootstrap95ConfidenceIntervalPercent;
  return (
    Array.isArray(interval) &&
    typeof interval[1] === "number" &&
    interval[1] < 0
  );
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

function runRequiredCommand(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string
): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed in ${cwd}:\n${
        typeof result.stdout === "string" ? result.stdout : ""
      }${typeof result.stderr === "string" ? result.stderr : ""}${
        result.error ? result.error.message : ""
      }`
    );
  }
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

async function assertReferenceCli(
  path: string | undefined,
  identity: Readonly<{ commit: string; role: string; tree: string }>,
  expectedDistHash?: string
): Promise<string> {
  if (!path || !(await pathExists(path))) {
    throw new Error(
      `${identity.role} reference evidence is unavailable. Build ${identity.commit} in a detached tree and pass its absolute compiler CLI path`
    );
  }
  const canonical = await realpath(path);
  const referenceRoot = resolve(dirname(canonical), "../../..");
  const commit = git(referenceRoot, "rev-parse", "HEAD");
  if (commit !== git(repositoryRoot, "rev-parse", identity.commit)) {
    throw new Error(
      `${identity.role} reference CLI must come from pinned ${identity.commit}; received ${commit}`
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
  if (tree !== identity.tree) {
    throw new Error(
      `${identity.role} reference source tree hash differs: expected ${identity.tree}, received ${tree}`
    );
  }
  const distRoot = join(referenceRoot, "packages/compiler/dist");
  const distHash = sha256(canonicalJson(await treeEntries(distRoot, distRoot)));
  if (expectedDistHash !== undefined && distHash !== expectedDistHash) {
    throw new Error(
      `${identity.role} reference dist is stale: expected ${expectedDistHash}, received ${distHash}`
    );
  }
  return canonical;
}

async function prepareReferenceCli(
  identity: Readonly<{ commit: string; role: string; tree: string }>,
  expectedDistHash?: string
): Promise<string> {
  const referenceRoot = resolve(
    benchmarkRoot,
    `${identity.role}-reference-${identity.commit}`
  );
  const cli = join(referenceRoot, "packages/compiler/dist/cli.js");
  const abi = join(referenceRoot, "packages/abi/dist/index.js");
  if ((await pathExists(cli)) && (await pathExists(abi))) {
    try {
      return await assertReferenceCli(cli, identity, expectedDistHash);
    } catch {
      // A stale or partial benchmark-owned reference is safe to recreate.
    }
  }

  spawnSync("git", ["worktree", "remove", "--force", referenceRoot], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  await rm(referenceRoot, { force: true, recursive: true });
  await mkdir(dirname(referenceRoot), { recursive: true });
  runRequiredCommand(
    "git",
    ["worktree", "add", "--detach", referenceRoot, identity.commit],
    repositoryRoot
  );
  runRequiredCommand(
    "corepack",
    ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
    referenceRoot
  );
  runRequiredCommand("corepack", ["pnpm", "build"], referenceRoot);
  return assertReferenceCli(cli, identity, expectedDistHash);
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

async function referenceIdentity(
  cli: string,
  role: "performance" | "semantic"
): Promise<JsonObject> {
  const root = resolve(dirname(cli), "../../..");
  const distRoot = join(root, "packages/compiler/dist");
  return {
    commit: git(root, "rev-parse", "HEAD"),
    distHash: sha256(canonicalJson(await treeEntries(distRoot, distRoot))),
    lockfileHash: sha256(await readFile(join(root, "pnpm-lock.yaml"))),
    role,
    tree: git(root, "rev-parse", "HEAD^{tree}"),
  };
}

async function evaluatorIdentity(): Promise<JsonObject> {
  const sources = await Promise.all(
    EVALUATOR_SOURCE_PATHS.map(
      async (path) =>
        [path, sha256(await readFile(join(repositoryRoot, path)))] as const
    )
  );
  return {
    argumentVectors: {
      rss: [process.execPath, "--import", rssProbe, "<cli>", "<command...>"],
      timing: [process.execPath, "<cli>", "<command...>"],
      typescript: [
        process.execPath,
        "--import",
        profiler,
        "<cli>",
        "<command...>",
      ],
    },
    fixtureManifestHash: sha256(canonicalJson(fixtureDefinitions)),
    rssSchedule: rssSamplingSchedule(
      fixtureDefinitions.map(({ name }) => name)
    ),
    sourceHash: sha256(canonicalJson(sources)),
    sources,
    workerProtocolHash: sha256(
      canonicalJson(
        sources.filter(([path]) => path.includes("authorization-ensure-"))
      )
    ),
  };
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
  const acceptanceEligible = acceptanceEligibility(
    configured.samples,
    configured.warmups
  );
  assertDistinctReferenceRoles(SEMANTIC_REFERENCE, PERFORMANCE_REFERENCE);
  const semanticReferenceCli = configured.semanticReferenceCli
    ? await assertReferenceCli(
        configured.semanticReferenceCli,
        SEMANTIC_REFERENCE,
        semanticReferenceDistHash
      )
    : await prepareReferenceCli(SEMANTIC_REFERENCE, semanticReferenceDistHash);
  const referenceCli = configured.performanceReferenceCli
    ? await assertReferenceCli(
        configured.performanceReferenceCli,
        PERFORMANCE_REFERENCE,
        performanceReferenceDistHash
      )
    : await prepareReferenceCli(
        PERFORMANCE_REFERENCE,
        performanceReferenceDistHash
      );
  if (
    !(await pathExists(candidateCli)) ||
    !(await pathExists(profiler)) ||
    !(await pathExists(rssProbe))
  ) {
    throw new Error(
      "Built candidate CLI or benchmark audit preload is missing"
    );
  }
  const candidateTypescript = await compilerTypescriptIdentity(candidateCli);
  const performanceReferenceTypescript =
    await compilerTypescriptIdentity(referenceCli);
  const semanticReferenceTypescript =
    await compilerTypescriptIdentity(semanticReferenceCli);
  const performanceReferenceIdentity = await referenceIdentity(
    referenceCli,
    "performance"
  );
  const semanticReferenceIdentity = await referenceIdentity(
    semanticReferenceCli,
    "semantic"
  );
  const benchmarkEvaluatorIdentity = await evaluatorIdentity();
  const candidateProductionIdentity =
    await productionCandidateIdentity(repositoryRoot);
  assertFrozenProductionCandidate(candidateProductionIdentity);

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
  const semanticIntegrityMatrix = await verifySemanticIntegrityMatrix(
    semanticReferenceCli,
    smokeSeed
  );
  const positiveSemanticParity = await verifyPositiveSemanticParity(
    semanticReferenceCli,
    seeds
  );
  const workerCliEquivalence = await verifyWorkerCliEquivalence(
    referenceCli,
    smokeSeed,
    smokeDefinition
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
    const order: ReadonlyArray<Engine> = engineOrder(outer);
    for (const definition of fixtureDefinitions) {
      const seed = seeds.get(definition.name);
      if (!seed) {
        throw new Error("Fixture seed is missing");
      }
      for (const engine of order) {
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
  }
  const typescriptAudits = await runTypescriptAudits(
    referenceCli,
    seeds,
    workflows
  );
  const instrumentationParity = instrumentationParityReport(typescriptAudits);
  const rssAudits = await runRssAudits(referenceCli, seeds);
  for (const definition of fixtureDefinitions) {
    const seed = seeds.get(definition.name);
    if (!seed) {
      throw new Error("Fixture seed is missing");
    }
    unchangedPairs.push(
      ...(await runUnchangedScenario(
        referenceCli,
        seed,
        join(fixtureRoot, `unchanged-${definition.name}`),
        definition,
        configured.samples,
        configured.warmups
      ))
    );
  }
  const fixtureIdentityHashes = new Map<ScenarioName, string>();
  for (const definition of fixtureDefinitions) {
    const seed = seeds.get(definition.name);
    if (!seed) {
      throw new Error("Fixture seed is missing");
    }
    fixtureIdentityHashes.set(definition.name, await fixtureInputHash(seed));
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
      const scenarioTypescriptAudits = typescriptAudits.filter(
        ({ scenario }) => scenario === definition.name
      );
      const referenceTypescriptAudit = scenarioTypescriptAudits.find(
        ({ engine }) => engine === "reference"
      );
      const candidateTypescriptAudit = scenarioTypescriptAudits.find(
        ({ engine }) => engine === "candidate"
      );
      const scenarioRssAudits = rssAudits.filter(
        ({ scenario }) => scenario === definition.name
      );
      const fixtureHash = fixtureIdentityHashes.get(definition.name);
      const referenceFirst = reference[0];
      const candidateFirst = candidate[0];
      if (
        !fixtureHash ||
        !referenceFirst ||
        !candidateFirst ||
        !referenceTypescriptAudit ||
        !candidateTypescriptAudit
      ) {
        throw new Error("Workload adapter evidence is incomplete");
      }
      const baselineWorkload = workflowWorkload(referenceFirst, fixtureHash);
      const candidateWorkload = workflowWorkload(candidateFirst, fixtureHash);
      assertWorkloadEquivalent(baselineWorkload, candidateWorkload);
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
      const pairs = unchangedPairs.filter(
        ({ scenario }) => scenario === definition.name
      );
      const workflowCells = scenarioWorkflows.map((workflow) => ({
        engine: workflow.engine,
        milliseconds:
          definition.name === "shared-workspace"
            ? workflow.completeGateMilliseconds
            : workflow.phaseTimings.workspaceAuthorizationMilliseconds,
      }));
      const workflowBlocks: Array<RawBlock> = [];
      for (let index = 0; index < configured.samples; index += 1) {
        const cells = workflowCells.slice(index * 4, index * 4 + 4);
        if (cells.length !== 4) {
          throw new Error("Full-workflow block evidence is incomplete");
        }
        workflowBlocks.push({
          cells: rawCells(cells),
          index,
          order: index % 2 === 0 ? "ABBA" : "BAAB",
        });
      }
      const pairedRawCells = pairedBlockStatistics(
        workflowBlocks,
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
      const unchangedPairedCells = pairedBlockStatistics(
        pairs.map(({ block }) => block),
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
      const completeGate = performanceGate({
        absoluteMedianLimit: medianLimit,
        absoluteP95Limit: p95Limit,
        baseline: rawStatistics(referenceGateRaw),
        candidate: rawStatistics(candidateGateRaw),
        confidenceUpperPercent: Number(
          (
            pairedRawCells.bootstrap95ConfidenceIntervalPercent as ReadonlyArray<number>
          )[1]
        ),
        relativeMedianLimit: relativeLimit,
      });
      const unchangedGate = performanceGate({
        absoluteMedianLimit: 400,
        absoluteP95Limit: 600,
        baseline: rawStatistics(
          pairs.flatMap(
            ({ referenceRawMilliseconds }) => referenceRawMilliseconds
          )
        ),
        candidate: rawStatistics(
          pairs.flatMap(
            ({ candidateRawMilliseconds }) => candidateRawMilliseconds
          )
        ),
        confidenceUpperPercent: Number(
          (
            unchangedPairedCells.bootstrap95ConfidenceIntervalPercent as ReadonlyArray<number>
          )[1]
        ),
        relativeMedianLimit: 0.3,
      });
      const { pass: completeLegacyCompositePass, ...completeGateEvidence } =
        completeGate;
      const { pass: unchangedLegacyCompositePass, ...unchangedGateEvidence } =
        unchangedGate;
      const completeGateContractPass = completeContractPass(completeGate);
      const rawStabilityPass =
        Number(candidateGatingLatency.coefficientOfVariation) <= 0.1 &&
        Number(referenceGatingLatency.coefficientOfVariation) <= 0.1 &&
        Number(candidateUnchanged.coefficientOfVariation) <= 0.1 &&
        Number(referenceUnchanged.coefficientOfVariation) <= 0.1;
      return [
        definition.name,
        {
          completeGate: {
            candidateRaw: candidateComplete,
            pairedRawCells,
            referenceRaw: referenceComplete,
          },
          counters: {
            candidate: {
              checkerCount: [candidateTypescriptAudit.checkerCount],
              filesAnalyzed: [candidateTypescriptAudit.filesAnalyzed],
              factoryMix: candidateTypescriptAudit.factoryCounts,
              ownerCount: [candidateTypescriptAudit.ownerCount],
              programCount: candidateTypescriptAudit.programCount,
            },
            expected: definition,
            reference: {
              checkerCount: [referenceTypescriptAudit.checkerCount],
              filesAnalyzed: [referenceTypescriptAudit.filesAnalyzed],
              factoryMix: referenceTypescriptAudit.factoryCounts,
              ownerCount: [referenceTypescriptAudit.ownerCount],
              programCount: referenceTypescriptAudit.programCount,
            },
          },
          gates: {
            completeGate: {
              ...completeGateEvidence,
              contractPass: completeGateContractPass,
              legacyCompositePass: completeLegacyCompositePass,
              measuredPhase:
                definition.name === "shared-workspace"
                  ? "completeGate"
                  : "processColdAuthorization",
              medianLimitMilliseconds: medianLimit,
              p95LimitMilliseconds: p95Limit,
              pairedBootstrapConfidencePass: completeConfidencePass,
              relativeLimit,
            },
            rawStability: { cvLimit: 0.1, pass: rawStabilityPass },
            unchangedEnsure: {
              ...unchangedGateEvidence,
              legacyCompositePass: unchangedLegacyCompositePass,
              medianLimitMilliseconds: 400,
              p95LimitMilliseconds: 600,
              pairedBootstrapConfidencePass: unchangedConfidencePass,
              relativeLimit: 0.3,
            },
          },
          parity: {
            baseline: baselineWorkload,
            candidate: candidateWorkload,
            mode: "V1/V2 workload equivalence; receipt, artifact, and serialization bytes excluded",
            pass: true,
          },
          gatingLatency: {
            candidateRaw: candidateGatingLatency,
            referenceRaw: referenceGatingLatency,
          },
          peakRssBytes: {
            candidate: statistics(
              scenarioRssAudits
                .filter(({ engine }) => engine === "candidate")
                .map(({ peaks }) => peaks.workflowBytes),
              "Bytes"
            ),
            reference: statistics(
              scenarioRssAudits
                .filter(({ engine }) => engine === "reference")
                .map(({ peaks }) => peaks.workflowBytes),
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
  const scenarioCompleteContractPass = scenarioValues.every((scenario) => {
    const gates = asObject(scenario.gates, "scenario gates");
    return asObject(gates.completeGate, "complete gate").contractPass === true;
  });
  const legacyScenarioCompositePass = scenarioValues.every((scenario) => {
    const gates = asObject(scenario.gates, "scenario gates");
    return (
      asObject(gates.completeGate, "complete gate").legacyCompositePass ===
        true &&
      asObject(gates.unchangedEnsure, "unchanged ensure gate")
        .legacyCompositePass === true
    );
  });
  const vectorHasPreload = (
    vector: ReadonlyArray<string>,
    preload: string
  ): boolean => vector.includes("--import") && vector.includes(preload);
  const auditProvenancePass =
    workflows.every((workflow) => {
      assertTimedWorkflowShape(workflow);
      return [
        workflow.childArguments.coldEnsure,
        workflow.childArguments.authorization,
      ].every((vector) => !vector.includes("--import"));
    }) &&
    typescriptAudits.length === fixtureDefinitions.length * 2 &&
    typescriptAudits.every((audit) =>
      [
        audit.childArguments.coldEnsure,
        audit.childArguments.authorization,
      ].every(
        (vector) =>
          vectorHasPreload(vector, profiler) && !vector.includes(rssProbe)
      )
    ) &&
    rssAudits.length === fixtureDefinitions.length * 5 * 2 &&
    rssAudits.every((audit) =>
      [
        audit.childArguments.coldEnsure,
        audit.childArguments.authorization,
      ].every(
        (vector) =>
          vectorHasPreload(vector, rssProbe) && !vector.includes(profiler)
      )
    ) &&
    (["reference", "candidate"] as const).every(
      (engine) =>
        rssAudits.filter((audit) => audit.engine === engine).length === 15
    ) &&
    fixtureDefinitions.every(({ name }) =>
      (["reference", "candidate"] as const).every(
        (engine) =>
          rssAudits.filter(
            (audit) => audit.engine === engine && audit.scenario === name
          ).length === 5
      )
    );
  const candidatePeak = Math.max(
    ...rssAudits
      .filter(({ engine }) => engine === "candidate")
      .map(({ peaks }) => peaks.workflowBytes)
  );
  const referencePeak = Math.max(
    ...rssAudits
      .filter(({ engine }) => engine === "reference")
      .map(({ peaks }) => peaks.workflowBytes)
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
      asObject(gates.unchangedEnsure, "unchanged ensure gate")
        .legacyCompositePass === true
    );
  });
  const unchangedPass = unchangedRelativeConfidencePass;
  const semanticIntegrityMatrixPass =
    asObject(semanticIntegrityMatrix, "semantic integrity matrix").pass ===
    true;
  const positiveSemanticParityPass = Object.values(
    positiveSemanticParity
  ).every(
    (value) =>
      asObject(value, "positive semantic parity scenario").pass === true
  );
  const instrumentationParityPass =
    asObject(instrumentationParity, "instrumentation parity").pass === true;
  const workerCliEquivalencePass = Object.values(workerCliEquivalence).every(
    (value) => asObject(value, "worker CLI equivalence").pass === true
  );
  const workloadParityPass = scenarioValues.every(
    (scenario) => asObject(scenario.parity, "scenario parity").pass === true
  );
  const pass = releaseAcceptance({
    auditProvenancePass,
    eligible: acceptanceEligible,
    instrumentationParityPass,
    latencyPass,
    positiveSemanticParityPass,
    rssPass,
    scenarioCompleteContractPass,
    semanticIntegrityMatrixPass,
    unchangedEnsureLegacyCompositePass: unchangedPass,
    workerCliEquivalencePass,
    workloadParityPass,
  });
  let acceptanceReason =
    "smoke only: reduced samples/batching are ineligible for acceptance";
  if (acceptanceEligible) {
    acceptanceReason = pass
      ? "all release evaluator gates passed"
      : "one or more release evaluator gates failed";
  }
  const acceptance = {
    auditProvenanceGate: { pass: auditProvenancePass },
    confidenceIntervalExcludesZeroForImprovement: confidencePass,
    eligible: acceptanceEligible,
    latencyGate: {
      median: { actualMilliseconds: rounded(latencyMedian), limit: 10_000 },
      p95: { actualMilliseconds: rounded(latencyP95), limit: 20_000 },
      pass: latencyPass,
    },
    minimums: {
      samples: minimumAcceptanceSamples,
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
    scenarioCompleteContractPass,
    semanticContractGate: {
      instrumentationParityPass,
      pass:
        semanticIntegrityMatrixPass &&
        positiveSemanticParityPass &&
        instrumentationParityPass &&
        workerCliEquivalencePass &&
        workloadParityPass,
      positiveSemanticParityPass,
      semanticIntegrityMatrixPass,
      workerCliEquivalencePass,
      workloadParityPass,
    },
    trendDiagnostics: {
      legacyScenarioCompositePass,
      stabilityCv: { limit: 0.1, pass: stabilityPass },
    },
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
      candidateProduction: candidateProductionIdentity,
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
      performanceReference: performanceReferenceIdentity,
      semanticReference: semanticReferenceIdentity,
      runnerImage: process.env.ImageOS ?? process.env.RUNNER_OS ?? "local",
      runnerName: process.env.RUNNER_NAME ?? "local",
      totalMemoryBytes: totalmem(),
      typescript: {
        candidate: candidateTypescript,
        performanceReference: performanceReferenceTypescript,
        semanticReference: semanticReferenceTypescript,
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
    evaluatorIdentity: benchmarkEvaluatorIdentity,
    methodology: {
      cacheState:
        "full workflows are process-cold; unchanged ensure uses one stable same-process worker per engine and fixture",
      comparison:
        "paired interleaved ABBA reference/candidate ordering; even outer samples use ABBA and odd samples use BAAB",
      confidenceAuthority:
        "exactly one two-cell-median delta per ABBA/BAAB block; bootstrapN equals measured outer blocks",
      completeGate:
        "parent wall clock around missing-output ensure followed by a fresh complete authorization check",
      fullWorkflowAggregation:
        "all four untrimmed timing cells are retained; timing observations alone determine median, p95, and CV",
      instrumentation:
        "one untimed TypeScript-profiler workflow per engine and fixture proves factory counts and output transparency; timed workflows have no preload",
      mode: acceptanceEligible ? "acceptance" : "smoke",
      processCold:
        "new CLI process per phase and fresh Mirai temporary/cache/output directories",
      rawLatencyGatesUntouched: true,
      referenceBaseline:
        "timings and RSS use full f9f2df6 commit/tree; exact semantic parity uses 89e362b only",
      rss: "five alternating A/B RSS-only pairs per fixture; each workflow retains cold-ensure and authorization child peaks and uses their maximum; RSS probe has no module loader hook",
      rssSchedule: rssSamplingSchedule(
        fixtureDefinitions.map(({ name }) => name)
      ),
      samples: configured.samples,
      scenario: configured.scenario,
      seed: configured.seed,
      unchangedEnsure:
        "one stable worker per engine/fixture; one changed bootstrap, five discarded warmups, measured normal ensure requests; no retry or replacement",
      warmups: configured.warmups,
    },
    instrumentationParity,
    rawSamples: {
      rssAudits,
      typescriptAudits,
      unchangedOwnerPairs: unchangedPairs,
      workflows,
    },
    positiveSemanticParity,
    semanticIntegrityMatrix,
    scenarios: scenarioReports,
    schemaVersion,
    workerCliEquivalence,
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
