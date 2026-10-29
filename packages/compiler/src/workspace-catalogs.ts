import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { ancestorDirectories } from "./path-within";

const workspaceSkipDirectories = new Set([
  ".git",
  ".mirai-intl",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

/**
 * True when `mirai-intl.workspace.json` in `directory` declares `"root": true`:
 * the folder is its own Mirai Intl workspace (catalog discovery and locale
 * preset) even inside a larger pnpm workspace, whose install root still
 * confines its realpaths (`installWorkspaceRoot`). Without the field the
 * preset only shares locale defaults, as before.
 */
export async function declaresIntlWorkspaceRoot(
  directory: string
): Promise<boolean> {
  const path = join(directory, "mirai-intl.workspace.json");
  const entry = await lstat(path).catch(() => undefined);
  if (!entry) {
    return false;
  }
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error("mirai-intl.workspace.json must be a regular file");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error("mirai-intl.workspace.json must contain valid JSON", {
      cause: error,
    });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("mirai-intl.workspace.json must be a JSON object");
  }
  return workspaceRootField((value as Record<string, unknown>).root);
}

/** @internal Validate `mirai-intl.workspace.json.root`: absent or `true`. */
export function workspaceRootField(root: unknown): boolean {
  if (root !== undefined && root !== true) {
    throw new TypeError(
      "mirai-intl.workspace.json.root must be true when present"
    );
  }
  return root === true;
}

/**
 * The lockfile names a workspace may carry, in the order every lockfile
 * lookup and watch list reads them.
 */
export const WORKSPACE_LOCK_NAMES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

/**
 * True when `directory` holds a pnpm-workspace.yaml. A symlinked or
 * non-file manifest throws wherever a walk or a discovery meets it, so every
 * lookup draws the same workspace boundary.
 */
async function hasPnpmWorkspaceManifest(directory: string): Promise<boolean> {
  const manifest = await lstat(join(directory, "pnpm-workspace.yaml")).catch(
    () => undefined
  );
  if (!manifest) {
    return false;
  }
  if (manifest.isSymbolicLink() || !manifest.isFile()) {
    throw new Error("pnpm-workspace.yaml must be a regular file");
  }
  return true;
}

/** The two roots above a package (`walkWorkspaceRoots`). */
export type WorkspaceRoots = Readonly<{
  /**
   * The nearest intl workspace root: the nearest folder holding a
   * pnpm-workspace.yaml or declaring `"root": true` (`declared`). It owns
   * catalog discovery and the locale preset. Absent when neither exists.
   */
  intl?: Readonly<{ declared: boolean; root: string }>;
  /**
   * The install root: the canonical base every confined realpath and every
   * receipt path is relative to. It is the nearest folder holding a
   * pnpm-workspace.yaml, because pnpm installs every dependency of the
   * workspace there (one root install puts them all in its
   * node_modules/.pnpm); without one, the intl root; else the start itself.
   * A declared intl root inside a pnpm workspace keeps its own discovery and
   * preset but shares the pnpm root's install, so its realpaths are
   * confined there.
   */
  install: string;
}>;

/**
 * The one workspace-root walk: from the realpath of `start` up to the
 * nearest pnpm-workspace.yaml (or the filesystem root), reading each folder
 * once. Markers above the first declared root are never parsed.
 */
export async function walkWorkspaceRoots(
  start: string
): Promise<WorkspaceRoots> {
  const canonicalStart = await realpath(start);
  let intl: WorkspaceRoots["intl"];
  for (const directory of ancestorDirectories(canonicalStart)) {
    if (await hasPnpmWorkspaceManifest(directory)) {
      return {
        install: directory,
        intl: intl ?? { declared: false, root: directory },
      };
    }
    if (intl === undefined && (await declaresIntlWorkspaceRoot(directory))) {
      intl = { declared: true, root: directory };
    }
  }
  return intl === undefined
    ? { install: canonicalStart }
    : { install: intl.root, intl };
}

/** The install root of `start` (`WorkspaceRoots.install`). */
export async function installWorkspaceRoot(start: string): Promise<string> {
  return (await walkWorkspaceRoots(start)).install;
}

/** The intl root of `start` for `--workspace` (`WorkspaceRoots.intl`). */
export async function nearestWorkspaceRoot(start: string): Promise<string> {
  const { intl } = await walkWorkspaceRoots(start);
  if (intl === undefined) {
    throw new Error("--workspace requires a parent pnpm-workspace.yaml");
  }
  return intl.root;
}

async function isRegularFile(path: string): Promise<boolean> {
  const stat = await lstat(path).catch(() => undefined);
  return stat?.isFile() === true && !stat.isSymbolicLink();
}

async function hasConventionCatalog(directory: string): Promise<boolean> {
  if (await isRegularFile(join(directory, "mirai-intl.config.json"))) {
    return true;
  }
  // A locales folder names a catalog only in a package root: a catalog's
  // identity is its package.json, so message files deeper inside a package
  // (an e-mail renderer's locales) are not a catalog of their own.
  if (!(await isRegularFile(join(directory, "package.json")))) {
    return false;
  }
  for (const name of ["src/locales", "locales"]) {
    const locales = await lstat(join(directory, name)).catch(() => undefined);
    if (locales?.isDirectory() && !locales.isSymbolicLink()) {
      return true;
    }
  }
  return false;
}

export async function discoverWorkspaceCatalogs(
  root: string
): Promise<Array<string>> {
  const catalogs: Array<string> = [];
  const visit = async (directory: string): Promise<void> => {
    if (directory !== root) {
      // A folder with its own pnpm-workspace.yaml, or one that declares
      // itself an intl workspace root, is another workspace, checked from
      // its own root, never as part of this one.
      if (
        (await hasPnpmWorkspaceManifest(directory)) ||
        (await declaresIntlWorkspaceRoot(directory))
      ) {
        return;
      }
      if (await hasConventionCatalog(directory)) {
        catalogs.push(directory);
        return;
      }
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        entry.name.startsWith(".") ||
        workspaceSkipDirectories.has(entry.name)
      ) {
        continue;
      }
      await visit(join(directory, entry.name));
    }
  };
  await visit(root);
  if (catalogs.length === 0) {
    throw new Error(
      "No Mirai Intl catalogs were discovered in the pnpm workspace"
    );
  }
  return catalogs.toSorted((left, right) => left.localeCompare(right));
}
