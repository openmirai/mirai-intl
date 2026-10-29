import { lstatSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import nodePath from "node:path";
import type { PlatformPath } from "node:path";

/**
 * Where `candidate` sits against `root`: the same folder, inside it, or
 * outside it. The one containment rule of the compiler: it compares path
 * segments through `relative()`, never string prefixes, so `/a/bc` is not
 * inside `/a/b`, a name that only starts with `..` (`..cache`) is inside,
 * and a Windows path on another drive (where `relative()` returns an
 * absolute path) is outside. Both paths are compared as given: callers that
 * confine realpaths pass realpaths. `path` exists for the win32 tests.
 */
export function relationWithin(
  root: string,
  candidate: string,
  path: PlatformPath = nodePath
): "equal" | "inside" | "outside" {
  const relation = path.relative(root, candidate);
  if (relation === "") {
    return "equal";
  }
  return relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
    ? "outside"
    : "inside";
}

/** True when `candidate` is `root` itself or inside it (`relationWithin`). */
export function isPathWithin(
  root: string,
  candidate: string,
  path: PlatformPath = nodePath
): boolean {
  return relationWithin(root, candidate, path) !== "outside";
}

/** True when `candidate` is inside `root` and not `root` itself. */
export function isPathStrictlyWithin(
  root: string,
  candidate: string,
  path: PlatformPath = nodePath
): boolean {
  return relationWithin(root, candidate, path) === "inside";
}

/** True when both paths name the same folder or file (`relationWithin`). */
export function isSamePath(
  left: string,
  right: string,
  path: PlatformPath = nodePath
): boolean {
  return relationWithin(left, right, path) === "equal";
}

/**
 * The portable (`/`-separated) path of `candidate` below `root`, or
 * `undefined` when it is `root` itself or outside it (`relationWithin`).
 */
export function relativePathWithin(
  root: string,
  candidate: string,
  path: PlatformPath = nodePath
): string | undefined {
  return relationWithin(root, candidate, path) === "inside"
    ? path.relative(root, candidate).split(path.sep).join("/")
    : undefined;
}

/**
 * `relativePathWithin`, or throw `message` when `candidate` is `root` itself
 * or outside it: the receipt, proof and evidence paths of the compiler.
 */
export function confinedRelativePath(
  root: string,
  candidate: string,
  message: string,
  path: PlatformPath = nodePath
): string {
  const relativePath = relativePathWithin(root, candidate, path);
  if (relativePath === undefined) {
    throw new Error(message);
  }
  return relativePath;
}

/**
 * `start` and then each parent folder up to the filesystem root: the one
 * ancestor walk behind the workspace-root, lockfile and package lookups.
 * Stop early with `break` or `return`.
 */
export function* ancestorDirectories(
  start: string,
  path: PlatformPath = nodePath
): Generator<string, void, undefined> {
  let directory = path.resolve(start);
  while (true) {
    yield directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      return;
    }
    directory = parent;
  }
}

function fileSystemErrorCode(error: unknown): unknown {
  return error && typeof error === "object"
    ? Reflect.get(error, "code")
    : undefined;
}

/** A realpath or lstat failure that only says the path is not there. */
function isMissingPathError(error: unknown): boolean {
  const code = fileSystemErrorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * The realpath `path` will have once its missing folders are created: the
 * realpath of its nearest existing ancestor (`ancestorDirectories`) plus the
 * missing segments as written. The one prospective-path rule of the compiler:
 * a symlinked ancestor resolves to its target, `..` segments are resolved
 * lexically first, a segment that cannot name a file (a bundler virtual id
 * such as `\0vite/preload-helper.js`) counts as missing, and an entry that
 * exists but does not resolve (a dangling or looping symlink) or a filesystem
 * error other than "not there" fails closed. Missing-path failures throw `message` with the realpath error as
 * the cause. Callers confine the result with `isPathWithin` against their
 * own realpath root.
 */
export async function prospectiveRealpath(
  path: string,
  message: string
): Promise<string> {
  const absolute = nodePath.resolve(path);
  let lastError: unknown;
  for (const ancestor of ancestorDirectories(absolute)) {
    if (cannotExist(ancestor)) {
      continue;
    }
    try {
      const canonical = await realpath(ancestor);
      return nodePath.resolve(canonical, nodePath.relative(ancestor, absolute));
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      lastError = error;
    }
    if (await entryExists(ancestor)) {
      throw new Error(message, { cause: lastError });
    }
  }
  throw new Error(message, { cause: lastError });
}

/** `prospectiveRealpath` for synchronous callers (TypeScript host hooks). */
export function prospectiveRealpathSync(path: string, message: string): string {
  const absolute = nodePath.resolve(path);
  let lastError: unknown;
  for (const ancestor of ancestorDirectories(absolute)) {
    if (cannotExist(ancestor)) {
      continue;
    }
    try {
      const canonical = realpathSync.native(ancestor);
      return nodePath.resolve(canonical, nodePath.relative(ancestor, absolute));
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
      lastError = error;
    }
    if (entryExistsSync(ancestor)) {
      throw new Error(message, { cause: lastError });
    }
  }
  throw new Error(message, { cause: lastError });
}

/** A NUL byte can never be part of a file name. */
function cannotExist(path: string): boolean {
  return path.includes("\0");
}

async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return false;
  }
}

function entryExistsSync(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return false;
  }
}
