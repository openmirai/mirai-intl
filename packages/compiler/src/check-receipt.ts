import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  IntlCheckFileIdentityV2,
  IntlCheckPackageIdentityV2,
  IntlCheckReceiptV2,
  IntlBuildVerificationCountersV2,
} from "@openmirai/intl-abi";

import { canonicalJson, sha256 } from "./canonical";
import {
  loadConventionCatalog,
  verifyLoadedConventionCatalog,
} from "./catalog";
import {
  parseCanonicalCatalogCurrentPointer,
  parseCanonicalCatalogGenerationReceipt,
} from "./generation-snapshot";
import {
  computeApplicationPackageIdentity,
  getImmutableIntegrityIdentity,
} from "./integrity-identity";
import type {
  IntegrityManifestEntry,
  ResolvedPackageIdentity,
} from "./integrity-identity";
import {
  canonicalIntlCheckReceiptV2Bytes,
  parseIntlBuildVerificationCountersV2,
  parseIntlCheckReceiptV2,
} from "./authorization-snapshot";

const receiptDirectory = ".mirai-intl";
const receiptName = "check-receipt.v2.json";
const legacyReceiptName = "check-receipt.v1.json";
const generationReceiptName = "catalog-generation-receipt.v1.json";

export type IntlBuildReceiptVerification = IntlBuildVerificationCountersV2 &
  Readonly<{
    receipt: IntlCheckReceiptV2;
  }>;

function relativePath(root: string, file: string): string {
  const path = relative(root, file).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("Mirai Intl receipt path escapes its workspace root");
  }
  return path;
}

async function workspaceRoot(packageRoot: string): Promise<string> {
  let directory = await realpath(packageRoot);
  for (;;) {
    for (const marker of [
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ]) {
      const entry = await lstat(join(directory, marker)).catch(() => undefined);
      if (entry?.isFile() && !entry.isSymbolicLink()) {
        return directory;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return await realpath(packageRoot);
    }
    directory = parent;
  }
}

async function hashRegular(path: string): Promise<`sha256:${string}`> {
  const entry = await lstat(path).catch(() => undefined);
  if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`Mirai Intl receipt input must be a regular file: ${path}`);
  }
  return sha256(await readFile(path, "utf8"));
}

async function verifyFiles(
  root: string,
  entries: ReadonlyArray<IntlCheckFileIdentityV2>,
  context: string
): Promise<void> {
  await Promise.all(
    entries
      .filter((entry) => !entry.path.startsWith("@typescript/lib/"))
      .map(async (entry) => {
        const path = resolve(root, entry.path);
        if (relativePath(root, path) !== entry.path) {
          throw new Error(`${context} path is not canonical: ${entry.path}`);
        }
        if ((await hashRegular(path)) !== entry.hash) {
          throw new Error(`${context} is stale or corrupt: ${entry.path}`);
        }
      })
  );
}

function packageIdentity(
  identity: ResolvedPackageIdentity
): IntlCheckPackageIdentityV2 {
  return {
    name: identity.name,
    packageHash: identity.hash,
    packageManifestHash: identity.packageJsonHash,
    version: identity.version,
  };
}

function compilerManifest(
  entries: ReadonlyArray<IntegrityManifestEntry>
): ReadonlyArray<IntlCheckFileIdentityV2> {
  return entries.map(({ hash, path }) => ({ hash, path }));
}

async function verifyGeneration(
  generatedRoot: string,
  expectedHash: `sha256:${string}`,
  receipt: IntlCheckReceiptV2
): Promise<void> {
  const receiptPath = join(generatedRoot, generationReceiptName);
  const receiptSource = await readFile(receiptPath, "utf8");
  if (sha256(receiptSource) !== expectedHash) {
    throw new Error("Mirai Intl generation receipt is stale or corrupt");
  }
  const generation = parseCanonicalCatalogGenerationReceipt(receiptSource);
  const pointerSource = await readFile(
    join(generatedRoot, "current.json"),
    "utf8"
  );
  const pointer = parseCanonicalCatalogCurrentPointer(pointerSource);
  if (
    pointer.generationReceiptHash !== expectedHash ||
    canonicalJson({
      contentHash: pointer.contentHash,
      directory: pointer.directory,
      schemaVersion: pointer.schemaVersion,
    }) !== canonicalJson(generation.pointerBase) ||
    canonicalJson(generation.pointerBase) !==
      canonicalJson(generation.selectorBase)
  ) {
    throw new Error("Mirai Intl generation pointer and receipt disagree");
  }
  const [facadeSource, lockSource] = await Promise.all([
    readFile(join(generatedRoot, "index.ts"), "utf8"),
    readFile(join(generatedRoot, "catalog.lock.json"), "utf8"),
  ]);
  if (
    sha256(facadeSource) !== generation.stableFacadeHash ||
    sha256(lockSource) !== generation.catalogLockHash ||
    lockSource !== `${canonicalJson(generation.pointerBase)}\n`
  ) {
    throw new Error("Mirai Intl generated facade or catalog lock is corrupt");
  }
  const payloadRoot = resolve(generatedRoot, generation.payload.directory);
  const actualPayloadPaths: Array<string> = [];
  const enumeratePayload = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Mirai Intl generated payload contains a symlink");
      }
      if (entry.isDirectory()) {
        await enumeratePayload(path);
      } else if (entry.isFile()) {
        actualPayloadPaths.push(relativePath(payloadRoot, path));
      } else {
        throw new Error("Mirai Intl generated payload contains a non-file");
      }
    }
  };
  await enumeratePayload(payloadRoot);
  if (
    canonicalJson(actualPayloadPaths.toSorted()) !==
    canonicalJson(
      generation.payload.manifest.entries.map((entry) => entry.path)
    )
  ) {
    throw new Error("Mirai Intl generated payload manifest is incomplete");
  }
  await Promise.all(
    generation.payload.manifest.entries.map(async (entry) => {
      const path = resolve(payloadRoot, entry.path);
      const stat = await lstat(path).catch(() => undefined);
      if (
        !stat ||
        stat.isSymbolicLink() ||
        !stat.isFile() ||
        stat.size !== entry.size ||
        (await hashRegular(path)) !== entry.hash
      ) {
        throw new Error(
          `Mirai Intl generated payload is corrupt: ${entry.path}`
        );
      }
    })
  );
  if (
    generation.abi.artifactAbi !== receipt.artifactAbi ||
    generation.abi.runtimeAbi !== receipt.runtimeAbi
  ) {
    throw new Error("Mirai Intl generation and authorization ABI disagree");
  }
}

