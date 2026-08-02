import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
  writeArtifactSet,
} from "../packages/compiler/src/internal";

import { catalogFixtureSource } from "../test/fixtures/catalog";

const root = resolve(import.meta.dirname, "..");
const evidenceRoot = join(root, ".tmp", "pack-smoke");
const temporaryRoot = await mkdtemp(join(tmpdir(), "mirai-intl-pack-smoke-"));
const packsRoot = join(temporaryRoot, "packs");
const catalogPackageRoot = join(temporaryRoot, "catalog-package");
const catalogDistRoot = join(catalogPackageRoot, "dist");
const installRoot = join(temporaryRoot, "isolated-install");
const receiptAppRoot = join(temporaryRoot, "receipt-app");
const catalogPackageName = "@openmirai/intl-catalog-smoke";
const commandOutputLimit = 64 * 1024;

type PackageManifest = Readonly<{ name: string; version: string }>;

async function readPackageManifest(path: string): Promise<PackageManifest> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (
    !value ||
    typeof value !== "object" ||
    typeof Reflect.get(value, "name") !== "string" ||
    typeof Reflect.get(value, "version") !== "string"
  ) {
    throw new TypeError(`Invalid package manifest ${path}`);
  }
  return {
    name: Reflect.get(value, "name") as string,
    version: Reflect.get(value, "version") as string,
  };
}

function run(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeoutMilliseconds: number
): string {
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new RangeError("timeoutMilliseconds must be a positive safe integer");
  }
  const { NODE_PATH: _nodePath, ...isolatedEnvironment } = process.env;
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...isolatedEnvironment, CI: "1" },
    killSignal: "SIGKILL",
    maxBuffer: commandOutputLimit,
    shell: false,
    timeout: timeoutMilliseconds,
    windowsHide: true,
  });
  const code = result.error ? Reflect.get(result.error, "code") : null;
  const timedOut = code === "ETIMEDOUT";
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      [
        `Bounded command failed: ${JSON.stringify([command, ...args])}`,
        `timeoutMilliseconds=${timeoutMilliseconds}`,
        `maxOutputBytes=${commandOutputLimit}`,
        `timedOut=${String(timedOut)}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `errorCode=${typeof code === "string" ? code : "(none)"}`,
        `error=${result.error?.message ?? "(none)"}`,
        `stdout:\n${(result.stdout ?? "").slice(0, commandOutputLimit) || "(empty)"}`,
        `stderr:\n${(result.stderr ?? "").slice(0, commandOutputLimit) || "(empty)"}`,
      ].join("\n")
    );
  }
  return result.stdout ?? "";
}

function runPnpm(
  args: ReadonlyArray<string>,
  cwd: string,
  timeoutMilliseconds: number
): string {
  return run("corepack", ["pnpm", ...args], cwd, timeoutMilliseconds);
}

function runFailure(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  expected: RegExp
): void {
  const { NODE_PATH: _nodePath, ...isolatedEnvironment } = process.env;
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...isolatedEnvironment, CI: "1" },
    killSignal: "SIGKILL",
    maxBuffer: commandOutputLimit,
    shell: false,
    timeout: 60_000,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (
    result.error ||
    result.status === 0 ||
    result.signal ||
    !expected.test(output)
  ) {
    throw new Error(
      [
        `Expected bounded command failure matching ${expected}`,
        `command=${JSON.stringify([command, ...args])}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `error=${result.error?.message ?? "(none)"}`,
        `output=${output.slice(0, commandOutputLimit) || "(empty)"}`,
      ].join("\n")
    );
  }
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

