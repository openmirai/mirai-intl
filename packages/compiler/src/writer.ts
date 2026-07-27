import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { canonicalJson, sha256 } from "./canonical";
import type { EmittedArtifacts } from "./emit";
import { generatedSourceHeader } from "./generated-source";

export type WriteResult = Readonly<{
  changed: boolean;
  contentHash: `sha256:${string}`;
  directory: string;
}>;

export type StableFacadeExport = Readonly<{
  descriptorExport: string;
  name: string;
}>;

export type StableFacadeOptions = Readonly<{
  exports: ReadonlyArray<StableFacadeExport>;
}>;

export type ArtifactWriterOptions = Readonly<{
  expectedCanonicalRoot?: string;
  generationIdentity?: CatalogGenerationIdentity;
  publicationHooks?: PublicationFaultInjectionHooks;
}>;

const emptyStableFacade: StableFacadeOptions = Object.freeze({ exports: [] });
const emptyWriterOptions: ArtifactWriterOptions = Object.freeze({});

type Sha256 = `sha256:${string}`;

export type CatalogGenerationIdentity = Readonly<{
  artifactAbi: string;
  compilerHash: Sha256;
  generationInputHash: Sha256;
  icuHash: Sha256;
  runtimeAbi: string;
}>;

export type PublicationState =
  | "PREPARED"
  | "STAGED_DURABLE"
  | "PAYLOAD_INSTALLED"
  | "SELECTORS_INSTALLED"
  | "RECEIPT_INSTALLED"
  | "POINTER_COMMITTED"
  | "VALIDATED";

export type PublicationFaultInjectionHooks = Readonly<{
  afterState?(state: PublicationState): Promise<void> | void;
}>;

type SelectorBase = Readonly<{
  contentHash: string;
  directory: string;
  schemaVersion: 2;
}>;

type SelectorIdentity = SelectorBase &
  Readonly<{ generationReceiptHash: string }>;

type CurrentPointer = SelectorIdentity;

type PayloadManifestEntry = Readonly<{
  hash: Sha256;
  path: string;
}>;

export type CatalogGenerationReceiptV1 = Readonly<{
  abi: Readonly<{
    artifactAbi: string;
    runtimeAbi: string;
  }>;
  compilerHash: Sha256;
  generationInputHash: Sha256;
  icuHash: Sha256;
  payload: Readonly<{
    contentHash: Sha256;
    directory: string;
    manifest: ReadonlyArray<PayloadManifestEntry>;
    manifestHash: Sha256;
  }>;
  pointerBase: SelectorBase;
  selectorBase: SelectorBase;
  schemaVersion: 1;
}>;

type PublicationLockMetadata = Readonly<{
  acquiredAtMs: number;
  ownerToken: string;
  pid: number;
  processStartedAtMs: number;
  schemaVersion: 1;
}>;

type PublicationLockSnapshot = Readonly<{
  birthtimeMs: number;
  content: string;
  ctimeMs: number;
  device: number;
  inode: number;
  mtimeMs: number;
  size: number;
}>;

export type PublicationLockRecoveryHooks = Readonly<{
  afterClaim?(): Promise<void> | void;
}>;

const selectorPrefix = "// @mirai-intl-selector ";
const publicationLockAttempts = 1_000;
const publicationLockRetryMs = 10;
const publicationRecoveryClaimStaleAfterMs = 5_000;
const publicationLockStaleAfterMs = 30_000;
const processStartedAtMs = Math.round(Date.now() - process.uptime() * 1_000);
const emptyPublicationLockRecoveryHooks: PublicationLockRecoveryHooks =
  Object.freeze({});

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function errorCode(error: unknown): unknown {
  return error && typeof error === "object"
    ? Reflect.get(error, "code")
    : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function isSamePath(left: string, right: string): boolean {
  return relative(left, right) === "" && relative(right, left) === "";
}

async function prospectiveCanonicalRoot(root: string): Promise<string> {
  let existingPath = resolve(root);
  const missingSegments: Array<string> = [];
  for (;;) {
    try {
      return resolve(await realpath(existingPath), ...missingSegments);
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      let existingEntry = false;
      try {
        await lstat(existingPath);
        existingEntry = true;
      } catch (entryError) {
        const entryCode = errorCode(entryError);
        if (entryCode !== "ENOENT" && entryCode !== "ENOTDIR") {
          throw entryError;
        }
      }
      if (existingEntry) {
        throw new Error("Unable to resolve generated output root", {
          cause: error,
        });
      }
      const parent = dirname(existingPath);
      if (parent === existingPath) {
        throw new Error("Unable to resolve generated output root", {
          cause: error,
        });
      }
      missingSegments.unshift(basename(existingPath));
      existingPath = parent;
    }
  }
}

async function expectedOutputRoot(
  root: string,
  options: ArtifactWriterOptions
): Promise<string> {
  const expected = options.expectedCanonicalRoot
    ? resolve(options.expectedCanonicalRoot)
    : await prospectiveCanonicalRoot(root);
  const prospective = await prospectiveCanonicalRoot(root);
  if (!isSamePath(expected, prospective)) {
    throw new Error(
      "Generated output root canonical path changed from its expected location"
    );
  }
  return expected;
}

async function canonicalOutputRoot(
  root: string,
  expected: string
): Promise<string> {
  const stats = await lstat(root);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Generated output root must be a non-symlink directory");
  }
  const canonical = await realpath(root);
  if (!isSamePath(expected, canonical)) {
    throw new Error(
      "Generated output root canonical path changed from its expected location"
    );
  }
  return canonical;
}

async function assertConfinedDirectory(
  outputRoot: string,
  directory: string,
  label: string,
  allowMissing = false
): Promise<boolean> {
  try {
    const stats = await lstat(directory);
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must not be a symbolic link`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`${label} must be a directory`);
    }
    const canonicalDirectory = await realpath(directory);
    if (!isWithin(outputRoot, canonicalDirectory)) {
      throw new Error(`${label} escapes the generated output root`);
    }
    return true;
  } catch (error) {
    if (allowMissing && errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function readManagedTextFile(
  outputRoot: string,
  file: string,
  label: string
): Promise<string | undefined> {
  try {
    const stats = await lstat(file);
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must not be a symbolic link`);
    }
    if (!stats.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
    const canonicalFile = await realpath(file);
    if (!isWithin(outputRoot, canonicalFile)) {
      throw new Error(`${label} escapes the generated output root`);
    }
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

const flatArtifactName = /^[\dA-Za-z][\dA-Za-z._-]*$/u;

function artifactEntries(
  artifacts: EmittedArtifacts
): ReadonlyArray<readonly [string, string]> {
  const prototype = Object.getPrototypeOf(artifacts);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Generated artifacts must be a plain object");
  }
  if (Object.getOwnPropertySymbols(artifacts).length > 0) {
    throw new TypeError("Generated artifacts must not contain symbol keys");
  }
  const descriptors = Object.getOwnPropertyDescriptors(artifacts);
  const names = Object.keys(descriptors).toSorted(compareStrings);
  if (names.length === 0) {
    throw new TypeError("Generated artifacts must not be empty");
  }
  return names.map((name) => {
    if (
      name.length > 255 ||
      name === "." ||
      name === ".." ||
      name.includes("/") ||
      name.includes("\\") ||
      !flatArtifactName.test(name)
    ) {
      throw new TypeError(
        `Generated artifact ${JSON.stringify(name)} must be a safe flat file name`
      );
    }
    const descriptor = descriptors[name];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string"
    ) {
      throw new TypeError(
        `Generated artifact ${JSON.stringify(name)} must be an enumerable string data property`
      );
    }
    return [name, descriptor.value] as const;
  });
}

