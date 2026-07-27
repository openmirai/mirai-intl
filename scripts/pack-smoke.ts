import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
  writeArtifactSet,
} from "../packages/compiler/src/internal";

import { catalogFixtureSource } from "../test/fixtures/catalog";

const root = resolve(import.meta.dirname, "..");
const temporaryRoot = join(root, ".tmp", "pack-smoke");
const packsRoot = join(temporaryRoot, "packs");
const catalogPackageRoot = join(temporaryRoot, "catalog-package");
const catalogDistRoot = join(catalogPackageRoot, "dist");
const installRoot = join(temporaryRoot, "isolated-install");
const receiptAppRoot = await mkdtemp(
  join(tmpdir(), "mirai-intl-pack-receipt-")
);
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
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
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

async function digest(path: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
}

await rm(temporaryRoot, { force: true, recursive: true });
await mkdir(packsRoot, { recursive: true });
runPnpm(["build"], root, 120_000);

const [
  abiPackage,
  compilerPackage,
  runtimePackage,
  intlPackage,
  intlI18nextPackage,
] = await Promise.all([
  readPackageManifest(join(root, "packages/abi/package.json")),
  readPackageManifest(join(root, "packages/compiler/package.json")),
  readPackageManifest(join(root, "packages/runtime/package.json")),
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
          [abiPackage.name]: abiPackage.version,
          [runtimePackage.name]: runtimePackage.version,
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
const byPackage = Object.fromEntries(
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
await writeFile(
  join(installRoot, "package.json"),
  `${JSON.stringify(
    {
      dependencies: byPackage,
      devDependencies: {
        "@tsconfig/node24": "24.0.4",
        "@types/react": "19.2.17",
        react: "19.2.7",
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
    ...Object.entries(byPackage).map(
      ([name, path]) => `  '${name}': '${path}'`
    ),
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(installRoot, "consumer.ts"),
  [
    'import { RUNTIME_ABI } from "@openmirai/intl-abi";',
    'import { COMPILER_VERSION as UMBRELLA_COMPILER_VERSION } from "@openmirai/intl";',
    'import type { TextDescriptor } from "@openmirai/intl/types";',
    'import { miraiIntlVite } from "@openmirai/intl/vite";',
    'import { createMiraiI18next } from "@openmirai/intl-i18next";',
    'import * as compilerPackage from "@openmirai/intl-compiler";',
    'import { COMPILER_VERSION } from "@openmirai/intl-compiler";',
    'import type { UseTranslations } from "@openmirai/intl-runtime";',
    'import { createPrecompiledBackend } from "@openmirai/intl-runtime/node";',
    'import { createUseIntl } from "@openmirai/intl-runtime/react";',
    'import { createServerIntl } from "@openmirai/intl-runtime/server";',
    'import { resolveTranslationMockPath } from "@openmirai/intl-runtime/testing";',
    `import { catalogManifest, isCatalogLocale, loadCatalogResource } from "${catalogPackageName}";`,
    `import type { CatalogContract } from "${catalogPackageName}";`,
    'RUNTIME_ABI satisfies "1.0.0";',
    "UMBRELLA_COMPILER_VERSION satisfies string;",
    "COMPILER_VERSION satisfies string;",
    "void createMiraiI18next;",
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
    'import { createIntlRuntime, createTranslationFunction } from "@openmirai/intl-runtime";',
    'import { createPrecompiledBackend } from "@openmirai/intl-runtime/node";',
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
    'import { RUNTIME_ABI } from "@openmirai/intl-abi";',
    'import * as compilerPackage from "@openmirai/intl-compiler";',
    'import { COMPILER_VERSION } from "@openmirai/intl-compiler";',
    `import { catalogManifest, loadCatalogResource } from "${catalogPackageName}";`,
    'import { getServerTranslations } from "./translations.mjs";',
    'if (RUNTIME_ABI !== "1.0.0") throw new Error("Unexpected ABI");',
    `if (COMPILER_VERSION !== ${JSON.stringify(compilerPackage.version)}) throw new Error("Unexpected compiler");`,
    'if (JSON.stringify(Object.keys(compilerPackage).sort()) !== JSON.stringify(["COMPILER_VERSION", "analyzeConventionSources", "finalizeBuildProof", "finalizeBuildProofTargets", "generateConventionCatalog", "loadConventionCatalog", "proveConventionCatalog", "verifyConventionBuildReceipt", "verifyConventionCatalog", "verifyConventionCheckReceipt", "verifyFinalizedBuildProof", "writeProvisionalBuildProof"])) throw new Error("Unexpected compiler public API");',
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
    'import { transformMiraiIntlSource } from "@openmirai/intl-compiler/transform";',
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
await mkdir(join(receiptAppRoot, "src/locales/global"), { recursive: true });
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
    `${JSON.stringify({ include: ["src/**/*.ts"] }, null, 2)}\n`,
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "src/locales/global/en.json"),
    '{"greeting":"Hello"}\n',
    "utf8"
  ),
  writeFile(
    join(receiptAppRoot, "src/page.ts"),
    "export const page = 1;\n",
    "utf8"
  ),
]);
const installedCompilerCli = join(
  installRoot,
  "node_modules/@openmirai/intl-compiler/dist/cli.js"
);
run(
  process.execPath,
  [installedCompilerCli, "generate"],
  receiptAppRoot,
  60_000
);
const authorizationOutput = JSON.parse(
  run(
    process.execPath,
    [installedCompilerCli, "prove", "--format=json"],
    receiptAppRoot,
    60_000
  )
) as {
  authorization: {
    semanticAuthorizationRuns: number;
    semanticFilesAnalyzed: number;
  };
  receipt: { schemaVersion: number };
};
if (
  authorizationOutput.receipt.schemaVersion !== 2 ||
  authorizationOutput.authorization.semanticAuthorizationRuns !== 1 ||
  authorizationOutput.authorization.semanticFilesAnalyzed !== 1
) {
  throw new Error("Packed CLI did not produce one complete V2 authorization");
}
await writeFile(
  join(installRoot, "verify-receipt.mjs"),
  [
    'import { verifyConventionBuildReceipt } from "@openmirai/intl-compiler";',
    `const verification = await verifyConventionBuildReceipt(${JSON.stringify(
      receiptAppRoot
    )});`,
    "process.stdout.write(JSON.stringify(verification));",
    "",
  ].join("\n"),
  "utf8"
);
const buildVerification = JSON.parse(
  run(process.execPath, ["verify-receipt.mjs"], installRoot, 60_000)
) as {
  buildReceiptVerifications: number;
  buildSemanticAnalysisRuns: number;
  receipt: { schemaVersion: number };
};
if (
  buildVerification.receipt.schemaVersion !== 2 ||
  buildVerification.buildReceiptVerifications < 1 ||
  buildVerification.buildSemanticAnalysisRuns !== 0
) {
  throw new Error("Packed build verifier did not consume V2 without semantics");
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
  join(temporaryRoot, "results.json"),
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
      receiptV2: {
        authorization: authorizationOutput.authorization,
        build: {
          buildReceiptVerifications:
            buildVerification.buildReceiptVerifications,
          buildSemanticAnalysisRuns:
            buildVerification.buildSemanticAnalysisRuns,
        },
      },
      installed: true,
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
await rm(receiptAppRoot, { force: true, recursive: true });
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
    receiptV2: {
      authorization: authorizationOutput.authorization,
      build: {
        buildReceiptVerifications: buildVerification.buildReceiptVerifications,
        buildSemanticAnalysisRuns: buildVerification.buildSemanticAnalysisRuns,
      },
    },
    renderedTranslation: runtimeEvidence.renderedTranslation,
  })}\n`
);
