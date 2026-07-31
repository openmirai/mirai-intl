import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { analyzeHardcodedLiterals } from "./analyze-hardcoded-literals";
import { compareCanonicalStrings, decodeUtf8Fatal, sha256 } from "./canonical";
import { loadConventionCatalog } from "./catalog";
import type { MiraiIntlClassifierAuthorityV3 } from "./classifier-authority";
import { createMiraiIntlPreparedCandidateSourceFile } from "./classifier-candidate-shadow";
import {
  assertMiraiIntlClassifierTransactionAuthorityV3,
  assertMiraiIntlClassifierWorkspaceTransactionV3,
} from "./classifier-candidate";
import type { MiraiIntlClassifierWorkspaceTransactionV3 } from "./classifier-candidate";
import type { IntlCheckExceptionV1 } from "@openmirai/intl-abi";
import { resolveConventionSourceUniverse } from "./ownership";
import { collectConventionSourceFiles } from "./source-discovery";
import type { SemanticProviderResolution } from "./semantic-providers";
import { transformMiraiIntlOwnerBatch } from "./transform";
import type {
  MiraiIntlSemanticBatchObservation,
  MiraiIntlSemanticEvidence,
  MiraiIntlTransformOptions,
} from "./transform";
import ts from "typescript";

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
  classifierAuthorities: ReadonlyArray<MiraiIntlClassifierAuthorityV3>;
  classifierProgramFiles: ReadonlyArray<string>;
  diagnostics: ReadonlyArray<ConventionSourceDiagnostic>;
  evidence: ReadonlyArray<MiraiIntlSemanticEvidence>;
  filesAnalyzed: number;
}>;

export type AnalyzeConventionSourcesOptions = MiraiIntlTransformOptions &
  Readonly<{
    /** V3 activation is explicit. Omission retains the pre-activation path. */
    classifier?:
      | Readonly<{
          mode: "approved";
          transaction: MiraiIntlClassifierWorkspaceTransactionV3;
        }>
      | Readonly<{ mode: "safe-unfiltered" }>;
    /** @internal Benchmark/test observation only; never enters receipts. */
    semanticBatchObserver?: (
      owner: string,
      observation: MiraiIntlSemanticBatchObservation
    ) => void;
    /** @internal Phase-1 finite-closure oracle for parity tests/benchmarks. */
    semanticEngine?: "owner-batch" | "reference";
  }>;

export type ConventionSourceSnapshot = Readonly<{
  absolute: string;
  file: string;
  owner: string;
  ownerCompilerOptions: ts.CompilerOptions;
  source: string;
  sourceFile: ts.SourceFile;
  sourceHash: `sha256:${string}`;
}>;

const internalSemanticEngineEnvironment = "MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE";

function classifierFacadeResolutionMaps(
  authority: MiraiIntlClassifierAuthorityV3,
  ownedSources: ReadonlyArray<ConventionSourceSnapshot>
): ReadonlyMap<string, ReadonlyMap<string, SemanticProviderResolution>> {
  const artifact = authority.artifactBinding;
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    throw new Error("Invalid classifier artifact binding");
  }
  const rows = Object.getOwnPropertyDescriptor(
    artifact,
    "facadeResolutionsBySource"
  )?.value;
  if (!Array.isArray(rows)) {
    throw new Error("Classifier artifact omitted facade resolution evidence");
  }
  const expectedSources = new Set(
    ownedSources.map(({ absolute }) => resolve(absolute))
  );
  const result = new Map<
    string,
    ReadonlyMap<string, SemanticProviderResolution>
  >();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid classifier facade resolution row");
    }
    const source = Object.getOwnPropertyDescriptor(value, "source")?.value;
    const resolutions = Object.getOwnPropertyDescriptor(
      value,
      "resolutions"
    )?.value;
    if (typeof source !== "string" || !Array.isArray(resolutions)) {
      throw new Error("Invalid classifier facade resolution row");
    }
    const absolute = resolve(source);
    if (!expectedSources.has(absolute) || result.has(absolute)) {
      throw new Error(
        `Classifier facade resolution source mismatch: ${JSON.stringify(source)}`
      );
    }
    const bySpecifier = new Map<string, SemanticProviderResolution>();
    for (const resolution of resolutions) {
      if (
        !resolution ||
        typeof resolution !== "object" ||
        Array.isArray(resolution)
      ) {
        throw new Error("Invalid classifier facade resolution evidence");
      }
      const specifier = Object.getOwnPropertyDescriptor(
        resolution,
        "specifier"
      )?.value;
      if (typeof specifier !== "string" || bySpecifier.has(specifier)) {
        throw new Error("Invalid classifier facade resolution specifier");
      }
      bySpecifier.set(specifier, resolution as SemanticProviderResolution);
    }
    result.set(absolute, bySpecifier);
  }
  return result;
}