function isPathWithin(path: string, parent: string): boolean {
  const pathFromParent = relative(parent, path);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

async function digest(path: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
}

await rm(evidenceRoot, { force: true, recursive: true });
await mkdir(evidenceRoot, { recursive: true });
await mkdir(packsRoot, { recursive: true });
runPnpm(["build"], root, 120_000);

const [compilerPackage, intlPackage, intlI18nextPackage] = await Promise.all([
  readPackageManifest(join(root, "packages/compiler/package.json")),
  readPackageManifest(join(root, "packages/intl/package.json")),
  readPackageManifest(join(root, "packages/intl-i18next/package.json")),
]);

const catalogOutput = compileCatalog({
  ...catalogFixtureSource,
  buildId: "pack-smoke-build",
  catalogPackage: catalogPackageName,
  id: "pack-smoke",
  rendererCapabilityId: "precompiled-v1",
});
const catalogArtifacts = emitArtifacts(catalogOutput, "precompiled", {
  compact: true,
});
if (
  catalogOutput.catalog.manifest.compilerVersion !== "mirai-intl-artifact-v2"
) {
  throw new Error(
    `Built catalog ABI ${catalogOutput.catalog.manifest.compilerVersion} does not match mirai-intl-artifact-v2`
  );
}
const smokeSuffix = `smoke.${catalogOutput.catalog.manifest.hash.slice(7, 19)}`;
const catalogVersion = compilerPackage.version.includes("-")
  ? `${compilerPackage.version}.${smokeSuffix}`
  : `${compilerPackage.version}-${smokeSuffix}`;
await mkdir(catalogDistRoot, { recursive: true });
await Promise.all([
  writeFile(
    join(catalogPackageRoot, "package.json"),
    `${JSON.stringify(
      {
        dependencies: {
          [intlPackage.name]: intlPackage.version,
        },
        engines: { node: ">=24" },
        exports: {
          ".": {
            import: "./dist/index.mjs",
            types: "./dist/index.d.mts",
          },
        },
        files: ["dist"],
        name: catalogPackageName,
        publishConfig: { access: "restricted" },
        sideEffects: false,
        type: "module",
        version: catalogVersion,
      },
      null,
      2
    )}\n`,
    "utf8"
  ),
  ...Object.entries(catalogArtifacts).map(([name, contents]) =>
    writeFile(join(catalogDistRoot, name), contents, "utf8")
  ),
  writeFile(
    join(catalogDistRoot, "index.d.mts"),
    [
      'export type { CatalogContract } from "./catalog.schema.gen.js";',
      'export { catalogManifest } from "./catalog.manifest.gen.mjs";',
      'export { isCatalogLocale, loadCatalogResource } from "./catalog.resources.gen.mjs";',
      "",
    ].join("\n"),
    "utf8"
  ),
  writeFile(
    join(catalogDistRoot, "index.mjs"),
    [
      'export { catalogManifest } from "./catalog.manifest.gen.mjs";',
      'export { isCatalogLocale, loadCatalogResource } from "./catalog.resources.gen.mjs";',
      "",
    ].join("\n"),
    "utf8"
  ),
]);

for (const packageName of [
  "@openmirai/intl-abi",
  "@openmirai/intl-compiler",
  "@openmirai/intl-runtime",
  "@openmirai/intl",
  "@openmirai/intl-i18next",
]) {
  runPnpm(
    ["--filter", packageName, "pack", "--pack-destination", packsRoot],
    root,
    60_000
  );
}
runPnpm(["pack", "--pack-destination", packsRoot], catalogPackageRoot, 60_000);

const tarballs = (await readdir(packsRoot))
  .filter((name) => name.endsWith(".tgz"))
  .toSorted();
if (tarballs.length !== 6) {
  throw new Error(`Expected six package tarballs, found ${tarballs.length}`);
}
const packedPackages = Object.fromEntries(
  tarballs.map((name) => {
    let packageName = "@openmirai/intl-abi";
    if (name.includes("catalog-smoke")) {
      packageName = catalogPackageName;
    } else if (name.includes("intl-i18next")) {
      packageName = intlI18nextPackage.name;
    } else if (name.includes("compiler")) {
      packageName = "@openmirai/intl-compiler";
    } else if (name.includes("runtime")) {
      packageName = "@openmirai/intl-runtime";
    } else if (/^openmirai-intl-\d/u.test(name)) {
      packageName = intlPackage.name;
    }
    return [packageName, `file:${join(packsRoot, name)}`];
  })
);

await mkdir(installRoot, { recursive: true });
const directDependencies = {
  [catalogPackageName]: packedPackages[catalogPackageName],
  [intlI18nextPackage.name]: packedPackages[intlI18nextPackage.name],
  [intlPackage.name]: packedPackages[intlPackage.name],
  react: "19.2.7",
} as const;
if (Object.values(directDependencies).some((value) => value === undefined)) {
  throw new Error("Packed consumer dependencies are incomplete");
}
await writeFile(
  join(installRoot, "package.json"),
  `${JSON.stringify(
    {
      dependencies: directDependencies,
      devDependencies: {
        "@tsconfig/node24": "24.0.4",
        "@types/react": "19.2.17",
        typescript: "7.0.2",
      },
      name: "mirai-intl-isolated-pack-smoke",
      packageManager: "pnpm@11.11.0",
      private: true,
      type: "module",
      version: "0.0.0",
    },
    null,
    2
  )}\n`,
  "utf8"
);
await writeFile(
  join(installRoot, "pnpm-workspace.yaml"),
  [
    "packages: []",
    "overrides:",
    ...Object.entries(packedPackages).map(
      ([name, path]) => `  '${name}': '${path}'`
    ),
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(installRoot, ".npmrc"),
  [
    "auto-install-peers=false",
    "resolve-peers-from-workspace-root=false",
    "strict-peer-dependencies=true",
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(installRoot, "consumer.ts"),
  [
    'import { COMPILER_VERSION } from "@openmirai/intl";',
    'import { createPrecompiledBackend } from "@openmirai/intl/node";',
    'import { createOtelDiagnosticSink } from "@openmirai/intl/otel";',
    'import { createUseIntl } from "@openmirai/intl/react";',
    'import { createServerIntl } from "@openmirai/intl/server";',
    'import { resolveTranslationMockPath } from "@openmirai/intl/testing";',
    'import type { TextDescriptor } from "@openmirai/intl/types";',
    'import { RUNTIME_ABI } from "@openmirai/intl/runtime";',
    'import type { UseTranslations } from "@openmirai/intl/runtime";',
    'import { miraiIntlVite } from "@openmirai/intl/vite";',
    'import { createMiraiI18next, createProviderBoundUseTranslations } from "@openmirai/intl-i18next";',
    `import { catalogManifest, isCatalogLocale, loadCatalogResource } from "${catalogPackageName}";`,
    `import type { CatalogContract } from "${catalogPackageName}";`,
    'RUNTIME_ABI satisfies "1.0.0";',
    "COMPILER_VERSION satisfies string;",
    "void createMiraiI18next;",
    "const otelSink = createOtelDiagnosticSink();",
    'otelSink({ code: "INTL_MISSING_RESOURCE", message: "Missing resource" });',
    "const useProviderTranslations = createProviderBoundUseTranslations<CatalogContract>();",
    "void useProviderTranslations;",
    "void miraiIntlVite;",
    "declare const descriptor: TextDescriptor;",
    "void descriptor;",
    "createPrecompiledBackend satisfies () => unknown;",
    "void createUseIntl;",
    "void createServerIntl;",
    'resolveTranslationMockPath("pack.smoke") satisfies string;',
    "catalogManifest.hash satisfies string;",
    'isCatalogLocale("en") satisfies boolean;',
    'loadCatalogResource("en") satisfies Promise<{ readonly translation: object; }>;',
    "declare const useTranslations: UseTranslations<CatalogContract>;",
    'const { t } = useTranslations("greeting");',
    't("morning", { name: "Mali" }) satisfies string;',
    "// @ts-expect-error inferred interpolation arguments are required",
    't("morning");',
    "// @ts-expect-error extra interpolation arguments are rejected",
    't("morning", { name: "Mali", extra: "value" });',
    "// @ts-expect-error unknown string keys are rejected",
    't("not-a-message");',
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(installRoot, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        types: [],
      },
      extends: "@tsconfig/node24/tsconfig.json",
      include: ["consumer.ts"],
    },
    null,
    2
  )}\n`,
  "utf8"
);
await writeFile(
  join(installRoot, "translations.mjs"),
  [
    'import { createIntlRuntime, createTranslationFunction } from "@openmirai/intl/runtime";',
    'import { createPrecompiledBackend } from "@openmirai/intl/node";',
    `import { catalogManifest } from "${catalogPackageName}";`,
    "const runtime = createIntlRuntime({",
    "  backend: createPrecompiledBackend(),",
    "  catalog: { manifest: catalogManifest, messages: [] },",
    "  formatters: {",
    '    money: { format: () => "unused", version: "1.0.0" },',
    "  },",
    '  locale: "en",',
    "});",
    "const t = createTranslationFunction(runtime);",
    "export async function getServerTranslations(_options) { return { t }; }",
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(installRoot, "smoke.source.mjs"),
  [
    'import { COMPILER_VERSION } from "@openmirai/intl";',
    'import { RUNTIME_ABI } from "@openmirai/intl/runtime";',
    'import { createOtelDiagnosticSink } from "@openmirai/intl/otel";',
    `import { catalogManifest, loadCatalogResource } from "${catalogPackageName}";`,
    'import { getServerTranslations } from "./translations.mjs";',
    'if (RUNTIME_ABI !== "1.0.0") throw new Error("Unexpected ABI");',
    `if (COMPILER_VERSION !== ${JSON.stringify(compilerPackage.version)}) throw new Error("Unexpected compiler");`,
    "const otelSink = createOtelDiagnosticSink();",
    'otelSink({ code: "INTL_MISSING_RESOURCE", message: "Missing resource" });',
    'const { t } = await getServerTranslations({ locale: "en", namespace: "greeting" });',
    'const renderedTranslation = t("morning", { name: "Mali" });',
    'if (renderedTranslation !== "Good morning, Mali") throw new Error("Unexpected translation");',
    'if (catalogManifest.rendererCapabilityId !== "precompiled-v1") throw new Error("Unexpected capability");',
    'const catalogResource = await loadCatalogResource("en");',
    'if (!catalogResource.translation) throw new Error("Missing lazy catalog resource");',
    "process.stdout.write(JSON.stringify({",
    "  catalogHash: catalogManifest.hash,",
    "  renderedTranslation,",
    "  rendererCapabilityId: catalogManifest.rendererCapabilityId,",
    "}));",
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(installRoot, "lower.mjs"),
  [
    'import { readFile, writeFile } from "node:fs/promises";',
    'import { resolve } from "node:path";',
    'import { inflateRawSync } from "node:zlib";',
    'import { transformMiraiIntlSource } from "@openmirai/intl/transform";',
    'const sourcePath = resolve("smoke.source.mjs");',
    'const result = await transformMiraiIntlSource(await readFile(sourcePath, "utf8"), sourcePath, { root: process.cwd() });',
    'if (!result) throw new Error("Pack smoke named-key source was not lowered");',
    'if (!/\\bm\\d+\\s+as\\s+__miraiIntlMessage\\d+\\b/u.test(result.code)) throw new Error("Pack smoke has no private message import");',
    'if (!result.code.includes("catalog.manifest.gen.mjs?__mirai_intl_exports=")) throw new Error("Pack smoke did not use the private carrier query");',
    'if (result.code.includes("catalog.message.")) throw new Error("Pack smoke retained a per-message module import");',
    'if (result.code.includes("catalog.descriptors.gen.mjs")) throw new Error("Pack smoke retained the monolithic descriptor module");',
    'if (result.code.includes(\'t("morning"\') || result.code.includes("t(\'morning\'")) throw new Error("Pack smoke retained a source named-key call");',
    'const selectedDirectory = resolve("src/i18n/generated", JSON.parse(await readFile("src/i18n/generated/current.json", "utf8")).directory);',
    'const payload = await readFile(resolve(selectedDirectory, "catalog.messages.gen.mjs"), "utf8");',
    'const marker = "// @generated by @openmirai/intl-compiler. Do not edit.\\n";',
    "const markerIndex = payload.indexOf(marker);",
    'if (markerIndex < 0) throw new Error("Pack smoke compact payload has no header");',
    'await writeFile(resolve(selectedDirectory, "catalog.messages.runtime.mjs"), inflateRawSync(Buffer.from(payload.slice(markerIndex + marker.length).trim(), "base64")).toString("utf8"), "utf8");',
    'const executable = result.code.replace(/catalog\\.manifest\\.gen\\.mjs\\?__mirai_intl_exports=[^"\']+/gu, "catalog.messages.runtime.mjs");',
    'if (executable === result.code) throw new Error("Pack smoke could not resolve the private carrier query");',
    "// Node does not run the framework loader in this packed smoke. Decode the same deterministic payload before executing the exact named exports; adapter tests cover virtual private slicing.",
    'await writeFile("smoke.mjs", executable, "utf8");',
    "",
  ].join("\n"),
  "utf8"
);
await writeArtifactSet(
  join(installRoot, "src", "i18n", "generated"),
  catalogArtifacts,
  undefined,
  { authority: "non-authoritative-test-only" }
);
runPnpm(
  ["install", "--ignore-scripts", "--frozen-lockfile=false"],
  installRoot,
  120_000
);
const canonicalRepositoryRoot = await realpath(root);
const canonicalInstallRoot = await realpath(installRoot);
const canonicalTemporaryRoot = await realpath(temporaryRoot);
if (
  isPathWithin(canonicalInstallRoot, canonicalRepositoryRoot) ||
  isPathWithin(canonicalTemporaryRoot, canonicalRepositoryRoot)
) {
  throw new Error("Packed consumer must be isolated outside the repository");
}
const packedIntlManifest = await realpath(
  join(installRoot, "node_modules/@openmirai/intl/package.json")
);
const packedIntlRequire = createRequire(packedIntlManifest);
const packedRuntimeOtelEntry = await realpath(
  packedIntlRequire.resolve("@openmirai/intl-runtime/otel")
);
if (Object.hasOwn(directDependencies, "@opentelemetry/api-logs")) {
  throw new Error(
    "Packed consumer must not declare transitive @opentelemetry/api-logs"
  );
}
const packedOtelEntry = await realpath(
  createRequire(packedRuntimeOtelEntry).resolve("@opentelemetry/api-logs")
);
for (const resolvedPath of [
  packedIntlManifest,
  packedRuntimeOtelEntry,
  packedOtelEntry,
]) {
  if (
    !isPathWithin(resolvedPath, canonicalInstallRoot) ||
    isPathWithin(resolvedPath, canonicalRepositoryRoot)
  ) {
    throw new Error(
      `Packed dependency leaked outside the isolated install: ${resolvedPath}`
    );
  }
}
await Promise.all([
  mkdir(join(receiptAppRoot, "node_modules/receipt-provider"), {
    recursive: true,
  }),
  mkdir(join(receiptAppRoot, "src/locales/receipt"), { recursive: true }),
]);
await Promise.all([
  writeFile(
    join(receiptAppRoot, "package.json"),
    `${JSON.stringify(
      {
        dependencies: { vite: "7.3.6" },
        name: "@openmirai/intl-receipt-smoke",
        private: true,
        version: "0.0.0",
      },
      null,
      2
    )}\n`,
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "mirai-intl.config.json"),
    `${JSON.stringify(
      {
        checkProjects: [{ path: "tsconfig.json", role: "owner" }],
      },
      null,
      2
    )}\n`,
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n",
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: { lib: ["ES2024"] },
        include: ["src/**/*.ts"],
      },
      null,
      2
    )}\n`,
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "src/locales/receipt/en.json"),
    '{"greeting":"Hello"}\n',
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "src/page.ts"),
    [
      'import { GREETING_KEY } from "receipt-provider";',
      'import { useTranslations } from "x";',
      'const { t } = useTranslations("receipt");',
      "export const page = t(GREETING_KEY);",
      "export type PagePromise = Promise<string>;",
      "",
    ].join("\n"),
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "node_modules/receipt-provider/index.d.ts"),
    'export declare const GREETING_KEY: "greeting";\n',
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "node_modules/receipt-provider/package.json"),
    '{"name":"receipt-provider","types":"index.d.ts","version":"1.0.0"}\n',
    "utf8"
  ),
]);
const installedIntlCli = join(
  installRoot,
  "node_modules/@openmirai/intl/dist/cli.js"
);
run(process.execPath, [installedIntlCli, "generate"], receiptAppRoot, 60_000);
run(
  process.execPath,
  [installedIntlCli, "prove", "--format=stylish", "--no-color"],
  receiptAppRoot,
  60_000
);
async function selectedAuthorityReceiptPath(app: string): Promise<string> {
  const authorityRoot = join(app, ".mirai-intl/authority");
  const selector = JSON.parse(
    await readFile(join(app, ".mirai-intl/check-receipt.current.json"), "utf8")
  ) as Readonly<{ authoritySetHash?: string; schemaVersion?: number }>;
  if (selector.schemaVersion !== 2 || !selector.authoritySetHash) {
    throw new Error(
      "Packed CLI did not activate a schema-2 authority selector"
    );
  }
  const setDigest = selector.authoritySetHash.replace(/^sha256:/u, "");
  const authoritySet = JSON.parse(
    await readFile(join(authorityRoot, "sets/v1", `${setDigest}.json`), "utf8")
  ) as Readonly<{
    receipt?: Readonly<{ hash?: string; schemaVersion?: number }>;
  }>;
  if (authoritySet.receipt?.schemaVersion !== 3 || !authoritySet.receipt.hash) {
    throw new Error("Packed CLI did not select V3 authorization authority");
  }
  const receiptDigest = authoritySet.receipt.hash.replace(/^sha256:/u, "");
  return join(authorityRoot, "receipts/v3", `${receiptDigest}.json`);
}
const receiptPath = await selectedAuthorityReceiptPath(receiptAppRoot);
const persistedAuthorizationReceipt = JSON.parse(
  await readFile(receiptPath, "utf8")
) as {
  schemaVersion: number;
  sources: ReadonlyArray<unknown>;
};
if (
  persistedAuthorizationReceipt.schemaVersion !== 3 ||
  persistedAuthorizationReceipt.sources.length !== 1
) {
  throw new Error("Packed CLI did not produce one complete V3 authorization");
}
const authorizationEvidence = {
  semanticAuthorizationRuns: 1,
  semanticFilesAnalyzed: persistedAuthorizationReceipt.sources.length,
} as const;
await writeFile(
  join(installRoot, "verify-receipt.mjs"),
  [
    'import { verifyConventionBuildReceipt } from "@openmirai/intl";',
    "const verification = await verifyConventionBuildReceipt(process.argv[2]);",
    "process.stdout.write(JSON.stringify(verification));",
    "",
  ].join("\n"),
  "utf8"
);
const buildVerification = JSON.parse(
  run(
    process.execPath,
    ["verify-receipt.mjs", receiptAppRoot],
    installRoot,
    60_000
  )
) as {
  buildReceiptVerifications: number;
  buildSemanticAnalysisRuns: number;
  receipt: { schemaVersion: number };
};
if (
  buildVerification.receipt.schemaVersion !== 3 ||
  buildVerification.buildReceiptVerifications < 1 ||
  buildVerification.buildSemanticAnalysisRuns !== 0
) {
  throw new Error("Packed build verifier did not consume V3 without semantics");
}
type PackedReceipt = Readonly<{
  providerClosures: ReadonlyArray<
    Readonly<{ declarations: ReadonlyArray<number> }>
  >;
  sources: ReadonlyArray<Readonly<{ file: string; hash: string }>>;
  tables: Readonly<{
    files: ReadonlyArray<Readonly<{ path: string }>>;
  }>;
  typescript: Readonly<{
    libs: ReadonlyArray<number>;
  }>;
}>;
type PackedGenerationReceipt = Readonly<{
  payload: Readonly<{
    directory: string;
    manifest: Readonly<{
      entries: ReadonlyArray<Readonly<{ path: string }>>;
    }>;
  }>;
}>;
const receiptSource = await readFile(receiptPath, "utf8");
const packedReceipt = JSON.parse(receiptSource) as PackedReceipt;
const generationReceiptPath = join(
  receiptAppRoot,
  "src/i18n/generated/catalog-generation-receipt.v1.json"
);
const generationReceiptSource = await readFile(generationReceiptPath, "utf8");
const packedGenerationReceipt = JSON.parse(
  generationReceiptSource
) as PackedGenerationReceipt;
const mutationRoot = join(temporaryRoot, "receipt-mutations");
const receiptNegativeMatrix = [
  "v1",
  "malformed-v3",
  "noncanonical-v3",
  "tampered-v3",
  "stale-source",
  "stale-config",
  "stale-provider",
  "stale-generation-receipt",
  "stale-payload",
  "stale-control",
  "stale-typescript-lib",
] as const;
await mkdir(mutationRoot, { recursive: true });
const expectReceiptRejection = async (
  name: string,
  mutate: (root: string) => Promise<void>,
  expected: RegExp
): Promise<void> => {
  const app = join(mutationRoot, name);
  await cp(receiptAppRoot, app, { recursive: true });
  await mutate(app);
  runFailure(
    process.execPath,
    ["verify-receipt.mjs", app],
    installRoot,
    expected
  );
};
await expectReceiptRejection(
  "v1",
  async (app) => {
    await rm(join(app, ".mirai-intl/check-receipt.current.json"));
    await writeFile(
      join(app, ".mirai-intl/check-receipt.v1.json"),
      '{"schemaVersion":1}\n',
      "utf8"
    );
  },
  /V1 is unsupported/u
);
await expectReceiptRejection(
  "malformed-v3",
  async (app) =>
    writeFile(await selectedAuthorityReceiptPath(app), "{\n", "utf8"),
  /selected immutable check receipt V3 hash is stale or corrupt/u
);
await expectReceiptRejection(
  "noncanonical-v3",
  async (app) =>
    writeFile(
      await selectedAuthorityReceiptPath(app),
      `${JSON.stringify(packedReceipt, null, 2)}\n`,
      "utf8"
    ),
  /selected immutable check receipt V3 hash is stale or corrupt/u
);
await expectReceiptRejection(
  "tampered-v3",
  async (app) => {
    const tampered = structuredClone(packedReceipt) as unknown as {
      sources: Array<{ file: string; hash: string }>;
    };
    const source = tampered.sources[0];
    if (!source) {
      throw new Error("Packed V3 receipt has no bound source");
    }
    source.hash = `sha256:${"0".repeat(64)}`;
    await writeFile(
      await selectedAuthorityReceiptPath(app),
      `${canonicalJson(tampered)}\n`,
      "utf8"
    );
  },
  /selected immutable check receipt V3 hash is stale or corrupt/u
);
await expectReceiptRejection(
  "stale-source",
  (app) =>
    writeFile(
      join(app, packedReceipt.sources[0]?.file ?? "missing-source"),
      "export const stale = true;\n",
      "utf8"
    ),
  /(?:source|V3 bound file) is stale or corrupt/u
);
await expectReceiptRejection(
  "stale-config",
  (app) =>
    writeFile(
      join(app, "tsconfig.json"),
      '{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}\n',
      "utf8"
    ),
  /TypeScript config is stale or corrupt|(?:V3 bound file|classifier control) is stale or corrupt/u
);
const providerDeclarationReference = packedReceipt.providerClosures.flatMap(
  ({ declarations }) => declarations
)[0];
const providerDeclaration =
  providerDeclarationReference === undefined
    ? undefined
    : packedReceipt.tables.files[providerDeclarationReference];
