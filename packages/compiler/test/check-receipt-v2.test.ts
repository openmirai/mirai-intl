import {
  mkdir,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import type ts from "typescript";
import type {
  IntlCheckReceiptCountersV3,
  IntlCheckReceiptSelectorV1,
  IntlCheckReceiptSelectorV2,
  PackageAuthoritySetV1,
  RuntimeAbi,
  Sha256,
} from "@openmirai/intl-abi";
import {
  INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
  INTL_CHECK_RECEIPT_SELECTOR_NAME,
  INTL_CHECK_RECEIPT_V2_NAME,
  INTL_CHECK_RECEIPT_V3_NAME,
} from "@openmirai/intl-abi";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalIntlCheckReceiptV2Bytes,
  buildIntlCheckReceiptV3FromClassifierProjections,
  buildIntlCheckReceiptV3PersistedAuthorityBinding,
  buildIntlCheckReceiptV3,
  canonicalIntlCheckReceiptV3Bytes,
} from "../src/authorization-snapshot";
import { canonicalJson, sha256 } from "../src/canonical";
import {
  buildMiraiIntlClassifierAuthorityEnvelopeV3,
  buildMiraiIntlPersistedClassifierAuthorityV3,
  canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes,
  parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3,
} from "../src/classifier-authority";
import { verifyProviderResolutionFrontier } from "../src/provider-resolution-identity";

const semanticFactoryNames = vi.hoisted(
  () =>
    [
      "createAbstractBuilder",
      "createProgram",
      "createIncrementalProgram",
      "createSemanticDiagnosticsBuilderProgram",
      "createEmitAndSemanticDiagnosticsBuilderProgram",
      "createLanguageService",
      "createSolutionBuilder",
      "createSolutionBuilderWithWatch",
      "createWatchProgram",
    ] as const satisfies ReadonlyArray<keyof typeof ts>
);

const semanticProgramInstrumentation = vi.hoisted(() => ({
  constructions: {
    createAbstractBuilder: 0,
    createEmitAndSemanticDiagnosticsBuilderProgram: 0,
    createIncrementalProgram: 0,
    createLanguageService: 0,
    createProgram: 0,
    createSemanticDiagnosticsBuilderProgram: 0,
    createSolutionBuilder: 0,
    createSolutionBuilderWithWatch: 0,
    createWatchProgram: 0,
  },
  failFast: false,
}));

vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const compiler = Reflect.get(actual, "default") as typeof ts;
  const instrumented = Object.create(compiler) as typeof compiler;
  for (const factoryName of semanticFactoryNames) {
    const factory = compiler[factoryName];
    Object.defineProperty(instrumented, factoryName, {
      value: (...arguments_: Array<unknown>) => {
        semanticProgramInstrumentation.constructions[factoryName] += 1;
        if (semanticProgramInstrumentation.failFast) {
          throw new Error(
            `build receipt verification invoked TypeScript semantic factory ${factoryName}`
          );
        }
        return Reflect.apply(factory, compiler, arguments_);
      },
    });
  }
  return { ...actual, default: instrumented };
});