export function artifactContentHash(
  artifacts: EmittedArtifacts
): `sha256:${string}` {
  return sha256(canonicalJson(Object.fromEntries(artifactEntries(artifacts))));
}

async function readCurrent(
  root: string,
  outputRoot: string
): Promise<CurrentPointer | undefined> {
  const content = await readManagedTextFile(
    outputRoot,
    join(root, "current.json"),
    "Generated current pointer"
  );
  if (content === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error("Generated current pointer is malformed", {
      cause: error,
    });
  }
  const identity = parseSelectorIdentity(value, "Generated current pointer");
  if (content !== `${canonicalJson(identity)}\n`) {
    throw new Error("Generated current pointer is noncanonical");
  }
  return identity;
}

function parseSelectorIdentity(
  value: unknown,
  label: string
): SelectorIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).toSorted(compareStrings);
  if (
    canonicalJson(keys) !==
    canonicalJson([
      "contentHash",
      "directory",
      "generationReceiptHash",
      "schemaVersion",
    ])
  ) {
    throw new Error(`${label} has unexpected fields`);
  }
  for (const key of keys) {
    if (!descriptors[key] || !("value" in descriptors[key])) {
      throw new Error(`${label}.${key} must be a data property`);
    }
  }
  const contentHash: unknown = Reflect.get(value, "contentHash");
  const directory: unknown = Reflect.get(value, "directory");
  const generationReceiptHash: unknown = Reflect.get(
    value,
    "generationReceiptHash"
  );
  const schemaVersion: unknown = Reflect.get(value, "schemaVersion");
  if (
    typeof contentHash !== "string" ||
    typeof directory !== "string" ||
    typeof generationReceiptHash !== "string" ||
    !generationReceiptHash.startsWith("sha256:") ||
    schemaVersion !== 2
  ) {
    throw new Error(`${label} has invalid identity fields`);
  }
  return { contentHash, directory, generationReceiptHash, schemaVersion };
}

function catalogLockContent(
  contentHash: `sha256:${string}`,
  directory: string,
  generationReceiptHash: Sha256
): string {
  return `${canonicalJson({
    contentHash,
    directory,
    generationReceiptHash,
    schemaVersion: 2,
  })}\n`;
}

async function readSelector(
  root: string,
  outputRoot: string,
  strict = true
): Promise<SelectorIdentity | undefined> {
  const source = await readManagedTextFile(
    outputRoot,
    join(root, "index.ts"),
    "Generated stable facade"
  );
  if (source === undefined) {
    return undefined;
  }
  const firstLine = source.slice(0, source.indexOf("\n"));
  if (!firstLine.startsWith(selectorPrefix)) {
    if (!strict) {
      return undefined;
    }
    throw new Error("Generated stable facade is missing its selector identity");
  }
  let value: unknown;
  try {
    value = JSON.parse(firstLine.slice(selectorPrefix.length)) as unknown;
  } catch (error) {
    if (!strict) {
      return undefined;
    }
    throw new Error("Generated stable facade selector identity is malformed", {
      cause: error,
    });
  }
  return parseSelectorIdentity(value, "Generated stable facade selector");
}

function assertStableFacadeOptions(facade: StableFacadeOptions): void {
  if (facade.exports.length > 0) {
    throw new TypeError(
      "Stable facade descriptor exports are private; use the named-key CatalogContract"
    );
  }
}

function stableFacadeModule(
  relativeDirectory: string,
  facade: StableFacadeOptions,
  contentHash: `sha256:${string}`,
  generationReceiptHash: Sha256
): string {
  assertStableFacadeOptions(facade);
  return [
    `${selectorPrefix}${canonicalJson({
      contentHash,
      directory: relativeDirectory,
      generationReceiptHash,
      schemaVersion: 2,
    })}`,
    generatedSourceHeader,
    'import { bindFormErrorTranslator, bindFormSchema, bindRecoveringFormErrorTranslator, bindRecoveringTranslationKeyFactory, bindRecoveringTranslationKeyParser, bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl/runtime";',
    'import type { ArgumentFreeTextKeysFor, NamespacePaths } from "@openmirai/intl/types";',
    `import type { CatalogContract as BoundCatalogContract } from "./${relativeDirectory}/catalog.schema.gen.js";`,
    `export type { CatalogContract } from "./${relativeDirectory}/catalog.schema.gen.js";`,
    `export type { CatalogLocale } from "./${relativeDirectory}/catalog.resources.gen.mjs";`,
    "export type TranslationNamespace = NamespacePaths<BoundCatalogContract>;",
    "export type TranslationKey<Namespace extends TranslationNamespace> = ArgumentFreeTextKeysFor<BoundCatalogContract, Namespace>;",
    'const __miraiIntlProduction = process.env.NODE_ENV === "production";',
    "export const createTranslationKey = /* @__PURE__ */ (__miraiIntlProduction ? bindRecoveringTranslationKeyFactory<BoundCatalogContract>() : bindTranslationKeyFactory<BoundCatalogContract>());",
    "export const parseTranslationKey = /* @__PURE__ */ (__miraiIntlProduction ? bindRecoveringTranslationKeyParser<BoundCatalogContract>() : bindTranslationKeyParser<BoundCatalogContract>());",
    "export const createFormErrorTranslator = /* @__PURE__ */ (__miraiIntlProduction ? bindRecoveringFormErrorTranslator<BoundCatalogContract>() : bindFormErrorTranslator<BoundCatalogContract>());",
    "export const createFormSchema = /* @__PURE__ */ bindFormSchema<BoundCatalogContract>();",
    `export { catalogManifest } from "./${relativeDirectory}/catalog.manifest.gen.mjs";`,
    `export { isCatalogLocale, loadCatalogResource } from "./${relativeDirectory}/catalog.resources.gen.mjs";`,
    "",
  ].join("\n");
}

