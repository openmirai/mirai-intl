import { readFileSync } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  IntlCheckFileIdentityV2,
  IntlCheckPackageIdentityV2,
  IntlCheckReceipt,
  IntlCheckReceiptSelector,
  IntlCheckReceiptSelectorV1,
  IntlCheckReceiptSelectorV2,
  IntlCheckReceiptV3,
  IntlBuildVerificationCountersV2,
  PackageAuthoritySetV1,
  Sha256,
} from "@openmirai/intl-abi";
import {
  INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
  INTL_CHECK_RECEIPT_DIRECTORY,
  INTL_CHECK_RECEIPT_SELECTOR_NAME,
  INTL_CHECK_RECEIPT_V2_NAME,
  INTL_CHECK_RECEIPT_V3_NAME,
  INTL_PACKAGE_AUTHORITY_CLASSIFIERS_DIRECTORY,
  INTL_PACKAGE_AUTHORITY_DIRECTORY,
  INTL_PACKAGE_AUTHORITY_RECEIPTS_DIRECTORY,
  INTL_PACKAGE_AUTHORITY_SETS_DIRECTORY,
} from "@openmirai/intl-abi";

import {
  canonicalJson,
  compareCanonicalStrings,
  decodeUtf8Fatal,
  sha256,
} from "./canonical";
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
import { verifyProviderResolutionFrontier } from "./provider-resolution-identity";
import { reconstructProjectRootFiles } from "./source-universe-identity";
import type {
  IntegrityManifestEntry,
  ResolvedPackageIdentity,
} from "./integrity-identity";
import {
  buildIntlCheckReceiptV3PersistedAuthorityBinding,
  canonicalIntlCheckReceiptV2Bytes,
  parseCanonicalIntlCheckReceiptV3,
  parseIntlBuildVerificationCountersV2,
  parseIntlCheckReceiptV2,
} from "./authorization-snapshot";
import { parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3 } from "./classifier-authority";

const legacyReceiptName = "check-receipt.v1.json";
const generationReceiptName = "catalog-generation-receipt.v1.json";
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const WORKSPACE_ROOT_EVIDENCE_PATH = ".mirai-intl/workspace-root";
const ANCESTOR_EVIDENCE_PREFIX = ".mirai-intl/ancestor/";

export type IntlBuildReceiptVerification = IntlBuildVerificationCountersV2 &
  Readonly<{
    receipt: IntlCheckReceipt;
  }>;

export type SelectedIntlCheckReceipt = Readonly<{
  authoritySetHash?: Sha256;
  receipt: IntlCheckReceipt;
  receiptHash: Sha256;
  receiptName:
    | typeof INTL_CHECK_RECEIPT_V2_NAME
    | typeof INTL_CHECK_RECEIPT_V3_NAME;
  selection: "authority-set" | "legacy-v2" | "selector";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: ReadonlyArray<string>
): boolean {
  return (
    Object.keys(value).toSorted().join("\u0000") ===
    [...expected].toSorted().join("\u0000")
  );
}