if (!providerDeclaration) {
  throw new Error("Packed V3 receipt has no bound provider declaration");
}
await expectReceiptRejection(
  "stale-provider",
  (app) =>
    writeFile(
      join(app, providerDeclaration.path),
      "export interface ReceiptProvider { readonly changed: true; }\n",
      "utf8"
    ),
  /provider declaration is stale or corrupt|(?:V3 bound file|classifier control) is stale or corrupt/u
);
await expectReceiptRejection(
  "stale-generation-receipt",
  (app) =>
    writeFile(
      join(app, "src/i18n/generated/catalog-generation-receipt.v1.json"),
      `${generationReceiptSource} `,
      "utf8"
    ),
  /generation receipt is stale or (?:corrupt|tampered)|(?:V3 bound file|classifier control) is stale or corrupt/iu
);
const payloadEntry = packedGenerationReceipt.payload.manifest.entries[0];
if (!payloadEntry) {
  throw new Error("Packed generation receipt has no payload entry");
}
await expectReceiptRejection(
  "stale-payload",
  (app) =>
    writeFile(
      join(
        app,
        "src/i18n/generated",
        packedGenerationReceipt.payload.directory,
        payloadEntry.path
      ),
      "tampered payload\n",
      "utf8"
    ),
  /Generated artifact directory.*corrupt|generated payload is corrupt|(?:V3 bound file|classifier control) is stale or corrupt/iu
);
await expectReceiptRejection(
  "stale-control",
  (app) =>
    writeFile(
      join(app, "src/i18n/generated/index.ts"),
      "// tampered selector\n",
      "utf8"
    ),
  /stable facade.*catalog lock is stale or tampered|generated facade or catalog lock is corrupt|(?:V3 bound file|classifier control) is stale or corrupt/iu
);
const typescriptLibReference = packedReceipt.typescript.libs[0];
const typescriptLib =
  typescriptLibReference === undefined
    ? undefined
    : packedReceipt.tables.files[typescriptLibReference];