const roots: Array<string> = [];
const placeholderHash = `sha256:${"0".repeat(64)}` as Sha256;
function semanticConstructionCount(): number {
  return Object.values(semanticProgramInstrumentation.constructions).reduce(
    (total, count) => total + count,
    0
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function authorizeDormantV2(
  root: string,
  options: Readonly<Record<string, unknown>> = {}
) {
  const { authorizeConventionCatalog } = await import("../src/proof");
  return authorizeConventionCatalog(root, {
    ...options,
    collectEnvironment: false,
    dormantV3: true,
  });
}

async function proveConventionCatalogV2(root: string) {
  const result = await authorizeDormantV2(root);
  if (result.receipt.schemaVersion !== 2) {
    throw new Error("Expected dormant V2 authorization receipt");
  }
  const directory = join(root, ".mirai-intl");
  await writeFile(
    join(directory, INTL_CHECK_RECEIPT_V2_NAME),
    canonicalIntlCheckReceiptV2Bytes(result.receipt)
  );
  await rm(join(directory, INTL_CHECK_RECEIPT_SELECTOR_NAME), { force: true });
  return result.receipt;
}

function emptyV3Counters(): IntlCheckReceiptCountersV3 {
  return {
    boundaryIdentities: 0,
    checkerProjects: 0,
    classifierBoundaries: 0,
    classifierCandidateRequests: 0,
    classifierFacadeImports: 0,
    classifierFilteredRequests: 0,
    classifierFullResolverRequests: 0,
    classifierOwnerFallbacks: 0,
    classifierSourcesBound: 0,
    controlSets: 0,
    declarationFiles: 0,
    exceptions: 0,
    fileIdentities: 0,
    loadedLibFiles: 0,
    lexicalFilesClassified: 0,
    lstatIdentities: 0,
    ownerProjects: 0,
    packageScopeIdentities: 0,
    physicalFrontiers: 0,
    probeIdentities: 0,
    providerClosures: 0,
    providerRoots: 0,
    realpathIdentities: 0,
    resolutionBindings: 0,
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: 0,
    sourceFiles: 0,
    typescriptLibFiles: 0,
    unknownActiveSources: 0,
    unknownBoundaryIdentities: 0,
  };
}

function minimalV3ReceiptBytes(): string {
  const receipt = buildIntlCheckReceiptV3({
    application: { packageManifest: 1, workspaceLockfile: 2 },
    artifactAbi: "mirai-intl-artifact-v3",
    candidateIndexes: [],
    classifierBindings: [],
    compilerManifest: [0],
    compilerManifestHash: placeholderHash,
    counters: emptyV3Counters(),
    exceptions: [],
    exceptionsHash: placeholderHash,
    generationReceiptHash: placeholderHash,
    icu: {
      name: "@formatjs/icu-messageformat-parser",
      packageHash: placeholderHash,
      packageManifestHash: placeholderHash,
      version: "3.5.14",
    },
    projects: [],
    providerClosures: [],
    runtimeAbi: "mirai-intl-runtime-v3" as RuntimeAbi,
    schemaVersion: 3,
    sourceAuthorizationHash: placeholderHash,
    sources: [],
    tables: {
      boundaries: [],
      controls: [],
      files: [
        { hash: placeholderHash, path: "compiler.js" },
        { hash: placeholderHash, path: "package.json" },
        { hash: placeholderHash, path: "pnpm-lock.yaml" },
      ],
      frontiers: [],
      lstats: [],
      packageScopes: [],
      probes: [],
      realpaths: [],
      unknownBoundaries: [],
    },
    typescript: {
      libHash: placeholderHash,
      libs: [],
      package: {
        name: "typescript",
        packageHash: placeholderHash,
        packageManifestHash: placeholderHash,
        version: "6.0.3",
      },
    },
  });
  return canonicalIntlCheckReceiptV3Bytes(receipt);
}

function minimalAuthorityBytes(): string {
  const receiptBytes = minimalV3ReceiptBytes();
  const receipt = JSON.parse(receiptBytes) as {
    sourceAuthorizationHash: Sha256;
  };
  return canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(
    buildMiraiIntlClassifierAuthorityEnvelopeV3({
      authorities: [],
      receiptHash: sha256(receiptBytes),
      sourceAuthorizationHash: receipt.sourceAuthorizationHash,
    })
  );
}

async function writeSelector(
  root: string,
  receiptSchemaVersion: 2 | 3,
  receiptBytes: string | Buffer
): Promise<void> {
  const selector =
    receiptSchemaVersion === 2
      ? ({
          receiptHash: sha256(receiptBytes),
          receiptName: INTL_CHECK_RECEIPT_V2_NAME,
          receiptSchemaVersion,
          schemaVersion: 1,
        } as const satisfies IntlCheckReceiptSelectorV1)
      : ({
          authorityHash: sha256(minimalAuthorityBytes()),
          authorityName: INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
          receiptHash: sha256(receiptBytes),
          receiptName: INTL_CHECK_RECEIPT_V3_NAME,
          receiptSchemaVersion,
          schemaVersion: 1,
        } as const satisfies IntlCheckReceiptSelectorV1);
  await writeFile(
    join(root, ".mirai-intl", INTL_CHECK_RECEIPT_SELECTOR_NAME),
    `${JSON.stringify(selector)}\n`
  );
}

async function writeImmutableV2AuthoritySet(root: string): Promise<{
  authoritySet: PackageAuthoritySetV1;
  authoritySetPath: string;
  receiptPath: string;
  selectorPath: string;
}> {
  const {
    canonicalPackageAuthoritySetV1Bytes,
    conventionPackageAuthorityReceiptPath,
    conventionPackageAuthoritySetPath,
  } = await import("../src/check-receipt");
  const directory = join(root, ".mirai-intl");
  const receiptBytes = await readFile(
    join(directory, INTL_CHECK_RECEIPT_V2_NAME)
  );
  const manifestBytes = await readFile(join(root, "package.json"));
  const authoritySet = {
    classifierAuthority: null,
    package: {
      manifestHash: sha256(
        Buffer.from(
          canonicalJson(JSON.parse(manifestBytes.toString("utf8")) as unknown),
          "utf8"
        )
      ),
      name: "@example/receipt-v2",
      root: ".",
    },
    receipt: {
      hash: sha256(receiptBytes),
      schemaVersion: 2,
    },
    schemaVersion: 1,
  } as const satisfies PackageAuthoritySetV1;
  const authoritySetBytes = canonicalPackageAuthoritySetV1Bytes(authoritySet);
  const authoritySetHash = sha256(authoritySetBytes);
  const authoritySetPath = conventionPackageAuthoritySetPath(
    root,
    authoritySetHash
  );
  const receiptPath = conventionPackageAuthorityReceiptPath(
    root,
    2,
    authoritySet.receipt.hash
  );
  const selectorPath = join(directory, INTL_CHECK_RECEIPT_SELECTOR_NAME);
  const selector = {
    authoritySetHash,
    schemaVersion: 2,
  } as const satisfies IntlCheckReceiptSelectorV2;
  await mkdir(join(receiptPath, ".."), { recursive: true });
  await mkdir(join(authoritySetPath, ".."), { recursive: true });
  await writeFile(receiptPath, receiptBytes);
  await writeFile(authoritySetPath, authoritySetBytes);
  await writeFile(selectorPath, `${canonicalJson(selector)}\n`);
  return { authoritySet, authoritySetPath, receiptPath, selectorPath };
}

async function buildPortableV3Authority(
  packageRoot: string,
  workspaceRoot: string
) {
  const receiptV2 = await proveConventionCatalogV2(packageRoot);
  const { createMiraiIntlClassifierWorkspaceTransactionV3 } =
    await import("../src/classifier-candidate");
  const transaction =
    await createMiraiIntlClassifierWorkspaceTransactionV3(workspaceRoot);
  for (const project of receiptV2.projects.filter(
    ({ role }) => role === "owner"
  )) {
    const sources = await Promise.all(
      receiptV2.sources
        .filter(({ owner }) => owner === project.path)
        .map(async ({ file }) => ({
          id: resolve(workspaceRoot, file),
          source: await readFile(resolve(workspaceRoot, file), "utf8"),
        }))
    );
    await transaction.authorize({
      generatedFacadePath: join(packageRoot, "src/page.ts"),
      options: project.normalizedOptions as unknown as ts.CompilerOptions,
      owner: project.path,
      sources,
      workspaceRoot,
    });
  }
  const finalized = await transaction.finalize();
  const evidence = finalized.authorities.map((authority, index) => {
    const projection = finalized.receiptProjections[index];
    if (projection === undefined) {
      throw new Error("Missing finalized classifier receipt projection");
    }
    return { authority, projection };
  });
  return buildIntlCheckReceiptV3FromClassifierProjections(receiptV2, evidence);
}

async function activateImmutableV3AuthoritySet(
  packageRoot: string,
  workspaceRoot: string,
  receiptBytes: string,
  authorityBytes: string
): Promise<{
  authorityPath: string;
  authoritySetPath: string;
  receiptPath: string;
  selectorPath: string;
}> {
  const {
    canonicalPackageAuthoritySetV1Bytes,
    conventionPackageAuthorityReceiptPath,
    conventionPackageAuthoritySetPath,
    conventionPackageClassifierAuthorityPath,
  } = await import("../src/check-receipt");
  const receipt = JSON.parse(receiptBytes) as {
    application: { packageManifest: number };
    tables: { files: ReadonlyArray<{ hash: Sha256; path: string }> };
  };
  const manifest = receipt.tables.files[receipt.application.packageManifest];
  if (manifest === undefined) {
    throw new Error("Missing V3 application manifest fixture");
  }
  const manifestValue = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8")
  ) as { name?: unknown };
  if (typeof manifestValue.name !== "string") {
    throw new Error("Missing V3 fixture package name");
  }
  const receiptHash = sha256(receiptBytes);
  const authorityHash = sha256(authorityBytes);
  const authoritySet = {
    classifierAuthority: { hash: authorityHash, schemaVersion: 3 },
    package: {
      manifestHash: manifest.hash,
      name: manifestValue.name,
      root: relative(workspaceRoot, packageRoot).split("\\").join("/") || ".",
    },
    receipt: { hash: receiptHash, schemaVersion: 3 },
    schemaVersion: 1,
  } as const satisfies PackageAuthoritySetV1;
  const setBytes = canonicalPackageAuthoritySetV1Bytes(authoritySet);
  const setHash = sha256(setBytes);
  const authorityPath = conventionPackageClassifierAuthorityPath(
    packageRoot,
    authorityHash
  );
  const receiptPath = conventionPackageAuthorityReceiptPath(
    packageRoot,
    3,
    receiptHash
  );
  const authoritySetPath = conventionPackageAuthoritySetPath(
    packageRoot,
    setHash
  );
  const selectorPath = join(
    packageRoot,
    ".mirai-intl",
    INTL_CHECK_RECEIPT_SELECTOR_NAME
  );
  await Promise.all(
    [authorityPath, receiptPath, authoritySetPath].map((path) =>
      mkdir(join(path, ".."), { recursive: true })
    )
  );
  await writeFile(authorityPath, authorityBytes);
  await writeFile(receiptPath, receiptBytes);
  await writeFile(authoritySetPath, setBytes);
  await writeFile(
    selectorPath,
    `${canonicalJson({ authoritySetHash: setHash, schemaVersion: 2 })}\n`
  );
  return { authorityPath, authoritySetPath, receiptPath, selectorPath };
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-receipt-v2-"));
  roots.push(root);
  await writeJson(join(root, "package.json"), {
    dependencies: { "@example/provider": "1.0.0", vite: "8.1.4" },
    name: "@example/receipt-v2",
    version: "1.0.0",
  });
  await writeJson(join(root, "node_modules/@example/provider/package.json"), {
    dependencies: { "@example/transitive": "1.0.0" },
    exports: { ".": "./index.js" },
    name: "@example/provider",
    types: "./index.d.ts",
    version: "1.0.0",
  });
  await writeFile(
    join(root, "node_modules/@example/provider/index.d.ts"),
    'export { key } from "@example/transitive";\n'
  );
  await writeFile(
    join(root, "node_modules/@example/provider/alternate.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await writeJson(join(root, "node_modules/@example/transitive/package.json"), {
    exports: { ".": "./index.js" },
    name: "@example/transitive",
    types: "./index.d.ts",
    version: "1.0.0",
  });
  await writeFile(
    join(root, "node_modules/@example/transitive/index.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await writeFile(
    join(root, "node_modules/@example/transitive/alternate.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await writeJson(join(root, "src/locales/global/en.json"), {
    group: { greeting: "Hello" },
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    group: { greeting: "สวัสดี" },
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src/page.ts"),
    [
      'import { key } from "@example/provider";',
      'import { useTranslations } from "x";',
      'const { t } = useTranslations("group");',
      "export const page = t(key);",
      "",
    ].join("\n")
  );
  await writeFile(join(root, "src/legacy.js"), "export const legacy = 1;\n");
  await writeJson(join(root, "tsconfig.a.json"), {
    compilerOptions: {
      allowJs: true,
      moduleSuffixes: [".ios", ""],
      resolveJsonModule: true,
    },
  });
  await writeJson(join(root, "tsconfig.base.json"), {
    compilerOptions: { strict: true },
  });
  await writeJson(join(root, "tsconfig.types.json"), {
    compilerOptions: { composite: true },
    files: [],
  });
  await writeJson(join(root, "tsconfig.z.json"), {
    compilerOptions: { allowJs: false, resolveJsonModule: false },
  });
  await writeJson(join(root, "tsconfig.json"), {
    exclude: ["src/node_modules"],
    extends: ["./tsconfig.z.json", "./tsconfig.a.json", "./tsconfig.base.json"],
    include: ["src/**/*"],
    references: [{ path: "./tsconfig.types.json" }],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

async function workspaceFixture(): Promise<{
  packageRoot: string;
  workspaceRoot: string;
}> {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "mirai-intl-receipt-workspace-v2-")
  );
  roots.push(workspaceRoot);
  const packageRoot = join(workspaceRoot, "packages/app");
  await writeFile(
    join(workspaceRoot, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n"
  );
  await writeFile(
    join(workspaceRoot, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\n"
  );
  await writeJson(join(packageRoot, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/workspace-receipt-v2",
    version: "1.0.0",
  });
  await writeJson(join(packageRoot, "src/locales/global/en.json"), {
    group: { greeting: "Hello" },
  });
  await writeJson(join(packageRoot, "src/locales/global/th.json"), {
    group: { greeting: "สวัสดี" },
  });
  await writeFile(
    join(packageRoot, "src/page.ts"),
    [
      'import { externalKey, useTranslations } from "x";',
      'const { t } = useTranslations("group");',
      'export const page = t(externalKey as "greeting");',
      "",
    ].join("\n")
  );
  await writeJson(join(packageRoot, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(packageRoot, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return { packageRoot, workspaceRoot };
}

async function repositoryWorkspaceFixture(): Promise<{
  packageRoot: string;
  workspaceRoot: string;
}> {
  const workspaceRoot = process.cwd();
  const fixtureParent = join(workspaceRoot, ".tmp");
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(
    join(fixtureParent, "mirai-intl-receipt-v3-")
  );
  roots.push(fixtureRoot);
  const packageRoot = join(fixtureRoot, "packages/app");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    canonicalJson({
      dependencies: { vite: "8.1.4" },
      name: "@example/workspace-receipt-v3",
      version: "1.0.0",
    })
  );
  await writeJson(join(packageRoot, "src/locales/global/en.json"), {
    group: { greeting: "Hello" },
  });
  await writeJson(join(packageRoot, "src/locales/global/th.json"), {
    group: { greeting: "สวัสดี" },
  });
  await writeFile(
    join(packageRoot, "src/page.ts"),
    [
      'import { useTranslations } from "@openmirai/intl";',
      'const { t } = useTranslations("group");',
      'const moduleName: string = "./dynamic";',
      "void import(moduleName);",
      'export const page = t("greeting");',
      "",
    ].join("\n")
  );
  await writeJson(join(packageRoot, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(packageRoot, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return { packageRoot, workspaceRoot };
}

afterEach(async () => {
  for (const factoryName of semanticFactoryNames) {
    semanticProgramInstrumentation.constructions[factoryName] = 0;
  }
  semanticProgramInstrumentation.failFast = false;
  vi.doUnmock("typescript");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("atomic V2/V3 receipt selection", () => {
  it("supports legacy V2, explicit V2 with dormant V3, and activated V3", async () => {
    const root = await fixture();
    await proveConventionCatalogV2(root);
    const directory = join(root, ".mirai-intl");
    const v2Bytes = await readFile(join(directory, INTL_CHECK_RECEIPT_V2_NAME));
    const v3Bytes = minimalV3ReceiptBytes();
    const {
      conventionCheckClassifierAuthorityV3Path,
      conventionCheckReceiptPath,
      conventionCheckReceiptSelectorPath,
      conventionCheckReceiptV3Path,
      readConventionCheckReceipt,
      verifyConventionBuildReceipt,
    } = await import("../src/check-receipt");

    expect(conventionCheckReceiptPath(root)).toBe(
      join(directory, INTL_CHECK_RECEIPT_V2_NAME)
    );
    expect(conventionCheckReceiptV3Path(root)).toBe(
      join(directory, INTL_CHECK_RECEIPT_V3_NAME)
    );
    expect(conventionCheckClassifierAuthorityV3Path(root)).toBe(
      join(directory, INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME)
    );
    expect(conventionCheckReceiptSelectorPath(root)).toBe(
      join(directory, INTL_CHECK_RECEIPT_SELECTOR_NAME)
    );

    await expect(readConventionCheckReceipt(root)).resolves.toMatchObject({
      receipt: { schemaVersion: 2 },
      receiptName: INTL_CHECK_RECEIPT_V2_NAME,
      selection: "legacy-v2",
    });

    await writeFile(join(directory, INTL_CHECK_RECEIPT_V3_NAME), v3Bytes);
    await writeFile(
      join(directory, INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME),
      minimalAuthorityBytes()
    );
    await writeSelector(root, 2, v2Bytes);
    await expect(readConventionCheckReceipt(root)).resolves.toMatchObject({
      receipt: { schemaVersion: 2 },
      receiptName: INTL_CHECK_RECEIPT_V2_NAME,
      selection: "selector",
    });
    await expect(verifyConventionBuildReceipt(root)).resolves.toMatchObject({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
      receipt: { schemaVersion: 2 },
    });

    await writeFile(
      join(directory, INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME),
      minimalAuthorityBytes()
    );
    await writeSelector(root, 3, v3Bytes);
    await expect(readConventionCheckReceipt(root)).resolves.toMatchObject({
      receipt: { schemaVersion: 3 },
      receiptName: INTL_CHECK_RECEIPT_V3_NAME,
      selection: "selector",
    });
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /generation receipt is stale or corrupt/u
    );
  }, 60_000);

  it("never falls back after selector or selected-artifact corruption", async () => {
    const root = await fixture();
    await proveConventionCatalogV2(root);
    const directory = join(root, ".mirai-intl");
    const selectorPath = join(directory, INTL_CHECK_RECEIPT_SELECTOR_NAME);
    const v2Path = join(directory, INTL_CHECK_RECEIPT_V2_NAME);
    const v3Path = join(directory, INTL_CHECK_RECEIPT_V3_NAME);
    const authorityPath = join(
      directory,
      INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME
    );
    const v2Bytes = await readFile(v2Path);
    const v3Bytes = minimalV3ReceiptBytes();
    const { readConventionCheckReceipt } = await import("../src/check-receipt");
    const reset = async (): Promise<void> => {
      await rm(selectorPath, { force: true, recursive: true });
      await rm(v3Path, { force: true, recursive: true });
      await rm(authorityPath, { force: true, recursive: true });
      await writeFile(v2Path, v2Bytes);
    };
    const cases: ReadonlyArray<readonly [string, () => Promise<void>, RegExp]> =
      [
        [
          "malformed selector",
          () => writeFile(selectorPath, "{\n"),
          /selector must contain valid JSON/u,
        ],
        [
          "noncanonical selector",
          async () => {
            const selector = {
              authorityHash: sha256(minimalAuthorityBytes()),
              authorityName: INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
              receiptHash: sha256(v3Bytes),
              receiptName: INTL_CHECK_RECEIPT_V3_NAME,
              receiptSchemaVersion: 3,
              schemaVersion: 1,
            } satisfies IntlCheckReceiptSelectorV1;
            await writeFile(
              selectorPath,
              `${JSON.stringify(selector, null, 2)}\n`
            );
          },
          /selector must use canonical JSON/u,
        ],
        [
          "mismatched selector name and schema",
          () =>
            writeFile(
              selectorPath,
              `${JSON.stringify({
                receiptHash: sha256(v3Bytes),
                receiptName: INTL_CHECK_RECEIPT_V2_NAME,
                receiptSchemaVersion: 3,
                schemaVersion: 1,
              })}\n`
            ),
          /selector schema is invalid/u,
        ],
        [
          "V3 selector missing authority binding",
          () =>
            writeFile(
              selectorPath,
              `${JSON.stringify({
                receiptHash: sha256(v3Bytes),
                receiptName: INTL_CHECK_RECEIPT_V3_NAME,
                receiptSchemaVersion: 3,
                schemaVersion: 1,
              })}\n`
            ),
          /selector schema is invalid/u,
        ],
        [
          "V2 selector with authority binding",
          () =>
            writeFile(
              selectorPath,
              `${JSON.stringify({
                authorityHash: sha256(minimalAuthorityBytes()),
                authorityName: INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
                receiptHash: sha256(v2Bytes),
                receiptName: INTL_CHECK_RECEIPT_V2_NAME,
                receiptSchemaVersion: 2,
                schemaVersion: 1,
              })}\n`
            ),
          /selector schema is invalid/u,
        ],
        [
          "V3 selector with unfixed authority name",
          () =>
            writeFile(
              selectorPath,
              `${JSON.stringify({
                authorityHash: sha256(minimalAuthorityBytes()),
                authorityName: "authority.json",
                receiptHash: sha256(v3Bytes),
                receiptName: INTL_CHECK_RECEIPT_V3_NAME,
                receiptSchemaVersion: 3,
                schemaVersion: 1,
              })}\n`
            ),
          /selector schema is invalid/u,
        ],
        [
          "invalid selector receipt hash",
          () =>
            writeFile(
              selectorPath,
              `${JSON.stringify({
                receiptHash: "sha256:not-a-hash",
                receiptName: INTL_CHECK_RECEIPT_V3_NAME,
                receiptSchemaVersion: 3,
                schemaVersion: 1,
              })}\n`
            ),
          /selector schema is invalid/u,
        ],
        [
          "selector directory interruption",
          () => mkdir(selectorPath),
          /selector must be a non-symlink regular file/u,
        ],
        [
          "selector symlink",
          async () => {
            const target = join(directory, "selector-target.json");
            await writeFile(target, "{}\n");
            await symlink(target, selectorPath, "file");
          },
          /selector must be a non-symlink regular file/u,
        ],
        [
          "selector publication interruption after V3 artifact rename",
          () => writeFile(v3Path, v3Bytes),
          /selector is missing while a V3 authorization artifact exists/u,
        ],
        [
          "selector publication interruption after authority artifact rename",
          () => writeFile(authorityPath, minimalAuthorityBytes()),
          /selector is missing while a V3 authorization artifact exists/u,
        ],
        [
          "missing selected V3",
          () => writeSelector(root, 3, v3Bytes),
          /selected check receipt 3 is missing/u,
        ],
        [
          "missing selected V2 with valid dormant V3",
          async () => {
            await rm(v2Path);
            await writeFile(v3Path, v3Bytes);
            await writeSelector(root, 2, v2Bytes);
          },
          /selected check receipt 2 is missing/u,
        ],
        [
          "selected V3 symlink",
          async () => {
            const target = join(directory, "v3-target.json");
            await writeFile(target, v3Bytes);
            await symlink(target, v3Path, "file");
            await writeSelector(root, 3, v3Bytes);
          },
          /selected check receipt 3 must be a non-symlink regular file/u,
        ],
        [
          "selected V3 hash mismatch",
          async () => {
            await writeFile(v3Path, v3Bytes);
            await writeSelector(root, 3, "different\n");
          },
          /selected check receipt V3 hash is stale or corrupt/u,
        ],
        [
          "selected V2 hash mismatch with valid dormant V3",
          async () => {
            await writeFile(v3Path, v3Bytes);
            await writeSelector(root, 2, "different\n");
          },
          /selected check receipt V2 hash is stale or corrupt/u,
        ],
        [
          "selected V3 invalid UTF-8",
          async () => {
            const bytes = Buffer.from([0x80]);
            await writeFile(v3Path, bytes);
            await writeSelector(root, 3, bytes);
          },
          /must contain valid UTF-8/u,
        ],
        [
          "selected V3 malformed JSON",
          async () => {
            const bytes = "{\n";
            await writeFile(v3Path, bytes);
            await writeSelector(root, 3, bytes);
          },
          /selected check receipt V3 is invalid/u,
        ],
        [
          "selected V3 noncanonical JSON",
          async () => {
            const bytes = `${JSON.stringify(JSON.parse(v3Bytes), null, 2)}\n`;
            await writeFile(v3Path, bytes);
            await writeSelector(root, 3, bytes);
          },
          /selected check receipt V3 is invalid/u,
        ],
        [
          "selected V3 invalid canonical structure",
          async () => {
            const bytes = '{"schemaVersion":3}\n';
            await writeFile(v3Path, bytes);
            await writeSelector(root, 3, bytes);
          },
          /selected check receipt V3 is invalid/u,
        ],
        [
          "missing selected V3 authority",
          async () => {
            await writeFile(v3Path, v3Bytes);
            await writeSelector(root, 3, v3Bytes);
          },
          /selected classifier authority V3 is missing/u,
        ],
        [
          "selected V3 authority directory interruption",
          async () => {
            await writeFile(v3Path, v3Bytes);
            await mkdir(authorityPath);
            await writeSelector(root, 3, v3Bytes);
          },
          /selected classifier authority V3 must be a non-symlink regular file/u,
        ],
        [
          "selected V3 authority symlink",
          async () => {
            const target = join(directory, "authority-target.json");
            await writeFile(target, minimalAuthorityBytes());
            await symlink(target, authorityPath, "file");
            await writeFile(v3Path, v3Bytes);
            await writeSelector(root, 3, v3Bytes);
          },
          /selected classifier authority V3 must be a non-symlink regular file/u,
        ],
        [
          "selected V3 authority hash mismatch",
          async () => {
            await writeFile(v3Path, v3Bytes);
            await writeFile(authorityPath, minimalAuthorityBytes());
            await writeSelector(root, 3, v3Bytes);
            const selector = JSON.parse(
              await readFile(selectorPath, "utf8")
            ) as IntlCheckReceiptSelectorV1;
            await writeFile(
              selectorPath,
              `${JSON.stringify({
                ...selector,
                authorityHash: sha256("different\n"),
              })}\n`
            );
          },
          /selected classifier authority V3 hash is stale or corrupt/u,
        ],
        [
          "selected V3 authority invalid UTF-8",
          async () => {
            const bytes = Buffer.from([0x80]);
            await writeFile(v3Path, v3Bytes);
            await writeFile(authorityPath, bytes);
            await writeFile(
              selectorPath,
              `${JSON.stringify({
                authorityHash: sha256(bytes),
                authorityName: INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
                receiptHash: sha256(v3Bytes),
                receiptName: INTL_CHECK_RECEIPT_V3_NAME,
                receiptSchemaVersion: 3,
                schemaVersion: 1,
              })}\n`
            );
          },
          /must contain valid UTF-8/u,
        ],
        [
          "selected V3 authority malformed JSON",
          async () => {
            const bytes = "{\n";
            await writeFile(v3Path, v3Bytes);
            await writeFile(authorityPath, bytes);
            await writeFile(
              selectorPath,
              `${JSON.stringify({
                authorityHash: sha256(bytes),
                authorityName: INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
                receiptHash: sha256(v3Bytes),
                receiptName: INTL_CHECK_RECEIPT_V3_NAME,
                receiptSchemaVersion: 3,
                schemaVersion: 1,
              })}\n`
            );
          },
          /JSON/u,
        ],
        [
          "selected V3 authority noncanonical JSON",
          async () => {
            const bytes = `${JSON.stringify(
              JSON.parse(minimalAuthorityBytes()),
              null,
              2
            )}\n`;
            await writeFile(v3Path, v3Bytes);
            await writeFile(authorityPath, bytes);
            await writeFile(
              selectorPath,
              `${JSON.stringify({
                authorityHash: sha256(bytes),
                authorityName: INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
                receiptHash: sha256(v3Bytes),
                receiptName: INTL_CHECK_RECEIPT_V3_NAME,
                receiptSchemaVersion: 3,
                schemaVersion: 1,
              })}\n`
            );
          },
          /must use canonical JSON bytes/u,
        ],
      ];

    for (const [label, arrange, expected] of cases) {
      await reset();
      await arrange();
      await expect(
        readConventionCheckReceipt(root),
        `case ${label} must fail without reading valid V2`
      ).rejects.toThrow(expected);
    }
  }, 60_000);

  it("never reads valid V2 when selector inspection fails", async () => {
    const root = await fixture();
    await proveConventionCatalogV2(root);
    const selectorSuffix = join(
      ".mirai-intl",
      INTL_CHECK_RECEIPT_SELECTOR_NAME
    );
    const v2Suffix = join(".mirai-intl", INTL_CHECK_RECEIPT_V2_NAME);
    const { readConventionCheckReceipt } = await import("../src/check-receipt");

    await expect(
      readConventionCheckReceipt(root, {
        async lstat(path) {
          const normalized = String(path);
          if (normalized.endsWith(selectorSuffix)) {
            throw Object.assign(new Error("permission denied"), {
              code: "EACCES",
            });
          }
          if (normalized.endsWith(v2Suffix)) {
            throw new Error("valid V2 must not be inspected");
          }
          return lstat(path);
        },
      })
    ).rejects.toThrow(/selector could not be inspected/u);
  }, 60_000);

  it("never falls back to valid V2 when selected authority inspection fails", async () => {
    const root = await fixture();
    await proveConventionCatalogV2(root);
    const directory = join(root, ".mirai-intl");
    const v3Bytes = minimalV3ReceiptBytes();
    await writeFile(join(directory, INTL_CHECK_RECEIPT_V3_NAME), v3Bytes);
    await writeFile(
      join(directory, INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME),
      minimalAuthorityBytes()
    );
    await writeSelector(root, 3, v3Bytes);
    const authoritySuffix = join(
      ".mirai-intl",
      INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME
    );
    const { readConventionCheckReceipt } = await import("../src/check-receipt");

    await expect(
      readConventionCheckReceipt(root, {
        async lstat(path) {
          if (String(path).endsWith(authoritySuffix)) {
            throw Object.assign(new Error("permission denied"), {
              code: "EACCES",
            });
          }
          return lstat(path);
        },
      })
    ).rejects.toThrow(
      /selected classifier authority V3 could not be inspected/u
    );
  }, 60_000);
});

describe("immutable package authority-set selection", () => {
  it("loads content-addressed V2 authority and ignores every fixed mirror", async () => {
    const root = await fixture();
    await proveConventionCatalogV2(root);
    const { authoritySet, authoritySetPath, receiptPath, selectorPath } =
      await writeImmutableV2AuthoritySet(root);
    const {
      conventionPackageAuthorityReceiptPath,
      conventionPackageAuthoritySetPath,
      readConventionCheckReceipt,
      verifyConventionBuildReceipt,
    } = await import("../src/check-receipt");

    expect(authoritySetPath).toBe(
      conventionPackageAuthoritySetPath(
        root,
        sha256(await readFile(authoritySetPath))
      )
    );
    expect(receiptPath).toBe(
      conventionPackageAuthorityReceiptPath(root, 2, authoritySet.receipt.hash)
    );
    await Promise.all([
      writeFile(
        join(root, ".mirai-intl", INTL_CHECK_RECEIPT_V2_NAME),
        "fixed V2 mirror ignored\n"
      ),
      writeFile(
        join(root, ".mirai-intl", INTL_CHECK_RECEIPT_V3_NAME),
        "fixed V3 mirror ignored\n"
      ),
      writeFile(
        join(root, ".mirai-intl", INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME),
        "fixed classifier mirror ignored\n"
      ),
    ]);

    await expect(readConventionCheckReceipt(root)).resolves.toMatchObject({
      authoritySetHash: sha256(await readFile(authoritySetPath)),
      receipt: { schemaVersion: 2 },
      receiptHash: authoritySet.receipt.hash,
      receiptName: INTL_CHECK_RECEIPT_V2_NAME,
      selection: "authority-set",
    });
    for (const factoryName of semanticFactoryNames) {
      semanticProgramInstrumentation.constructions[factoryName] = 0;
    }
    semanticProgramInstrumentation.failFast = true;
    await expect(verifyConventionBuildReceipt(root)).resolves.toMatchObject({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
      receipt: { schemaVersion: 2 },
    });
    expect(semanticConstructionCount()).toBe(0);
    expect(await lstat(selectorPath)).toMatchObject({});
  }, 60_000);

  it.each([
    [
      "missing set object",
      async ({
        authoritySetPath,
      }: Awaited<ReturnType<typeof writeImmutableV2AuthoritySet>>) =>
        rm(authoritySetPath),
      /selected package authority set is missing/u,
    ],
    [
      "set object corruption",
      async ({
        authoritySetPath,
      }: Awaited<ReturnType<typeof writeImmutableV2AuthoritySet>>) =>
        writeFile(authoritySetPath, "corrupt\n"),
      /authority set hash is stale or corrupt/u,
    ],
    [
      "set object symlink",
      async ({
        authoritySetPath,
      }: Awaited<ReturnType<typeof writeImmutableV2AuthoritySet>>) => {
        const target = `${authoritySetPath}.target`;
        await writeFile(target, await readFile(authoritySetPath));
        await rm(authoritySetPath);
        await symlink(target, authoritySetPath, "file");
      },
      /authority set must be a non-symlink regular file/u,
    ],
    [
      "missing receipt object",
      async ({
        receiptPath,
      }: Awaited<ReturnType<typeof writeImmutableV2AuthoritySet>>) =>
        rm(receiptPath),
      /immutable check receipt V2 is missing/u,
    ],
    [
      "receipt object corruption",
      async ({
        receiptPath,
      }: Awaited<ReturnType<typeof writeImmutableV2AuthoritySet>>) =>
        writeFile(receiptPath, "corrupt\n"),
      /immutable check receipt V2 hash is stale or corrupt/u,
    ],
    [
      "receipt object symlink",
      async ({
        receiptPath,
      }: Awaited<ReturnType<typeof writeImmutableV2AuthoritySet>>) => {
        const target = `${receiptPath}.target`;
        await writeFile(target, await readFile(receiptPath));
        await rm(receiptPath);
        await symlink(target, receiptPath, "file");
      },
      /immutable check receipt V2 must be a non-symlink regular file/u,
    ],
    [
      "authority store parent symlink",
      async ({
        authoritySetPath,
      }: Awaited<ReturnType<typeof writeImmutableV2AuthoritySet>>) => {
        const setsRoot = join(authoritySetPath, "../../..");
        const target = `${setsRoot}.target`;
        await rename(setsRoot, target);
        await symlink(target, setsRoot, "dir");
      },
      /parent path must be a non-symlink directory/u,
    ],
    [
      "live package manifest mutation",
      async () => undefined,
      /package identity is stale or corrupt/u,
    ],
  ] as const)(
    "fails closed without fixed-mirror fallback after %s",
    async (label, mutate, expected) => {
      const root = await fixture();
      await proveConventionCatalogV2(root);
      const state = await writeImmutableV2AuthoritySet(root);
      if (label === "live package manifest mutation") {
        await writeJson(join(root, "package.json"), {
          name: "@example/mutated",
          version: "1.0.0",
        });
      } else {
        await mutate(state);
      }
      await writeFile(
        join(root, ".mirai-intl", INTL_CHECK_RECEIPT_V2_NAME),
        await readFile(state.receiptPath).catch(
          () => "valid mirror unavailable\n"
        )
      );
      const { readConventionCheckReceipt } =
        await import("../src/check-receipt");
      await expect(readConventionCheckReceipt(root)).rejects.toThrow(expected);
    },
    60_000
  );

  it("rejects traversal and V2/V3 classifier-shape substitutions before lookup", async () => {
    const {
      canonicalPackageAuthoritySetV1Bytes,
      parseCanonicalPackageAuthoritySetV1,
    } = await import("../src/check-receipt");
    const valid = {
      classifierAuthority: null,
      package: {
        manifestHash: placeholderHash,
        name: "@example/app",
        root: ".",
      },
      receipt: { hash: placeholderHash, schemaVersion: 2 },
      schemaVersion: 1,
    } as const satisfies PackageAuthoritySetV1;
    expect(
      parseCanonicalPackageAuthoritySetV1(
        canonicalPackageAuthoritySetV1Bytes(valid)
      )
    ).toEqual(valid);
    expect(() =>
      parseCanonicalPackageAuthoritySetV1(`${JSON.stringify(valid, null, 2)}\n`)
    ).toThrow(/must use canonical JSON/u);
    expect(() =>
      parseCanonicalPackageAuthoritySetV1(
        `${canonicalJson({
          ...valid,
          package: { ...valid.package, root: "../escape" },
        })}\n`
      )
    ).toThrow(/workspace-relative/u);
    expect(() =>
      parseCanonicalPackageAuthoritySetV1(
        `${canonicalJson({
          ...valid,
          classifierAuthority: { hash: placeholderHash, schemaVersion: 3 },
        })}\n`
      )
    ).toThrow(/V2 without classifier authority/u);
    expect(() =>
      parseCanonicalPackageAuthoritySetV1(
        `${canonicalJson({
          ...valid,
          receipt: { ...valid.receipt, schemaVersion: 3 },
        })}\n`
      )
    ).toThrow(/V3 with classifier authority/u);
  });

  it.each([
    [
      "noncanonical schema-2 selector",
      (authoritySetHash: Sha256) =>
        `${JSON.stringify({ authoritySetHash, schemaVersion: 2 }, null, 2)}\n`,
      /selector must use canonical JSON/u,
    ],
    [
      "traversal-shaped schema-2 selector hash",
      () =>
        `${canonicalJson({ authoritySetHash: "sha256:../escape", schemaVersion: 2 })}\n`,
      /must be a SHA-256 identity/u,
    ],
    [
      "schema-2 selector with extra path field",
      (authoritySetHash: Sha256) =>
        `${canonicalJson({ authoritySetHash, path: "../escape", schemaVersion: 2 })}\n`,
      /selector schema is invalid/u,
    ],
  ] as const)(
    "rejects %s without legacy fallback",
    async (_label, selectorBytes, expected) => {
      const root = await fixture();
      await proveConventionCatalogV2(root);
      const state = await writeImmutableV2AuthoritySet(root);
      await writeFile(
        state.selectorPath,
        selectorBytes(sha256(await readFile(state.authoritySetPath)))
      );
      const { readConventionCheckReceipt } =
        await import("../src/check-receipt");
      await expect(readConventionCheckReceipt(root)).rejects.toThrow(expected);
    },
    60_000
  );

  it("loads a full portable V3 envelope and rejects missing, extra, swapped, or corrupt owners without mirrors", async () => {
    const { packageRoot, workspaceRoot } = await repositoryWorkspaceFixture();
    const binding = await buildPortableV3Authority(packageRoot, workspaceRoot);
    const envelope = parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
      binding.authorityBytes
    );
    expect(envelope.authorities).not.toHaveLength(0);
    expect(binding.receipt.tables.unknownBoundaries).not.toHaveLength(0);
    expect(
      buildIntlCheckReceiptV3PersistedAuthorityBinding(
        binding.receipt,
        envelope
      ).authorityHash
    ).toBe(binding.authorityHash);
    const validState = await activateImmutableV3AuthoritySet(
      packageRoot,
      workspaceRoot,
      binding.receiptBytes,
      binding.authorityBytes
    );
    await Promise.all([
      writeFile(
        join(packageRoot, ".mirai-intl", INTL_CHECK_RECEIPT_V2_NAME),
        "fixed V2 mirror ignored\n"
      ),
      writeFile(
        join(packageRoot, ".mirai-intl", INTL_CHECK_RECEIPT_V3_NAME),
        "fixed V3 mirror ignored\n"
      ),
      writeFile(
        join(
          packageRoot,
          ".mirai-intl",
          INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME
        ),
        "fixed classifier mirror ignored\n"
      ),
    ]);
    for (const factoryName of semanticFactoryNames) {
      semanticProgramInstrumentation.constructions[factoryName] = 0;
    }
    semanticProgramInstrumentation.failFast = true;
    const { readConventionCheckReceipt } = await import("../src/check-receipt");
    const cwdSpy = vi
      .spyOn(process, "cwd")
      .mockReturnValue(join(tmpdir(), "outside-workspace"));
    try {
      await expect(
        readConventionCheckReceipt(packageRoot)
      ).resolves.toMatchObject({
        authoritySetHash: sha256(await readFile(validState.authoritySetPath)),
        receipt: { schemaVersion: 3 },
        receiptHash: binding.receiptHash,
        receiptName: INTL_CHECK_RECEIPT_V3_NAME,
        selection: "authority-set",
      });
    } finally {
      cwdSpy.mockRestore();
    }
    expect(semanticConstructionCount()).toBe(0);

    const original = envelope.authorities[0];
    if (original === undefined) {
      throw new Error("Missing portable classifier authority fixture");
    }
    const { resultHash: _resultHash, ...originalBinding } = original;
    const other = buildMiraiIntlPersistedClassifierAuthorityV3({
      ...originalBinding,
      owner: "tsconfig.other.json",
    });
    const variants = [
      [
        "missing owner",
        buildMiraiIntlClassifierAuthorityEnvelopeV3({
          authorities: [],
          receiptHash: envelope.receiptHash,
          sourceAuthorizationHash: envelope.sourceAuthorizationHash,
        }),
      ],
      [
        "extra owner",
        buildMiraiIntlClassifierAuthorityEnvelopeV3({
          authorities: [...envelope.authorities, other],
          receiptHash: envelope.receiptHash,
          sourceAuthorizationHash: envelope.sourceAuthorizationHash,
        }),
      ],
      [
        "swapped owner",
        buildMiraiIntlClassifierAuthorityEnvelopeV3({
          authorities: [other],
          receiptHash: envelope.receiptHash,
          sourceAuthorizationHash: envelope.sourceAuthorizationHash,
        }),
      ],
    ] as const;
    for (const [label, changedEnvelope] of variants) {
      const changedBytes =
        canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(changedEnvelope);
      await activateImmutableV3AuthoritySet(
        packageRoot,
        workspaceRoot,
        binding.receiptBytes,
        changedBytes
      );
      await expect(
        readConventionCheckReceipt(packageRoot),
        `${label} must fail closed`
      ).rejects.toThrow(/does not exactly bind|at least one owner/u);
    }

    const restored = await activateImmutableV3AuthoritySet(
      packageRoot,
      workspaceRoot,
      binding.receiptBytes,
      binding.authorityBytes
    );
    await writeFile(restored.authorityPath, "corrupt classifier object\n");
    await expect(readConventionCheckReceipt(packageRoot)).rejects.toThrow(
      /classifier authority V3 hash is stale or corrupt/u
    );
  }, 60_000);
});

describe("V2 build receipt verification", () => {
  it("authorizes a resolved key when unrelated provider traversal exceeds the finite budget", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "node_modules/@example/provider/index.d.ts"),
      [
        'export declare const key: "greeting";',
        'import "./provider-0";',
        "",
      ].join("\n")
    );
    for (let index = 0; index < 66; index += 1) {
      await writeFile(
        join(root, `node_modules/@example/provider/provider-${index}.d.ts`),
        index === 65 ? "export {};\n" : `import "./provider-${index + 1}";\n`
      );
    }

    const receipt = await proveConventionCatalogV2(root);
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");

    expect(
      Math.max(
        ...receipt.providerClosures.map((closure) => closure.providers.length)
      )
    ).toBeLessThanOrEqual(64);
    await expect(verifyConventionBuildReceipt(root)).resolves.toMatchObject({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    });
  }, 60_000);

  it("writes deterministic V2 authority and verifies with zero semantic runs", async () => {
    const root = await fixture();
    const first = (
      await authorizeDormantV2(root, {
        collectEnvironment: false,
        dormantV3: true,
      })
    ).receipt;
    const second = (
      await authorizeDormantV2(root, {
        collectEnvironment: false,
        dormantV3: true,
      })
    ).receipt;

    expect(second).toEqual(first);
    expect(first.schemaVersion).toBe(2);
    if (first.schemaVersion !== 2) {
      throw new Error("Expected dormant V2 authorization receipt");
    }
    expect(first.counters.semanticAuthorizationRuns).toBe(1);
    expect(first.counters.providerRoots).toBe(2);
    expect(first.projects[0]?.normalizedOptions.allowJs).toBe(true);
    expect(first.projects[0]?.normalizedOptions.moduleSuffixes).toEqual([
      ".ios",
      "",
    ]);
    expect(first.projects[0]?.normalizedOptions.resolveJsonModule).toBe(true);
    expect(first.projects[0]?.rootFiles).toEqual(
      expect.arrayContaining(["src/legacy.js", "src/page.ts"])
    );
    expect(
      first.providerClosures.find((closure) => closure.source === "src/page.ts")
        ?.providers
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolutions: [
            expect.objectContaining({
              controlFiles: expect.arrayContaining([
                expect.objectContaining({
                  path: "node_modules/@example/provider/package.json",
                }),
              ]),
              packageName: "@example/provider",
              packageVersion: "1.0.0",
              specifier: "@example/provider",
            }),
          ],
          root: "node_modules/@example/provider/index.d.ts",
        }),
        expect.objectContaining({
          resolutions: [
            expect.objectContaining({
              controlFiles: expect.arrayContaining([
                expect.objectContaining({
                  path: "node_modules/@example/transitive/package.json",
                }),
              ]),
              from: "node_modules/@example/provider/index.d.ts",
              packageName: "@example/transitive",
              packageVersion: "1.0.0",
              specifier: "@example/transitive",
            }),
          ],
          root: "node_modules/@example/transitive/index.d.ts",
        }),
      ])
    );
    const providerResolution = first.providerClosures
      .find((closure) => closure.source === "src/page.ts")
      ?.providers.find(
        (provider) =>
          provider.root === "node_modules/@example/provider/index.d.ts"
      )
      ?.resolutions.at(0);
    expect(providerResolution?.optionsHash).toBe(
      first.projects[0]?.normalizedOptionsHash
    );
    expect(providerResolution?.probes).toEqual(
      expect.arrayContaining([
        {
          kind: "file",
          path: "node_modules/@example/provider/index.ios.d.ts",
          present: false,
        },
      ])
    );
    expect(
      first.projects[0]?.configManifest.map((entry) => entry.path)
    ).toEqual([
      "tsconfig.a.json",
      "tsconfig.base.json",
      "tsconfig.json",
      "tsconfig.types.json",
      "tsconfig.z.json",
    ]);
    expect(
      first.projects[0]?.configManifest.find(
        (entry) => entry.path === "tsconfig.json"
      )?.extends
    ).toEqual(["tsconfig.z.json", "tsconfig.a.json", "tsconfig.base.json"]);
    expect(semanticConstructionCount()).toBeGreaterThan(0);

    for (const factoryName of semanticFactoryNames) {
      semanticProgramInstrumentation.constructions[factoryName] = 0;
    }
    semanticProgramInstrumentation.failFast = true;
    vi.resetModules();
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");
    const verification = await verifyConventionBuildReceipt(root);
    expect(verification).toMatchObject({
      buildSemanticAnalysisRuns: 0,
      receipt: { schemaVersion: 2 },
    });
    expect(verification.buildReceiptVerifications).toBeGreaterThanOrEqual(1);
    expect(semanticConstructionCount()).toBe(0);

    await writeFile(join(root, "src/page.ts"), "export const stale = true;\n");
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /source is stale or corrupt/u
    );
    expect(semanticConstructionCount()).toBe(0);
  }, 60_000);

  it("rejects source and generation corruption", async () => {
    const root = await fixture();
    await proveConventionCatalogV2(root);
    const sourcePath = join(root, "src/page.ts");
    const originalSource = await readFile(sourcePath, "utf8");
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");

    await writeFile(sourcePath, "export const page = 2;\n");
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /source is stale or corrupt/u
    );
    await writeFile(sourcePath, originalSource);

    await writeFile(sourcePath, Buffer.from([0x80]));
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /must contain valid UTF-8/u
    );
    await writeFile(sourcePath, originalSource);

    const configPath = join(root, "tsconfig.base.json");
    const originalConfig = await readFile(configPath, "utf8");
    await writeJson(configPath, {
      compilerOptions: { strict: false },
    });
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /TypeScript config is stale or corrupt/u
    );
    await writeFile(configPath, originalConfig);

    const pointerPath = join(root, "src/i18n/generated/current.json");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as {
      generationReceiptHash: string;
    };
    pointer.generationReceiptHash = `sha256:${"0".repeat(64)}`;
    await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(/./u);
  }, 60_000);

  it.each([
    [
      "nearer package addition",
      async (root: string) => {
        await writeJson(
          join(root, "src/node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./index.d.ts" },
            name: "@example/provider",
            version: "2.0.0",
          }
        );
        await writeFile(
          join(root, "src/node_modules/@example/provider/index.d.ts"),
          'export declare const key: "greeting";\n'
        );
      },
      /provider resolution frontier is stale/u,
    ],
    [
      "implementation addition",
      async (root: string) => {
        await writeFile(
          join(root, "node_modules/@example/provider/index.ts"),
          'export const key = "greeting" as const;\n'
        );
      },
      /provider resolution frontier is stale/u,
    ],
    [
      "module-suffixed implementation addition",
      async (root: string) => {
        await writeFile(
          join(root, "node_modules/@example/provider/index.ios.d.ts"),
          'export declare const key: "greeting";\n'
        );
      },
      /provider resolution frontier is stale/u,
    ],
    [
      "provider removal",
      async (root: string) => {
        await rm(join(root, "node_modules/@example/provider"), {
          recursive: true,
        });
      },
      /receipt input must be a regular file/u,
    ],
    [
      "exports retarget",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./alternate.js" },
            name: "@example/provider",
            types: "./index.d.ts",
            version: "1.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
    [
      "types retarget",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./index.js" },
            name: "@example/provider",
            types: "./alternate.d.ts",
            version: "1.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
    [
      "package identity mutation",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./index.js" },
            name: "@example/provider",
            types: "./index.d.ts",
            version: "2.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
    [
      "transitive exports retarget",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/transitive/package.json"),
          {
            exports: { ".": "./alternate.js" },
            name: "@example/transitive",
            types: "./index.d.ts",
            version: "1.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
  ] as const)(
    "rejects provider authority after %s",
    async (_label, mutate, error) => {
      const root = await fixture();
      await proveConventionCatalogV2(root);
      await mutate(root);
      vi.resetModules();
      vi.doMock("typescript", () => {
        throw new Error("build verification imported TypeScript");
      });
      const { verifyConventionBuildReceipt } =
        await import("../src/check-receipt");
      await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(error);
    },
    60_000
  );

  it("binds hoisted workspace resolution changes into evidence and receipt invalidation", async () => {
    const { packageRoot, workspaceRoot } = await workspaceFixture();
    const missing = (
      await authorizeDormantV2(packageRoot, {
        collectEnvironment: false,
        dormantV3: true,
      })
    ).receipt;
    if (missing.schemaVersion !== 2) {
      throw new Error("Expected dormant V2 authorization receipt");
    }
    expect(missing.projects[0]?.path).toBe("tsconfig.json");
    expect(missing.sources[0]?.owner).toBe("tsconfig.json");
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");
    await expect(
      verifyConventionBuildReceipt(packageRoot)
    ).resolves.toMatchObject({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    });
    const missingResolution = missing.providerClosures
      .find((closure) => closure.source === "packages/app/src/page.ts")
      ?.providers.flatMap((provider) => provider.resolutions)
      .find((resolution) => resolution.specifier === "x");
    expect(missingResolution).toMatchObject({
      from: "packages/app/src/page.ts",
      packageName: null,
      packageVersion: null,
      specifier: "x",
    });
    expect(missingResolution?.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "directory",
          path: "node_modules",
          present: false,
        }),
      ])
    );

    await writeJson(join(workspaceRoot, "node_modules/x/package.json"), {
      name: "x",
      types: "./index.d.ts",
      version: "1.0.0",
    });
    await writeFile(
      join(workspaceRoot, "node_modules/x/index.d.ts"),
      [
        'export declare const externalKey: "greeting";',
        "export declare function useTranslations(namespace: string): { t(key: string): string };",
        "",
      ].join("\n")
    );
    if (!missingResolution) {
      throw new Error("Missing unresolved hoisted provider receipt evidence");
    }
    await expect(
      verifyProviderResolutionFrontier(
        workspaceRoot,
        missingResolution.optionsHash,
        missingResolution
      )
    ).rejects.toThrow(/provider resolution frontier is stale/u);

    const present = (
      await authorizeDormantV2(packageRoot, {
        collectEnvironment: false,
        dormantV3: true,
      })
    ).receipt;
    if (present.schemaVersion !== 2) {
      throw new Error("Expected dormant V2 authorization receipt");
    }
    const presentProvider = present.providerClosures
      .find((closure) => closure.source === "packages/app/src/page.ts")
      ?.providers.find(
        (provider) => provider.root === "node_modules/x/index.d.ts"
      );
    expect(presentProvider).toMatchObject({
      declarations: [
        expect.objectContaining({ path: "node_modules/x/index.d.ts" }),
      ],
      kind: "external",
      resolutions: [
        expect.objectContaining({
          packageName: "x",
          packageVersion: "1.0.0",
          specifier: "x",
        }),
      ],
    });
    const presentResolution = presentProvider?.resolutions.at(0);
    if (!presentResolution) {
      throw new Error("Missing resolved hoisted provider receipt evidence");
    }

    await rm(join(workspaceRoot, "node_modules/x"), { recursive: true });
    await expect(
      verifyProviderResolutionFrontier(
        workspaceRoot,
        presentResolution.optionsHash,
        presentResolution
      )
    ).rejects.toThrow(/provider resolution frontier is stale/u);
  }, 60_000);

  it("fails closed when typeRoots would bypass the traced type-resolution frontier", async () => {
    const root = await fixture();
    await writeJson(join(root, "tsconfig.a.json"), {
      compilerOptions: {
        allowJs: true,
        moduleSuffixes: [".ios", ""],
        resolveJsonModule: true,
        typeRoots: ["./node_modules/@types"],
      },
    });
    await expect(proveConventionCatalogV2(root)).rejects.toThrow(
      new RegExp(
        "does not support TypeScript provider resolution option\\(s\\): typeRoots",
        "u"
      )
    );
  }, 60_000);

  it("rejects legacy V1 explicitly", async () => {
    const root = await fixture();
    await proveConventionCatalogV2(root);
    await writeFile(
      join(root, ".mirai-intl/check-receipt.v2.json"),
      '{"schemaVersion":99}\n'
    );
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /schema is unsupported/u
    );

    await rm(join(root, ".mirai-intl/check-receipt.v2.json"));
    await writeFile(
      join(root, ".mirai-intl/check-receipt.v1.json"),
      '{"schemaVersion":1}\n'
    );
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /V1 is unsupported/u
    );
  }, 60_000);

  it.each([
    [
      "addition",
      async (root: string) => {
        await writeFile(
          join(root, "src/added.js"),
          "export const added = 1;\n"
        );
      },
      /source universe is stale/u,
    ],
    [
      "deletion",
      async (root: string) => {
        await rm(join(root, "src/legacy.js"));
      },
      /receipt input must be a regular file/u,
    ],
    [
      "rename",
      async (root: string) => {
        await rename(join(root, "src/legacy.js"), join(root, "src/renamed.js"));
      },
      /receipt input must be a regular file/u,
    ],
  ] as const)(
    "rejects post-authorization source %s without semantic verification",
    async (_label, mutate, error) => {
      const root = await fixture();
      await proveConventionCatalogV2(root);
      await mutate(root);
      vi.resetModules();
      vi.doMock("typescript", () => {
        throw new Error("build verification imported TypeScript");
      });
      const { verifyConventionBuildReceipt } =
        await import("../src/check-receipt");
      await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(error);
    },
    60_000
  );

  it.each([
    ["script", "d.ts", "ts"],
    ["ES module", "d.mts", "mts"],
    ["CommonJS module", "d.cts", "cts"],
  ] as const)(
    "rejects a %s implementation added beside an authorized declaration",
    async (_label, declarationExtension, implementationExtension) => {
      const root = await fixture();
      const declaration = `src/shadow.${declarationExtension}`;
      await writeFile(
        join(root, declaration),
        "export declare const shadow: number;\n"
      );
      const receipt = await proveConventionCatalogV2(root);
      expect(receipt.projects[0]?.rootFiles).toContain(declaration);

      await writeFile(
        join(root, `src/shadow.${implementationExtension}`),
        "export const shadow = 1;\n"
      );
      vi.resetModules();
      vi.doMock("typescript", () => {
        throw new Error("build verification imported TypeScript");
      });
      const { verifyConventionBuildReceipt } =
        await import("../src/check-receipt");
      await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
        /check-project source universe is stale/u
      );
    },
    60_000
  );
});
