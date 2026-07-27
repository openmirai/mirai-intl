import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { analyzeHardcodedLiterals } from "./analyze-hardcoded-literals";
import { compareCanonicalStrings, sha256 } from "./canonical";
import { loadConventionCatalog } from "./catalog";
import type { IntlCheckExceptionV1 } from "@openmirai/intl-abi";
import { resolveConventionSourceUniverse } from "./ownership";
import { transformMiraiIntlOwnerBatch } from "./transform";
import type {
  MiraiIntlSemanticBatchObservation,
  MiraiIntlSemanticEvidence,
  MiraiIntlTransformOptions,
} from "./transform";
import ts from "typescript";

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

type ExceptionDiagnostic = ConventionSourceDiagnostic &
  Readonly<{
    nodeHash: `sha256:${string}`;
    rule: "source-analysis";
  }>;

export type ConventionSourceAnalysis = Readonly<{
  candidates: number;
  diagnostics: ReadonlyArray<ConventionSourceDiagnostic>;
  evidence: ReadonlyArray<MiraiIntlSemanticEvidence>;
  filesAnalyzed: number;
}>;

export type AnalyzeConventionSourcesOptions = MiraiIntlTransformOptions &
  Readonly<{
    /** @internal Benchmark/test observation only; never enters receipts. */
    semanticBatchObserver?: (
      owner: string,
      observation: MiraiIntlSemanticBatchObservation
    ) => void;
    /** @internal Phase-1 finite-closure oracle for parity tests/benchmarks. */
    semanticEngine?: "owner-batch" | "reference";
  }>;

function parseTransformDiagnostic(
  error: unknown,
  fallbackFile: string,
  source: string
): ExceptionDiagnostic {
  const fallback = (): ExceptionDiagnostic => ({
    file: fallbackFile,
    message: error instanceof Error ? error.message : String(error),
    nodeHash: sha256(source),
    rule: "source-analysis",
  });
  if (!(error instanceof Error)) {
    return fallback();
  }
  const match = /^(.+):(\d+):(\d+): (.+)$/u.exec(error.message);
  if (!match) {
    return fallback();
  }
  const line = Number(match[2]);
  const column = Number(match[3]);
  const sourceFile = ts.createSourceFile(
    fallbackFile,
    source,
    ts.ScriptTarget.Latest,
    true
  );
  const position = sourceFile.getPositionOfLineAndCharacter(
    Math.max(0, line - 1),
    Math.max(0, column - 1)
  );
  let token: ts.Node = sourceFile;
  const visit = (node: ts.Node): void => {
    if (position < node.getFullStart() || position > node.getEnd()) {
      return;
    }
    token = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    file: match[1] ?? fallbackFile,
    message: `${match[2]}:${match[3]}: ${match[4]}`,
    nodeHash: sha256(token.getFullText(sourceFile)),
    rule: "source-analysis",
  };
}

function applyExactExceptions(
  root: string,
  diagnostics: ReadonlyArray<ExceptionDiagnostic>,
  exceptions: ReadonlyArray<IntlCheckExceptionV1>
): Array<ConventionSourceDiagnostic> {
  const unmatched = new Set(
    exceptions.map(
      (exception) => `${exception.file}:${exception.rule}:${exception.nodeHash}`
    )
  );
  const accepted: Array<ConventionSourceDiagnostic> = [];
  for (const diagnostic of diagnostics) {
    const file = relative(root, diagnostic.file).split(sep).join("/");
    const key = `${file}:${diagnostic.rule}:${diagnostic.nodeHash}`;
    if (unmatched.delete(key)) {
      continue;
    }
    accepted.push(diagnostic);
  }
  for (const key of [...unmatched].toSorted()) {
    accepted.push({
      file: "mirai-intl.config.json",
      message: `Stale or non-matching Mirai Intl check exception ${key}`,
    });
  }
  return accepted;
}

export async function collectConventionSourceFiles(
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
  return files.toSorted(compareCanonicalStrings);
}

export async function analyzeConventionSources(
  packageRoot: string,
  options: AnalyzeConventionSourcesOptions = {}
): Promise<ConventionSourceAnalysis> {
  const loaded = await loadConventionCatalog(packageRoot);
  const root = resolve(options.root ?? loaded.repositoryRoot);
  const generatedDirectory =
    options.generatedDirectory ?? loaded.discovery.output;
  const sourceFiles = await collectConventionSourceFiles(
    root,
    generatedDirectory
  );
  const universe = await resolveConventionSourceUniverse(
    root,
    loaded.checkProjects,
    generatedDirectory,
    sourceFiles
  );
  return analyzeLoadedConventionSourceFiles(
    loaded,
    root,
    generatedDirectory,
    universe.files,
    universe.workspaceRoot,
    options
  );
}