/** Seal exact source bytes and their single shared syntax tree. */
export async function loadConventionSourceSnapshots(
  sourceFiles: ReadonlyArray<
    Readonly<{
      absolute: string;
      file: string;
      owner: string;
      ownerCompilerOptions: ts.CompilerOptions;
    }>
  >
): Promise<ReadonlyArray<ConventionSourceSnapshot>> {
  return Promise.all(
    sourceFiles.map(async (entry) => {
      const bytes = await readFile(entry.absolute);
      const source = decodeUtf8Fatal(
        bytes,
        `Mirai Intl source ${entry.absolute}`
      );
      return {
        ...entry,
        source,
        sourceFile: createMiraiIntlPreparedCandidateSourceFile(
          entry.absolute,
          source,
          entry.ownerCompilerOptions
        ),
        sourceHash: sha256(bytes),
      };
    })
  );
}

function resolveSemanticEngine(
  explicit?: "owner-batch" | "reference"
): "owner-batch" | "reference" {
  if (explicit !== undefined) {
    return explicit;
  }
  const value = process.env[internalSemanticEngineEnvironment];
  if (value === undefined || value === "owner-batch") {
    return "owner-batch";
  }
  if (value === "reference") {
    return "reference";
  }
  throw new Error(
    `Invalid ${internalSemanticEngineEnvironment}: ${JSON.stringify(value)}`
  );
}

