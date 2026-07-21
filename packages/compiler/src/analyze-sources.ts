import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { analyzeHardcodedLiterals } from "./analyze-hardcoded-literals";
import { loadConventionCatalog } from "./catalog";
import {
  isMiraiIntlTransformCandidate,
  transformMiraiIntlSource,
} from "./transform";
import type { MiraiIntlTransformOptions } from "./transform";

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

export type ConventionSourceDiagnostic = Readonly<{
  file: string;
  message: string;
}>;

export type ConventionSourceAnalysis = Readonly<{
  candidates: number;
  diagnostics: ReadonlyArray<ConventionSourceDiagnostic>;
  filesAnalyzed: number;
}>;

export type AnalyzeConventionSourcesOptions = MiraiIntlTransformOptions &
  Readonly<{
    skipSources?: boolean;
  }>;

function parseTransformDiagnostic(
  error: unknown,
  fallbackFile: string
): ConventionSourceDiagnostic {
  if (!(error instanceof Error)) {
    return { file: fallbackFile, message: String(error) };
  }
  const match = /^(.+):(\d+):(\d+): (.+)$/u.exec(error.message);
  if (!match) {
    return { file: fallbackFile, message: error.message };
  }
  return {
    file: match[1] ?? fallbackFile,
    message: `${match[2]}:${match[3]}: ${match[4]}`,
  };
}

async function collectSourceFiles(
  root: string,
  generatedRelative: string
): Promise<Array<string>> {
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
  return files.toSorted((left, right) => left.localeCompare(right));
}

export async function analyzeConventionSources(
  packageRoot: string,
  options: AnalyzeConventionSourcesOptions = {}
): Promise<ConventionSourceAnalysis> {
  if (options.skipSources) {
    return { candidates: 0, diagnostics: [], filesAnalyzed: 0 };
  }

  const loaded = await loadConventionCatalog(packageRoot);
  const root = resolve(options.root ?? loaded.repositoryRoot);
  const generatedDirectory =
    options.generatedDirectory ?? loaded.discovery.output;
  const sourceFiles = await collectSourceFiles(root, generatedDirectory);
  const diagnostics: Array<ConventionSourceDiagnostic> = [];
  let candidates = 0;
  let filesAnalyzed = 0;

  for (const file of sourceFiles) {
    const source = await readFile(file, "utf8");
    filesAnalyzed += 1;

    diagnostics.push(
      ...analyzeHardcodedLiterals({
        filePath: file,
        packageRoot: root,
        source,
      })
    );

    if (!isMiraiIntlTransformCandidate(source, file)) {
      continue;
    }
    candidates += 1;
    try {
      await transformMiraiIntlSource(source, file, {
        generatedDirectory,
        root,
      });
    } catch (error) {
      diagnostics.push(parseTransformDiagnostic(error, file));
    }
  }

  return {
    candidates,
    diagnostics,
    filesAnalyzed,
  };
}
