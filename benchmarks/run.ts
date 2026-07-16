import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
  writeArtifactSet,
} from "../packages/compiler/src/internal";

import {
  treeShakingCatalogSource,
  unusedNamespaceSentinel,
  usedMessageSentinel,
} from "./fixtures/catalog";

const root = resolve(import.meta.dirname, "..");
const outputRoot = resolve(root, ".tmp", "benchmarks");
const workRoot = resolve(outputRoot, "work");
const reportPath = resolve(outputRoot, "catalog-benchmarks.json");
const commandOutputLimit = 64 * 1024;
const declarationByteCeiling = 34_610;
const bundleDeltaGzipCeilings = {
  next: 50_000,
  vite: 20_000,
} as const;

type Framework = keyof typeof bundleDeltaGzipCeilings;

type CommandEvidence = Readonly<{
  durationMilliseconds: number;
  status: number;
}>;

type BundleEvidence = Readonly<{
  baselineGzipBytes: number;
  compactGzipBytes: number;
  deltaGzipBytes: number;
  deltaThresholdBytes: number;
  referencedMessageFound: boolean;
  unrelatedMessageFound: boolean;
}>;

type Provenance = Readonly<{
  exports: ReadonlyArray<
    Readonly<{
      descriptorExport: string;
      module: string;
      path: string;
      runtimeExport: string;
    }>
  >;
}>;