/** Verify exact receipt-bound bytes without importing TypeScript or semantic code. */
export async function verifyConventionBuildReceipt(
  packageRoot: string
): Promise<IntlBuildReceiptVerification> {
  const root = await realpath(resolve(packageRoot));
  const path = join(root, receiptDirectory, receiptName);
  const source = await readFile(path, "utf8").catch(async () => {
    const legacy = await lstat(join(root, receiptDirectory, legacyReceiptName))
      .then((entry) => entry.isFile())
      .catch(() => false);
    throw new Error(
      legacy
        ? "Mirai Intl check receipt V1 is unsupported; run intl:prove to create V2 authority"
        : "Mirai Intl production build requires an intl:prove V2 receipt"
    );
  });
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch {
    throw new Error("Mirai Intl check receipt V2 must contain valid JSON");
  }
  if (
    raw &&
    typeof raw === "object" &&
    Reflect.get(raw, "schemaVersion") !== 2
  ) {
    throw new Error(
      "Mirai Intl check receipt schema is unsupported; run intl:prove to create V2 authority"
    );
  }
  const receipt = parseIntlCheckReceiptV2(raw);
  if (source !== canonicalIntlCheckReceiptV2Bytes(receipt)) {
    throw new Error("Mirai Intl check receipt V2 must use canonical JSON");
  }
  const workspace = await workspaceRoot(root);
  const loaded = await loadConventionCatalog(root);
  await verifyLoadedConventionCatalog(loaded, { collectEnvironment: false });
  await Promise.all([
    verifyFiles(
      workspace,
      receipt.projects.flatMap((project) => project.configManifest),
      "Mirai Intl TypeScript config"
    ),
    verifyFiles(
      workspace,
      receipt.sources.map(({ file, hash }) => ({ hash, path: file })),
      "Mirai Intl source"
    ),
    verifyFiles(
      workspace,
      receipt.providerClosures.flatMap((closure) => closure.declarations),
      "Mirai Intl provider declaration"
    ),
    verifyFiles(
      workspace,
      receipt.providerClosures.flatMap((closure) => closure.libs),
      "Mirai Intl loaded TypeScript lib"
    ),
  ]);
  const immutable = await getImmutableIntegrityIdentity();
  if (
    canonicalJson(receipt.compilerManifest) !==
      canonicalJson(compilerManifest(immutable.compiler.modules.entries)) ||
    canonicalJson(receipt.icu) !==
      canonicalJson(packageIdentity(immutable.icuParser)) ||
    canonicalJson(receipt.typescript.package) !==
      canonicalJson(packageIdentity(immutable.typescript))
  ) {
    throw new Error("Mirai Intl compiler dependency identity is stale");
  }
  const installedLibs = new Map(
    immutable.typescriptLibs.libs.entries.map((entry) => [
      `@typescript/lib/${entry.path}`,
      entry.hash,
    ])
  );
  for (const lib of receipt.typescript.libs) {
    if (installedLibs.get(lib.path) !== lib.hash) {
      throw new Error(
        `Mirai Intl TypeScript lib identity is stale: ${lib.path}`
      );
    }
  }
  const application = await computeApplicationPackageIdentity(root);
  const applicationExpected = {
    packageManifest: {
      hash: application.packageJsonHash,
      path: relativePath(workspace, join(root, "package.json")),
    },
    workspaceLockfile: application.lock
      ? {
          hash: application.lock.hash,
          path: relativePath(workspace, join(workspace, application.lock.name)),
        }
      : {
          hash: application.packageJsonHash,
          path: relativePath(workspace, join(root, "package.json")),
        },
  };
  if (
    canonicalJson(receipt.application) !== canonicalJson(applicationExpected)
  ) {
    throw new Error("Mirai Intl application package or lock identity is stale");
  }
  await verifyGeneration(
    resolve(root, loaded.discovery.output),
    receipt.generationReceiptHash,
    receipt
  );
  return {
    ...parseIntlBuildVerificationCountersV2({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    }),
    receipt,
  };
}

export function conventionCheckReceiptPath(packageRoot: string): string {
  return join(resolve(packageRoot), receiptDirectory, receiptName);
}
