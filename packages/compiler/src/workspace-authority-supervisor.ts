import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import type { Sha256 } from "@openmirai/intl-abi";

import {
  INTL_WORKSPACE_AUTHORITY_DIRECTORY,
  INTL_WORKSPACE_AUTHORITY_MANIFESTS_DIRECTORY,
  INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH,
  buildWorkspaceAuthorityRootPointerV1,
  canonicalWorkspaceAuthorityRootPointerV1Bytes,
  canonicalWorkspaceAuthorityV1Bytes,
  hashWorkspaceAuthorityV1,
  validateWorkspaceAuthorityV1,
  workspaceAuthorityManifestPath,
} from "./workspace-authority";
import type { WorkspaceAuthorityV1 } from "./workspace-authority";

export type WorkspaceAuthoritySupervisorBoundary =
  | "manifest-installed"
  | "pointer-staged"
  | "before-live-revalidate"
  | "pointer-committed";

export type WorkspaceAuthoritySupervisorLease = Readonly<{
  withLease<Value>(
    operation: (leaseToken: string) => Promise<Value>
  ): Promise<Value>;
}>;

export type WorkspaceAuthoritySupervisorDescriptor = Readonly<{
  authority: WorkspaceAuthorityV1;
  leaseToken: string;
}>;

export type WorkspaceAuthoritySupervisorOptions = Readonly<{
  boundary?: (
    boundary: WorkspaceAuthoritySupervisorBoundary
  ) => Promise<void> | void;
  commitIo?: Readonly<{
    rename: (stagedPath: string, pointerPath: string) => void;
    syncDirectory: (directory: string) => void;
  }>;
  commitReadyCutoff: number;
  liveRevalidate: () => Promise<void>;
}>;

export type WorkspaceAuthoritySupervisorResult = Readonly<{
  committed: boolean;
  manifestHash: Sha256;
  manifestPath: string;
  noOp: boolean;
  pointerPath: string;
  pointerRenames: 0 | 1;
  recoveredPostCommitFailure: boolean;
  warnings: ReadonlyArray<"post-commit-failure-recovered">;
}>;

const POST_COMMIT_WARNING = "post-commit-failure-recovered" as const;
const NO_WARNINGS: ReadonlyArray<typeof POST_COMMIT_WARNING> = Object.freeze(
  []
);
const RECOVERED_WARNINGS: ReadonlyArray<typeof POST_COMMIT_WARNING> =
  Object.freeze([POST_COMMIT_WARNING]);

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error
    ? String(error.code)
    : undefined;
}

function assertLeaseToken(value: string): void {
  if (
    value.length < 16 ||
    value.normalize("NFC") !== value ||
    [...value].some((character) => character.charCodeAt(0) <= 0x20)
  ) {
    throw new TypeError(
      "Workspace authority supervisor lease token is invalid"
    );
  }
}

async function assertDirectory(path: string, context: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${context} must be a non-symlink directory`);
  }
}

async function prepareDirectory(path: string, context: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw error;
    }
  }
  await assertDirectory(path, context);
}

async function assertRoot(root: string): Promise<string> {
  const absolute = resolve(root);
  await assertDirectory(absolute, "Workspace authority root");
  return realpath(absolute);
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function installImmutableObject(
  path: string,
  bytes: string
): Promise<void> {
  let handle;
  try {
    handle = await open(path, "wx", 0o400);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") {
      throw error;
    }
    const metadata = await lstat(path);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      (await readFile(path, "utf8")) !== bytes
    ) {
      throw new Error("Workspace authority immutable manifest is corrupt", {
        cause: error,
      });
    }
    return;
  }
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.datasync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function stagePointer(path: string, bytes: string): Promise<string> {
  const temporary = join(
    dirname(path),
    `.current.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await open(temporary, "wx+", 0o600);
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.datasync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
  return temporary;
}

