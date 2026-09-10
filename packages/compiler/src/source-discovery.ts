import { readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { compareCanonicalStrings } from "./canonical";
import { nativeDiscoverSources } from "./native-engine";

const SKIP_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "node_modules",
]);

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;

/** @internal Discover candidate source files without loading TypeScript. */
export async function collectConventionSourceFiles(
  root: string,
  generatedRelative: string
): Promise<Array<string>> {
  // Preserve the legacy path representation for unusual relative caller roots.
  if (isAbsolute(root) && resolve(root) === root) {
    const native = await nativeDiscoverSources(root, generatedRelative);
    if (native) {
      return native.toSorted(compareCanonicalStrings);
    }
  }
  const generatedPrefix = generatedRelative.split(/[\\/]/u).join(sep);
  const files: Array<string> = [];

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") {
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          continue;
        }
      }
      const absolute = join(directory, entry.name);
      const relativePath = relative(root, absolute);
      if (entry.isDirectory()) {
        if (
          SKIP_DIRECTORY_NAMES.has(entry.name) ||
          relativePath === generatedPrefix ||
          relativePath.startsWith(`${generatedPrefix}${sep}`)
        ) {
          continue;
        }
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSION.test(entry.name)) {
        continue;
      }
      if (
        relativePath === generatedPrefix ||
        relativePath.startsWith(`${generatedPrefix}${sep}`)
      ) {
        continue;
      }
      files.push(absolute);
    }
  };

  await visit(root);
  return files.toSorted(compareCanonicalStrings);
}
