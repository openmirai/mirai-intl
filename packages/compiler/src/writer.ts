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
}>;

const emptyStableFacade: StableFacadeOptions = Object.freeze({ exports: [] });
const emptyWriterOptions: ArtifactWriterOptions = Object.freeze({});

type CurrentPointer = Readonly<{
  contentHash: string;
  directory: string;
}>;

type SelectorIdentity = CurrentPointer & Readonly<{ schemaVersion: 1 }>;

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
  try {
    const content = await readManagedTextFile(
      outputRoot,
      join(root, "current.json"),
      "Generated current pointer"
    );
    if (content === undefined) {
      return undefined;
    }
    const value: unknown = JSON.parse(content);
    if (
      value &&
      typeof value === "object" &&
      Object.hasOwn(value, "contentHash") &&
      typeof Reflect.get(value, "contentHash") === "string" &&
      Object.hasOwn(value, "directory") &&
      typeof Reflect.get(value, "directory") === "string"
    ) {
      return {
        contentHash: Reflect.get(value, "contentHash") as string,
        directory: Reflect.get(value, "directory") as string,
      };
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
  return undefined;
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
    canonicalJson(["contentHash", "directory", "schemaVersion"])
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
  const schemaVersion: unknown = Reflect.get(value, "schemaVersion");
  if (
    typeof contentHash !== "string" ||
    typeof directory !== "string" ||
    schemaVersion !== 1
  ) {
    throw new Error(`${label} has invalid identity fields`);
  }
  return { contentHash, directory, schemaVersion };
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
  contentHash: `sha256:${string}`
): string {
  assertStableFacadeOptions(facade);
  return [
    `${selectorPrefix}${canonicalJson({ contentHash, directory: relativeDirectory, schemaVersion: 1 })}`,
    'import { bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl-runtime";',
    `import type { CatalogContract as BoundCatalogContract } from "./${relativeDirectory}/catalog.schema.gen.js";`,
    `export type { CatalogContract } from "./${relativeDirectory}/catalog.schema.gen.js";`,
    `export type { CatalogLocale } from "./${relativeDirectory}/catalog.resources.gen.mjs";`,
    "export const createTranslationKey = /* @__PURE__ */ bindTranslationKeyFactory<BoundCatalogContract>();",
    "export const parseTranslationKey = /* @__PURE__ */ bindTranslationKeyParser<BoundCatalogContract>();",
    `export { catalogManifest } from "./${relativeDirectory}/catalog.manifest.gen.mjs";`,
    `export { isCatalogLocale, loadCatalogResource } from "./${relativeDirectory}/catalog.resources.gen.mjs";`,
    "",
  ].join("\n");
}

async function stableFacadeMatches(
  root: string,
  outputRoot: string,
  relativeDirectory: string,
  facade: StableFacadeOptions,
  contentHash: `sha256:${string}`
): Promise<boolean> {
  const expected = stableFacadeModule(relativeDirectory, facade, contentHash);
  try {
    const source = await readManagedTextFile(
      outputRoot,
      join(root, "index.ts"),
      "Generated stable facade"
    );
    if (source === undefined) {
      return false;
    }
    for (const legacyName of ["index.mjs", "index.d.mts"] as const) {
      const legacy = await readManagedTextFile(
        outputRoot,
        join(root, legacyName),
        `Legacy generated facade ${legacyName}`
      );
      if (legacy !== undefined) {
        return false;
      }
    }
    return source === expected;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function writeStableFacade(
  root: string,
  relativeDirectory: string,
  facade: StableFacadeOptions,
  contentHash: `sha256:${string}`
): Promise<void> {
  const content = stableFacadeModule(relativeDirectory, facade, contentHash);
  await replaceTextFile(root, "index.ts", content);
  await Promise.all(
    ["index.mjs", "index.d.mts"].map((name) =>
      rm(join(root, name), { force: true })
    )
  );
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
  operation: () => Promise<Value>
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
    return await operation();
  } finally {
    await releasePublicationLock(outputRoot, lockPath, ownerToken);
  }
}

async function pruneGeneratedState(
  outputRoot: string,
  buildsRoot: string,
  selectedDirectoryName: string
): Promise<boolean> {
  let changed = false;
  const buildEntries = await readdir(buildsRoot, { withFileTypes: true });
  const canonicalBuildsRoot = join(outputRoot, "builds");
  for (const entry of buildEntries) {
    if (entry.name === selectedDirectoryName) {
      continue;
    }
    const candidate = join(canonicalBuildsRoot, entry.name);
    if (!isWithin(outputRoot, candidate)) {
      throw new Error("Generated build cleanup escaped the output root");
    }
    await rm(candidate, { force: true, recursive: true });
    changed = true;
  }

  // Clean staging directories produced by compiler versions that staged next
  // to the generated root. The prefix is reserved for catalog publication.
  const parent = dirname(outputRoot);
  const temporaryPrefix = `.${basename(outputRoot)}.`;
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (
      !entry.name.startsWith(temporaryPrefix) ||
      !entry.name.endsWith(".tmp")
    ) {
      continue;
    }
    const candidate = join(parent, entry.name);
    if (!isSamePath(dirname(candidate), parent)) {
      throw new Error("Generated staging cleanup escaped its reserved parent");
    }
    await rm(candidate, { force: true, recursive: true });
    changed = true;
  }
  return changed;
}

async function assertSingleSelectedBuild(
  root: string,
  selectedDirectoryName: string
): Promise<void> {
  const builds = await readdir(join(root, "builds"));
  if (builds.length !== 1 || builds[0] !== selectedDirectoryName) {
    throw new Error(
      `Generated builds are stale: expected only ${selectedDirectoryName}, found ${builds.join(", ")}`
    );
  }
}

async function artifactSetMatches(
  outputRoot: string,
  destination: string,
  artifacts: EmittedArtifacts
): Promise<boolean> {
  try {
    if (
      !(await assertConfinedDirectory(
        outputRoot,
        destination,
        "Generated artifact directory",
        true
      ))
    ) {
      return false;
    }
    const expected = artifactEntries(artifacts);
    const actual = (
      await readdir(destination, { withFileTypes: true })
    ).toSorted((left, right) => compareStrings(left.name, right.name));
    if (actual.length !== expected.length) {
      return false;
    }
    for (const [index, [name, content]] of expected.entries()) {
      const entry = actual[index];
      if (!entry?.isFile() || entry.name !== name) {
        return false;
      }
      const actualContent = await readManagedTextFile(
        outputRoot,
        join(destination, name),
        `Generated artifact ${name}`
      );
      if (actualContent !== content) {
        return false;
      }
    }
    return true;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

export async function verifyArtifactSet(
  root: string,
  artifacts: EmittedArtifacts,
  facade: StableFacadeOptions = emptyStableFacade,
  options: ArtifactWriterOptions = emptyWriterOptions
): Promise<WriteResult> {
  artifactContentHash(artifacts);
  const expected = await expectedOutputRoot(root, options);
  const outputRoot = await canonicalOutputRoot(root, expected);
  const contentHash = artifactContentHash(artifacts);
  const directoryName = contentHash.slice(7);
  const relativeDirectory = `builds/${directoryName}`;
  const destination = join(root, relativeDirectory);
  await assertConfinedDirectory(
    outputRoot,
    join(root, "builds"),
    "Generated builds directory"
  );
  const selector = await readSelector(root, outputRoot);
  if (
    selector?.contentHash !== contentHash ||
    selector.directory !== relativeDirectory
  ) {
    throw new Error(
      `Generated artifacts are stale: expected ${contentHash} at ${relativeDirectory}, found ${String(selector?.contentHash)} at ${String(selector?.directory)}`
    );
  }
  if (!(await artifactSetMatches(outputRoot, destination, artifacts))) {
    throw new Error(
      `Current artifact set ${contentHash} does not match its destination files`
    );
  }
  await assertSingleSelectedBuild(root, directoryName);
  if (
    !(await stableFacadeMatches(
      root,
      outputRoot,
      relativeDirectory,
      facade,
      contentHash
    ))
  ) {
    throw new Error("Generated stable facade is stale or tampered");
  }
  const current = await readCurrent(root, outputRoot);
  if (
    current?.contentHash !== contentHash ||
    current.directory !== relativeDirectory
  ) {
    throw new Error("Generated current pointer is stale or tampered");
  }
  return { changed: false, contentHash, directory: destination };
}

async function writeArtifactSetUnlocked(
  root: string,
  artifacts: EmittedArtifacts,
  facade: StableFacadeOptions = emptyStableFacade,
  options: ArtifactWriterOptions = emptyWriterOptions
): Promise<WriteResult> {
  const expected = await expectedOutputRoot(root, options);
  await mkdir(root, { recursive: true });
  const outputRoot = await canonicalOutputRoot(root, expected);
  const contentHash = artifactContentHash(artifacts);
  const directoryName = contentHash.slice(7);
  const buildsRoot = join(root, "builds");
  const destination = join(buildsRoot, directoryName);
  const relativeDirectory = `builds/${directoryName}`;
  stableFacadeModule(relativeDirectory, facade, contentHash);
  const selector = await readSelector(root, outputRoot, false);
  if (
    selector?.contentHash === contentHash &&
    selector.directory === relativeDirectory
  ) {
    await assertConfinedDirectory(
      outputRoot,
      buildsRoot,
      "Generated builds directory"
    );
    if (!(await artifactSetMatches(outputRoot, destination, artifacts))) {
      throw new Error(
        `Current artifact set ${contentHash} does not match its destination files`
      );
    }
    const facadeMatches = await stableFacadeMatches(
      root,
      outputRoot,
      relativeDirectory,
      facade,
      contentHash
    );
    const current = await readCurrent(root, outputRoot);
    const currentMatches =
      current?.contentHash === contentHash &&
      current.directory === relativeDirectory;
    const pointer = `${canonicalJson({ contentHash, directory: relativeDirectory })}\n`;
    if (!currentMatches) {
      await replaceTextFile(root, "current.json", pointer);
    }
    if (!facadeMatches) {
      await writeStableFacade(
        root,
        `builds/${directoryName}`,
        facade,
        contentHash
      );
    }
    const pruned = await pruneGeneratedState(
      outputRoot,
      buildsRoot,
      directoryName
    );
    await assertSingleSelectedBuild(root, directoryName);
    return {
      changed: !facadeMatches || !currentMatches || pruned,
      contentHash,
      directory: destination,
    };
  }

  if (
    !(await assertConfinedDirectory(
      outputRoot,
      buildsRoot,
      "Generated builds directory",
      true
    ))
  ) {
    await mkdir(buildsRoot, { recursive: true });
  }
  await assertConfinedDirectory(
    outputRoot,
    buildsRoot,
    "Generated builds directory"
  );
  await assertConfinedDirectory(
    outputRoot,
    destination,
    "Generated artifact directory",
    true
  );
  const staging = join(
    buildsRoot,
    `.${directoryName}.${process.pid}.${Date.now().toString(36)}.${randomUUID()}.tmp`
  );
  await rm(staging, { force: true, recursive: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const [name, content] of artifactEntries(artifacts)) {
      await writeFile(join(staging, name), content, "utf8");
    }

    try {
      await assertConfinedDirectory(
        outputRoot,
        buildsRoot,
        "Generated builds directory"
      );
      await assertConfinedDirectory(
        outputRoot,
        destination,
        "Generated artifact directory",
        true
      );
      await rename(staging, destination);
    } catch (error) {
      const code =
        error && typeof error === "object"
          ? Reflect.get(error, "code")
          : undefined;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") {
        throw error;
      }
      if (!(await artifactSetMatches(outputRoot, destination, artifacts))) {
        throw new Error(
          `Existing artifact set ${contentHash} does not match its destination files`,
          { cause: error }
        );
      }
    }
  } finally {
    await rm(staging, { force: true, recursive: true });
  }

  await assertConfinedDirectory(
    outputRoot,
    destination,
    "Generated artifact directory"
  );

  const pointer = `${canonicalJson({ contentHash, directory: relativeDirectory })}\n`;
  // Option C publishes only from an exclusive predev, prebuild, or CI step.
  // The selector replacement is atomic, but this path makes no live-reader or
  // power-loss durability guarantee.
  await replaceTextFile(root, "current.json", pointer);
  await writeStableFacade(root, relativeDirectory, facade, contentHash);
  await pruneGeneratedState(outputRoot, buildsRoot, directoryName);
  await assertSingleSelectedBuild(root, directoryName);

  return { changed: true, contentHash, directory: destination };
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
  return withPublicationLock(root, outputRoot, () =>
    writeArtifactSetUnlocked(root, artifacts, facade, {
      expectedCanonicalRoot: outputRoot,
    })
  );
}
