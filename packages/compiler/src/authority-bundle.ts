import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  lstat,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

import { extract, Pack, Parser } from "tar";

import { canonicalJson, sha256 } from "./canonical";
import { withReceiptParsingScope } from "./authorization-snapshot";
import { withNativeOperation } from "./native-engine";
import {
  conventionPackageAuthorityReceiptPath,
  conventionPackageAuthoritySetPath,
  conventionPackageClassifierAuthorityPath,
  parseCanonicalPackageAuthoritySetV1,
  readConventionCheckReceipt,
  verifyTransferredConventionBuildReceiptBatch,
} from "./check-receipt";
import { parseCanonicalCatalogGenerationReceipt } from "./generation-snapshot";
import { discoverWorkspaceCatalogs } from "./workspace-catalogs";
import type { WorkspaceAuthorityPackageV1 } from "./workspace-authority";
import {
  INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH,
  parseCanonicalWorkspaceAuthorityRootPointerV1,
  parseCanonicalWorkspaceAuthorityV1,
  workspaceAuthorityManifestPath,
} from "./workspace-authority";

const MANIFEST = "intl-authority-bundle.v1.json";
const GENERATED = "src/i18n/generated";
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = MAX_BYTES + 64 * 1024 * 1024;
const MAX_FILES = 10_000;

class AuthorityImportRecoveryError extends Error {
  constructor(directory: string, cause: unknown) {
    super(
      `Authority import rollback failed. Preserve the import lock and recover backups from ${directory}`,
      { cause }
    );
    this.name = "AuthorityImportRecoveryError";
  }
}

type BundleFile = Readonly<{ path: string; hash: string; size: number }>;
type BundleManifest = Readonly<{
  schemaVersion: 1;
  catalogs: ReadonlyArray<string>;
  files: ReadonlyArray<BundleFile>;
}>;

export type AuthorityBundleOptions = Readonly<{
  root: string;
  archive: string;
}>;
export type AuthorityBundleResult = Readonly<{
  catalogs: ReadonlyArray<string>;
  files: number;
  bytes: number;
}>;

export type AuthorityReuseResult =
  | Readonly<{ status: "reused"; bundle: AuthorityBundleResult }>
  | Readonly<{
      status: "miss";
      reason: "missing" | "candidate-rejected";
      stage: "archive" | "manifest" | "closure" | "checkout";
      recoverySafe: true;
      diagnostic: string;
    }>;

type CandidateRejection = Extract<AuthorityReuseResult, { status: "miss" }>;
type ImportTransactionResult =
  | Extract<AuthorityReuseResult, { status: "reused" }>
  | Readonly<{
      status: "rejected";
      rejection: CandidateRejection;
      error: unknown;
    }>;

// Only failures inside explicit candidate-validation boundaries can become a
// miss. Filesystem/lock/resource errors (including wrapped causes) must escape.
function candidateValidationFailure(error: unknown): error is Error {
  if (
    !(error instanceof Error) ||
    error instanceof RangeError ||
    error instanceof ReferenceError ||
    error instanceof EvalError
  ) {
    return false;
  }
  if (
    "code" in error &&
    typeof error.code === "string" &&
    !["ENOENT", "TAR_BAD_ARCHIVE", "TAR_ABORT", "TAR_ENTRY_INVALID"].includes(
      error.code
    )
  ) {
    return false;
  }
  if (error.cause !== undefined && !candidateValidationFailure(error.cause)) {
    return false;
  }
  return (
    !(error instanceof AggregateError) ||
    error.errors.every(candidateValidationFailure)
  );
}

function safePath(value: string): string {
  if (
    !value ||
    /[\\:]/u.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    value.normalize("NFC") !== value ||
    value
      .split("/")
      .some(
        (part) => !part || part === "." || part === ".." || /[. ]$/u.test(part)
      )
  ) {
    throw new Error(`Unsafe authority bundle path: ${JSON.stringify(value)}`);
  }
  return value;
}

function localPath(root: string, absolute: string): string {
  return safePath(relative(root, absolute).split(sep).join("/"));
}