if (!typescriptLib) {
  throw new Error("Packed V3 receipt has no bound TypeScript lib");
}
const packedCompilerEntry = await realpath(
  packedIntlRequire.resolve("@openmirai/intl-compiler")
);
const packedCompilerRequire = createRequire(packedCompilerEntry);
const installedTypeScriptLib = await realpath(
  join(
    dirname(packedCompilerRequire.resolve("typescript/package.json")),
    "lib",
    typescriptLib.path.split("/").at(-1) ?? ""
  )
);
const installedTypeScriptLibBackup = `${installedTypeScriptLib}.pack-smoke`;
await rename(installedTypeScriptLib, installedTypeScriptLibBackup);
try {
  await writeFile(
    installedTypeScriptLib,
    `${await readFile(installedTypeScriptLibBackup, "utf8")}\n// tampered\n`,
    "utf8"
  );
  runFailure(
    process.execPath,
    ["verify-receipt.mjs", receiptAppRoot],
    installRoot,
    /compiler dependency identity is stale|current pointer is stale or tampered|TypeScript lib identity is stale/u
  );
} finally {
  await rm(installedTypeScriptLib, { force: true });
  await rename(installedTypeScriptLibBackup, installedTypeScriptLib);
}
runPnpm(
  ["exec", "tsc", "--project", "tsconfig.json", "--pretty", "false"],
  installRoot,
  60_000
);
run(process.execPath, ["lower.mjs"], installRoot, 30_000);
const runtimeEvidence = {
  catalogHash: catalogOutput.catalog.manifest.hash,
  renderedTranslation: "Good morning, Mali",
  rendererCapabilityId: "precompiled-v1",
} as const;
const runtimeOutput = run(
  process.execPath,
  ["smoke.mjs"],
  installRoot,
  30_000
).trim();
if (runtimeOutput !== JSON.stringify(runtimeEvidence)) {
  throw new Error(
    `Installed catalog runtime evidence did not match: ${runtimeOutput}`
  );
}

