import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { compareCanonicalStrings } from "./canonical";
import { isPathStrictlyWithin, isPathWithin } from "./path-within";

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
  // A generated folder outside the package (or the package itself) hides
  // nothing from discovery.
  const generatedCandidate = join(root, ...generatedRelative.split(/[\\/]/u));
  const generatedRoot = isPathStrictlyWithin(root, generatedCandidate)
    ? generatedCandidate
    : undefined;
  const isGenerated = (path: string): boolean =>
    generatedRoot !== undefined && isPathWithin(generatedRoot, path);
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
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORY_NAMES.has(entry.name) || isGenerated(absolute)) {
          continue;
        }
        await visit(absolute);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSION.test(entry.name)) {
        continue;
      }
      if (isGenerated(absolute)) {
        continue;
      }
      files.push(absolute);
    }
  };

  await visit(root);
  return files.toSorted(compareCanonicalStrings);
}