function parseTransformDiagnostic(
  error: unknown,
  fallbackFile: string,
  source: string,
  preparedSourceFile?: ts.SourceFile
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
  const sourceFile =
    preparedSourceFile ??
    createMiraiIntlPreparedCandidateSourceFile(fallbackFile, source, {});
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

export { collectConventionSourceFiles } from "./source-discovery";

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

/** @internal Analyze an already-loaded, already-resolved source universe. */
export async function analyzeLoadedConventionSourceFiles(
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
  options: AnalyzeConventionSourcesOptions = {},
  preparedSources?: ReadonlyArray<ConventionSourceSnapshot>,
  classifierProjectControls?: ReadonlyMap<
    string,
    ReadonlyArray<Readonly<{ hash: `sha256:${string}`; path: string }>>
  >
): Promise<ConventionSourceAnalysis> {
  const profileStarted = performance.now();
  let profilePrior = profileStarted;
  const profilePhases: Array<
    Readonly<{ milliseconds: number; phase: string }>
  > = [];
  const markProfilePhase = (phase: string): void => {
    if (process.env.MIRAI_INTL_INTERNAL_ANALYZE_PROFILE !== "1") {
      return;
    }
    const now = performance.now();
    profilePhases.push({ milliseconds: now - profilePrior, phase });
    profilePrior = now;
  };
  const diagnostics: Array<ConventionSourceDiagnostic> = [];
  const exceptionDiagnostics: Array<ExceptionDiagnostic> = [];
  let candidates = 0;
  let filesAnalyzed = 0;
  const evidence: Array<MiraiIntlSemanticEvidence> = [];
  const classifierAuthorities: Array<MiraiIntlClassifierAuthorityV3> = [];
  const classifierProgramFiles: Array<string> = [];

  const loadedSources =
    preparedSources ?? (await loadConventionSourceSnapshots(sourceFiles));
  if (
    new Set(sourceFiles.map(({ absolute }) => absolute)).size !==
      sourceFiles.length ||
    new Set(loadedSources.map(({ absolute }) => absolute)).size !==
      loadedSources.length
  ) {
    throw new Error("Duplicate Mirai Intl source path in analysis universe");
  }
  const expectedSources = new Map(
    sourceFiles.map((entry) => [entry.absolute, entry])
  );
  if (
    loadedSources.length !== sourceFiles.length ||
    loadedSources.some((entry) => {
      const expected = expectedSources.get(entry.absolute);
      return (
        !expected ||
        expected.file !== entry.file ||
        expected.owner !== entry.owner ||
        expected.ownerCompilerOptions !== entry.ownerCompilerOptions
      );
    })
  ) {
    throw new Error(
      "Prepared Mirai Intl source snapshot does not match its source universe"
    );
  }
  for (const { absolute, source, sourceFile } of loadedSources) {
    filesAnalyzed += 1;
    candidates += 1;
    diagnostics.push(
      ...analyzeHardcodedLiterals({
        filePath: absolute,
        packageRoot: root,
        source,
        sourceFile,
      })
    );
  }
  markProfilePhase("lexical-source-analysis");
  const owners = new Map<string, Array<(typeof loadedSources)[number]>>();
  for (const entry of loadedSources) {
    const entries = owners.get(entry.owner) ?? [];
    entries.push(entry);
    owners.set(entry.owner, entries);
  }
  const {
    classifier,
    semanticBatchObserver: observe,
    semanticEngine: explicitSemanticEngine,
    ...transformOptions
  } = options;
  const semanticEngine = resolveSemanticEngine(explicitSemanticEngine);
  if (
    classifier !== undefined &&
    classifier.mode !== "approved" &&
    classifier.mode !== "safe-unfiltered"
  ) {
    throw new Error("Invalid Mirai Intl classifier activation mode");
  }
  if (classifier?.mode === "approved") {
    await assertMiraiIntlClassifierWorkspaceTransactionV3(
      classifier.transaction,
      workspaceRoot
    );
  }
  for (const [owner, ownedSources] of [...owners].toSorted(([left], [right]) =>
    compareCanonicalStrings(left, right)
  )) {
    const ownerCompilerOptions = ownedSources[0]?.ownerCompilerOptions ?? {};
    let classifierFacadeResolutions = new Map<
      string,
      ReadonlyMap<string, SemanticProviderResolution>
    >();
    let semanticSources = ownedSources;
    if (classifier?.mode === "approved") {
      const projectControls = classifierProjectControls?.get(owner);
      const authorityRequest = {
        generatedFacadePath: resolve(root, generatedDirectory, "index.ts"),
        options: ownerCompilerOptions,
        owner,
        ...(projectControls ? { projectControls } : {}),
        sources: ownedSources.map(({ absolute, source, sourceFile }) => ({
          id: absolute,
          preparedSourceFile: sourceFile,
          source,
        })),
        workspaceRoot,
      };
      const authority =
        await classifier.transaction.authorize(authorityRequest);
      await assertMiraiIntlClassifierTransactionAuthorityV3(
        classifier.transaction,
        authorityRequest,
        authority
      );
      classifierAuthorities.push(authority);
      classifierFacadeResolutions = new Map(
        classifierFacadeResolutionMaps(authority, ownedSources)
      );
      const decisions = new Map(
        authority.sources.map((source) => [resolve(source.source), source])
      );
      semanticSources = ownedSources.filter(({ absolute }) => {
        const decision = decisions.get(resolve(absolute));
        if (!decision) {
          throw new Error(
            `Mirai Intl classifier authority omitted ${relative(workspaceRoot, absolute).split(sep).join("/")}`
          );
        }
        return decision.requiresProgram;
      });
      if (decisions.size !== ownedSources.length) {
        throw new Error(
          `Mirai Intl classifier authority source universe mismatch for ${owner}`
        );
      }
      markProfilePhase(`classifier:${owner}`);
    }
    classifierProgramFiles.push(
      ...semanticSources.map(({ absolute }) => absolute)
    );
    const evidenceByFile = new Map<string, MiraiIntlSemanticEvidence>();
    const results = await transformMiraiIntlOwnerBatch(
      semanticSources.map(({ absolute, source, sourceFile }) => {
        const classifierFacadeResolution = classifierFacadeResolutions.get(
          resolve(absolute)
        );
        return {
          authorizationEvidence: {
            record(value) {
              evidenceByFile.set(absolute, value);
            },
            workspaceRoot,
          },
          ...(classifierFacadeResolution
            ? {
                classifierFacadeResolutions: classifierFacadeResolution,
              }
            : {}),
          id: absolute,
          source,
          sourceFile,
        };
      }),
      {
        ...transformOptions,
        generatedDirectory,
        root,
      },
      (observation) => observe?.(owner, observation),
      semanticEngine === "reference",
      {
        compilerOptions: ownerCompilerOptions,
      },
      true
    );
    markProfilePhase(`semantic:${owner}`);
    for (const result of results) {
      const sourceSnapshot = ownedSources.find(
        ({ absolute }) => absolute === result.id
      );
      const source = sourceSnapshot?.source ?? "";
      if ("error" in result) {
        exceptionDiagnostics.push(
          parseTransformDiagnostic(
            result.error,
            result.id,
            source,
            sourceSnapshot?.sourceFile
          )
        );
      }
      const semanticEvidence = evidenceByFile.get(result.id);
      if (!semanticEvidence) {
        if ("error" in result) {
          continue;
        }
        throw new Error(
          `Mirai Intl source analysis did not record semantic evidence for ${relative(workspaceRoot, result.id).split(sep).join("/")}`
        );
      }
      if (semanticEvidence.sourceHash !== sourceSnapshot?.sourceHash) {
        throw new Error(
          `Mirai Intl semantic evidence source hash changed for ${relative(workspaceRoot, result.id).split(sep).join("/")}`
        );
      }
      evidence.push(semanticEvidence);
    }
  }

  if (process.env.MIRAI_INTL_INTERNAL_ANALYZE_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_ANALYZE_PROFILE=${JSON.stringify({
        phases: profilePhases,
        totalMilliseconds: performance.now() - profileStarted,
      })}\n`
    );
  }

  return {
    candidates,
    classifierAuthorities: classifierAuthorities.toSorted((left, right) =>
      compareCanonicalStrings(left.inputHash, right.inputHash)
    ),
    classifierProgramFiles: classifierProgramFiles.toSorted(
      compareCanonicalStrings
    ),
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