async function regularFile(root: string, path: string): Promise<Buffer> {
  const parts = safePath(path).split("/");
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const entry = await lstat(current);
    if (
      entry.isSymbolicLink() ||
      (index === parts.length - 1
        ? !entry.isFile() || entry.nlink !== 1
        : !entry.isDirectory())
    ) {
      throw new Error(
        `Authority bundle requires regular confined files: ${path}`
      );
    }
  }
  const entry = await lstat(current);
  if (entry.size > MAX_BYTES) {
    throw new Error(`Authority bundle file is too large: ${path}`);
  }
  return readFile(current);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid authority bundle manifest");
  }
  return value as Record<string, unknown>;
}

function parseManifest(bytes: Buffer): BundleManifest {
  const value = object(JSON.parse(bytes.toString("utf8")) as unknown);
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.catalogs) ||
    !Array.isArray(value.files) ||
    !value.catalogs.length ||
    value.files.length > MAX_FILES
  ) {
    throw new Error("Invalid authority bundle manifest");
  }
  const catalogs = value.catalogs.map((path: unknown) => {
    if (typeof path !== "string") {
      throw new Error("Invalid authority bundle catalog");
    }
    return safePath(path);
  });
  const files = value.files.map((file: unknown): BundleFile => {
    const entry = object(file);
    if (
      typeof entry.path !== "string" ||
      typeof entry.hash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(entry.hash) ||
      typeof entry.size !== "number" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0
    ) {
      throw new Error("Invalid authority bundle file");
    }
    const parsed = {
      path: safePath(entry.path),
      hash: entry.hash,
      size: entry.size,
    };
    if (canonicalJson(parsed) !== canonicalJson(entry)) {
      throw new Error("Unexpected authority bundle file fields");
    }
    return parsed;
  });
  const manifest = { schemaVersion: 1, catalogs, files } as const;
  for (const paths of [catalogs, files.map((file) => file.path)]) {
    if (
      new Set(paths).size !== paths.length ||
      canonicalJson(paths) !== canonicalJson(paths.toSorted())
    ) {
      throw new Error("Authority bundle inventory must be unique and sorted");
    }
  }
  if (
    files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES ||
    `${canonicalJson(manifest)}\n` !== bytes.toString("utf8")
  ) {
    throw new Error("Authority bundle manifest is non-canonical or too large");
  }
  return manifest;
}

async function catalogsAt(root: string): Promise<Array<string>> {
  return (await discoverWorkspaceCatalogs(root))
    .map((path) => localPath(root, path))
    .toSorted();
}

