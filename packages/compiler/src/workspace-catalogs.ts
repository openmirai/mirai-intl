import { lstat, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const workspaceSkipDirectories = new Set([
  ".git",
  ".mirai-intl",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

export async function nearestWorkspaceRoot(start: string): Promise<string> {
  let directory = resolve(start);
  while (true) {
    const marker = await lstat(join(directory, "pnpm-workspace.yaml")).catch(
      () => undefined
    );
    if (marker?.isFile() && !marker.isSymbolicLink()) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error("--workspace requires a parent pnpm-workspace.yaml");
    }
    directory = parent;
  }
}

async function hasConventionCatalog(directory: string): Promise<boolean> {
  const config = await lstat(join(directory, "mirai-intl.config.json")).catch(
    () => undefined
  );
  if (config?.isFile() && !config.isSymbolicLink()) {
    return true;
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
    if (directory !== root && (await hasConventionCatalog(directory))) {
      catalogs.push(directory);
      return;
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