function run(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeout: number
): CommandEvidence {
  const start = performance.now();
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_ENV: "production",
    },
    killSignal: "SIGKILL",
    maxBuffer: commandOutputLimit,
    shell: false,
    timeout,
  });
  const durationMilliseconds = Math.round(performance.now() - start);
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      [
        `Benchmark command failed: ${JSON.stringify([command, ...args])}`,
        `cwd=${cwd}`,
        `durationMilliseconds=${durationMilliseconds}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `error=${result.error?.message ?? "(none)"}`,
        `stdout:\n${(result.stdout ?? "").slice(0, commandOutputLimit)}`,
        `stderr:\n${(result.stderr ?? "").slice(0, commandOutputLimit)}`,
      ].join("\n")
    );
  }
  return { durationMilliseconds, status: result.status };
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function filesBelow(directory: string): Promise<ReadonlyArray<string>> {
  const files: Array<string> = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "cache") {
          await visit(path);
        }
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  await visit(directory);
  return files.toSorted();
}

async function bundleContents(directory: string): Promise<
  Readonly<{
    gzipBytes: number;
    referencedMessageFound: boolean;
    unrelatedMessageFound: boolean;
  }>
> {
  const bundleFiles = (await filesBelow(directory)).filter(
    (path) =>
      /\.(?:css|html|js|mjs)$/u.test(path) &&
      !path.endsWith(".map") &&
      !path.includes(`${join("node_modules", "")}`)
  );
  const contents = await Promise.all(bundleFiles.map((path) => readFile(path)));
  return {
    gzipBytes: contents.reduce(
      (total, content) => total + gzipSync(content, { level: 9 }).byteLength,
      0
    ),
    referencedMessageFound: contents.some((content) =>
      content.includes(Buffer.from(usedMessageSentinel))
    ),
    unrelatedMessageFound: contents.some((content) =>
      content.includes(Buffer.from(unusedNamespaceSentinel))
    ),
  };
}

function transformedRuntimeSource(): string {
  return [
    'import { useTranslations } from "./useTranslations.mjs";',
    "",
    'const { t } = useTranslations("used");',
    'export const renderedTranslation = t("greeting");',
    'if (renderedTranslation !== "used.greeting") {',
    '  throw new Error("Unexpected benchmark translation");',
    "}",
    "",
  ].join("\n");
}

const fakeUseTranslationsSource = [
  "export function useTranslations(_namespace) {",
  "  return {",
  "    t(message) {",
  '      if (!message || (typeof message !== "object" && typeof message !== "function") || typeof message.path !== "string") {',
  '        throw new TypeError("Benchmark translation was not compiler-lowered");',
  "      }",
  "      return message.path;",
  "    },",
  "  };",
  "}",
  "",
].join("\n");

async function writeConventionMessages(directory: string): Promise<void> {
  await Promise.all([
    writeText(
      resolve(directory, "locales/used/en.json"),
      `${JSON.stringify({ greeting: usedMessageSentinel }, null, 2)}\n`
    ),
    writeText(
      resolve(directory, "locales/unused/en.json"),
      `${JSON.stringify({ [unusedNamespaceSentinel]: "unused" }, null, 2)}\n`
    ),
  ]);
}

async function createViteProject(
  directory: string,
  source: string,
  intl: boolean
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeText(
      resolve(directory, "package.json"),
      `${JSON.stringify(
        {
          dependencies: { vite: "7.3.6" },
          name: `@openmirai/intl-benchmark-vite-${intl ? "compact" : "baseline"}`,
          private: true,
          type: "module",
          version: "1.0.0",
        },
        null,
        2
      )}\n`
    ),
    writeText(
      resolve(directory, "index.html"),
      '<div id="app"></div><script type="module" src="/src/main.mjs"></script>\n'
    ),
    writeText(resolve(directory, "src/main.mjs"), source),
    writeText(
      resolve(directory, "vite.config.mjs"),
      intl
        ? 'import { miraiIntlVite } from "@openmirai/intl-compiler/vite";\nimport { defineConfig } from "vite";\nexport default defineConfig({ build: { minify: true }, plugins: [miraiIntlVite()] });\n'
        : 'import { defineConfig } from "vite";\nexport default defineConfig({ build: { minify: true } });\n'
    ),
  ]);
  if (intl) {
    await Promise.all([
      writeText(
        resolve(directory, "src/useTranslations.mjs"),
        fakeUseTranslationsSource
      ),
      writeConventionMessages(directory),
    ]);
  }
}

async function createNextProject(
  directory: string,
  source: string,
  intl: boolean
): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeText(
      resolve(directory, "package.json"),
      `${JSON.stringify(
        {
          dependencies: { next: "16.2.9" },
          name: `@openmirai/intl-benchmark-next-${intl ? "compact" : "baseline"}`,
          private: true,
          type: "module",
          version: "1.0.0",
        },
        null,
        2
      )}\n`
    ),
    writeText(
      resolve(directory, "next.config.mjs"),
      intl
        ? 'import { withMiraiIntl } from "@openmirai/intl-compiler/next";\nexport default withMiraiIntl({ reactStrictMode: true, turbopack: {} });\n'
        : "export default { reactStrictMode: true, turbopack: {} };\n"
    ),
    writeText(
      resolve(directory, "app/layout.jsx"),
      'export default function Layout({ children }) { return <html lang="en"><body>{children}</body></html>; }\n'
    ),
    writeText(
      resolve(directory, "app/page.jsx"),
      'import { renderedTranslation } from "./translation.mjs";\nexport default function Page() { return <main>{renderedTranslation}</main>; }\n'
    ),
    writeText(resolve(directory, "app/translation.mjs"), source),
  ]);
  if (intl) {
    await Promise.all([
      writeText(
        resolve(directory, "app/useTranslations.mjs"),
        fakeUseTranslationsSource
      ),
      writeConventionMessages(directory),
    ]);
  }
}

async function measureFramework(
  framework: Framework
): Promise<
  Readonly<{ bundles: BundleEvidence; commands: Array<CommandEvidence> }>
> {
  const frameworkRoot = resolve(workRoot, framework);
  const baselineRoot = resolve(frameworkRoot, "baseline");
  const compactRoot = resolve(frameworkRoot, "compact");
  const baselineSource =
    'export const renderedTranslation = "used";\nif (renderedTranslation !== "used") throw new Error("Unexpected baseline");\n';
  const compactSource = transformedRuntimeSource();
  const createProject =
    framework === "vite" ? createViteProject : createNextProject;
  await Promise.all([
    createProject(baselineRoot, baselineSource, false),
    createProject(compactRoot, compactSource, true),
  ]);

  const executable = resolve(root, "node_modules", ".bin", framework);
  const args =
    framework === "vite"
      ? ["build", "--config", "vite.config.mjs", "--mode", "production"]
      : ["build", "--turbopack"];
  const timeout = framework === "vite" ? 60_000 : 180_000;
  const baselineCommand = run(executable, args, baselineRoot, timeout);
  const compactCommand = run(executable, args, compactRoot, timeout);
  const outputDirectory = framework === "vite" ? "dist" : ".next";
  const baseline = await bundleContents(resolve(baselineRoot, outputDirectory));
  const compact = await bundleContents(resolve(compactRoot, outputDirectory));
  return {
    bundles: {
      baselineGzipBytes: baseline.gzipBytes,
      compactGzipBytes: compact.gzipBytes,
      deltaGzipBytes: compact.gzipBytes - baseline.gzipBytes,
      deltaThresholdBytes: bundleDeltaGzipCeilings[framework],
      referencedMessageFound: compact.referencedMessageFound,
      unrelatedMessageFound: compact.unrelatedMessageFound,
    },
    commands: [baselineCommand, compactCommand],
  };
}

async function typecheckContract(
  declaration: string
): Promise<
  ReadonlyArray<Readonly<{ durationMilliseconds: number; version: string }>>
> {
  const directory = resolve(workRoot, "typecheck");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeText(resolve(directory, "catalog.d.ts"), declaration),
    writeText(
      resolve(directory, "consumer.ts"),
      [
        'import type { CatalogContract } from "./catalog";',
        'import type { UseTranslations } from "@openmirai/intl-runtime/react";',
        "declare const useTranslations: UseTranslations<CatalogContract>;",
        'const { t } = useTranslations("used");',
        't("greeting") satisfies string;',
        "// @ts-expect-error unrelated keys are excluded from the namespace",
        't("missing");',
        "",
      ].join("\n")
    ),
    writeText(
      resolve(directory, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            paths: {
              "@openmirai/intl-abi": [
                resolve(root, "packages/abi/src/index.ts"),
              ],
              "@openmirai/intl-runtime/react": [
                resolve(root, "packages/runtime/src/react.ts"),
              ],
            },
            skipLibCheck: false,
            strict: true,
            target: "ES2024",
            types: [],
          },
          include: ["catalog.d.ts", "consumer.ts"],
        },
        null,
        2
      )}\n`
    ),
  ]);

  const versions = ["typescript-5-9", "typescript-6", "typescript-7"];
  return versions.map((version) => {
    const evidence = run(
      process.execPath,
      [
        resolve(root, "node_modules", version, "bin/tsc"),
        "--project",
        resolve(directory, "tsconfig.json"),
        "--pretty",
        "false",
      ],
      directory,
      30_000
    );
    return { durationMilliseconds: evidence.durationMilliseconds, version };
  });
}