const checksums = Object.fromEntries(
  await Promise.all(
    tarballs.map(
      async (name) => [name, await digest(join(packsRoot, name))] as const
    )
  )
);
await writeFile(
  join(evidenceRoot, "results.json"),
  `${JSON.stringify(
    {
      apiSurface: "getServerTranslations(namespace).t(named-key)",
      catalogIdentity: {
        buildId: catalogOutput.catalog.manifest.buildId,
        capabilitySetHash: catalogOutput.catalog.manifest.capabilitySetHash,
        catalogHash: catalogOutput.catalog.manifest.hash,
        catalogId: catalogOutput.catalog.manifest.catalogId,
        packageName: catalogPackageName,
        rendererCapabilityId:
          catalogOutput.catalog.manifest.rendererCapabilityId,
        runtimeAbi: catalogOutput.catalog.manifest.runtimeAbi,
        version: catalogVersion,
      },
      checksums,
      compilerPublicApi: true,
      receiptV3: {
        authorization: authorizationEvidence,
        build: {
          buildReceiptVerifications:
            buildVerification.buildReceiptVerifications,
          buildSemanticAnalysisRuns:
            buildVerification.buildSemanticAnalysisRuns,
        },
        negativeMatrix: receiptNegativeMatrix,
      },
      installed: true,
      isolatedInstall: true,
      otelDependencyResolvedTransitively: true,
      privateDescriptorLowering: true,
      nodeNextTypecheck: true,
      renderedTranslation: runtimeEvidence.renderedTranslation,
      skipLibCheck: false,
      tarballs,
    },
    null,
    2
  )}\n`,
  "utf8"
);
await rm(temporaryRoot, { force: true, recursive: true });
process.stdout.write(
  `${JSON.stringify({
    apiSurface: "getServerTranslations(namespace).t(named-key)",
    catalogIdentity: {
      catalogHash: catalogOutput.catalog.manifest.hash,
      catalogId: catalogOutput.catalog.manifest.catalogId,
      packageName: catalogPackageName,
      rendererCapabilityId: catalogOutput.catalog.manifest.rendererCapabilityId,
      version: catalogVersion,
    },
    checksums,
    compilerPublicApi: true,
    installed: true,
    nodeNextTypecheck: true,
    privateDescriptorLowering: true,
    receiptV3: {
      authorization: authorizationEvidence,
      build: {
        buildReceiptVerifications: buildVerification.buildReceiptVerifications,
        buildSemanticAnalysisRuns: buildVerification.buildSemanticAnalysisRuns,
      },
      negativeMatrix: receiptNegativeMatrix,
    },
    isolatedInstall: true,
    otelDependencyResolvedTransitively: true,
    renderedTranslation: runtimeEvidence.renderedTranslation,
  })}\n`
);