/** Analyze an already-authorized exact source universe without rediscovery. */
export async function analyzeConventionSourceFiles(
  packageRoot: string,
  sourceFiles: ReadonlyArray<string>,
  workspaceRoot: string,
  options: AnalyzeConventionSourcesOptions = {}
): Promise<ConventionSourceAnalysis> {
  const loaded = await loadConventionCatalog(packageRoot);
  const root = resolve(options.root ?? loaded.repositoryRoot);
  const generatedDirectory =
    options.generatedDirectory ?? loaded.discovery.output;
  const universe = await resolveConventionSourceUniverse(
    root,
    loaded.checkProjects,
    generatedDirectory,
    sourceFiles
  );
  const requested = new Set(sourceFiles);
  return analyzeLoadedConventionSourceFiles(
    loaded,
    root,
    generatedDirectory,
    universe.files.filter(({ absolute }) => requested.has(absolute)),
    workspaceRoot,
    options
  );
}

async function analyzeLoadedConventionSourceFiles(
  loaded: Awaited<ReturnType<typeof loadConventionCatalog>>,
  root: string,
  generatedDirectory: string,
  sourceFiles: ReadonlyArray<
    Readonly<{
      absolute: string;
      file: string;
      owner: string;
      ownerCompilerOptions: ts.CompilerOptions;
    }>
  >,
  workspaceRoot: string = root,
  options: AnalyzeConventionSourcesOptions = {}
): Promise<ConventionSourceAnalysis> {
  const diagnostics: Array<ConventionSourceDiagnostic> = [];
  const exceptionDiagnostics: Array<ExceptionDiagnostic> = [];
  let candidates = 0;
  let filesAnalyzed = 0;
  const evidence: Array<MiraiIntlSemanticEvidence> = [];

  const loadedSources = await Promise.all(
    sourceFiles.map(async ({ absolute, owner, ownerCompilerOptions }) => ({
      file: absolute,
      owner,
      ownerCompilerOptions,
      source: await readFile(absolute, "utf8"),
    }))
  );
  for (const { file, source } of loadedSources) {
    filesAnalyzed += 1;
    candidates += 1;
    diagnostics.push(
      ...analyzeHardcodedLiterals({
        filePath: file,
        packageRoot: root,
        source,
      })
    );
  }
  const owners = new Map<string, Array<(typeof loadedSources)[number]>>();
  for (const entry of loadedSources) {
    const entries = owners.get(entry.owner) ?? [];
    entries.push(entry);
    owners.set(entry.owner, entries);
  }
  const {
    semanticBatchObserver: observe,
    semanticEngine = "owner-batch",
    ...transformOptions
  } = options;
  for (const [owner, ownedSources] of [...owners].toSorted(([left], [right]) =>
    compareCanonicalStrings(left, right)
  )) {
    const evidenceByFile = new Map<string, MiraiIntlSemanticEvidence>();
    const results = await transformMiraiIntlOwnerBatch(
      ownedSources.map(({ file, source }) => ({
        authorizationEvidence: {
          record(value) {
            evidenceByFile.set(file, value);
          },
          workspaceRoot,
        },
        id: file,
        source,
      })),
      {
        ...transformOptions,
        generatedDirectory,
        root,
      },
      (observation) => observe?.(owner, observation),
      semanticEngine === "reference",
      {
        compilerOptions: ownedSources[0]?.ownerCompilerOptions ?? {},
      }
    );
    for (const result of results) {
      const source =
        ownedSources.find(({ file }) => file === result.id)?.source ?? "";
      if ("error" in result) {
        exceptionDiagnostics.push(
          parseTransformDiagnostic(result.error, result.id, source)
        );
      }
      const semanticEvidence = evidenceByFile.get(result.id);
      if (!semanticEvidence) {
        throw new Error(
          `Mirai Intl source analysis did not record semantic evidence for ${relative(workspaceRoot, result.id).split(sep).join("/")}`
        );
      }
      evidence.push(semanticEvidence);
    }
  }

  return {
    candidates,
    diagnostics: [
      ...diagnostics,
      ...applyExactExceptions(
        root,
        exceptionDiagnostics,
        loaded.checkExceptions
      ),
    ],
    evidence: evidence.toSorted((left, right) =>
      compareCanonicalStrings(left.source, right.source)
    ),
    filesAnalyzed,
  };
}