await rm(workRoot, { force: true, recursive: true });
await mkdir(outputRoot, { recursive: true });

const output = compileCatalog(treeShakingCatalogSource);
const artifacts = emitArtifacts(output, "precompiled", { compact: true });
const catalogRoot = resolve(workRoot, "catalog");
const written = await writeArtifactSet(catalogRoot, artifacts);
const builds = await readdir(resolve(catalogRoot, "builds"));
const declaration = artifacts["catalog.schema.gen.d.ts"];
const provenance = JSON.parse(
  artifacts["catalog.provenance.gen.json"]
) as Provenance;
const usedExport = provenance.exports.find(
  (entry) => entry.path === "used.greeting"
);
const unrelatedExport = provenance.exports.find((entry) =>
  entry.path.startsWith("unused.")
);
if (!usedExport || !unrelatedExport) {
  throw new Error("Compact benchmark provenance is incomplete");
}
const messageModules = Object.keys(artifacts).filter(
  (name) => name === "catalog.messages.gen.mjs"
);
const typechecks = await typecheckContract(declaration);
const vite = await measureFramework("vite");
const next = await measureFramework("next");

const gates = {
  compactOnly:
    !("catalog.descriptors.gen.mjs" in artifacts) &&
    messageModules.length === 1 &&
    Object.keys(artifacts).every(
      (name) => !name.startsWith("catalog.message.") || !name.endsWith(".d.mts")
    ),
  declaration: Buffer.byteLength(declaration, "utf8") <= declarationByteCeiling,
  nextBundle:
    next.bundles.deltaGzipBytes <= next.bundles.deltaThresholdBytes &&
    next.bundles.referencedMessageFound &&
    !next.bundles.unrelatedMessageFound,
  oneBuild: builds.length === 1,
  typecheck: typechecks.length === 3,
  viteBundle:
    vite.bundles.deltaGzipBytes <= vite.bundles.deltaThresholdBytes &&
    vite.bundles.referencedMessageFound &&
    !vite.bundles.unrelatedMessageFound,
};
const measurementComplete = Object.values(gates).every(Boolean);
const report = {
  artifact: {
    contentHash: written.contentHash,
    declarationBytes: Buffer.byteLength(declaration, "utf8"),
    declarationByteCeiling,
    messageModuleCount: messageModules.length,
    selectedBuildCount: builds.length,
    unrelatedModule: unrelatedExport.module,
    usedModule: usedExport.module,
  },
  bundles: { next: next.bundles, vite: vite.bundles },
  commands: { next: next.commands, vite: vite.commands },
  gates,
  measurementComplete,
  representation: "compact-precompiled",
  schemaVersion: 1,
  typechecks,
};
const temporaryReport = `${reportPath}.tmp`;
await writeFile(
  temporaryReport,
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8"
);
await rename(temporaryReport, reportPath);
process.stdout.write(
  `${JSON.stringify(
    {
      measurementComplete,
      nextDeltaGzipBytes: next.bundles.deltaGzipBytes,
      output: relative(root, reportPath),
      selectedBuildCount: builds.length,
      viteDeltaGzipBytes: vite.bundles.deltaGzipBytes,
    },
    null,
    2
  )}\n`
);
if (!measurementComplete) {
  process.exitCode = 1;
}