async function replaceTextFile(
  root: string,
  name: string,
  content: string
): Promise<void> {
  const temporary = join(root, `.${name}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temporary, join(root, name));
        break;
      } catch (error) {
        const code =
          error && typeof error === "object"
            ? Reflect.get(error, "code")
            : undefined;
        if (attempt >= 4 || (code !== "EBUSY" && code !== "EPERM")) {
          throw error;
        }
        await delay((attempt + 1) * 10);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

function parsePublicationLock(
  source: string,
  label: string
): PublicationLockMetadata {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`${label} is malformed`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).toSorted(compareStrings);
  if (
    canonicalJson(keys) !==
    canonicalJson([
      "acquiredAtMs",
      "ownerToken",
      "pid",
      "processStartedAtMs",
      "schemaVersion",
    ])
  ) {
    throw new Error(`${label} has unexpected fields`);
  }
  for (const key of keys) {
    if (!descriptors[key] || !("value" in descriptors[key])) {
      throw new Error(`${label}.${key} must be a data property`);
    }
  }
  const acquiredAtMs: unknown = Reflect.get(value, "acquiredAtMs");
  const ownerToken: unknown = Reflect.get(value, "ownerToken");
  const pid: unknown = Reflect.get(value, "pid");
  const ownerProcessStartedAtMs: unknown = Reflect.get(
    value,
    "processStartedAtMs"
  );
  const schemaVersion: unknown = Reflect.get(value, "schemaVersion");
  if (
    typeof acquiredAtMs !== "number" ||
    !Number.isSafeInteger(acquiredAtMs) ||
    typeof ownerToken !== "string" ||
    ownerToken.length === 0 ||
    typeof pid !== "number" ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    typeof ownerProcessStartedAtMs !== "number" ||
    !Number.isSafeInteger(ownerProcessStartedAtMs) ||
    schemaVersion !== 1
  ) {
    throw new Error(`${label} has invalid ownership metadata`);
  }
  return {
    acquiredAtMs,
    ownerToken,
    pid,
    processStartedAtMs: ownerProcessStartedAtMs,
    schemaVersion,
  };
}

function publicationOwnerIsAlive(owner: PublicationLockMetadata): boolean {
  if (owner.pid === process.pid) {
    return owner.processStartedAtMs === processStartedAtMs;
  }
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function samePublicationLock(
  left: PublicationLockSnapshot,
  right: PublicationLockSnapshot
): boolean {
  return (
    left.birthtimeMs === right.birthtimeMs &&
    left.content === right.content &&
    left.ctimeMs === right.ctimeMs &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

function samePublicationLockInode(
  left: Pick<PublicationLockSnapshot, "device" | "inode">,
  right: Pick<PublicationLockSnapshot, "device" | "inode">
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

async function publicationLockSnapshot(
  outputRoot: string,
  lockPath: string,
  label = "Generated catalog publication lock"
): Promise<PublicationLockSnapshot | undefined> {
  const content = await readManagedTextFile(outputRoot, lockPath, label);
  if (content === undefined) {
    return undefined;
  }
  let stats: Awaited<ReturnType<typeof lstat>>;
  try {
    stats = await lstat(lockPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a non-symlink regular file`);
  }
  let canonicalLock: string;
  try {
    canonicalLock = await realpath(lockPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  if (!isWithin(outputRoot, canonicalLock)) {
    throw new Error(`${label} escapes the generated output root`);
  }
  return {
    birthtimeMs: stats.birthtimeMs,
    content,
    ctimeMs: stats.ctimeMs,
    device: stats.dev,
    inode: stats.ino,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function stalePublicationLock(snapshot: PublicationLockSnapshot): boolean {
  try {
    return !publicationOwnerIsAlive(
      parsePublicationLock(
        snapshot.content,
        "Generated catalog publication lock"
      )
    );
  } catch {
    return Date.now() - snapshot.mtimeMs >= publicationLockStaleAfterMs;
  }
}

export async function recoverStalePublicationLock(
  outputRoot: string,
  lockPath: string,
  hooks: PublicationLockRecoveryHooks = emptyPublicationLockRecoveryHooks
): Promise<boolean> {
  const before = await publicationLockSnapshot(outputRoot, lockPath);
  if (before === undefined) {
    return true;
  }
  if (!stalePublicationLock(before)) {
    return false;
  }

  const recoveryPath = `${lockPath}.recovering`;
  try {
    await link(lockPath, recoveryPath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return true;
    }
    if (code === "EEXIST") {
      return false;
    }
    throw error;
  }

  try {
    const claim = await publicationLockSnapshot(outputRoot, recoveryPath);
    if (
      claim === undefined ||
      !samePublicationLockInode(before, claim) ||
      before.content !== claim.content ||
      !stalePublicationLock(claim)
    ) {
      return false;
    }

    await hooks.afterClaim?.();

    const [current, confirmedClaim] = await Promise.all([
      publicationLockSnapshot(outputRoot, lockPath),
      publicationLockSnapshot(outputRoot, recoveryPath),
    ]);
    if (current === undefined) {
      return true;
    }
    if (
      confirmedClaim === undefined ||
      !samePublicationLock(claim, confirmedClaim) ||
      !samePublicationLockInode(current, confirmedClaim) ||
      current.content !== confirmedClaim.content
    ) {
      return false;
    }
    await rm(lockPath);
    return true;
  } finally {
    const claim = await publicationLockSnapshot(outputRoot, recoveryPath);
    if (
      claim &&
      samePublicationLockInode(before, claim) &&
      before.content === claim.content
    ) {
      await rm(recoveryPath, { force: true });
    }
  }
}

async function recoveryClaimExists(recoveryPath: string): Promise<boolean> {
  return (
    (await publicationLockSnapshot(
      dirname(recoveryPath),
      recoveryPath,
      "Generated catalog publication recovery claim"
    )) !== undefined
  );
}

async function recoverAbandonedRecoveryClaim(
  outputRoot: string,
  recoveryPath: string
): Promise<boolean> {
  const claim = await publicationLockSnapshot(
    outputRoot,
    recoveryPath,
    "Generated catalog publication recovery claim"
  );
  if (claim === undefined) {
    return true;
  }
  if (Date.now() - claim.ctimeMs < publicationRecoveryClaimStaleAfterMs) {
    return false;
  }
  await removePublicationLockIfOwned(recoveryPath, claim);
  return !(await recoveryClaimExists(recoveryPath));
}

async function removePublicationLockIfOwned(
  lockPath: string,
  owner: Pick<PublicationLockSnapshot, "device" | "inode">
): Promise<void> {
  try {
    const stats = await lstat(lockPath);
    if (stats.dev === owner.device && stats.ino === owner.inode) {
      await rm(lockPath);
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

async function installPublicationLock(
  outputRoot: string,
  lockPath: string,
  recoveryPath: string,
  ownerToken: string,
  content: string
): Promise<boolean> {
  const candidatePath = join(
    outputRoot,
    `.publish.lock.${ownerToken}.candidate`
  );
  const handle = await open(candidatePath, "wx", 0o600);
  let accepted = false;
  let candidateIdentity:
    | Readonly<{ device: number; inode: number }>
    | undefined;
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    const candidateStats = await handle.stat();
    candidateIdentity = {
      device: candidateStats.dev,
      inode: candidateStats.ino,
    };
    try {
      await link(candidatePath, lockPath);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        return false;
      }
      throw error;
    }

    if (await recoveryClaimExists(recoveryPath)) {
      await removePublicationLockIfOwned(lockPath, candidateIdentity);
      return false;
    }

    const lockStats = await lstat(lockPath);
    if (
      lockStats.dev !== candidateIdentity.device ||
      lockStats.ino !== candidateIdentity.inode
    ) {
      throw new Error(
        "Generated catalog publication lock identity changed during acquisition"
      );
    }
    accepted = true;
    return true;
  } finally {
    if (!accepted && candidateIdentity) {
      await removePublicationLockIfOwned(lockPath, candidateIdentity);
    }
    await handle.close();
    await rm(candidatePath, { force: true });
  }
}

async function releasePublicationLock(
  outputRoot: string,
  lockPath: string,
  ownerToken: string
): Promise<void> {
  const before = await publicationLockSnapshot(outputRoot, lockPath);
  if (before === undefined) {
    throw new Error("Generated catalog publication lock disappeared");
  }
  const owner = parsePublicationLock(
    before.content,
    "Generated catalog publication lock"
  );
  if (owner.ownerToken !== ownerToken) {
    throw new Error("Generated catalog publication lock ownership changed");
  }
  const after = await publicationLockSnapshot(outputRoot, lockPath);
  if (after === undefined || !samePublicationLock(before, after)) {
    throw new Error("Generated catalog publication lock ownership changed");
  }
  await rm(lockPath);
}

async function withPublicationLock<Value>(
  root: string,
  outputRoot: string,
  operation: (ownerToken: string) => Promise<Value>
): Promise<Value> {
  await canonicalOutputRoot(root, outputRoot);
  await assertConfinedDirectory(outputRoot, root, "Generated output root");
  const lockPath = join(outputRoot, ".publish.lock");
  const recoveryPath = `${lockPath}.recovering`;
  if (!isWithin(outputRoot, lockPath) || !isWithin(outputRoot, recoveryPath)) {
    throw new Error(
      "Generated catalog publication lock escapes the generated output root"
    );
  }
  const ownerToken = randomUUID();
  const metadata: PublicationLockMetadata = {
    acquiredAtMs: Date.now(),
    ownerToken,
    pid: process.pid,
    processStartedAtMs,
    schemaVersion: 1,
  };
  const content = `${canonicalJson(metadata)}\n`;
  let acquired = false;
  for (let attempt = 0; attempt < publicationLockAttempts; attempt += 1) {
    await canonicalOutputRoot(root, outputRoot);
    if (!(await recoverAbandonedRecoveryClaim(outputRoot, recoveryPath))) {
      if (attempt === publicationLockAttempts - 1) {
        throw new Error("Unable to acquire generated catalog publication lock");
      }
      await delay(publicationLockRetryMs);
      continue;
    }
    acquired = await installPublicationLock(
      outputRoot,
      lockPath,
      recoveryPath,
      ownerToken,
      content
    );
    if (acquired) {
      break;
    }
    if (await recoverStalePublicationLock(outputRoot, lockPath)) {
      continue;
    }
    if (attempt === publicationLockAttempts - 1) {
      throw new Error("Unable to acquire generated catalog publication lock");
    }
    await delay(publicationLockRetryMs);
  }
  if (!acquired) {
    throw new Error("Unable to acquire generated catalog publication lock");
  }
  try {
    return await operation(ownerToken);
  } finally {
    await releasePublicationLock(outputRoot, lockPath, ownerToken);
  }
}

type PublicationPlan = Readonly<{
  contentHash: Sha256;
  destination: string;
  directoryName: string;
  identity: CatalogGenerationIdentity;
  lockContent: string;
  manifest: ReadonlyArray<PayloadManifestEntry>;
  pointerContent: string;
  receiptContent: string;
  receiptHash: Sha256;
  relativeDirectory: string;
  selectorContent: string;
}>;

type PublicationJournal = Readonly<{
  expectedPublicationHash: Sha256;
  ownerToken: string;
  previousDirectory: string | null;
  schemaVersion: 1;
  stageDirectory: string;
  state: PublicationState;
}>;

const publicationDirectoryName = ".catalog-publication";
const journalFileName = "journal.v1.json";
const receiptFileName = "catalog-generation-receipt.v1.json";
const publicationStates: ReadonlyArray<PublicationState> = [
  "PREPARED",
  "STAGED_DURABLE",
  "PAYLOAD_INSTALLED",
  "SELECTORS_INSTALLED",
  "RECEIPT_INSTALLED",
  "POINTER_COMMITTED",
  "VALIDATED",
];

function deterministicArtifactIdentity(
  contentHash: Sha256
): CatalogGenerationIdentity {
  return Object.freeze({
    artifactAbi: "artifact-only:v1",
    compilerHash: sha256("artifact-only:compiler:v1"),
    generationInputHash: sha256(
      canonicalJson({ contentHash, mode: "artifact-only" })
    ),
    icuHash: sha256("artifact-only:icu:v1"),
    runtimeAbi: "artifact-only:v1",
  });
}

function assertSha256(value: string, label: string): asserts value is Sha256 {
  if (!/^sha256:[\da-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 identity`);
  }
}

function generationIdentity(
  contentHash: Sha256,
  options: ArtifactWriterOptions
): CatalogGenerationIdentity {
  const identity =
    options.generationIdentity ?? deterministicArtifactIdentity(contentHash);
  assertSha256(identity.compilerHash, "Compiler hash");
  assertSha256(identity.generationInputHash, "Generation input hash");
  assertSha256(identity.icuHash, "ICU hash");
  if (identity.artifactAbi.length === 0 || identity.runtimeAbi.length === 0) {
    throw new Error("Generation ABI identities must not be empty");
  }
  return Object.freeze({ ...identity });
}

function payloadManifest(
  artifacts: EmittedArtifacts
): ReadonlyArray<PayloadManifestEntry> {
  return artifactEntries(artifacts).map(([path, content]) =>
    Object.freeze({ hash: sha256(content), path })
  );
}

function publicationPlan(
  root: string,
  artifacts: EmittedArtifacts,
  facade: StableFacadeOptions,
  options: ArtifactWriterOptions
): PublicationPlan {
  const contentHash = artifactContentHash(artifacts);
  const directoryName = contentHash.slice(7);
  const relativeDirectory = `builds/${directoryName}`;
  const destination = join(root, relativeDirectory);
  const manifest = payloadManifest(artifacts);
  const identity = generationIdentity(contentHash, options);
  const selectorBase: SelectorBase = {
    contentHash,
    directory: relativeDirectory,
    schemaVersion: 2,
  };
  const receipt: CatalogGenerationReceiptV1 = {
    abi: {
      artifactAbi: identity.artifactAbi,
      runtimeAbi: identity.runtimeAbi,
    },
    compilerHash: identity.compilerHash,
    generationInputHash: identity.generationInputHash,
    icuHash: identity.icuHash,
    payload: {
      contentHash,
      directory: relativeDirectory,
      manifest,
      manifestHash: sha256(canonicalJson(manifest)),
    },
    pointerBase: selectorBase,
    schemaVersion: 1,
    selectorBase,
  };
  const receiptContent = `${canonicalJson(receipt)}\n`;
  const receiptHash = sha256(receiptContent);
  const pointer: CurrentPointer = {
    ...selectorBase,
    generationReceiptHash: receiptHash,
  };
  return Object.freeze({
    contentHash,
    destination,
    directoryName,
    identity,
    lockContent: catalogLockContent(
      contentHash,
      relativeDirectory,
      receiptHash
    ),
    manifest,
    pointerContent: `${canonicalJson(pointer)}\n`,
    receiptContent,
    receiptHash,
    relativeDirectory,
    selectorContent: stableFacadeModule(
      relativeDirectory,
      facade,
      contentHash,
      receiptHash
    ),
  });
}

function expectedPublicationHash(plan: PublicationPlan): Sha256 {
  return sha256(
    canonicalJson({
      contentHash: plan.contentHash,
      identity: plan.identity,
      lockHash: sha256(plan.lockContent),
      manifest: plan.manifest,
      pointerHash: sha256(plan.pointerContent),
      receiptHash: plan.receiptHash,
      selectorHash: sha256(plan.selectorContent),
    })
  );
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (
      !(["EINVAL", "ENOTSUP", "EISDIR", "EBADF"] as const).includes(
        errorCode(error) as "EINVAL"
      )
    ) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function writeDurableFile(
  file: string,
  content: string,
  exclusive = true
): Promise<void> {
  await writeFile(file, content, {
    encoding: "utf8",
    flag: exclusive ? "wx" : "w",
    mode: 0o600,
  });
  const handle = await open(file, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableReplaceTextFile(
  root: string,
  name: string,
  content: string
): Promise<void> {
  await replaceTextFile(root, name, content);
  const handle = await open(join(root, name), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(root);
}

function journalContent(journal: PublicationJournal): string {
  return `${canonicalJson(journal)}\n`;
}

function parseJournal(source: string): PublicationJournal {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error("Generated publication journal is malformed", {
      cause: error,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Generated publication journal must be an object");
  }
  const keys = Object.keys(value).toSorted(compareStrings);
  if (
    canonicalJson(keys) !==
    canonicalJson([
      "expectedPublicationHash",
      "ownerToken",
      "previousDirectory",
      "schemaVersion",
      "stageDirectory",
      "state",
    ])
  ) {
    throw new Error("Generated publication journal has unexpected fields");
  }
  const expected = Reflect.get(value, "expectedPublicationHash");
  const ownerToken = Reflect.get(value, "ownerToken");
  const previousDirectory = Reflect.get(value, "previousDirectory");
  const schemaVersion = Reflect.get(value, "schemaVersion");
  const stageDirectory = Reflect.get(value, "stageDirectory");
  const state = Reflect.get(value, "state");
  if (
    typeof expected !== "string" ||
    typeof ownerToken !== "string" ||
    !/^[\da-f-]{36}$/u.test(ownerToken) ||
    (previousDirectory !== null && typeof previousDirectory !== "string") ||
    schemaVersion !== 1 ||
    typeof stageDirectory !== "string" ||
    stageDirectory !== `stage-${ownerToken}` ||
    typeof state !== "string" ||
    !publicationStates.includes(state as PublicationState)
  ) {
    throw new Error("Generated publication journal has invalid fields");
  }
  assertSha256(expected, "Publication journal expected hash");
  const journal: PublicationJournal = {
    expectedPublicationHash: expected,
    ownerToken,
    previousDirectory,
    schemaVersion,
    stageDirectory,
    state: state as PublicationState,
  };
  if (source !== journalContent(journal)) {
    throw new Error("Generated publication journal is noncanonical");
  }
  return journal;
}

async function assertPublicationArea(
  outputRoot: string,
  publicationRoot: string,
  journal: PublicationJournal | undefined
): Promise<void> {
  if (
    !(await assertConfinedDirectory(
      outputRoot,
      publicationRoot,
      "Generated publication staging area",
      true
    ))
  ) {
    return;
  }
  const entries = await readdir(publicationRoot, { withFileTypes: true });
  const allowed = new Set(
    journal ? [journalFileName, journal.stageDirectory] : []
  );
  for (const entry of entries) {
    if (!allowed.has(entry.name)) {
      throw new Error(
        `Generated publication staging area contains unexplained state: ${entry.name}`
      );
    }
    if (entry.name === journalFileName && !entry.isFile()) {
      throw new Error("Generated publication journal must be a regular file");
    }
    if (entry.name === journal?.stageDirectory && !entry.isDirectory()) {
      throw new Error("Generated publication stage must be a directory");
    }
  }
}

async function readJournal(
  outputRoot: string,
  publicationRoot: string
): Promise<PublicationJournal | undefined> {
  const source = await readManagedTextFile(
    outputRoot,
    join(publicationRoot, journalFileName),
    "Generated publication journal"
  );
  return source === undefined ? undefined : parseJournal(source);
}

async function persistJournal(
  publicationRoot: string,
  journal: PublicationJournal
): Promise<void> {
  await durableReplaceTextFile(
    publicationRoot,
    journalFileName,
    journalContent(journal)
  );
}

async function advanceJournal(
  publicationRoot: string,
  journal: PublicationJournal,
  state: PublicationState,
  hooks: PublicationFaultInjectionHooks | undefined
): Promise<PublicationJournal> {
  const next = Object.freeze({ ...journal, state });
  await persistJournal(publicationRoot, next);
  await hooks?.afterState?.(state);
  return next;
}

function receiptFromSource(source: string): CatalogGenerationReceiptV1 {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error("Catalog generation receipt is malformed", {
      cause: error,
    });
  }
  if (source !== `${canonicalJson(value)}\n`) {
    throw new Error("Catalog generation receipt is noncanonical");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.get(value, "schemaVersion") !== 1
  ) {
    throw new Error("Catalog generation receipt has an unsupported schema");
  }
  return value as CatalogGenerationReceiptV1;
}

async function assertPayloadManifest(
  outputRoot: string,
  destination: string,
  manifest: ReadonlyArray<PayloadManifestEntry>,
  label: string
): Promise<void> {
  await assertConfinedDirectory(outputRoot, destination, label);
  const entries = (
    await readdir(destination, { withFileTypes: true })
  ).toSorted((left, right) => compareStrings(left.name, right.name));
  if (entries.length !== manifest.length) {
    throw new Error(`${label} does not match its destination files`);
  }
  const seen = new Set<string>();
  for (const [index, expected] of manifest.entries()) {
    if (seen.has(expected.path)) {
      throw new Error(`${label} manifest contains a duplicate path`);
    }
    seen.add(expected.path);
    const entry = entries[index];
    if (!entry || entry.name !== expected.path || !entry.isFile()) {
      throw new Error(`${label} does not match its destination files`);
    }
    const source = await readManagedTextFile(
      outputRoot,
      join(destination, expected.path),
      `${label} file ${expected.path}`
    );
    if (source === undefined || sha256(source) !== expected.hash) {
      throw new Error(
        `${label} does not match its destination files: ${expected.path} is corrupt`
      );
    }
  }
}

async function exactTextFile(
  outputRoot: string,
  file: string,
  expected: string,
  label: string
): Promise<boolean> {
  const source = await readManagedTextFile(outputRoot, file, label);
  return source !== undefined && source === expected;
}

async function assertExactSelectors(
  root: string,
  outputRoot: string,
  plan: PublicationPlan
): Promise<void> {
  if (
    !(await exactTextFile(
      outputRoot,
      join(root, "index.ts"),
      plan.selectorContent,
      "Generated stable facade"
    )) ||
    !(await exactTextFile(
      outputRoot,
      join(root, "catalog.lock.json"),
      plan.lockContent,
      "Generated catalog lock"
    ))
  ) {
    throw new Error(
      "Generated stable facade selector or catalog lock is stale or tampered"
    );
  }
  for (const legacyName of ["index.mjs", "index.d.mts"] as const) {
    if (
      (await readManagedTextFile(
        outputRoot,
        join(root, legacyName),
        `Legacy generated facade ${legacyName}`
      )) !== undefined
    ) {
      throw new Error(`Generated stable facade has unexplained ${legacyName}`);
    }
  }
}

async function assertKnownBuilds(
  root: string,
  allowedDirectories: ReadonlyArray<string>
): Promise<void> {
  const buildsRoot = join(root, "builds");
  try {
    const entries = await readdir(buildsRoot, { withFileTypes: true });
    const allowed = new Set(allowedDirectories);
    for (const entry of entries) {
      if (!entry.isDirectory() || !allowed.has(entry.name)) {
        throw new Error(
          `Generated builds contain duplicate or unexplained state: ${entry.name}`
        );
      }
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

async function assertCommittedPlan(
  root: string,
  outputRoot: string,
  plan: PublicationPlan,
  previousDirectoryName?: string
): Promise<void> {
  const pointer = await readCurrent(root, outputRoot);
  const expectedPointer = JSON.parse(plan.pointerContent) as CurrentPointer;
  if (canonicalJson(pointer) !== canonicalJson(expectedPointer)) {
    throw new Error("Generated current pointer is stale or tampered");
  }
  await assertExactSelectors(root, outputRoot, plan);
  const receiptSource = await readManagedTextFile(
    outputRoot,
    join(root, receiptFileName),
    "Catalog generation receipt"
  );
  if (
    receiptSource === undefined ||
    sha256(receiptSource) !== plan.receiptHash ||
    receiptSource !== plan.receiptContent
  ) {
    throw new Error("Catalog generation receipt is stale or tampered");
  }
  receiptFromSource(receiptSource);
  await assertPayloadManifest(
    outputRoot,
    plan.destination,
    plan.manifest,
    "Generated artifact directory"
  );
  await assertKnownBuilds(
    root,
    [plan.directoryName, previousDirectoryName].filter(
      (value): value is string => value !== undefined
    )
  );
}

async function assertPreviousCommittedState(
  root: string,
  outputRoot: string,
  current: CurrentPointer
): Promise<void> {
  const selector = await readSelector(root, outputRoot);
  if (canonicalJson(selector) !== canonicalJson(current)) {
    throw new Error("Generated selector and current pointer disagree");
  }
  const lockSource = await readManagedTextFile(
    outputRoot,
    join(root, "catalog.lock.json"),
    "Generated catalog lock"
  );
  if (lockSource !== `${canonicalJson(current)}\n`) {
    throw new Error("Generated catalog lock and current pointer disagree");
  }
  const receiptSource = await readManagedTextFile(
    outputRoot,
    join(root, receiptFileName),
    "Catalog generation receipt"
  );
  if (
    receiptSource === undefined ||
    sha256(receiptSource) !== current.generationReceiptHash
  ) {
    throw new Error(
      "Selected catalog generation receipt is missing or corrupt"
    );
  }
  const receipt = receiptFromSource(receiptSource);
  if (
    canonicalJson(receipt.pointerBase) !==
      canonicalJson({
        contentHash: current.contentHash,
        directory: current.directory,
        schemaVersion: 2,
      }) ||
    receipt.payload.contentHash !== current.contentHash ||
    receipt.payload.directory !== current.directory ||
    receipt.payload.manifestHash !==
      sha256(canonicalJson(receipt.payload.manifest))
  ) {
    throw new Error("Selected catalog receipt identities disagree");
  }
  const destination = join(root, current.directory);
  await assertPayloadManifest(
    outputRoot,
    destination,
    receipt.payload.manifest,
    "Selected generated artifact directory"
  );
  await assertKnownBuilds(root, [basename(current.directory)]);
}

async function inspectInitialState(
  root: string,
  outputRoot: string,
  plan: PublicationPlan
): Promise<CurrentPointer | undefined> {
  const current = await readCurrent(root, outputRoot);
  const controlNames = [
    "index.ts",
    "catalog.lock.json",
    receiptFileName,
  ] as const;
  if (!current) {
    for (const name of controlNames) {
      if (
        (await readManagedTextFile(
          outputRoot,
          join(root, name),
          `Generated control file ${name}`
        )) !== undefined
      ) {
        throw new Error(
          `Generated state contains unexplained control file ${name}`
        );
      }
    }
    await assertKnownBuilds(root, []);
    return undefined;
  }

  const expected = JSON.parse(plan.pointerContent) as CurrentPointer;
  if (canonicalJson(current) !== canonicalJson(expected)) {
    await assertPreviousCommittedState(root, outputRoot, current);
    return current;
  }

  await assertExactSelectors(root, outputRoot, plan);
  const payloadExists = await assertConfinedDirectory(
    outputRoot,
    plan.destination,
    "Generated artifact directory",
    true
  );
  if (payloadExists) {
    await assertPayloadManifest(
      outputRoot,
      plan.destination,
      plan.manifest,
      "Generated artifact directory"
    );
  }
  await assertKnownBuilds(root, payloadExists ? [plan.directoryName] : []);
  const receiptSource = await readManagedTextFile(
    outputRoot,
    join(root, receiptFileName),
    "Catalog generation receipt"
  );
  if (receiptSource !== undefined) {
    try {
      receiptFromSource(receiptSource);
      if (
        receiptSource !== plan.receiptContent ||
        sha256(receiptSource) !== current.generationReceiptHash
      ) {
        throw new Error("Catalog generation receipt hash disagrees");
      }
    } catch (error) {
      if (
        current.generationReceiptHash !== plan.receiptHash ||
        !payloadExists
      ) {
        throw error;
      }
    }
  } else if (
    current.generationReceiptHash !== plan.receiptHash ||
    !payloadExists
  ) {
    if (!payloadExists) {
      return current;
    }
    throw new Error(
      "Catalog generation receipt is missing and cannot be reconstructed"
    );
  }
  return current;
}

async function createStage(
  root: string,
  outputRoot: string,
  publicationRoot: string,
  journal: PublicationJournal,
  artifacts: EmittedArtifacts,
  plan: PublicationPlan
): Promise<void> {
  const stageRoot = join(publicationRoot, journal.stageDirectory);
  const payloadRoot = join(stageRoot, "payload");
  const controlsRoot = join(stageRoot, "controls");
  if (!isWithin(outputRoot, stageRoot)) {
    throw new Error("Generated publication stage escapes the output root");
  }
  await rm(stageRoot, { force: true, recursive: true });
  await mkdir(stageRoot);
  await mkdir(payloadRoot);
  await mkdir(controlsRoot);
  try {
    for (const [name, content] of artifactEntries(artifacts)) {
      await writeDurableFile(join(payloadRoot, name), content);
    }
    await writeDurableFile(
      join(controlsRoot, "index.ts"),
      plan.selectorContent
    );
    await writeDurableFile(
      join(controlsRoot, "catalog.lock.json"),
      plan.lockContent
    );
    await writeDurableFile(
      join(controlsRoot, receiptFileName),
      plan.receiptContent
    );
    await writeDurableFile(
      join(controlsRoot, "current.json"),
      plan.pointerContent
    );
    await syncDirectory(payloadRoot);
    await syncDirectory(controlsRoot);
    await syncDirectory(stageRoot);
    await syncDirectory(publicationRoot);
    await assertPayloadManifest(
      outputRoot,
      payloadRoot,
      plan.manifest,
      "Staged generated artifact directory"
    );
    for (const [name, content] of [
      ["index.ts", plan.selectorContent],
      ["catalog.lock.json", plan.lockContent],
      [receiptFileName, plan.receiptContent],
      ["current.json", plan.pointerContent],
    ] as const) {
      if (
        !(await exactTextFile(
          outputRoot,
          join(controlsRoot, name),
          content,
          `Staged control file ${name}`
        ))
      ) {
        throw new Error(`Staged control file ${name} is corrupt`);
      }
    }
  } catch (error) {
    await rm(stageRoot, { force: true, recursive: true });
    throw error;
  }
}

async function installStagedFile(
  outputRoot: string,
  stagedFile: string,
  destination: string,
  expected: string,
  label: string
): Promise<void> {
  const staged = await readManagedTextFile(outputRoot, stagedFile, label);
  if (staged === undefined) {
    if (await exactTextFile(outputRoot, destination, expected, label)) {
      return;
    }
    throw new Error(`${label} is missing from both stage and destination`);
  }
  if (staged !== expected) {
    throw new Error(`${label} staged bytes are corrupt`);
  }
  await rename(stagedFile, destination);
  await syncDirectory(dirname(destination));
  if (!(await exactTextFile(outputRoot, destination, expected, label))) {
    throw new Error(`${label} installed bytes are corrupt`);
  }
}

async function installPayload(
  root: string,
  outputRoot: string,
  stageRoot: string,
  plan: PublicationPlan
): Promise<void> {
  const buildsRoot = join(root, "builds");
  if (
    !(await assertConfinedDirectory(
      outputRoot,
      buildsRoot,
      "Generated builds directory",
      true
    ))
  ) {
    await mkdir(buildsRoot);
    await syncDirectory(root);
  }
  const stagedPayload = join(stageRoot, "payload");
  if (
    await assertConfinedDirectory(
      outputRoot,
      stagedPayload,
      "Staged generated artifact directory",
      true
    )
  ) {
    await assertPayloadManifest(
      outputRoot,
      stagedPayload,
      plan.manifest,
      "Staged generated artifact directory"
    );
    try {
      await rename(stagedPayload, plan.destination);
      await syncDirectory(buildsRoot);
    } catch (error) {
      if (errorCode(error) !== "EEXIST" && errorCode(error) !== "ENOTEMPTY") {
        throw error;
      }
    }
  }
  await assertPayloadManifest(
    outputRoot,
    plan.destination,
    plan.manifest,
    "Generated artifact directory"
  );
}

async function removePreviousPayload(
  root: string,
  outputRoot: string,
  previousDirectory: string | null,
  selectedDirectory: string
): Promise<void> {
  if (!previousDirectory || previousDirectory === selectedDirectory) {
    return;
  }
  if (
    !previousDirectory.startsWith("builds/") ||
    basename(previousDirectory) === ""
  ) {
    throw new Error("Publication journal previous payload identity is invalid");
  }
  const previous = join(outputRoot, previousDirectory);
  if (!isWithin(outputRoot, previous)) {
    throw new Error("Previous generated payload escapes the output root");
  }
  await assertConfinedDirectory(
    outputRoot,
    previous,
    "Previous generated artifact directory"
  );
  await rm(previous, { recursive: true });
  await syncDirectory(join(root, "builds"));
}

async function runPublication(
  root: string,
  outputRoot: string,
  ownerToken: string,
  artifacts: EmittedArtifacts,
  plan: PublicationPlan,
  options: ArtifactWriterOptions
): Promise<WriteResult> {
  const publicationRoot = join(outputRoot, publicationDirectoryName);
  if (
    !(await assertConfinedDirectory(
      outputRoot,
      publicationRoot,
      "Generated publication staging area",
      true
    ))
  ) {
    await mkdir(publicationRoot);
    await syncDirectory(root);
  }

  let journal = await readJournal(outputRoot, publicationRoot);
  await assertPublicationArea(outputRoot, publicationRoot, journal);
  if (journal) {
    if (journal.expectedPublicationHash !== expectedPublicationHash(plan)) {
      throw new Error(
        "Interrupted publication does not match the exact expected generation"
      );
    }
  } else {
    const current = await inspectInitialState(root, outputRoot, plan);
    const expectedPointer = JSON.parse(plan.pointerContent) as CurrentPointer;
    if (current && canonicalJson(current) === canonicalJson(expectedPointer)) {
      try {
        await assertCommittedPlan(root, outputRoot, plan);
        await rm(publicationRoot, { recursive: true });
        await syncDirectory(root);
        return {
          changed: false,
          contentHash: plan.contentHash,
          directory: plan.destination,
        };
      } catch {
        // Only exact expected bytes may be reconstructed through the journal.
      }
    }
    journal = {
      expectedPublicationHash: expectedPublicationHash(plan),
      ownerToken,
      previousDirectory: current?.directory ?? null,
      schemaVersion: 1,
      stageDirectory: `stage-${ownerToken}`,
      state: "PREPARED",
    };
    await writeDurableFile(
      join(publicationRoot, journalFileName),
      journalContent(journal)
    );
    await syncDirectory(publicationRoot);
    await options.publicationHooks?.afterState?.("PREPARED");
  }

  const stageRoot = join(publicationRoot, journal.stageDirectory);
  if (journal.state === "PREPARED") {
    await createStage(
      root,
      outputRoot,
      publicationRoot,
      journal,
      artifacts,
      plan
    );
    journal = await advanceJournal(
      publicationRoot,
      journal,
      "STAGED_DURABLE",
      options.publicationHooks
    );
  }
  if (journal.state === "STAGED_DURABLE") {
    await assertPayloadManifest(
      outputRoot,
      join(stageRoot, "payload"),
      plan.manifest,
      "Staged generated artifact directory"
    );
    await installPayload(root, outputRoot, stageRoot, plan);
    journal = await advanceJournal(
      publicationRoot,
      journal,
      "PAYLOAD_INSTALLED",
      options.publicationHooks
    );
  }
  if (journal.state === "PAYLOAD_INSTALLED") {
    await assertPayloadManifest(
      outputRoot,
      plan.destination,
      plan.manifest,
      "Generated artifact directory"
    );
    const controlsRoot = join(stageRoot, "controls");
    await installStagedFile(
      outputRoot,
      join(controlsRoot, "index.ts"),
      join(root, "index.ts"),
      plan.selectorContent,
      "Generated stable facade"
    );
    await installStagedFile(
      outputRoot,
      join(controlsRoot, "catalog.lock.json"),
      join(root, "catalog.lock.json"),
      plan.lockContent,
      "Generated catalog lock"
    );
    await assertExactSelectors(root, outputRoot, plan);
    journal = await advanceJournal(
      publicationRoot,
      journal,
      "SELECTORS_INSTALLED",
      options.publicationHooks
    );
  }
  if (journal.state === "SELECTORS_INSTALLED") {
    await assertExactSelectors(root, outputRoot, plan);
    await installStagedFile(
      outputRoot,
      join(stageRoot, "controls", receiptFileName),
      join(root, receiptFileName),
      plan.receiptContent,
      "Catalog generation receipt"
    );
    journal = await advanceJournal(
      publicationRoot,
      journal,
      "RECEIPT_INSTALLED",
      options.publicationHooks
    );
  }
  if (journal.state === "RECEIPT_INSTALLED") {
    const receiptSource = await readManagedTextFile(
      outputRoot,
      join(root, receiptFileName),
      "Catalog generation receipt"
    );
    if (
      receiptSource !== plan.receiptContent ||
      sha256(receiptSource) !== plan.receiptHash
    ) {
      throw new Error("Catalog generation receipt is corrupt before commit");
    }
    await installStagedFile(
      outputRoot,
      join(stageRoot, "controls", "current.json"),
      join(root, "current.json"),
      plan.pointerContent,
      "Generated current pointer"
    );
    journal = await advanceJournal(
      publicationRoot,
      journal,
      "POINTER_COMMITTED",
      options.publicationHooks
    );
  }
  if (journal.state === "POINTER_COMMITTED") {
    await assertCommittedPlan(
      root,
      outputRoot,
      plan,
      journal.previousDirectory
        ? basename(journal.previousDirectory)
        : undefined
    );
    journal = await advanceJournal(
      publicationRoot,
      journal,
      "VALIDATED",
      options.publicationHooks
    );
  }
  if (journal.state === "VALIDATED") {
    await assertCommittedPlan(
      root,
      outputRoot,
      plan,
      journal.previousDirectory
        ? basename(journal.previousDirectory)
        : undefined
    );
    await removePreviousPayload(
      root,
      outputRoot,
      journal.previousDirectory,
      plan.relativeDirectory
    );
    await assertKnownBuilds(root, [plan.directoryName]);
    await rm(stageRoot, { force: true, recursive: true });
    await rm(join(publicationRoot, journalFileName));
    await syncDirectory(publicationRoot);
    await rm(publicationRoot, { recursive: true });
    await syncDirectory(root);
  }

  return {
    changed: true,
    contentHash: plan.contentHash,
    directory: plan.destination,
  };
}

export async function verifyArtifactSet(
  root: string,
  artifacts: EmittedArtifacts,
  facade: StableFacadeOptions = emptyStableFacade,
  options: ArtifactWriterOptions = emptyWriterOptions
): Promise<WriteResult> {
  assertStableFacadeOptions(facade);
  const expected = await expectedOutputRoot(root, options);
  const outputRoot = await canonicalOutputRoot(root, expected);
  const plan = publicationPlan(root, artifacts, facade, options);
  const publicationRoot = join(outputRoot, publicationDirectoryName);
  const journal = await readJournal(outputRoot, publicationRoot);
  if (journal) {
    const current = await readCurrent(root, outputRoot);
    if (!current) {
      throw new Error("Generated catalog publication is interrupted");
    }
    await assertPreviousCommittedState(root, outputRoot, current);
    const expectedPointer = JSON.parse(plan.pointerContent) as CurrentPointer;
    if (canonicalJson(current) !== canonicalJson(expectedPointer)) {
      throw new Error("Generated catalog publication is interrupted");
    }
    return {
      changed: false,
      contentHash: plan.contentHash,
      directory: plan.destination,
    };
  }
  await assertPublicationArea(outputRoot, publicationRoot, undefined);
  await assertCommittedPlan(root, outputRoot, plan);
  return {
    changed: false,
    contentHash: plan.contentHash,
    directory: plan.destination,
  };
}

export async function writeArtifactSet(
  root: string,
  artifacts: EmittedArtifacts,
  facade: StableFacadeOptions = emptyStableFacade,
  options: ArtifactWriterOptions = emptyWriterOptions
): Promise<WriteResult> {
  assertStableFacadeOptions(facade);
  artifactContentHash(artifacts);
  const expected = await expectedOutputRoot(root, options);
  await mkdir(root, { recursive: true });
  const outputRoot = await canonicalOutputRoot(root, expected);
  const plan = publicationPlan(root, artifacts, facade, options);
  return withPublicationLock(root, outputRoot, (ownerToken) =>
    runPublication(root, outputRoot, ownerToken, artifacts, plan, {
      ...options,
      expectedCanonicalRoot: outputRoot,
    })
  );
}