/** Reconstruct the closure from the selected native receipts, never from a caller's file list. */
async function selectedFiles(
  sourceRoot: string,
  stateRoot: string,
  catalogs: ReadonlyArray<string>
): Promise<Array<string>> {
  const paths = new Set<string>();
  const selectedPackages: Array<WorkspaceAuthorityPackageV1> = [];
  for (const catalog of catalogs) {
    const packageRoot = join(sourceRoot, catalog);
    const stagedRoot = join(stateRoot, catalog);
    const selected = await readConventionCheckReceipt(
      packageRoot,
      undefined,
      stagedRoot
    );
    if (
      selected.selection !== "authority-set" ||
      selected.receipt.schemaVersion !== 3 ||
      !selected.authoritySetHash
    ) {
      throw new Error(
        `Authority bundle requires selected immutable V3 authority: ${catalog}`
      );
    }
    const setPath = localPath(
      stateRoot,
      conventionPackageAuthoritySetPath(stagedRoot, selected.authoritySetHash)
    );
    const set = parseCanonicalPackageAuthoritySetV1(
      (await regularFile(stateRoot, setPath)).toString("utf8")
    );
    if (!set.classifierAuthority) {
      throw new Error(`Missing classifier authority: ${catalog}`);
    }
    paths.add(`${catalog}/.mirai-intl/check-receipt.current.json`);
    paths.add(setPath);
    paths.add(
      localPath(
        stateRoot,
        conventionPackageAuthorityReceiptPath(stagedRoot, 3, set.receipt.hash)
      )
    );
    paths.add(
      localPath(
        stateRoot,
        conventionPackageClassifierAuthorityPath(
          stagedRoot,
          set.classifierAuthority.hash
        )
      )
    );
    const generated = `${catalog}/${GENERATED}`;
    const receiptPath = `${generated}/catalog-generation-receipt.v1.json`;
    const receipt = parseCanonicalCatalogGenerationReceipt(
      (await regularFile(stateRoot, receiptPath)).toString("utf8")
    );
    selectedPackages.push({
      authoritySetHash: selected.authoritySetHash,
      catalogContentHash: receipt.payload.contentHash,
      classifierAuthorityHash: set.classifierAuthority.hash,
      generationReceiptHash: selected.receipt.generationReceiptHash,
      package: set.package,
      receiptHash: set.receipt.hash,
      sourceAuthorizationHash: selected.receipt.sourceAuthorizationHash,
    });
    for (const name of [
      "current.json",
      "catalog.lock.json",
      "index.ts",
      "catalog-generation-receipt.v1.json",
    ]) {
      paths.add(`${generated}/${name}`);
    }
    for (const entry of receipt.payload.manifest.entries) {
      paths.add(
        safePath(`${generated}/${receipt.payload.directory}/${entry.path}`)
      );
    }
  }
  const pointerPath = INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH;
  const pointerEntry = await lstat(join(stateRoot, pointerPath)).catch(
    (error: unknown) => {
      if (object(error).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  );
  if (pointerEntry) {
    const pointer = parseCanonicalWorkspaceAuthorityRootPointerV1(
      (await regularFile(stateRoot, pointerPath)).toString("utf8")
    );
    const manifestPath = workspaceAuthorityManifestPath(pointer.manifestHash);
    const bytes = await regularFile(stateRoot, manifestPath);
    const authority = parseCanonicalWorkspaceAuthorityV1(
      bytes.toString("utf8")
    );
    if (
      sha256(bytes) !== pointer.manifestHash ||
      canonicalJson(authority.packages) !== canonicalJson(selectedPackages) ||
      sha256(await regularFile(sourceRoot, authority.workspaceLock.path)) !==
        authority.workspaceLock.hash
    ) {
      throw new Error(
        "Workspace authority does not match selected package authority"
      );
    }
    paths.add(pointerPath);
    paths.add(manifestPath);
  }
  return [...paths].toSorted();
}

async function describeFiles(
  root: string,
  paths: ReadonlyArray<string>
): Promise<Array<BundleFile>> {
  const result: Array<BundleFile> = [];
  let total = 0;
  for (const path of paths) {
    const bytes = await regularFile(root, path);
    total += bytes.length;
    if (total > MAX_BYTES || result.length >= MAX_FILES) {
      throw new Error("Authority bundle exceeds size limits");
    }
    result.push({ path, hash: sha256(bytes), size: bytes.length });
  }
  return result;
}

async function validateBundle(
  sourceRoot: string,
  stagedRoot: string,
  manifest: BundleManifest
): Promise<void> {
  if (
    canonicalJson(await catalogsAt(sourceRoot)) !==
    canonicalJson(manifest.catalogs)
  ) {
    throw new Error(
      "Authority bundle catalog inventory does not match checkout"
    );
  }
  const expected = await selectedFiles(
    sourceRoot,
    stagedRoot,
    manifest.catalogs
  );
  if (
    canonicalJson(expected) !==
    canonicalJson(manifest.files.map((file) => file.path))
  ) {
    throw new Error(
      "Authority bundle is missing required objects or contains unexpected files"
    );
  }
  if (
    canonicalJson(await describeFiles(stagedRoot, expected)) !==
    canonicalJson(manifest.files)
  ) {
    throw new Error("Authority bundle file digest or size mismatch");
  }
}

function summary(manifest: BundleManifest): AuthorityBundleResult {
  return {
    catalogs: manifest.catalogs,
    files: manifest.files.length,
    bytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
  };
}

/** Export one deterministic archive containing only the fully verified selected authority. */
export async function exportAuthorityBundle(
  options: AuthorityBundleOptions
): Promise<AuthorityBundleResult> {
  return withReceiptParsingScope(() =>
    withNativeOperation(() => exportAuthorityBundleWithinOperation(options))
  );
}

async function exportAuthorityBundleWithinOperation(
  options: AuthorityBundleOptions
): Promise<AuthorityBundleResult> {
  const root = await realpath(resolve(options.root));
  const archive = resolve(options.archive);
  const temporary = await mkdtemp(join(tmpdir(), "intl-authority-export-"));
  try {
    const catalogs = await catalogsAt(root);
    const files = await describeFiles(
      root,
      await selectedFiles(root, root, catalogs)
    );
    const manifest: BundleManifest = { schemaVersion: 1, catalogs, files };
    const stage = join(temporary, "stage");
    await mkdir(stage);
    for (const file of files) {
      const destination = join(stage, file.path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await regularFile(root, file.path), {
        mode: 0o600,
        flag: "wx",
      });
    }
    await validateBundle(root, stage, manifest);
    await verifyTransferredConventionBuildReceiptBatch(
      catalogs.map((catalog) => ({
        packageRoot: join(root, catalog),
        transferredPackageRoot: join(stage, catalog),
      })),
      root
    );
    await writeFile(join(stage, MANIFEST), `${canonicalJson(manifest)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    const tar = join(temporary, "bundle.tar");
    const pack = new Pack({
      cwd: stage,
      portable: true,
      noMtime: true,
      strict: true,
      noDirRecurse: true,
    });
    const packed = pipeline(
      pack,
      createWriteStream(tar, { flags: "wx", mode: 0o600 })
    );
    // Pack.add treats scoped paths literally; create interprets @file as another archive.
    for (const path of [MANIFEST, ...files.map((file) => file.path)]) {
      pack.add(path);
    }
    pack.end();
    await packed;
    if ((await lstat(tar)).size > MAX_ARCHIVE_BYTES) {
      throw new Error("Authority archive exceeds metadata overhead limit");
    }
    // Stage on the destination filesystem, then atomically install complete bytes
    // without replacing an existing archive (rename would overwrite on POSIX).
    const destinationStage = await mkdtemp(
      join(dirname(archive), ".intl-authority-export-")
    );
    try {
      const completed = join(destinationStage, "bundle.tar");
      await cp(tar, completed, { force: false, errorOnExist: true });
      await link(completed, archive);
    } finally {
      await rm(destinationStage, { recursive: true, force: true });
    }
    return summary(manifest);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function unpackArchive(
  archive: string,
  stage: string
): Promise<Array<string>> {
  const handle = await open(archive, "r");
  try {
    const header = Buffer.alloc(512);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 512 || header.toString("ascii", 257, 262) !== "ustar") {
      throw new Error("Authority bundles require an uncompressed tar archive");
    }
  } finally {
    await handle.close();
  }
  const seen = new Set<string>();
  let total = 0;
  const parser = new Parser({
    strict: true,
    maxMetaEntrySize: 1024 * 1024,
    onReadEntry(entry) {
      try {
        safePath(entry.path);
        total += entry.size;
        if (
          entry.type !== "File" ||
          seen.has(entry.path) ||
          seen.size >= MAX_FILES + 1 ||
          total > MAX_BYTES + 1024 * 1024
        ) {
          throw new Error(`Invalid authority archive entry: ${entry.path}`);
        }
        seen.add(entry.path);
        entry.resume();
      } catch (error) {
        parser.abort(
          error instanceof Error
            ? error
            : new Error("Invalid authority archive")
        );
      }
    },
  });
  await pipeline(createReadStream(archive), parser);
  await extract({
    cwd: stage,
    file: archive,
    strict: true,
    noChmod: true,
    noMtime: true,
  });
  return [...seen].toSorted();
}

async function safeDestination(root: string, path: string): Promise<void> {
  let directory = root;
  for (const part of safePath(path).split("/")) {
    directory = join(directory, part);
    const entry = await lstat(directory).catch((error: unknown) => {
      if (object(error).code === "ENOENT") {
        return undefined;
      }
      throw error;
    });
    if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) {
      throw new Error(`Unsafe authority import destination: ${path}`);
    }
  }
}

async function publish(
  root: string,
  stage: string,
  backupRoot: string,
  manifest: BundleManifest,
  verifyTransferred: typeof verifyTransferredConventionBuildReceiptBatch
): Promise<void> {
  const generatedPaths = manifest.catalogs.map(
    (catalog) => `${catalog}/${GENERATED}`
  );
  const authorityPaths = manifest.catalogs.map(
    (catalog) => `${catalog}/.mirai-intl`
  );
  const paths = [...generatedPaths, ...authorityPaths];
  if (
    manifest.files.some(
      (file) => file.path === INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH
    )
  ) {
    paths.push(".mirai-intl/workspace-authority");
  } else if (
    await lstat(join(root, ".mirai-intl/workspace-authority")).catch(
      (error: unknown) => {
        if (object(error).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    )
  ) {
    throw new Error(
      "Receiving workspace authority is absent from the bundle; use a clean checkout"
    );
  }
  for (const path of paths) {
    await safeDestination(root, path);
  }
  for (const path of generatedPaths) {
    const entries = await readdir(join(root, path)).catch((error: unknown) => {
      if (object(error).code === "ENOENT") {
        return [];
      }
      throw error;
    });
    if (
      entries.some(
        (name) =>
          name.startsWith(".publish.lock") || name === ".catalog-publication"
      )
    ) {
      throw new Error(
        `Receiving catalog has publication recovery state: ${path}; recover it before import`
      );
    }
  }
  const installed: Array<string> = [];
  const backedUp: Array<string> = [];
  try {
    for (const path of paths) {
      if (path === authorityPaths[0]) {
        // Generated declarations must be visible to the normal resolver, but
        // no new authority selector is activated until every package verifies.
        // Import is an exclusive operation in an inactive checkout; any failure
        // restores the previous generated tree before releasing the import lock.
        await verifyTransferred(
          manifest.catalogs.map((catalog) => ({
            packageRoot: join(root, catalog),
            transferredPackageRoot: join(stage, catalog),
            generatedRoot: join(root, catalog, GENERATED),
          })),
          root
        );
      }
      const target = join(root, path);
      await safeDestination(root, path);
      const backup = join(backupRoot, path);
      await mkdir(dirname(target), { recursive: true });
      await mkdir(dirname(backup), { recursive: true });
      try {
        await rename(target, backup);
        backedUp.push(path);
      } catch (error) {
        if (object(error).code !== "ENOENT") {
          throw error;
        }
      }
      await rename(join(stage, path), target);
      installed.push(path);
    }
    // Catch source edits during publication, before granting successful import.
    await verifyTransferred(
      manifest.catalogs.map((catalog) => ({
        packageRoot: join(root, catalog),
        transferredPackageRoot: join(root, catalog),
      })),
      root
    );
  } catch (error) {
    try {
      for (const path of installed.toReversed()) {
        await rm(join(root, path), { recursive: true, force: true });
      }
      for (const path of backedUp.toReversed()) {
        await rename(join(backupRoot, path), join(root, path));
      }
    } catch (rollbackError) {
      throw new AuthorityImportRecoveryError(
        backupRoot,
        new AggregateError([error, rollbackError])
      );
    }
    throw error;
  }
}

async function assertInactiveCatalogs(root: string): Promise<void> {
  for (const catalog of await catalogsAt(root)) {
    const path = `${catalog}/${GENERATED}`;
    await safeDestination(root, path);
    const entries = await readdir(join(root, path)).catch((error: unknown) => {
      if (object(error).code === "ENOENT") {
        return [];
      }
      throw error;
    });
    if (
      entries.some(
        (name) =>
          name.startsWith(".publish.lock") || name === ".catalog-publication"
      )
    ) {
      throw new Error(
        `Receiving catalog has publication recovery state: ${path}; recover it before import`
      );
    }
  }
}

async function importAuthorityTransaction(
  options: AuthorityBundleOptions,
  allowRecovery: boolean
): Promise<ImportTransactionResult> {
  const root = await realpath(resolve(options.root));
  const archive = resolve(options.archive);
  const lockPath = join(root, ".mirai-intl-authority-transfer.lock");
  const temporary = await mkdtemp(join(root, ".mirai-intl-transfer-"));
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let preserveRecovery = false;
  let rejected:
    | Readonly<{ error: Error; rejection: CandidateRejection }>
    | undefined;
  const candidateCheck = async <T>(
    stage: CandidateRejection["stage"],
    action: () => Promise<T>,
    missing = false
  ): Promise<T> => {
    try {
      return await action();
    } catch (error) {
      if (candidateValidationFailure(error)) {
        rejected = {
          error,
          rejection: {
            status: "miss",
            reason:
              missing && "code" in error && error.code === "ENOENT"
                ? "missing"
                : "candidate-rejected",
            stage,
            recoverySafe: true,
            diagnostic: error.message,
          },
        };
      }
      throw error;
    }
  };
  try {
    lock = await open(lockPath, "wx", 0o600);
    // A missing/corrupt candidate does not grant permission to audit over an
    // active writer or unresolved publication. Check before returning any miss.
    if (allowRecovery) {
      await assertInactiveCatalogs(root);
    }
    await candidateCheck(
      "archive",
      async () => {
        const entry = await lstat(archive);
        if (
          !entry.isFile() ||
          entry.isSymbolicLink() ||
          entry.size > MAX_ARCHIVE_BYTES
        ) {
          throw new Error("Invalid authority archive file");
        }
      },
      true
    );
    // Snapshot before parsing, so the untrusted input cannot change between inspection and extraction.
    const snapshot = join(temporary, "bundle.tar");
    await cp(archive, snapshot, {
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    const copied = await lstat(snapshot);
    if (
      !copied.isFile() ||
      copied.isSymbolicLink() ||
      copied.size > MAX_ARCHIVE_BYTES
    ) {
      throw new Error("Authority archive changed during snapshot");
    }
    const stage = join(temporary, "stage");
    await mkdir(stage);
    const paths = await candidateCheck("archive", () =>
      unpackArchive(snapshot, stage)
    );
    const manifest = await candidateCheck("manifest", async () => {
      const parsed = parseManifest(await regularFile(stage, MANIFEST));
      if (
        canonicalJson(paths) !==
        canonicalJson(
          [MANIFEST, ...parsed.files.map((file) => file.path)].toSorted()
        )
      ) {
        throw new Error(
          "Authority archive file inventory disagrees with manifest"
        );
      }
      return parsed;
    });
    await candidateCheck("closure", () =>
      validateBundle(root, stage, manifest)
    );
    await publish(root, stage, join(temporary, "backup"), manifest, (...args) =>
      candidateCheck("checkout", () =>
        verifyTransferredConventionBuildReceiptBatch(...args)
      )
    );
    return { status: "reused", bundle: summary(manifest) };
  } catch (error) {
    preserveRecovery = error instanceof AuthorityImportRecoveryError;
    if (
      !preserveRecovery &&
      rejected !== undefined &&
      rejected.error === error
    ) {
      // This result reaches the caller only after finally completes. Failed
      // rollback or cleanup instead rejects and never permits a fresh audit.
      return { status: "rejected", rejection: rejected.rejection, error };
    }
    throw error;
  } finally {
    await lock?.close();
    if (!preserveRecovery) {
      await rm(temporary, { recursive: true, force: true });
      if (lock) {
        await rm(lockPath);
      }
    }
  }
}

/** Import into an inactive checkout only; no authored source or dependency is restored. */
export async function importAuthorityBundle(
  options: AuthorityBundleOptions
): Promise<AuthorityBundleResult> {
  const result = await withReceiptParsingScope(() =>
    withNativeOperation(() => importAuthorityTransaction(options, false))
  );
  if (result.status === "rejected") {
    throw result.error;
  }
  return result.bundle;
}

/** Try one candidate, never auditing or generating. Only a safely cleaned miss permits producer recovery. */
export async function reuseAuthorityBundle(
  options: AuthorityBundleOptions
): Promise<AuthorityReuseResult> {
  const result = await withReceiptParsingScope(() =>
    withNativeOperation(() => importAuthorityTransaction(options, true))
  );
  return result.status === "rejected" ? result.rejection : result;
}