function parseSha256(value: unknown, context: string): Sha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${context} must be a SHA-256 identity`);
  }
  return value as Sha256;
}

function parseCanonicalPackageRoot(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    isAbsolute(value) ||
    (value !== "." &&
      value
        .split("/")
        .some((segment) => !segment || segment === "." || segment === ".."))
  ) {
    throw new Error(
      "Mirai Intl package authority set package root must be canonical and workspace-relative"
    );
  }
  return value;
}

function parsePackageAuthoritySetV1(value: unknown): PackageAuthoritySetV1 {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "classifierAuthority",
      "package",
      "receipt",
      "schemaVersion",
    ]) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.package) ||
    !hasExactKeys(value.package, ["manifestHash", "name", "root"]) ||
    typeof value.package.name !== "string" ||
    value.package.name.length === 0 ||
    !isRecord(value.receipt) ||
    !hasExactKeys(value.receipt, ["hash", "schemaVersion"]) ||
    (value.receipt.schemaVersion !== 2 && value.receipt.schemaVersion !== 3)
  ) {
    throw new Error("Mirai Intl package authority set schema is invalid");
  }
  const classifier = value.classifierAuthority;
  if (
    classifier !== null &&
    (!isRecord(classifier) ||
      !hasExactKeys(classifier, ["hash", "schemaVersion"]) ||
      classifier.schemaVersion !== 3)
  ) {
    throw new Error("Mirai Intl package authority set schema is invalid");
  }
  if (
    (value.receipt.schemaVersion === 2 && classifier !== null) ||
    (value.receipt.schemaVersion === 3 && classifier === null)
  ) {
    throw new Error(
      "Mirai Intl package authority set must bind V2 without classifier authority and V3 with classifier authority"
    );
  }
  return {
    classifierAuthority:
      classifier === null
        ? null
        : {
            hash: parseSha256(
              classifier.hash,
              "Mirai Intl package authority classifier hash"
            ),
            schemaVersion: 3,
          },
    package: {
      manifestHash: parseSha256(
        value.package.manifestHash,
        "Mirai Intl package authority manifest hash"
      ),
      name: value.package.name,
      root: parseCanonicalPackageRoot(value.package.root),
    },
    receipt: {
      hash: parseSha256(
        value.receipt.hash,
        "Mirai Intl package authority receipt hash"
      ),
      schemaVersion: value.receipt.schemaVersion,
    },
    schemaVersion: 1,
  };
}

/** Canonical immutable package-authority-set bytes. */
export function canonicalPackageAuthoritySetV1Bytes(
  value: PackageAuthoritySetV1
): string {
  return `${canonicalJson(parsePackageAuthoritySetV1(value))}\n`;
}

/** Strict parser for one canonical immutable package-authority-set object. */
export function parseCanonicalPackageAuthoritySetV1(
  source: string
): PackageAuthoritySetV1 {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error("Mirai Intl package authority set must contain valid JSON");
  }
  const authoritySet = parsePackageAuthoritySetV1(value);
  if (source !== canonicalPackageAuthoritySetV1Bytes(authoritySet)) {
    throw new Error("Mirai Intl package authority set must use canonical JSON");
  }
  return authoritySet;
}

function authorityDigest(hash: Sha256): string {
  return parseSha256(hash, "Mirai Intl authority object hash").slice(
    "sha256:".length
  );
}

/** Pure path for one immutable package receipt. */
export function conventionPackageAuthorityReceiptPath(
  packageRoot: string,
  schemaVersion: 2 | 3,
  hash: Sha256
): string {
  return join(
    resolve(packageRoot),
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_PACKAGE_AUTHORITY_DIRECTORY,
    INTL_PACKAGE_AUTHORITY_RECEIPTS_DIRECTORY,
    `v${String(schemaVersion)}`,
    `${authorityDigest(hash)}.json`
  );
}

/** Pure path for one immutable classifier-authority envelope. */
export function conventionPackageClassifierAuthorityPath(
  packageRoot: string,
  hash: Sha256
): string {
  return join(
    resolve(packageRoot),
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_PACKAGE_AUTHORITY_DIRECTORY,
    INTL_PACKAGE_AUTHORITY_CLASSIFIERS_DIRECTORY,
    "v3",
    `${authorityDigest(hash)}.json`
  );
}

/** Pure path for one immutable package authority set. */
export function conventionPackageAuthoritySetPath(
  packageRoot: string,
  hash: Sha256
): string {
  return join(
    resolve(packageRoot),
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_PACKAGE_AUTHORITY_DIRECTORY,
    INTL_PACKAGE_AUTHORITY_SETS_DIRECTORY,
    "v1",
    `${authorityDigest(hash)}.json`
  );
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

type CheckReceiptReaderDependencies = Readonly<{
  lstat: (path: string) => Promise<
    Readonly<{
      isDirectory: () => boolean;
      isFile: () => boolean;
      isSymbolicLink: () => boolean;
    }>
  >;
}>;

const defaultCheckReceiptReaderDependencies: CheckReceiptReaderDependencies = {
  lstat,
};

async function lstatOptional(
  path: string,
  context: string,
  dependencies = defaultCheckReceiptReaderDependencies
) {
  try {
    return await dependencies.lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw new Error(`${context} could not be inspected`, { cause: error });
  }
}

function parseCheckReceiptSelector(source: string): IntlCheckReceiptSelector {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error(
      "Mirai Intl check receipt selector must contain valid JSON"
    );
  }
  if (!isRecord(value)) {
    throw new Error("Mirai Intl check receipt selector schema is invalid");
  }
  if (value.schemaVersion === 2) {
    if (!hasExactKeys(value, ["authoritySetHash", "schemaVersion"])) {
      throw new Error("Mirai Intl check receipt selector schema is invalid");
    }
    const selector: IntlCheckReceiptSelectorV2 = {
      authoritySetHash: parseSha256(
        value.authoritySetHash,
        "Mirai Intl check receipt selector authoritySetHash"
      ),
      schemaVersion: 2,
    };
    if (source !== `${canonicalJson(selector)}\n`) {
      throw new Error(
        "Mirai Intl check receipt selector must use canonical JSON"
      );
    }
    return selector;
  }
  const commonValid =
    value.schemaVersion === 1 &&
    typeof value.receiptHash === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.receiptHash);
  const isV2 =
    Object.keys(value).toSorted().join("\u0000") ===
      [
        "receiptHash",
        "receiptName",
        "receiptSchemaVersion",
        "schemaVersion",
      ].join("\u0000") &&
    value.receiptName === INTL_CHECK_RECEIPT_V2_NAME &&
    value.receiptSchemaVersion === 2;
  const isV3 =
    Object.keys(value).toSorted().join("\u0000") ===
      [
        "authorityHash",
        "authorityName",
        "receiptHash",
        "receiptName",
        "receiptSchemaVersion",
        "schemaVersion",
      ].join("\u0000") &&
    typeof value.authorityHash === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.authorityHash) &&
    value.authorityName === INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME &&
    value.receiptName === INTL_CHECK_RECEIPT_V3_NAME &&
    value.receiptSchemaVersion === 3;
  if (!commonValid || (!isV2 && !isV3)) {
    throw new Error("Mirai Intl check receipt selector schema is invalid");
  }
  const selector = value as IntlCheckReceiptSelectorV1;
  if (source !== `${canonicalJson(selector)}\n`) {
    throw new Error(
      "Mirai Intl check receipt selector must use canonical JSON"
    );
  }
  return selector;
}

async function readRegularBytes(
  path: string,
  context: string,
  dependencies = defaultCheckReceiptReaderDependencies
): Promise<Buffer> {
  const entry = await lstatOptional(path, context, dependencies);
  if (!entry) {
    throw new Error(`${context} is missing`);
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`${context} must be a non-symlink regular file`);
  }
  return readFile(path);
}

async function readImmutableAuthorityBytes(
  packageRoot: string,
  directories: ReadonlyArray<string>,
  fileName: string,
  context: string,
  dependencies = defaultCheckReceiptReaderDependencies
): Promise<Buffer> {
  let directory = resolve(packageRoot);
  for (const segment of [
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_PACKAGE_AUTHORITY_DIRECTORY,
    ...directories,
  ]) {
    directory = join(directory, segment);
    const entry = await lstatOptional(directory, context, dependencies);
    if (!entry) {
      throw new Error(`${context} parent directory is missing`);
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`${context} parent path must be a non-symlink directory`);
    }
  }
  return readRegularBytes(join(directory, fileName), context, dependencies);
}

function parseSelectedReceipt(
  source: string,
  schemaVersion: 2 | 3,
  workspace: string
): IntlCheckReceipt {
  if (schemaVersion === 3) {
    try {
      return parseCanonicalIntlCheckReceiptV3(source, undefined, {
        readSourceBytes(sourcePath) {
          const path = resolve(workspace, sourcePath);
          if (relativePath(workspace, path) !== sourcePath) {
            throw new Error(
              `Mirai Intl check receipt V3 source path is not canonical: ${sourcePath}`
            );
          }
          return readFileSync(path);
        },
      });
    } catch (error) {
      throw new Error("Mirai Intl selected check receipt V3 is invalid", {
        cause: error,
      });
    }
  }
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
  return receipt;
}

function canonicalPackageRoot(workspace: string, packageRoot: string): string {
  const path = relative(workspace, packageRoot).split(sep).join("/");
  return parseCanonicalPackageRoot(path || ".");
}

function packageManifestPath(packageRoot: string): string {
  return packageRoot === "." ? "package.json" : `${packageRoot}/package.json`;
}

async function currentPackageAuthorityIdentity(
  packageRoot: string,
  workspace: string,
  receiptSchemaVersion: 2 | 3,
  dependencies = defaultCheckReceiptReaderDependencies
): Promise<PackageAuthoritySetV1["package"]> {
  const manifestBytes = await readRegularBytes(
    join(packageRoot, "package.json"),
    "Mirai Intl package authority manifest",
    dependencies
  );
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      decodeUtf8Fatal(manifestBytes, "Mirai Intl package authority manifest")
    ) as unknown;
  } catch {
    throw new Error("Mirai Intl package authority manifest must contain JSON");
  }
  if (
    !isRecord(manifest) ||
    typeof manifest.name !== "string" ||
    manifest.name.length === 0
  ) {
    throw new Error("Mirai Intl package authority manifest name is invalid");
  }
  return {
    manifestHash:
      receiptSchemaVersion === 2
        ? sha256(Buffer.from(canonicalJson(manifest), "utf8"))
        : sha256(manifestBytes),
    name: manifest.name,
    root: canonicalPackageRoot(workspace, packageRoot),
  };
}

function receiptPackageManifest(
  receipt: IntlCheckReceipt
): IntlCheckFileIdentityV2 {
  if (receipt.schemaVersion === 2) {
    return receipt.application.packageManifest;
  }
  const manifest = receipt.tables.files[receipt.application.packageManifest];
  if (manifest === undefined) {
    throw new Error(
      "Mirai Intl package authority receipt manifest reference is invalid"
    );
  }
  return manifest;
}

function verifyPackageAuthorityIdentity(
  authorityPackage: PackageAuthoritySetV1["package"],
  currentPackage: PackageAuthoritySetV1["package"],
  receipt: IntlCheckReceipt
): void {
  const manifest = receiptPackageManifest(receipt);
  if (
    canonicalJson(authorityPackage) !== canonicalJson(currentPackage) ||
    manifest.hash !== authorityPackage.manifestHash ||
    manifest.path !== packageManifestPath(authorityPackage.root)
  ) {
    throw new Error(
      "Mirai Intl package authority set package identity is stale or corrupt"
    );
  }
}

async function readPackageAuthoritySetReceipt(
  root: string,
  workspace: string,
  selector: IntlCheckReceiptSelectorV2,
  dependencies = defaultCheckReceiptReaderDependencies
): Promise<SelectedIntlCheckReceipt> {
  const setDigest = authorityDigest(selector.authoritySetHash);
  const setBytes = await readImmutableAuthorityBytes(
    root,
    [INTL_PACKAGE_AUTHORITY_SETS_DIRECTORY, "v1"],
    `${setDigest}.json`,
    "Mirai Intl selected package authority set",
    dependencies
  );
  if (sha256(setBytes) !== selector.authoritySetHash) {
    throw new Error(
      "Mirai Intl selected package authority set hash is stale or corrupt"
    );
  }
  const authoritySet = parseCanonicalPackageAuthoritySetV1(
    decodeUtf8Fatal(setBytes, "Mirai Intl selected package authority set")
  );
  const currentPackage = await currentPackageAuthorityIdentity(
    root,
    workspace,
    authoritySet.receipt.schemaVersion,
    dependencies
  );
  const receiptDigest = authorityDigest(authoritySet.receipt.hash);
  const receiptBytes = await readImmutableAuthorityBytes(
    root,
    [
      INTL_PACKAGE_AUTHORITY_RECEIPTS_DIRECTORY,
      `v${String(authoritySet.receipt.schemaVersion)}`,
    ],
    `${receiptDigest}.json`,
    `Mirai Intl selected immutable check receipt V${String(authoritySet.receipt.schemaVersion)}`,
    dependencies
  );
  if (sha256(receiptBytes) !== authoritySet.receipt.hash) {
    throw new Error(
      `Mirai Intl selected immutable check receipt V${String(authoritySet.receipt.schemaVersion)} hash is stale or corrupt`
    );
  }
  let receipt = parseSelectedReceipt(
    decodeUtf8Fatal(
      receiptBytes,
      `Mirai Intl selected immutable check receipt V${String(authoritySet.receipt.schemaVersion)}`
    ),
    authoritySet.receipt.schemaVersion,
    workspace
  );
  if (receipt.schemaVersion !== authoritySet.receipt.schemaVersion) {
    throw new Error(
      "Mirai Intl package authority set receipt schema is stale or corrupt"
    );
  }
  verifyPackageAuthorityIdentity(authoritySet.package, currentPackage, receipt);
  if (receipt.schemaVersion === 3) {
    const classifier = authoritySet.classifierAuthority;
    if (classifier === null) {
      throw new Error(
        "Mirai Intl package authority set V3 classifier binding is missing"
      );
    }
    const classifierDigest = authorityDigest(classifier.hash);
    const classifierBytes = await readImmutableAuthorityBytes(
      root,
      [INTL_PACKAGE_AUTHORITY_CLASSIFIERS_DIRECTORY, "v3"],
      `${classifierDigest}.json`,
      "Mirai Intl selected immutable classifier authority V3",
      dependencies
    );
    if (sha256(classifierBytes) !== classifier.hash) {
      throw new Error(
        "Mirai Intl selected immutable classifier authority V3 hash is stale or corrupt"
      );
    }
    const envelope = parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
      decodeUtf8Fatal(
        classifierBytes,
        "Mirai Intl selected immutable classifier authority V3"
      )
    );
    const binding = buildIntlCheckReceiptV3PersistedAuthorityBinding(
      receipt,
      envelope
    );
    if (
      binding.receiptHash !== authoritySet.receipt.hash ||
      binding.authorityHash !== classifier.hash
    ) {
      throw new Error(
        "Mirai Intl package authority set V3 cross-binding is stale or corrupt"
      );
    }
    receipt = binding.receipt;
  }
  return {
    authoritySetHash: selector.authoritySetHash,
    receipt,
    receiptHash: authoritySet.receipt.hash,
    receiptName:
      receipt.schemaVersion === 2
        ? INTL_CHECK_RECEIPT_V2_NAME
        : INTL_CHECK_RECEIPT_V3_NAME,
    selection: "authority-set",
  };
}

/**
 * Read exactly one activated authorization receipt.
 *
 * A missing selector preserves the legacy V2 path. Once a selector exists,
 * every selector or selected-artifact failure is terminal and cannot fall back
 * to another receipt version.
 */
export async function readConventionCheckReceipt(
  packageRoot: string,
  dependencies = defaultCheckReceiptReaderDependencies
): Promise<SelectedIntlCheckReceipt> {
  const root = await realpath(resolve(packageRoot));
  const workspace = await workspaceRoot(root);
  const directory = join(root, INTL_CHECK_RECEIPT_DIRECTORY);
  const selectorPath = join(directory, INTL_CHECK_RECEIPT_SELECTOR_NAME);
  const selectorEntry = await lstatOptional(
    selectorPath,
    "Mirai Intl check receipt selector",
    dependencies
  );
  if (!selectorEntry) {
    const [unselectedV3Receipt, unselectedV3Authority] = await Promise.all([
      lstatOptional(
        join(directory, INTL_CHECK_RECEIPT_V3_NAME),
        "Mirai Intl unselected check receipt V3",
        dependencies
      ),
      lstatOptional(
        join(directory, INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME),
        "Mirai Intl unselected classifier authority V3",
        dependencies
      ),
    ]);
    if (unselectedV3Receipt || unselectedV3Authority) {
      throw new Error(
        "Mirai Intl check receipt selector is missing while a V3 authorization artifact exists"
      );
    }
    const legacyPath = join(directory, INTL_CHECK_RECEIPT_V2_NAME);
    const sourceBytes = await readRegularBytes(
      legacyPath,
      "Mirai Intl production build V2 check receipt",
      dependencies
    ).catch(async (error) => {
      const legacy = await lstat(join(directory, legacyReceiptName))
        .then((entry) => entry.isFile())
        .catch(() => false);
      throw new Error(
        legacy
          ? "Mirai Intl check receipt V1 is unsupported; run intl:prove to create V2 authority"
          : "Mirai Intl production build requires an intl:prove V2 receipt",
        { cause: error }
      );
    });
    const source = decodeUtf8Fatal(sourceBytes, "Mirai Intl check receipt V2");
    return {
      receipt: parseSelectedReceipt(source, 2, workspace),
      receiptHash: sha256(sourceBytes),
      receiptName: INTL_CHECK_RECEIPT_V2_NAME,
      selection: "legacy-v2",
    };
  }
  if (selectorEntry.isSymbolicLink() || !selectorEntry.isFile()) {
    throw new Error(
      "Mirai Intl check receipt selector must be a non-symlink regular file"
    );
  }
  const selectorBytes = await readFile(selectorPath);
  const selector = parseCheckReceiptSelector(
    decodeUtf8Fatal(selectorBytes, "Mirai Intl check receipt selector")
  );
  if (selector.schemaVersion === 2) {
    return readPackageAuthoritySetReceipt(
      root,
      workspace,
      selector,
      dependencies
    );
  }
  const selectedPath = join(directory, selector.receiptName);
  const selectedBytes = await readRegularBytes(
    selectedPath,
    `Mirai Intl selected check receipt ${String(selector.receiptSchemaVersion)}`,
    dependencies
  );
  if (sha256(selectedBytes) !== selector.receiptHash) {
    throw new Error(
      `Mirai Intl selected check receipt V${String(selector.receiptSchemaVersion)} hash is stale or corrupt`
    );
  }
  const source = decodeUtf8Fatal(
    selectedBytes,
    `Mirai Intl selected check receipt V${String(selector.receiptSchemaVersion)}`
  );
  let receipt = parseSelectedReceipt(
    source,
    selector.receiptSchemaVersion,
    workspace
  );
  if (selector.receiptSchemaVersion === 3) {
    const authorityBytes = await readRegularBytes(
      join(directory, selector.authorityName),
      "Mirai Intl selected classifier authority V3",
      dependencies
    );
    if (sha256(authorityBytes) !== selector.authorityHash) {
      throw new Error(
        "Mirai Intl selected classifier authority V3 hash is stale or corrupt"
      );
    }
    const authorityEnvelope =
      parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
        decodeUtf8Fatal(
          authorityBytes,
          "Mirai Intl selected classifier authority V3"
        )
      );
    receipt = buildIntlCheckReceiptV3PersistedAuthorityBinding(
      receipt,
      authorityEnvelope
    ).receipt;
  }
  return {
    receipt,
    receiptHash: selector.receiptHash,
    receiptName: selector.receiptName,
    selection: "selector",
  };
}

async function hashRegular(path: string): Promise<`sha256:${string}`> {
  const entry = await lstat(path).catch(() => undefined);
  if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`Mirai Intl receipt input must be a regular file: ${path}`);
  }
  const bytes = await readFile(path);
  decodeUtf8Fatal(bytes, `Mirai Intl receipt input ${path}`);
  return sha256(bytes);
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
  receipt: IntlCheckReceipt
): Promise<void> {
  const receiptPath = join(generatedRoot, generationReceiptName);
  const receiptBytes = await readFile(receiptPath);
  if (sha256(receiptBytes) !== expectedHash) {
    throw new Error("Mirai Intl generation receipt is stale or corrupt");
  }
  const receiptSource = decodeUtf8Fatal(
    receiptBytes,
    "Mirai Intl generation receipt"
  );
  const generation = parseCanonicalCatalogGenerationReceipt(receiptSource);
  const pointerSource = decodeUtf8Fatal(
    await readFile(join(generatedRoot, "current.json")),
    "Mirai Intl generation pointer"
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
  const [facadeBytes, lockBytes] = await Promise.all([
    readFile(join(generatedRoot, "index.ts")),
    readFile(join(generatedRoot, "catalog.lock.json")),
  ]);
  decodeUtf8Fatal(facadeBytes, "Mirai Intl generated facade");
  const lockSource = decodeUtf8Fatal(
    lockBytes,
    "Mirai Intl generated catalog lock"
  );
  if (
    sha256(facadeBytes) !== generation.stableFacadeHash ||
    sha256(lockBytes) !== generation.catalogLockHash ||
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

function receiptV3Files(
  receipt: IntlCheckReceiptV3,
  references: ReadonlyArray<number>,
  context: string
): ReadonlyArray<IntlCheckFileIdentityV2> {
  return references.map((reference) => {
    const file = receipt.tables.files[reference];
    if (!file) {
      throw new Error(`${context} references an unknown file identity`);
    }
    return file;
  });
}

async function verifyClassifierFilesystemV3(
  workspace: string,
  receipt: IntlCheckReceiptV3
): Promise<void> {
  const classifierPath = (path: string): string => {
    const absolute = resolve(workspace, path);
    const canonical = relative(workspace, absolute).split(sep).join("/") || ".";
    if (
      canonical !== path ||
      canonical.startsWith("../") ||
      isAbsolute(canonical)
    ) {
      throw new Error(`Mirai Intl classifier path is not canonical: ${path}`);
    }
    return absolute;
  };
  const isSyntheticPath = (path: string): boolean =>
    path === WORKSPACE_ROOT_EVIDENCE_PATH ||
    path.startsWith(ANCESTOR_EVIDENCE_PREFIX);
  await verifyFiles(
    workspace,
    receipt.tables.controls.flatMap((control) =>
      receiptV3Files(receipt, control.files, "Mirai Intl V3 control set")
    ),
    "Mirai Intl classifier control"
  );
  await Promise.all([
    ...receipt.tables.probes.map(async (probe) => {
      if (isSyntheticPath(probe.path)) {
        return;
      }
      const path = classifierPath(probe.path);
      const entry = await stat(path).catch((error: unknown) => {
        if (isMissingPathError(error)) {
          return undefined;
        }
        throw error;
      });
      const present =
        probe.kind === "directory" ? entry?.isDirectory() : entry?.isFile();
      if (Boolean(present) !== probe.present) {
        throw new Error(`Mirai Intl classifier probe is stale: ${probe.path}`);
      }
    }),
    ...receipt.tables.realpaths.map(async (identity) => {
      if (isSyntheticPath(identity.path)) {
        return;
      }
      const path = classifierPath(identity.path);
      const target = classifierPath(identity.target);
      if ((await realpath(path)) !== target) {
        throw new Error(
          `Mirai Intl classifier realpath is stale: ${identity.path}`
        );
      }
    }),
    ...receipt.tables.lstats.map(async (identity) => {
      if (isSyntheticPath(identity.path)) {
        return;
      }
      const path = classifierPath(identity.path);
      const entry = await lstat(path).catch((error: unknown) => {
        if (isMissingPathError(error)) {
          return undefined;
        }
        throw error;
      });
      let kind: typeof identity.kind = "absent";
      if (entry?.isSymbolicLink()) {
        kind = "symlink";
      } else if (entry?.isDirectory()) {
        kind = "directory";
      } else if (entry?.isFile()) {
        kind = "file";
      } else if (entry) {
        kind = "other";
      }
      let linkTargetBase64: string | null = null;
      let linkTargetHash: `sha256:${string}` | null = null;
      if (kind === "symlink") {
        const target = await readlink(path, { encoding: "buffer" });
        linkTargetBase64 = target.toString("base64");
        linkTargetHash = sha256(target);
      }
      if (
        kind !== identity.kind ||
        linkTargetBase64 !== identity.linkTargetBase64 ||
        linkTargetHash !== identity.linkTargetHash
      ) {
        throw new Error(
          `Mirai Intl classifier lstat is stale: ${identity.path}`
        );
      }
    }),
  ]);
}

async function verifyConventionBuildReceiptV3(
  root: string,
  workspace: string,
  receipt: IntlCheckReceiptV3
): Promise<IntlBuildReceiptVerification> {
  const loaded = await loadConventionCatalog(root);
  const compilerFiles = new Set(receipt.compilerManifest);
  const nonRawApplicationFiles = new Set([
    receipt.application.packageManifest,
    receipt.application.workspaceLockfile,
  ]);
  await Promise.all([
    verifyFiles(
      workspace,
      receipt.tables.files.filter(
        (_, reference) =>
          !compilerFiles.has(reference) &&
          !nonRawApplicationFiles.has(reference)
      ),
      "Mirai Intl V3 bound file"
    ),
    verifyClassifierFilesystemV3(workspace, receipt),
  ]);
  await verifyGeneration(
    resolve(root, loaded.discovery.output),
    receipt.generationReceiptHash,
    receipt
  );
  await verifyLoadedConventionCatalog(loaded, { collectEnvironment: false });
  const reconstructedProjects = await Promise.all(
    receipt.projects.map(async (project) => {
      const expandedProject = {
        ...project,
        configManifest: project.configManifest.map((config) => ({
          extends: config.extends,
          hash: (
            receipt.tables.files[config.file] ??
            (() => {
              throw new Error(
                `Mirai Intl V3 project config references an unknown file: ${config.path}`
              );
            })()
          ).hash,
          path: config.path,
          references: config.references,
        })),
      };
      return {
        project,
        rootFiles: await reconstructProjectRootFiles(
          workspace,
          expandedProject,
          root
        ),
      };
    })
  );
  for (const { project, rootFiles } of reconstructedProjects) {
    if (canonicalJson(rootFiles) !== canonicalJson(project.rootFiles)) {
      throw new Error(
        `Mirai Intl check-project source universe is stale: ${project.path}; expected ${canonicalJson(project.rootFiles)}, received ${canonicalJson(rootFiles)}`
      );
    }
  }
  const generatedPrefix = relative(
    workspace,
    resolve(root, loaded.discovery.output)
  )
    .split(sep)
    .join("/");
  const reconstructedOwners = reconstructedProjects
    .filter(({ project }) => project.role === "owner")
    .flatMap(({ project, rootFiles }) =>
      rootFiles
        .filter(
          (file) =>
            SOURCE_EXTENSION.test(file) &&
            file !== generatedPrefix &&
            !file.startsWith(`${generatedPrefix}/`)
        )
        .map((file) => ({ file, owner: project.path }))
    )
    .toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.file}\u0000${left.owner}`,
        `${right.file}\u0000${right.owner}`
      )
    );
  const receiptOwners = receipt.sources
    .map(({ file, owner }) => ({ file, owner }))
    .toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.file}\u0000${left.owner}`,
        `${right.file}\u0000${right.owner}`
      )
    );
  if (canonicalJson(reconstructedOwners) !== canonicalJson(receiptOwners)) {
    throw new Error("Mirai Intl authorized source universe is stale");
  }
  const immutable = await getImmutableIntegrityIdentity();
  if (
    canonicalJson(
      receiptV3Files(receipt, receipt.compilerManifest, "V3 compiler manifest")
    ) !== canonicalJson(compilerManifest(immutable.compiler.modules.entries)) ||
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
  for (const lib of receiptV3Files(
    receipt,
    receipt.typescript.libs,
    "V3 TypeScript libs"
  )) {
    if (installedLibs.get(lib.path) !== lib.hash) {
      throw new Error(
        `Mirai Intl TypeScript lib identity is stale: ${lib.path}`
      );
    }
  }
  const application = await computeApplicationPackageIdentity(root);
  const packageManifest =
    receipt.tables.files[receipt.application.packageManifest];
  const workspaceLockfile =
    receipt.tables.files[receipt.application.workspaceLockfile];
  const expectedManifest = {
    hash: sha256(await readFile(join(root, "package.json"))),
    path: relativePath(workspace, join(root, "package.json")),
  };
  const expectedLockfile = application.lock
    ? {
        hash: application.lock.hash,
        path: relativePath(workspace, join(workspace, application.lock.name)),
      }
    : expectedManifest;
  if (
    canonicalJson(packageManifest) !== canonicalJson(expectedManifest) ||
    canonicalJson(workspaceLockfile) !== canonicalJson(expectedLockfile)
  ) {
    throw new Error("Mirai Intl application package or lock identity is stale");
  }
  return {
    ...parseIntlBuildVerificationCountersV2({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    }),
    receipt,
  };
}

/** Verify exact receipt-bound bytes without importing TypeScript or semantic code. */
export async function verifyConventionBuildReceipt(
  packageRoot: string
): Promise<IntlBuildReceiptVerification> {
  const root = await realpath(resolve(packageRoot));
  const workspace = await workspaceRoot(root);
  const { receipt } = await readConventionCheckReceipt(root);
  if (receipt.schemaVersion === 3) {
    return verifyConventionBuildReceiptV3(root, workspace, receipt);
  }
  const loaded = await loadConventionCatalog(root);
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
      receipt.providerClosures.flatMap((closure) =>
        closure.providers.flatMap((provider) =>
          provider.resolutions.flatMap((resolution) => resolution.controlFiles)
        )
      ),
      "Mirai Intl provider resolution control"
    ),
    verifyFiles(
      workspace,
      receipt.providerClosures.flatMap((closure) => closure.libs),
      "Mirai Intl loaded TypeScript lib"
    ),
  ]);
  await verifyGeneration(
    resolve(root, loaded.discovery.output),
    receipt.generationReceiptHash,
    receipt
  );
  await verifyLoadedConventionCatalog(loaded, { collectEnvironment: false });
  const reconstructedProjects = await Promise.all(
    receipt.projects.map(async (project) => ({
      project,
      rootFiles: await reconstructProjectRootFiles(workspace, project, root),
    }))
  );
  for (const { project, rootFiles } of reconstructedProjects) {
    if (canonicalJson(rootFiles) !== canonicalJson(project.rootFiles)) {
      throw new Error(
        `Mirai Intl check-project source universe is stale: ${project.path}; expected ${canonicalJson(project.rootFiles)}, received ${canonicalJson(rootFiles)}`
      );
    }
  }
  const sourceByFile = new Map(
    receipt.sources.map((ledgerEntry) => [ledgerEntry.file, ledgerEntry])
  );
  const projectByPath = new Map(
    receipt.projects.map((project) => [project.path, project])
  );
  for (const closure of receipt.providerClosures) {
    const ledgerEntry = sourceByFile.get(closure.source);
    const project = ledgerEntry
      ? projectByPath.get(ledgerEntry.owner)
      : undefined;
    if (!project) {
      throw new Error(
        `Mirai Intl provider closure has no owning check project: ${closure.source}`
      );
    }
    for (const provider of closure.providers) {
      for (const resolution of provider.resolutions) {
        await verifyProviderResolutionFrontier(
          workspace,
          project.normalizedOptionsHash,
          resolution
        );
      }
    }
  }
  const generatedPrefix = relative(
    workspace,
    resolve(root, loaded.discovery.output)
  )
    .split(sep)
    .join("/");
  const reconstructedOwners = reconstructedProjects
    .filter(({ project }) => project.role === "owner")
    .flatMap(({ project, rootFiles }) =>
      rootFiles
        .filter(
          (file) =>
            SOURCE_EXTENSION.test(file) &&
            file !== generatedPrefix &&
            !file.startsWith(`${generatedPrefix}/`)
        )
        .map((file) => ({ file, owner: project.path }))
    )
    .toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.file}\u0000${left.owner}`,
        `${right.file}\u0000${right.owner}`
      )
    );
  const receiptOwners = receipt.sources
    .map(({ file, owner }) => ({ file, owner }))
    .toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.file}\u0000${left.owner}`,
        `${right.file}\u0000${right.owner}`
      )
    );
  if (canonicalJson(reconstructedOwners) !== canonicalJson(receiptOwners)) {
    throw new Error("Mirai Intl authorized source universe is stale");
  }
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
  return {
    ...parseIntlBuildVerificationCountersV2({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    }),
    receipt,
  };
}

export function conventionCheckReceiptPath(packageRoot: string): string {
  return join(
    resolve(packageRoot),
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_CHECK_RECEIPT_V2_NAME
  );
}

export function conventionCheckReceiptV3Path(packageRoot: string): string {
  return join(
    resolve(packageRoot),
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_CHECK_RECEIPT_V3_NAME
  );
}

export function conventionCheckClassifierAuthorityV3Path(
  packageRoot: string
): string {
  return join(
    resolve(packageRoot),
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME
  );
}

export function conventionCheckReceiptSelectorPath(
  packageRoot: string
): string {
  return join(
    resolve(packageRoot),
    INTL_CHECK_RECEIPT_DIRECTORY,
    INTL_CHECK_RECEIPT_SELECTOR_NAME
  );
}