function verifyRegularFileSync(path: string, context: string): void {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${context} must be a non-symlink regular file`);
  }
}

function commitPointerSync(
  stagedPath: string,
  pointerPath: string,
  bytes: string,
  commitIo: NonNullable<WorkspaceAuthoritySupervisorOptions["commitIo"]>
): Readonly<{
  committed: boolean;
  recoveredPostCommitFailure: boolean;
}> {
  verifyRegularFileSync(stagedPath, "Workspace authority staged pointer");
  const descriptor = openSync(stagedPath, constants.O_RDONLY);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || readFileSync(descriptor, "utf8") !== bytes) {
      throw new Error("Workspace authority staged pointer bytes changed");
    }
  } finally {
    closeSync(descriptor);
  }

  try {
    verifyRegularFileSync(pointerPath, "Workspace authority root pointer");
    if (readFileSync(pointerPath, "utf8") === bytes) {
      return { committed: false, recoveredPostCommitFailure: false };
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }

  commitIo.rename(stagedPath, pointerPath);
  try {
    commitIo.syncDirectory(dirname(pointerPath));
    return { committed: true, recoveredPostCommitFailure: false };
  } catch {
    return { committed: true, recoveredPostCommitFailure: true };
  }
}

const defaultCommitIo = Object.freeze({
  rename: renameSync,
  syncDirectory(directoryPath: string): void {
    const directory = openSync(directoryPath, constants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  },
});

/**
 * Installs one validated exact-five workspace authority and commits only its
 * root pointer. The caller owns the hard-link/token lease implementation; this
 * function refuses descriptors whose sealed token differs from the lease.
 */
export async function publishWorkspaceAuthorityV1(
  root: string,
  descriptor: WorkspaceAuthoritySupervisorDescriptor,
  lease: WorkspaceAuthoritySupervisorLease,
  options: WorkspaceAuthoritySupervisorOptions
): Promise<WorkspaceAuthoritySupervisorResult> {
  const startedAt = performance.now();
  const cutoff = options.commitReadyCutoff;
  if (
    !Number.isFinite(cutoff) ||
    cutoff <= startedAt ||
    cutoff - startedAt > 18_000
  ) {
    throw new Error("Workspace authority publication deadline expired");
  }
  const commitIo = options.commitIo ?? defaultCommitIo;
  let committedResult: WorkspaceAuthoritySupervisorResult | undefined;
  try {
    return await lease.withLease(async (leaseToken) => {
      assertLeaseToken(leaseToken);
      assertLeaseToken(descriptor.leaseToken);
      if (leaseToken !== descriptor.leaseToken) {
        throw new Error("Workspace authority descriptor lease is counterfeit");
      }
      const authority = validateWorkspaceAuthorityV1(descriptor.authority);
      const manifestBytes = canonicalWorkspaceAuthorityV1Bytes(authority);
      const manifestHash = hashWorkspaceAuthorityV1(authority);
      const pointerBytes = canonicalWorkspaceAuthorityRootPointerV1Bytes(
        buildWorkspaceAuthorityRootPointerV1(manifestHash)
      );
      const workspaceRoot = await assertRoot(root);
      const authorityDirectory = join(
        workspaceRoot,
        INTL_WORKSPACE_AUTHORITY_DIRECTORY
      );
      const manifestsDirectory = join(
        workspaceRoot,
        INTL_WORKSPACE_AUTHORITY_MANIFESTS_DIRECTORY
      );
      await prepareDirectory(
        join(workspaceRoot, ".mirai-intl"),
        "Workspace authority metadata directory"
      );
      await prepareDirectory(
        authorityDirectory,
        "Workspace authority directory"
      );
      await prepareDirectory(
        manifestsDirectory,
        "Workspace authority manifests directory"
      );
      const manifestPath = join(
        workspaceRoot,
        workspaceAuthorityManifestPath(manifestHash)
      );
      const pointerPath = join(
        workspaceRoot,
        INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH
      );
      let stagedPath: string | undefined;
      let committed = false;
      try {
        await installImmutableObject(manifestPath, manifestBytes);
        await options.boundary?.("manifest-installed");
        stagedPath = await stagePointer(pointerPath, pointerBytes);
        await options.boundary?.("pointer-staged");
        if (performance.now() >= cutoff) {
          throw new Error("Workspace authority publication deadline expired");
        }
        await options.boundary?.("before-live-revalidate");
        await options.liveRevalidate();
        if (performance.now() >= cutoff) {
          throw new Error("Workspace authority publication deadline expired");
        }
        const commit = commitPointerSync(
          stagedPath,
          pointerPath,
          pointerBytes,
          commitIo
        );
        committed = commit.committed;
        if (committed) {
          stagedPath = undefined;
        }
        let result: WorkspaceAuthoritySupervisorResult = Object.freeze({
          committed,
          manifestHash,
          manifestPath,
          noOp: !committed,
          pointerPath,
          pointerRenames: committed ? 1 : 0,
          recoveredPostCommitFailure: commit.recoveredPostCommitFailure,
          warnings: commit.recoveredPostCommitFailure
            ? RECOVERED_WARNINGS
            : NO_WARNINGS,
        });
        committedResult = result;
        if (committed) {
          try {
            await options.boundary?.("pointer-committed");
          } catch {
            result = Object.freeze({
              ...result,
              recoveredPostCommitFailure: true,
              warnings: RECOVERED_WARNINGS,
            });
            committedResult = result;
          }
        }
        return result;
      } finally {
        if (stagedPath !== undefined) {
          await rm(stagedPath, { force: true }).catch(() => undefined);
        }
      }
    });
  } catch (error) {
    if (committedResult?.committed) {
      return Object.freeze({
        ...committedResult,
        recoveredPostCommitFailure: true,
        warnings: RECOVERED_WARNINGS,
      });
    }
    throw error;
  }
}
