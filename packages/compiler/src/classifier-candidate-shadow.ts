import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import ts from "typescript";
import { GeneratedFacadeProjectionProofKindV3 } from "@openmirai/intl-abi";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical";
import type { SemanticProviderResolution } from "./semantic-providers";
import {
  classifyMiraiIntlModuleBoundariesShadow,
  hashMiraiIntlClassifierBoundariesShadow,
  miraiIntlClassifierDecisionVectorShadow,
} from "./transform";
import type {
  MiraiIntlClassifierBoundaryKind,
  MiraiIntlClassifierBoundaryTuple,
  MiraiIntlClassifierShadowBoundary,
  MiraiIntlClassifierShadowLedgerEntry,
  MiraiIntlClassifierShadowRequest,
  MiraiIntlClassifierShadowResult,
  MiraiIntlClassifierShadowUnknownBoundary,
} from "./transform";

export type MiraiIntlCandidateFallbackReason =
  | "custom-conditions-ambiguous"
  | "package-exports-ambiguous"
  | "package-imports-ambiguous"
  | "path-projection-ambiguous"
  | "preserve-symlinks"
  | "resolution-mode-ambiguous"
  | "root-dirs-ambiguous"
  | "symlink-boundary-ambiguous"
  | "unsupported-module-resolution";

export type MiraiIntlCandidateProjectionShadow = Readonly<{
  boundary: number;
  canonicalRoot: string;
  lexicalRoot: string;
  proofKind: GeneratedFacadeProjectionProofKindV3;
  status: "candidate" | "disjoint";
}>;

type MiraiIntlCandidateProof =
  | Readonly<{ status: "ambiguous"; targets: ReadonlyArray<string> }>
  | Readonly<{ status: "proven-candidate"; targets: ReadonlyArray<string> }>
  | Readonly<{ status: "proven-disjoint"; targets: ReadonlyArray<string> }>;

export type MiraiIntlPortableLstatShadow = Readonly<{
  kind: "absent" | "directory" | "file" | "other" | "symlink";
  linkTargetBase64: string | null;
  linkTargetHash: `sha256:${string}` | null;
  path: string;
}>;

export type MiraiIntlGeneratedFacadeCandidateIndexShadow = Readonly<{
  activeConditions: ReadonlyArray<string>;
  analyzerAbi: "mirai-intl-classifier-v3-shadow";
  canonicalRoot: string;
  barePackageProofs: ReadonlyArray<
    Readonly<{
      boundary: number;
      controlFiles: MiraiIntlClassifierShadowRequest["frontier"]["controlFiles"];
      packageName: string | null;
      packageVersion: string | null;
      resolvedFileName: string | null;
      resolverFrontierHash: `sha256:${string}`;
      status: "candidate" | "proven-disjoint";
    }>
  >;
  candidateBoundaryRefs: ReadonlyArray<number>;
  controls: ReadonlyArray<Readonly<{ hash: `sha256:${string}`; path: string }>>;
  facade: string;
  indexHash: `sha256:${string}`;
  lexicalRoot: string;
  lstats: ReadonlyArray<MiraiIntlPortableLstatShadow>;
  mode: "filtered" | "owner-fallback";
  optionsHash: `sha256:${string}`;
  owner: string;
  packageTopology: ReadonlyArray<
    Readonly<{
      canonicalRoot: string;
      manifest: MiraiIntlPortableLstatShadow;
      manifestHash: `sha256:${string}` | null;
      root: MiraiIntlPortableLstatShadow;
    }>
  >;
  packageScopes: ReadonlyArray<
    Readonly<{
      canonicalRoot: string;
      lexicalRoot: string;
      manifestHash: `sha256:${string}`;
      manifestPath: string;
    }>
  >;
  probes: ReadonlyArray<
    Readonly<{
      kind: "directory" | "file";
      path: string;
      present: boolean;
    }>
  >;
  projections: ReadonlyArray<MiraiIntlCandidateProjectionShadow>;
  realpaths: ReadonlyArray<Readonly<{ path: string; target: string }>>;
  reasons: ReadonlyArray<MiraiIntlCandidateFallbackReason>;
  resolverFrontier: MiraiIntlClassifierShadowRequest["frontier"];
  resolverFrontierHash: `sha256:${string}`;
}>;

export type MiraiIntlCandidateShadowSource = Readonly<{
  id: string;
  /** @internal Exact transaction-local syntax tree prepared from `source`. */
  preparedSourceFile?: ts.SourceFile;
  source: string;
}>;

export type MiraiIntlCandidateCheckpointShadow = Readonly<{
  artifactHash: `sha256:${string}`;
  boundaryCategoryCounts: Readonly<Record<string, number>>;
  candidateRequests: number;
  candidateSet: ReadonlyArray<number>;
  checkpointAHash: `sha256:${string}`;
  fallbackReasonCounts: Readonly<Record<string, number>>;
  falseNegatives: number;
  falsePositives: number;
  facadeResolutionsBySource: ReadonlyArray<
    Readonly<{
      resolutions: ReadonlyArray<SemanticProviderResolution>;
      source: string;
    }>
  >;
  facadeImports: number;
  index: MiraiIntlGeneratedFacadeCandidateIndexShadow;
  optimizedFacadeSet: ReadonlyArray<number>;
  optimizedRequiresProgramVector: ReadonlyArray<readonly [string, boolean]>;
  optimizedRequiresProgramVectorHash: `sha256:${string}`;
  ownerFallbacks: number;
  ownerMode: "filtered" | "owner-fallback";
  referenceBoundaries: number;
  referenceFacadeSet: ReadonlyArray<number>;
  referenceRequiresProgramVector: ReadonlyArray<readonly [string, boolean]>;
  referenceRequiresProgramVectorHash: `sha256:${string}`;
  sourceCount: number;
  sources: ReadonlyArray<
    MiraiIntlClassifierShadowResult &
      Readonly<{ sourceHash: `sha256:${string}` }>
  >;
  timings: Readonly<Record<string, number>>;
  unknownBoundaries: number;
  resolverCounters: Readonly<{
    cacheHits: number;
    hostCalls: number;
    programs: 0;
    resolverCalls: number;
  }>;
  resolverFrontier: MiraiIntlClassifierShadowRequest["frontier"];
}>;

function within(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return value === "" || (!value.startsWith(`..${sep}`) && value !== "..");
}

function normalizedOptions(
  options: ts.CompilerOptions,
  workspaceRoot: string
): unknown {
  const normalize = (value: unknown): unknown => {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      return value;
    }
    if (typeof value === "string") {
      const absolute = isAbsolute(value) ? resolve(value) : undefined;
      if (absolute && within(resolve(workspaceRoot), absolute)) {
        return relative(resolve(workspaceRoot), absolute).split(sep).join("/");
      }
      return value.replaceAll("\\", "/").normalize("NFC");
    }
    if (Array.isArray(value)) {
      return value.map(normalize);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
          .map(([key, entry]) => [key, normalize(entry)])
      );
    }
    throw new Error("Classifier project options must be canonical JSON");
  };
  return normalize(options);
}

export function hashMiraiIntlClassifierProjectOptionsV3(
  projectPath: string,
  options: ts.CompilerOptions,
  workspaceRoot: string
): `sha256:${string}` {
  return sha256(
    canonicalJson([
      "mirai-intl",
      "project-normalized-options",
      3,
      [projectPath, normalizedOptions(options, workspaceRoot)],
    ])
  );
}

function packageTargetProof(
  value: unknown,
  conditions: ReadonlySet<string>
): MiraiIntlCandidateProof {
  if (typeof value === "string") {
    return { status: "proven-candidate", targets: [value] };
  }
  if (value === null) {
    return { status: "proven-disjoint", targets: [] };
  }
  if (Array.isArray(value)) {
    const proofs = value.map((entry) => packageTargetProof(entry, conditions));
    if (proofs.some(({ status }) => status === "ambiguous")) {
      return { status: "ambiguous", targets: [] };
    }
    const selectedTargets = proofs.flatMap(
      ({ targets: proofTargets }) => proofTargets
    );
    return selectedTargets.length <= 1
      ? {
          status:
            selectedTargets.length === 1
              ? "proven-candidate"
              : "proven-disjoint",
          targets: selectedTargets,
        }
      : { status: "ambiguous", targets: selectedTargets };
  }
  if (value !== null && typeof value === "object") {
    for (const [condition, target] of Object.entries(value)) {
      if (condition === "default" || conditions.has(condition)) {
        return packageTargetProof(target, conditions);
      }
    }
    return { status: "proven-disjoint", targets: [] };
  }
  return { status: "ambiguous", targets: [] };
}

function activeConditions(
  options: ts.CompilerOptions,
  resolutionMode: "default" | "import" | "require"
): ReadonlySet<string> {
  return new Set([
    "types",
    ...(resolutionMode === "require" ? ["require"] : ["import"]),
    ...(options.moduleResolution === ts.ModuleResolutionKind.Bundler
      ? []
      : ["node"]),
    ...(options.customConditions ?? []),
  ]);
}

function targetForms(path: string): ReadonlyArray<string> {
  const withoutExtension = path.replace(/\.[^./]+$/u, "");
  const withoutIndex = withoutExtension.replace(/\/index$/u, "");
  return [...new Set([path, withoutExtension, withoutIndex])];
}

function facadeSpecifiersFromExports(
  packageName: string,
  packageRoot: string,
  exportsValue: unknown,
  facadePath: string,
  conditions: ReadonlySet<string>
): Readonly<{
  specifiers: ReadonlyArray<string>;
  status: "ambiguous" | "proven";
}> {
  const entries =
    exportsValue !== null &&
    typeof exportsValue === "object" &&
    !Array.isArray(exportsValue) &&
    Object.keys(exportsValue).some((key) => key.startsWith("."))
      ? Object.entries(exportsValue)
      : [[".", exportsValue] as const];
  const facadeForms = targetForms(
    `./${relative(packageRoot, facadePath).split(sep).join("/")}`
  );
  const specifiers = new Set<string>();
  for (const [subpath, target] of entries) {
    const targetProof = packageTargetProof(target, conditions);
    if (targetProof.status === "ambiguous") {
      return { specifiers: [], status: "ambiguous" };
    }
    for (const selectedTarget of targetProof.targets) {
      const star = selectedTarget.indexOf("*");
      if (star < 0) {
        if (
          targetForms(selectedTarget).some((entry) =>
            facadeForms.includes(entry)
          )
        ) {
          specifiers.add(
            subpath === "." ? packageName : `${packageName}/${subpath.slice(2)}`
          );
        }
        continue;
      }
      const prefix = selectedTarget.slice(0, star);
      const suffix = selectedTarget.slice(star + 1);
      const form = facadeForms
        .toReversed()
        .find((entry) => entry.startsWith(prefix) && entry.endsWith(suffix));
      if (!form || !subpath.includes("*")) {
        continue;
      }
      const wildcard = form.slice(prefix.length, form.length - suffix.length);
      const matchedSubpath = subpath.replace("*", wildcard);
      specifiers.add(
        matchedSubpath === "."
          ? packageName
          : `${packageName}/${matchedSubpath.slice(2)}`
      );
    }
  }
  return { specifiers: [...specifiers], status: "proven" };
}

function winningPackageMapTarget(
  map: unknown,
  specifier: string
): Readonly<{ target: unknown; wildcard: string }> | undefined {
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    return undefined;
  }
  const exact = Object.entries(map).find(([key]) => key === specifier);
  if (exact) {
    return { target: exact[1], wildcard: "" };
  }
  let winner:
    | Readonly<{ prefix: string; suffix: string; target: unknown }>
    | undefined;
  for (const [pattern, target] of Object.entries(map)) {
    const star = pattern.indexOf("*");
    if (star < 0 || pattern.indexOf("*", star + 1) >= 0) {
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (!winner || prefix.length > winner.prefix.length)
    ) {
      winner = { prefix, suffix, target };
    }
  }
  return winner
    ? {
        target: winner.target,
        wildcard: specifier.slice(
          winner.prefix.length,
          specifier.length - winner.suffix.length
        ),
      }
    : undefined;
}

function winningPathSubstitutions(
  specifier: string,
  options: ts.CompilerOptions
): ReadonlyArray<string> | undefined {
  const entries = Object.entries(options.paths ?? {});
  const exact = entries.find(([pattern]) => pattern === specifier);
  let selected = exact;
  if (!selected) {
    let longest = -1;
    for (const entry of entries) {
      const star = entry[0].indexOf("*");
      if (star < 0 || entry[0].indexOf("*", star + 1) >= 0) {
        continue;
      }
      const prefix = entry[0].slice(0, star);
      const suffix = entry[0].slice(star + 1);
      if (
        specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        prefix.length > longest
      ) {
        selected = entry;
        longest = prefix.length;
      }
    }
  }
  if (!selected) {
    return undefined;
  }
  const star = selected[0].indexOf("*");
  const prefix = star < 0 ? selected[0] : selected[0].slice(0, star);
  const suffix = star < 0 ? "" : selected[0].slice(star + 1);
  const wildcard =
    star < 0
      ? ""
      : specifier.slice(prefix.length, specifier.length - suffix.length);
  return selected[1].map((target) => target.replace("*", wildcard));
}

function projectedPaths(
  boundary: MiraiIntlClassifierShadowBoundary,
  options: ts.CompilerOptions
): Readonly<{
  paths: ReadonlyArray<string>;
  proofKind: GeneratedFacadeProjectionProofKindV3;
}> {
  if (isAbsolute(boundary.specifier)) {
    return {
      paths: [resolve(boundary.specifier)],
      proofKind: GeneratedFacadeProjectionProofKindV3.ABSOLUTE_DIRECT,
    };
  }
  if (boundary.specifier.startsWith(".")) {
    const direct = resolve(dirname(boundary.source), boundary.specifier);
    const roots = options.rootDirs ?? [];
    const containingRoot = roots.find((root) =>
      within(resolve(root), dirname(boundary.source))
    );
    if (!containingRoot) {
      return {
        paths: [direct],
        proofKind: GeneratedFacadeProjectionProofKindV3.RELATIVE_DIRECT,
      };
    }
    const virtual = relative(resolve(containingRoot), direct);
    return {
      paths: roots.map((root) => resolve(root, virtual)),
      proofKind: GeneratedFacadeProjectionProofKindV3.RELATIVE_ROOT_DIRS,
    };
  }
  const substitutions = winningPathSubstitutions(boundary.specifier, options);
  if (substitutions) {
    const configPath =
      typeof options.configFilePath === "string" ? options.configFilePath : "";
    const base = resolve(options.baseUrl ?? dirname(configPath));
    return {
      paths: substitutions.map((target) =>
        isAbsolute(target) ? resolve(target) : resolve(base, target)
      ),
      proofKind: GeneratedFacadeProjectionProofKindV3.TSCONFIG_PATHS,
    };
  }
  if (options.baseUrl) {
    return {
      paths: [resolve(options.baseUrl, boundary.specifier)],
      proofKind: GeneratedFacadeProjectionProofKindV3.TSCONFIG_BASE_URL,
    };
  }
  return {
    paths: [],
    proofKind: GeneratedFacadeProjectionProofKindV3.UNMAPPED_EXTERNAL,
  };
}

async function portableLstat(
  path: string
): Promise<MiraiIntlPortableLstatShadow> {
  try {
    const value = await lstat(path);
    if (value.isSymbolicLink()) {
      const target = Buffer.from(await readlink(path));
      return {
        kind: "symlink",
        linkTargetBase64: target.toString("base64"),
        linkTargetHash: sha256(target),
        path,
      };
    }
    let kind: "directory" | "file" | "other" = "other";
    if (value.isDirectory()) {
      kind = "directory";
    } else if (value.isFile()) {
      kind = "file";
    }
    return {
      kind,
      linkTargetBase64: null,
      linkTargetHash: null,
      path,
    };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
    return {
      kind: "absent",
      linkTargetBase64: null,
      linkTargetHash: null,
      path,
    };
  }
}

function candidateBySpecifier(
  boundary: MiraiIntlClassifierShadowBoundary,
  projected: ReadonlyArray<string>,
  facadeRoot: string,
  facadeSpecifiers: ReadonlySet<string>
): boolean {
  if (facadeSpecifiers.has(boundary.specifier)) {
    return true;
  }
  return projected.some(
    (path) => within(facadeRoot, path) || within(path, facadeRoot)
  );
}

function candidateScriptKind(path: string): ts.ScriptKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (lower.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (lower.endsWith(".json")) {
    return ts.ScriptKind.JSON;
  }
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs")
  ) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function candidateResolutionMode(
  mode: ts.ResolutionMode
): "default" | "import" | "require" | undefined {
  if (mode === undefined) {
    return "default";
  }
  if (mode === ts.ModuleKind.ESNext) {
    return "import";
  }
  if (mode === ts.ModuleKind.CommonJS) {
    return "require";
  }
  return undefined;
}

function rawCandidateResolutionMode(
  mode: MiraiIntlClassifierShadowBoundary["resolutionMode"]
): ts.ResolutionMode {
  if (mode === "import") {
    return ts.ModuleKind.ESNext;
  }
  if (mode === "require") {
    return ts.ModuleKind.CommonJS;
  }
  return undefined;
}

function cleanCandidateModuleId(id: string): string {
  return resolve(id.replace(/[?#].*$/u, ""));
}

type PreparedCandidateSourceBinding = Readonly<{
  cleanId: string;
  impliedNodeFormat: ts.ResolutionMode;
  scriptKind: ts.ScriptKind;
  sourceHash: `sha256:${string}`;
  syntaxHash: `sha256:${string}`;
}>;

const preparedCandidateSourceBindings = new WeakMap<
  ts.SourceFile,
  PreparedCandidateSourceBinding
>();

function updateCandidateSyntaxHash(
  hash: ReturnType<typeof createHash>,
  node: ts.Node
): void {
  const tokenText =
    !ts.isSourceFile(node) &&
    "text" in node &&
    typeof (node as Readonly<{ text?: unknown }>).text === "string"
      ? (node as Readonly<{ text: string }>).text
      : "";
  hash.update(
    `(${node.kind}:${node.pos}:${node.end}:${JSON.stringify(tokenText)}`
  );
  ts.forEachChild(node, (child) => updateCandidateSyntaxHash(hash, child));
  hash.update(")");
}

function candidateSyntaxHash(sourceFile: ts.SourceFile): `sha256:${string}` {
  const hash = createHash("sha256");
  updateCandidateSyntaxHash(hash, sourceFile);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Prepare the one syntax tree shared by lexical analysis, classification, and
 * semantic analysis. The private weak binding prevents arbitrary AST injection;
 * the AST itself is intentionally neither serialized nor frozen.
 */
export function createMiraiIntlPreparedCandidateSourceFile(
  id: string,
  source: string,
  options: ts.CompilerOptions
): ts.SourceFile {
  const cleanId = cleanCandidateModuleId(id);
  const impliedNodeFormat = ts.getImpliedNodeFormatForFile(
    cleanId,
    undefined,
    ts.sys,
    options
  );
  const scriptKind = candidateScriptKind(cleanId);
  const sourceFile = ts.createSourceFile(
    cleanId,
    source,
    {
      impliedNodeFormat,
      languageVersion: ts.ScriptTarget.Latest,
    },
    true,
    scriptKind
  );
  preparedCandidateSourceBindings.set(sourceFile, {
    cleanId,
    impliedNodeFormat,
    scriptKind,
    sourceHash: sha256(source),
    syntaxHash: candidateSyntaxHash(sourceFile),
  });
  return sourceFile;
}

function preparedCandidateSourceBinding(
  source: MiraiIntlCandidateShadowSource,
  options: ts.CompilerOptions
): PreparedCandidateSourceBinding | undefined {
  const sourceFile = source.preparedSourceFile;
  if (!sourceFile) {
    return undefined;
  }
  const binding = preparedCandidateSourceBindings.get(sourceFile);
  const cleanId = cleanCandidateModuleId(source.id);
  const impliedNodeFormat = ts.getImpliedNodeFormatForFile(
    cleanId,
    undefined,
    ts.sys,
    options
  );
  if (
    !binding ||
    binding.cleanId !== cleanId ||
    binding.impliedNodeFormat !== impliedNodeFormat ||
    binding.scriptKind !== candidateScriptKind(cleanId) ||
    binding.sourceHash !== sha256(source.source) ||
    sourceFile.fileName !== cleanId ||
    sourceFile.text !== source.source ||
    sourceFile.impliedNodeFormat !== impliedNodeFormat
  ) {
    throw new Error("Invalid Mirai Intl prepared classifier source binding");
  }
  return binding;
}

type ScannedCandidateSource = Readonly<{
  boundaries: ReadonlyArray<MiraiIntlClassifierShadowBoundary>;
  cleanId: string;
  source: string;
  unknownBoundaries: ReadonlyArray<MiraiIntlClassifierShadowUnknownBoundary>;
}>;

function scanCandidateSources(
  sources: ReadonlyArray<MiraiIntlCandidateShadowSource>,
  options: ts.CompilerOptions,
  observe?: (mode: "parsed" | "prepared") => void
): ReadonlyArray<ScannedCandidateSource> {
  return sources.map((entry) => {
    const { id, source } = entry;
    const cleanId = cleanCandidateModuleId(id);
    const preparedBinding = preparedCandidateSourceBinding(entry, options);
    observe?.(preparedBinding ? "prepared" : "parsed");
    const sourceFile =
      entry.preparedSourceFile ??
      createMiraiIntlPreparedCandidateSourceFile(id, source, options);
    const boundaries: Array<MiraiIntlClassifierShadowBoundary> = [];
    const unknownBoundaries: Array<MiraiIntlClassifierShadowUnknownBoundary> =
      [];
    let boundaryOrdinal = 0;
    let observationOrdinal = 0;
    const record = (
      kind: MiraiIntlClassifierBoundaryKind,
      node: ts.Node,
      moduleReference: ts.StringLiteralLike | undefined
    ): void => {
      const observation = observationOrdinal++;
      if (!moduleReference) {
        const start = node.getStart(sourceFile);
        const end = node.getEnd();
        const byteStart = Buffer.byteLength(source.slice(0, start));
        const byteEnd = Buffer.byteLength(source.slice(0, end));
        const sourceSliceHash = sha256(Buffer.from(source.slice(start, end)));
        const nodeKind = ts.SyntaxKind[node.kind] ?? String(node.kind);
        unknownBoundaries.push({
          byteEnd,
          byteStart,
          kind,
          nodeHash: sha256(
            canonicalJson([
              "mirai-intl",
              "unknown-boundary-node",
              3,
              [
                kind,
                nodeKind,
                observation,
                "nonliteral-specifier",
                cleanId,
                byteStart,
                byteEnd,
                sourceSliceHash,
              ],
            ])
          ),
          nodeKind,
          observationOrdinal: observation,
          reason: "nonliteral-specifier",
          source: cleanId,
          sourceSliceHash,
        });
        return;
      }
      const resolutionMode = candidateResolutionMode(
        ts.getModeForUsageLocation(sourceFile, moduleReference, options)
      );
      if (!resolutionMode) {
        const start = moduleReference.getStart(sourceFile);
        const end = moduleReference.getEnd();
        const byteStart = Buffer.byteLength(source.slice(0, start));
        const byteEnd = Buffer.byteLength(source.slice(0, end));
        const sourceSliceHash = sha256(Buffer.from(source.slice(start, end)));
        const nodeKind =
          ts.SyntaxKind[moduleReference.kind] ?? String(moduleReference.kind);
        unknownBoundaries.push({
          byteEnd,
          byteStart,
          kind,
          nodeHash: sha256(
            canonicalJson([
              "mirai-intl",
              "unknown-boundary-node",
              3,
              [
                kind,
                nodeKind,
                observation,
                "unknown-resolution-mode",
                cleanId,
                byteStart,
                byteEnd,
                sourceSliceHash,
              ],
            ])
          ),
          nodeKind,
          observationOrdinal: observation,
          reason: "unknown-resolution-mode",
          source: cleanId,
          sourceSliceHash,
        });
        return;
      }
      boundaries.push({
        impliedNodeFormat:
          candidateResolutionMode(sourceFile.impliedNodeFormat) ?? "default",
        kind,
        nodeKind:
          ts.SyntaxKind[moduleReference.kind] ?? String(moduleReference.kind),
        observationOrdinal: observation,
        ordinal: boundaryOrdinal++,
        resolutionMode,
        source: cleanId,
        sourceExtension: cleanId.slice(cleanId.lastIndexOf(".")),
        specifier: moduleReference.text,
      });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        record(
          "import",
          node,
          ts.isStringLiteralLike(node.moduleSpecifier)
            ? node.moduleSpecifier
            : undefined
        );
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        record(
          "export",
          node,
          ts.isStringLiteralLike(node.moduleSpecifier)
            ? node.moduleSpecifier
            : undefined
        );
      } else if (
        ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)
      ) {
        const expression = node.moduleReference.expression;
        record(
          "import-equals",
          node,
          expression && ts.isStringLiteralLike(expression)
            ? expression
            : undefined
        );
      } else if (ts.isImportTypeNode(node)) {
        const argument = node.argument;
        record(
          "import-type",
          node,
          ts.isLiteralTypeNode(argument) &&
            ts.isStringLiteralLike(argument.literal)
            ? argument.literal
            : undefined
        );
      } else if (
        ts.isModuleDeclaration(node) &&
        ts.isStringLiteral(node.name)
      ) {
        record("module-declaration", node, node.name);
      } else if (ts.isCallExpression(node)) {
        const argument = node.arguments[0];
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          record(
            "dynamic-import",
            node,
            argument && ts.isStringLiteralLike(argument) ? argument : undefined
          );
        } else if (
          ts.isIdentifier(node.expression) &&
          node.expression.text === "require"
        ) {
          record(
            "require",
            node,
            argument && ts.isStringLiteralLike(argument) ? argument : undefined
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (
      preparedBinding &&
      candidateSyntaxHash(sourceFile) !== preparedBinding.syntaxHash
    ) {
      throw new Error("Mirai Intl prepared classifier source AST mutated");
    }
    return { boundaries, cleanId, source, unknownBoundaries };
  });
}

async function classifyCandidateReferenceTransaction(
  input: Readonly<{
    generatedFacadePath: string;
    options: ts.CompilerOptions;
    sources: ReadonlyArray<MiraiIntlCandidateShadowSource>;
    sourceObserver?: ((mode: "parsed" | "prepared") => void) | undefined;
    workspaceRoot: string;
  }>,
  selectedBoundaryRefs?: ReadonlySet<number>,
  scannedSources?: ReadonlyArray<ScannedCandidateSource>
): Promise<
  Readonly<{
    counters: Readonly<{
      cacheHits: number;
      hostCalls: number;
      programs: 0;
      resolverCalls: number;
    }>;
    frontier: MiraiIntlClassifierShadowRequest["frontier"];
    results: ReadonlyArray<
      MiraiIntlClassifierShadowResult &
        Readonly<{ sourceHash: `sha256:${string}` }>
    >;
  }>
> {
  const canonicalFacade = await realpath(input.generatedFacadePath);
  const canonicalFileName = ts.sys.useCaseSensitiveFileNames
    ? (path: string) => path
    : (path: string) => path.toLowerCase();
  const cache = ts.createModuleResolutionCache(
    resolve(input.workspaceRoot),
    canonicalFileName,
    input.options
  );
  const resolverOptionsIdentity = sha256(
    canonicalJson(normalizedOptions(input.options, input.workspaceRoot))
  );
  let hostCalls = 0;
  let currentProbes = new Map<
    string,
    Readonly<{ kind: "directory" | "file"; path: string; present: boolean }>
  >();
  let currentControls = new Map<
    string,
    Readonly<{ hash: `sha256:${string}`; path: string }>
  >();
  let currentRealpaths = new Map<string, string>();
  const globalProbes = new Map<
    string,
    Readonly<{ kind: "directory" | "file"; path: string; present: boolean }>
  >();
  const globalControls = new Map<
    string,
    Readonly<{ hash: `sha256:${string}`; path: string }>
  >();
  const globalRealpaths = new Map<string, string>();
  const host: ts.ModuleResolutionHost = {
    ...ts.sys,
    directoryExists(path) {
      hostCalls += 1;
      const present = ts.sys.directoryExists?.(path) ?? false;
      currentProbes.set(`directory\0${path}`, {
        kind: "directory",
        path: resolve(path),
        present,
      });
      globalProbes.set(`directory\0${path}`, {
        kind: "directory",
        path: resolve(path),
        present,
      });
      return present;
    },
    fileExists(path) {
      hostCalls += 1;
      const present = ts.sys.fileExists(path);
      currentProbes.set(`file\0${path}`, {
        kind: "file",
        path: resolve(path),
        present,
      });
      globalProbes.set(`file\0${path}`, {
        kind: "file",
        path: resolve(path),
        present,
      });
      return present;
    },
    readFile(path) {
      hostCalls += 1;
      const value = ts.sys.readFile(path);
      if (value !== undefined) {
        const control = {
          hash: sha256(readFileSync(path)),
          path: resolve(path),
        } as const;
        currentControls.set(resolve(path), control);
        globalControls.set(resolve(path), control);
      }
      return value;
    },
    realpath(path) {
      hostCalls += 1;
      const target = ts.sys.realpath?.(path) ?? resolve(path);
      currentRealpaths.set(resolve(path), resolve(target));
      globalRealpaths.set(resolve(path), resolve(target));
      return target;
    },
  };
  const frontierByKey = new Map<
    string,
    MiraiIntlClassifierShadowRequest["frontier"]
  >();
  let cacheHits = 0;
  let resolverCalls = 0;
  const parsed =
    scannedSources ??
    scanCandidateSources(input.sources, input.options, input.sourceObserver);
  const results: Array<
    MiraiIntlClassifierShadowResult &
      Readonly<{ sourceHash: `sha256:${string}` }>
  > = [];
  let boundaryOffset = 0;
  for (const entry of parsed) {
    const requests: Array<MiraiIntlClassifierShadowRequest> = [];
    const resolutionFailures = [];
    for (const boundary of entry.boundaries) {
      if (
        selectedBoundaryRefs !== undefined &&
        !selectedBoundaryRefs.has(boundaryOffset + boundary.ordinal)
      ) {
        continue;
      }
      currentProbes = new Map();
      currentControls = new Map();
      currentRealpaths = new Map();
      const callsBefore = hostCalls;
      resolverCalls += 1;
      const resolved = ts.resolveModuleName(
        boundary.specifier,
        boundary.source,
        input.options,
        host,
        cache,
        undefined,
        rawCandidateResolutionMode(boundary.resolutionMode)
      ).resolvedModule;
      const key = `${resolverOptionsIdentity}\0${dirname(boundary.source)}\0${boundary.specifier}\0${boundary.resolutionMode}`;
      if (hostCalls === callsBefore) {
        cacheHits += 1;
      }
      let canonicalTarget: string | null = null;
      if (resolved) {
        try {
          canonicalTarget =
            ts.sys.realpath?.(resolved.resolvedFileName) ??
            resolve(resolved.resolvedFileName);
        } catch {
          resolutionFailures.push({
            boundaryOrdinal: boundary.ordinal,
            reason: "target-realpath-failed" as const,
            resolvedFileName: resolved.resolvedFileName,
          });
        }
      }
      const observedFrontier = {
        controlFiles: [...currentControls.values()],
        from: boundary.source,
        packageName: resolved?.packageId?.name ?? null,
        packageVersion: resolved?.packageId?.version ?? null,
        probes: [...currentProbes.values()],
        realpaths: [...currentRealpaths].map(([path, target]) => ({
          path,
          target,
        })),
        specifier: boundary.specifier,
      };
      const frontier =
        hostCalls === callsBefore
          ? (frontierByKey.get(key) ?? observedFrontier)
          : observedFrontier;
      frontierByKey.set(key, frontier);
      requests.push({
        boundary,
        canonicalTarget,
        frontier,
        resolutionMode: boundary.resolutionMode,
        resolvedFileName: resolved?.resolvedFileName ?? null,
      });
    }
    const generatedFacadeOrdinals = requests
      .filter(({ canonicalTarget }) => canonicalTarget === canonicalFacade)
      .map(({ boundary }) => boundary.ordinal);
    const ledger: Array<MiraiIntlClassifierShadowLedgerEntry> = [
      ...entry.boundaries.map(
        ({
          kind,
          observationOrdinal,
          ordinal,
          resolutionMode,
          source,
          specifier,
        }): MiraiIntlClassifierBoundaryTuple => ({
          kind,
          observationOrdinal,
          ordinal,
          resolutionMode,
          source,
          specifier,
        })
      ),
      ...entry.unknownBoundaries,
    ].toSorted(
      (left, right) => left.observationOrdinal - right.observationOrdinal
    );
    const boundaryIdentity = hashMiraiIntlClassifierBoundariesShadow(ledger);
    let decision: MiraiIntlClassifierShadowResult["decision"] = "facade-absent";
    if (generatedFacadeOrdinals.length > 0) {
      decision = "facade-present";
    } else if (entry.unknownBoundaries.length > 0) {
      decision = "facade-unknown-active";
    }
    results.push({
      ambiguous: resolutionFailures.length > 0,
      boundaries: entry.boundaries,
      boundaryHash: boundaryIdentity.hash,
      boundaryHashInput: boundaryIdentity.preimage,
      counters: {
        boundaries: entry.boundaries.length,
        generatedFacadeBoundaries: generatedFacadeOrdinals.length,
        referenceRequests: requests.length,
        resolutionFailures: resolutionFailures.length,
        unknownBoundaries: entry.unknownBoundaries.length,
      },
      decision,
      generatedFacadeOrdinals,
      ledger,
      requests,
      requiresProgram: decision !== "facade-absent",
      resolutionFailures,
      source: entry.cleanId,
      sourceHash: sha256(entry.source),
      unknownBoundaries: entry.unknownBoundaries,
    });
    boundaryOffset += entry.boundaries.length;
  }
  return {
    counters: { cacheHits, hostCalls, programs: 0, resolverCalls },
    frontier: {
      controlFiles: [...globalControls.values()].toSorted((left, right) =>
        compareCanonicalStrings(left.path, right.path)
      ),
      from: resolve(input.workspaceRoot),
      packageName: null,
      packageVersion: null,
      probes: [...globalProbes.values()].toSorted((left, right) =>
        compareCanonicalStrings(
          `${left.path}\0${left.kind}`,
          `${right.path}\0${right.kind}`
        )
      ),
      realpaths: [...globalRealpaths]
        .map(([path, target]) => ({ path, target }))
        .toSorted((left, right) =>
          compareCanonicalStrings(left.path, right.path)
        ),
      specifier: "*transaction-global*",
    },
    results,
  };
}

function classifyCandidateLexicalTransaction(
  input: Readonly<{
    options: ts.CompilerOptions;
    sources: ReadonlyArray<MiraiIntlCandidateShadowSource>;
    sourceObserver?: ((mode: "parsed" | "prepared") => void) | undefined;
    workspaceRoot: string;
  }>,
  scannedSources?: ReadonlyArray<ScannedCandidateSource>
): Awaited<ReturnType<typeof classifyCandidateReferenceTransaction>> {
  const results = (
    scannedSources ??
    scanCandidateSources(input.sources, input.options, input.sourceObserver)
  ).map((entry) => {
    const ledger: Array<MiraiIntlClassifierShadowLedgerEntry> = [
      ...entry.boundaries.map(
        ({
          kind,
          observationOrdinal,
          ordinal,
          resolutionMode,
          source,
          specifier,
        }): MiraiIntlClassifierBoundaryTuple => ({
          kind,
          observationOrdinal,
          ordinal,
          resolutionMode,
          source,
          specifier,
        })
      ),
      ...entry.unknownBoundaries,
    ].toSorted(
      (left, right) => left.observationOrdinal - right.observationOrdinal
    );
    const boundaryIdentity = hashMiraiIntlClassifierBoundariesShadow(ledger);
    const decision =
      entry.unknownBoundaries.length > 0
        ? ("facade-unknown-active" as const)
        : ("facade-absent" as const);
    return {
      ambiguous: false,
      boundaries: entry.boundaries,
      boundaryHash: boundaryIdentity.hash,
      boundaryHashInput: boundaryIdentity.preimage,
      counters: {
        boundaries: entry.boundaries.length,
        generatedFacadeBoundaries: 0,
        referenceRequests: 0,
        resolutionFailures: 0,
        unknownBoundaries: entry.unknownBoundaries.length,
      },
      decision,
      generatedFacadeOrdinals: [],
      ledger,
      requests: [],
      requiresProgram: decision !== "facade-absent",
      resolutionFailures: [],
      source: entry.cleanId,
      sourceHash: sha256(entry.source),
      unknownBoundaries: entry.unknownBoundaries,
    };
  });
  return {
    counters: { cacheHits: 0, hostCalls: 0, programs: 0, resolverCalls: 0 },
    frontier: {
      controlFiles: [],
      from: resolve(input.workspaceRoot),
      packageName: null,
      packageVersion: null,
      probes: [],
      realpaths: [],
      specifier: "*production-proof*",
    },
    results,
  };
}

export async function buildMiraiIntlCandidateCheckpointShadow(
  input: Readonly<{
    executionMode:
      | "production-proof"
      | "qualification-cached-reference"
      | "qualification-uncached-reference";
    generatedFacadePath: string;
    options: ts.CompilerOptions;
    owner: string;
    projectControls?: ReadonlyArray<
      Readonly<{ hash: `sha256:${string}`; path: string }>
    >;
    sources: ReadonlyArray<MiraiIntlCandidateShadowSource>;
    /** @internal Test/benchmark observation only; never enters artifacts. */
    sourceObserver?: ((mode: "parsed" | "prepared") => void) | undefined;
    workspaceRoot: string;
  }>
): Promise<MiraiIntlCandidateCheckpointShadow> {
  const started = performance.now();
  const timings: Record<string, number> = {};
  let phaseStarted = started;
  const markPhase = (name: string): void => {
    const now = performance.now();
    timings[name] = now - phaseStarted;
    phaseStarted = now;
  };
  const optionsHash = hashMiraiIntlClassifierProjectOptionsV3(
    input.owner,
    input.options,
    input.workspaceRoot
  );
  const lexicalFacade = resolve(input.generatedFacadePath);
  const canonicalFacade = await realpath(lexicalFacade);
  const lexicalRoot = dirname(lexicalFacade);
  const canonicalRoot = await realpath(lexicalRoot);
  const facadeSpecifiers = new Set<string>();
  const activeConditionNames = [
    ...new Set([
      ...activeConditions(input.options, "import"),
      ...activeConditions(input.options, "require"),
    ]),
  ].toSorted(compareCanonicalStrings);
  const packageScopes: Array<{
    canonicalRoot: string;
    lexicalRoot: string;
    manifestHash: `sha256:${string}`;
    manifestPath: string;
  }> = [];
  const packageTopology: Array<{
    canonicalRoot: string;
    manifest: MiraiIntlPortableLstatShadow;
    manifestHash: `sha256:${string}` | null;
    root: MiraiIntlPortableLstatShadow;
  }> = [];
  const reasons = new Set<MiraiIntlCandidateFallbackReason>();
  const topologyByRoot = new Map<
    string,
    Readonly<{
      canonicalRoot: string;
      manifest: MiraiIntlPortableLstatShadow;
      manifestBytes: Uint8Array | null;
      root: MiraiIntlPortableLstatShadow;
    }>
  >();
  const bindPackageTopology = async (
    directory: string,
    ambiguityReason: "package-exports-ambiguous" | "package-imports-ambiguous"
  ) => {
    const lexicalDirectory = resolve(directory);
    const prior = topologyByRoot.get(lexicalDirectory);
    if (prior) {
      return prior;
    }
    const root = await portableLstat(lexicalDirectory);
    const manifest = await portableLstat(
      resolve(lexicalDirectory, "package.json")
    );
    if (root.kind === "symlink" || manifest.kind === "symlink") {
      reasons.add("symlink-boundary-ambiguous");
    }
    if (
      !["directory", "symlink"].includes(root.kind) ||
      !["absent", "file", "symlink"].includes(manifest.kind)
    ) {
      reasons.add(ambiguityReason);
    }
    let canonicalTopologyRoot = lexicalDirectory;
    if (root.kind !== "absent") {
      canonicalTopologyRoot = await realpath(lexicalDirectory);
    }
    const manifestBytes =
      manifest.kind === "file"
        ? await readFile(resolve(lexicalDirectory, "package.json"))
        : null;
    const bound = {
      canonicalRoot: canonicalTopologyRoot,
      manifest,
      manifestBytes,
      root,
    };
    topologyByRoot.set(lexicalDirectory, bound);
    packageTopology.push({
      canonicalRoot: canonicalTopologyRoot,
      manifest,
      manifestHash: manifestBytes === null ? null : sha256(manifestBytes),
      root,
    });
    return bound;
  };
  let facadePackageManifest: string | undefined;
  let packageRoot = lexicalRoot;
  while (within(resolve(input.workspaceRoot), packageRoot)) {
    const manifestPath = resolve(packageRoot, "package.json");
    const topology = await bindPackageTopology(
      packageRoot,
      "package-exports-ambiguous"
    );
    if (topology.manifestBytes) {
      let manifest:
        | Readonly<{
            exports?: unknown;
            imports?: unknown;
            name?: unknown;
          }>
        | undefined;
      try {
        manifest = JSON.parse(topology.manifestBytes.toString("utf8")) as
          | typeof manifest
          | undefined;
      } catch {
        reasons.add("package-exports-ambiguous");
      }
      if (
        typeof manifest?.name === "string" &&
        facadePackageManifest === undefined
      ) {
        facadePackageManifest = manifestPath;
        packageScopes.push({
          canonicalRoot: topology.canonicalRoot,
          lexicalRoot: packageRoot,
          manifestHash: sha256(topology.manifestBytes),
          manifestPath,
        });
        if (manifest.exports === undefined) {
          facadeSpecifiers.add(manifest.name);
        } else {
          for (const resolutionMode of ["import", "require"] as const) {
            const proof = facadeSpecifiersFromExports(
              manifest.name,
              packageRoot,
              manifest.exports,
              lexicalFacade,
              activeConditions(input.options, resolutionMode)
            );
            if (proof.status === "ambiguous") {
              reasons.add("package-exports-ambiguous");
            }
            for (const specifier of proof.specifiers) {
              facadeSpecifiers.add(specifier);
            }
          }
        }
      }
    }
    const parent = dirname(packageRoot);
    if (parent === packageRoot) {
      break;
    }
    packageRoot = parent;
  }
  markPhase("facade-package-topology");
  const canonicalSources = input.sources.toSorted((left, right) =>
    compareCanonicalStrings(resolve(left.id), resolve(right.id))
  );
  const scannedProductionSources =
    input.executionMode === "production-proof"
      ? scanCandidateSources(
          canonicalSources,
          input.options,
          input.sourceObserver
        )
      : undefined;
  let referenceTransaction;
  if (input.executionMode === "production-proof") {
    referenceTransaction = classifyCandidateLexicalTransaction(
      {
        options: input.options,
        sources: canonicalSources,
        sourceObserver: input.sourceObserver,
        workspaceRoot: input.workspaceRoot,
      },
      scannedProductionSources
    );
  } else if (input.executionMode === "qualification-uncached-reference") {
    const results = await Promise.all(
      canonicalSources.map(
        async ({
          id,
          source,
        }): Promise<
          MiraiIntlClassifierShadowResult &
            Readonly<{ sourceHash: `sha256:${string}` }>
        > => ({
          ...(await classifyMiraiIntlModuleBoundariesShadow(
            source,
            id,
            input.options,
            input.workspaceRoot,
            canonicalFacade
          )),
          sourceHash: sha256(source),
        })
      )
    );
    const controlFiles = new Map<
      string,
      MiraiIntlClassifierShadowRequest["frontier"]["controlFiles"][number]
    >();
    const probes = new Map<
      string,
      MiraiIntlClassifierShadowRequest["frontier"]["probes"][number]
    >();
    const realpaths = new Map<string, string>();
    for (const result of results) {
      for (const { frontier } of result.requests) {
        for (const control of frontier.controlFiles) {
          controlFiles.set(control.path, control);
        }
        for (const probe of frontier.probes) {
          probes.set(`${probe.path}\0${probe.kind}`, probe);
        }
        for (const identity of frontier.realpaths) {
          realpaths.set(identity.path, identity.target);
        }
      }
    }
    referenceTransaction = {
      counters: {
        cacheHits: 0,
        hostCalls: 0,
        programs: 0 as const,
        resolverCalls: results.reduce(
          (count, result) => count + result.boundaries.length,
          0
        ),
      },
      frontier: {
        controlFiles: [...controlFiles.values()],
        from: resolve(input.workspaceRoot),
        packageName: null,
        packageVersion: null,
        probes: [...probes.values()],
        realpaths: [...realpaths].map(([path, target]) => ({ path, target })),
        specifier: "*uncached-transaction-global*",
      },
      results,
    };
  } else {
    referenceTransaction = await classifyCandidateReferenceTransaction({
      generatedFacadePath: canonicalFacade,
      options: input.options,
      sources: canonicalSources,
      sourceObserver: input.sourceObserver,
      workspaceRoot: input.workspaceRoot,
    });
  }
  let sourceResults = referenceTransaction.results;
  let resolverFrontierHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-transaction-resolver-frontier",
      3,
      referenceTransaction.frontier,
    ])
  );
  markPhase("reference-boundary-resolution");
  const sourcePackageScopes = new Map<
    string,
    Readonly<{
      imports: unknown;
      root: string;
    }> | null
  >();
  const packageImportCandidate = async (
    boundary: MiraiIntlClassifierShadowBoundary
  ): Promise<MiraiIntlCandidateProof> => {
    let directory = dirname(boundary.source);
    let scope = sourcePackageScopes.get(directory);
    if (scope === undefined) {
      const sourceDirectory = directory;
      scope = null;
      while (within(resolve(input.workspaceRoot), directory)) {
        const manifestPath = resolve(directory, "package.json");
        const topology = await bindPackageTopology(
          directory,
          "package-imports-ambiguous"
        );
        if (topology.manifestBytes) {
          let manifest: Readonly<{ imports?: unknown }> | undefined;
          try {
            manifest = JSON.parse(topology.manifestBytes.toString("utf8")) as {
              imports?: unknown;
            };
          } catch {
            reasons.add("package-imports-ambiguous");
          }
          if (!manifest) {
            return { status: "ambiguous", targets: [] };
          }
          scope ??= { imports: manifest.imports, root: directory };
          if (
            !packageScopes.some((entry) => entry.manifestPath === manifestPath)
          ) {
            packageScopes.push({
              canonicalRoot: topology.canonicalRoot,
              lexicalRoot: directory,
              manifestHash: sha256(topology.manifestBytes),
              manifestPath,
            });
          }
        }
        const parent = dirname(directory);
        if (parent === directory) {
          break;
        }
        directory = parent;
      }
      sourcePackageScopes.set(sourceDirectory, scope);
    }
    if (!scope) {
      return { status: "proven-disjoint", targets: [] };
    }
    const matched = winningPackageMapTarget(scope.imports, boundary.specifier);
    if (!matched) {
      return { status: "proven-disjoint", targets: [] };
    }
    const targetProof = packageTargetProof(
      matched.target,
      activeConditions(input.options, boundary.resolutionMode)
    );
    if (targetProof.status === "ambiguous") {
      reasons.add("package-imports-ambiguous");
      return targetProof;
    }
    const candidate = targetProof.targets.some((target) => {
      if (!target.startsWith(".")) {
        return facadeSpecifiers.has(target.replace("*", matched.wildcard));
      }
      const projected = resolve(
        scope.root,
        target.replace("*", matched.wildcard)
      );
      return targetForms(projected).some(
        (path) => within(lexicalRoot, path) || within(path, lexicalRoot)
      );
    });
    return {
      status: candidate ? "proven-candidate" : "proven-disjoint",
      targets: targetProof.targets,
    };
  };
  if (input.options.preserveSymlinks) {
    reasons.add("preserve-symlinks");
  }
  const customConditions = input.options.customConditions ?? [];
  if (
    new Set(customConditions).size !== customConditions.length ||
    customConditions.some((condition) =>
      ["default", "import", "node", "require", "types"].includes(condition)
    )
  ) {
    reasons.add("custom-conditions-ambiguous");
  }
  if (
    ![
      ts.ModuleResolutionKind.Bundler,
      ts.ModuleResolutionKind.Node16,
      ts.ModuleResolutionKind.NodeNext,
    ].includes(input.options.moduleResolution ?? ts.ModuleResolutionKind.Node10)
  ) {
    reasons.add("unsupported-module-resolution");
  }
  if (
    input.options.moduleSuffixes &&
    (!input.options.moduleSuffixes.every(
      (value) => typeof value === "string"
    ) ||
      !input.options.moduleSuffixes.includes(""))
  ) {
    reasons.add("path-projection-ambiguous");
  }
  if (
    sourceResults.some(
      ({ resolutionFailures }) => resolutionFailures.length > 0
    )
  ) {
    reasons.add("resolution-mode-ambiguous");
  }
  if (
    canonicalRoot !== lexicalRoot ||
    packageScopes.some((scope) => scope.canonicalRoot !== scope.lexicalRoot)
  ) {
    reasons.add("symlink-boundary-ambiguous");
  }

  const flattened = sourceResults.flatMap((result) => result.boundaries);
  if (
    input.options.rootDirs &&
    flattened.some(
      (boundary) =>
        !input.options.rootDirs?.some((root) =>
          within(resolve(root), dirname(boundary.source))
        )
    )
  ) {
    reasons.add("root-dirs-ambiguous");
  }
  const referenceFacadeSet: Array<number> = [];
  let offset = 0;
  for (const result of sourceResults) {
    referenceFacadeSet.push(
      ...result.generatedFacadeOrdinals.map((ordinal) => offset + ordinal)
    );
    offset += result.boundaries.length;
  }
  const projections: Array<MiraiIntlCandidateProjectionShadow> = [];
  const candidateSet: Array<number> = [];
  const barePackageProofs: Array<
    MiraiIntlGeneratedFacadeCandidateIndexShadow["barePackageProofs"][number]
  > = [];
  const bareBoundaryRefs: Array<number> = [];
  const projectedRealpaths = new Map<string, Promise<string>>();
  const canonicalProjectedPath = (path: string): Promise<string> => {
    const prior = projectedRealpaths.get(path);
    if (prior) {
      return prior;
    }
    const pending = realpath(path).catch((error: unknown) => {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
      return path;
    });
    projectedRealpaths.set(path, pending);
    return pending;
  };
  const projectedProofs = flattened.map((boundary) =>
    projectedPaths(boundary, input.options)
  );
  const projectedByBoundary = projectedProofs.map(({ paths }) => paths);
  const evidencePathsByBoundary = projectedByBoundary.map((paths) =>
    paths.length > 0 ? paths : [resolve(input.workspaceRoot)]
  );
  await Promise.all(
    [...new Set(evidencePathsByBoundary.flatMap((paths) => paths))].map(
      canonicalProjectedPath
    )
  );
  for (const [boundaryRef, boundary] of flattened.entries()) {
    const paths = projectedByBoundary[boundaryRef];
    const projectedProof = projectedProofs[boundaryRef];
    if (!paths) {
      throw new Error(`Missing projected paths for boundary ${boundaryRef}`);
    }
    if (!projectedProof) {
      throw new Error(`Missing projection proof for boundary ${boundaryRef}`);
    }
    const evidencePaths = evidencePathsByBoundary[boundaryRef];
    if (!evidencePaths) {
      throw new Error(`Missing evidence paths for boundary ${boundaryRef}`);
    }
    const importProof = boundary.specifier.startsWith("#")
      ? await packageImportCandidate(boundary)
      : undefined;
    if (importProof?.status === "ambiguous") {
      reasons.add("package-imports-ambiguous");
    }
    const barePackage =
      !boundary.specifier.startsWith(".") &&
      !boundary.specifier.startsWith("#") &&
      !isAbsolute(boundary.specifier);
    const bareCandidate =
      barePackage && facadeSpecifiers.has(boundary.specifier);
    if (barePackage) {
      bareBoundaryRefs.push(boundaryRef);
    }
    const candidate =
      importProof?.status === "proven-candidate" ||
      bareCandidate ||
      candidateBySpecifier(boundary, paths, lexicalRoot, facadeSpecifiers);
    let proofKind = projectedProof.proofKind;
    if (boundary.specifier.startsWith("#")) {
      proofKind = GeneratedFacadeProjectionProofKindV3.PACKAGE_IMPORTS;
    } else if (bareCandidate) {
      proofKind = GeneratedFacadeProjectionProofKindV3.FACADE_PACKAGE_EXPORT;
    }
    if (candidate) {
      candidateSet.push(boundaryRef);
    }
    for (const path of evidencePaths) {
      const canonical = await canonicalProjectedPath(path);
      projections.push({
        boundary: boundaryRef,
        canonicalRoot: dirname(canonical),
        lexicalRoot: dirname(path),
        proofKind,
        status: candidate ? "candidate" : "disjoint",
      });
    }
  }
  const projectionGroups = Map.groupBy(projections, ({ boundary }) => boundary);
  if (
    projectionGroups.size !== flattened.length ||
    [...flattened.keys()].some((boundary) => {
      const group = projectionGroups.get(boundary) ?? [];
      return (
        group.length === 0 ||
        new Set(group.map(({ proofKind }) => proofKind)).size !== 1 ||
        new Set(group.map(({ status }) => status)).size !== 1
      );
    }) ||
    new Set(candidateSet).size !== candidateSet.length
  ) {
    reasons.add("path-projection-ambiguous");
  }
  if (
    projections.some(
      (projection) => projection.canonicalRoot !== projection.lexicalRoot
    )
  ) {
    reasons.add("symlink-boundary-ambiguous");
  }
  if (reasons.size > 0) {
    candidateSet.splice(0, candidateSet.length, ...flattened.keys());
    projections.splice(
      0,
      projections.length,
      ...projections.map((projection) => ({
        ...projection,
        status: "candidate" as const,
      }))
    );
    barePackageProofs.splice(
      0,
      barePackageProofs.length,
      ...barePackageProofs.map((proof) => ({
        ...proof,
        status: "candidate" as const,
      }))
    );
  }
  if (input.executionMode === "production-proof") {
    const resolveSelection = async () =>
      classifyCandidateReferenceTransaction(
        {
          generatedFacadePath: canonicalFacade,
          options: input.options,
          sources: canonicalSources,
          sourceObserver: input.sourceObserver,
          workspaceRoot: input.workspaceRoot,
        },
        new Set(candidateSet),
        scannedProductionSources
      );
    let productionTransaction = await resolveSelection();
    if (
      productionTransaction.results.some(
        ({ ambiguous, resolutionFailures }) =>
          ambiguous || resolutionFailures.length > 0
      )
    ) {
      reasons.add("resolution-mode-ambiguous");
      candidateSet.splice(0, candidateSet.length, ...flattened.keys());
      projections.splice(
        0,
        projections.length,
        ...projections.map((projection) => ({
          ...projection,
          status: "candidate" as const,
        }))
      );
      productionTransaction = await resolveSelection();
    }
    const requestCoverage = () => {
      const requestsByBoundary = new Map<
        number,
        Array<MiraiIntlClassifierShadowRequest>
      >();
      let productionOffset = 0;
      for (const result of productionTransaction.results) {
        for (const request of result.requests) {
          const reference = productionOffset + request.boundary.ordinal;
          const requests = requestsByBoundary.get(reference) ?? [];
          requests.push(request);
          requestsByBoundary.set(reference, requests);
        }
        productionOffset += result.boundaries.length;
      }
      return requestsByBoundary;
    };
    const incomplete = (coverage: ReturnType<typeof requestCoverage>) =>
      [...flattened.keys()].some((boundary) => {
        const count = coverage.get(boundary)?.length ?? 0;
        return candidateSet.includes(boundary) ? count !== 1 : count !== 0;
      });
    if (incomplete(requestCoverage())) {
      reasons.add("resolution-mode-ambiguous");
      candidateSet.splice(0, candidateSet.length, ...flattened.keys());
      projections.splice(
        0,
        projections.length,
        ...projections.map((projection) => ({
          ...projection,
          status: "candidate" as const,
        }))
      );
      productionTransaction = await resolveSelection();
      if (incomplete(requestCoverage())) {
        throw new Error(
          "Classifier V3 owner fallback request coverage is incomplete"
        );
      }
    }
    sourceResults = productionTransaction.results;
    referenceTransaction = productionTransaction;
    referenceFacadeSet.splice(0, referenceFacadeSet.length);
    let productionFacadeOffset = 0;
    for (const result of sourceResults) {
      referenceFacadeSet.push(
        ...result.generatedFacadeOrdinals.map(
          (ordinal) => productionFacadeOffset + ordinal
        )
      );
      productionFacadeOffset += result.boundaries.length;
    }
  }
  if (reasons.size > 0) {
    sourceResults = sourceResults.map((result) => ({
      ...result,
      requiresProgram: true,
    }));
  }
  resolverFrontierHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-transaction-resolver-frontier",
      3,
      referenceTransaction.frontier,
    ])
  );
  const finalRequestByBoundary = new Map<
    number,
    MiraiIntlClassifierShadowRequest
  >();
  let finalRequestOffset = 0;
  for (const result of sourceResults) {
    for (const request of result.requests) {
      const reference = finalRequestOffset + request.boundary.ordinal;
      if (finalRequestByBoundary.has(reference)) {
        throw new Error(
          `Classifier V3 duplicate request for boundary ${reference}`
        );
      }
      finalRequestByBoundary.set(reference, request);
    }
    finalRequestOffset += result.boundaries.length;
  }
  for (const boundary of bareBoundaryRefs) {
    const request = finalRequestByBoundary.get(boundary);
    const candidate = candidateSet.includes(boundary);
    if (
      input.executionMode === "production-proof" &&
      candidate !== Boolean(request)
    ) {
      throw new Error(
        `Classifier V3 bare-package request coverage mismatch for boundary ${boundary}`
      );
    }
    barePackageProofs.push({
      boundary,
      controlFiles: request?.frontier.controlFiles ?? [],
      packageName: request?.frontier.packageName ?? null,
      packageVersion: request?.frontier.packageVersion ?? null,
      resolvedFileName: request?.resolvedFileName ?? null,
      resolverFrontierHash,
      status: candidate ? "candidate" : "proven-disjoint",
    });
  }
  const falseNegatives = referenceFacadeSet.filter(
    (boundary) => !candidateSet.includes(boundary)
  );
  if (falseNegatives.length > 0) {
    throw new Error(
      `Classifier V3 shadow false negative boundaries: ${falseNegatives.join(",")}`
    );
  }
  const optimizedFacadeSet: Array<number> = [];
  let requestOffset = 0;
  for (const result of sourceResults) {
    for (const request of result.requests) {
      const boundaryRef = requestOffset + request.boundary.ordinal;
      if (
        candidateSet.includes(boundaryRef) &&
        request.canonicalTarget === canonicalFacade
      ) {
        optimizedFacadeSet.push(boundaryRef);
      }
    }
    requestOffset += result.boundaries.length;
  }
  if (canonicalJson(optimizedFacadeSet) !== canonicalJson(referenceFacadeSet)) {
    throw new Error("Classifier V3 optimized/reference facade target mismatch");
  }
  const ownerFallbackVector = () => {
    const vector = sourceResults
      .map(({ source }) => [source, true] as const)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right));
    return {
      hash: sha256(
        canonicalJson(["mirai-intl", "requires-program-vector", 3, vector])
      ),
      vector,
    };
  };
  const referenceVector =
    reasons.size > 0
      ? ownerFallbackVector()
      : miraiIntlClassifierDecisionVectorShadow(sourceResults);
  let optimizedOffset = 0;
  const optimizedResults = sourceResults.map((result) => {
    const sourceOffset = optimizedOffset;
    optimizedOffset += result.boundaries.length;
    const generatedFacadeOrdinals = result.generatedFacadeOrdinals.filter(
      (ordinal) => optimizedFacadeSet.includes(sourceOffset + ordinal)
    );
    const referenceSourceFacadeSet = result.generatedFacadeOrdinals.map(
      (ordinal) => sourceOffset + ordinal
    );
    const optimizedSourceFacadeSet = generatedFacadeOrdinals.map(
      (ordinal) => sourceOffset + ordinal
    );
    if (
      canonicalJson(optimizedSourceFacadeSet) !==
      canonicalJson(referenceSourceFacadeSet)
    ) {
      throw new Error(
        `Classifier V3 optimized/reference facade target mismatch for ${result.source}`
      );
    }
    let decision: MiraiIntlClassifierShadowResult["decision"] = "facade-absent";
    if (generatedFacadeOrdinals.length > 0) {
      decision = "facade-present";
    } else if (result.unknownBoundaries.length > 0) {
      decision = "facade-unknown-active";
    }
    return {
      ...result,
      decision,
      generatedFacadeOrdinals,
      requiresProgram: reasons.size > 0 || decision !== "facade-absent",
    };
  });
  const optimizedVector =
    reasons.size > 0
      ? ownerFallbackVector()
      : miraiIntlClassifierDecisionVectorShadow(optimizedResults);
  if (optimizedVector.hash !== referenceVector.hash) {
    throw new Error(
      "Classifier V3 optimized/reference requiresProgram mismatch"
    );
  }
  markPhase("candidate-proof-and-parity");
  const expectedProjectControls = new Map<string, `sha256:${string}`>();
  for (const control of input.projectControls ?? []) {
    const path = resolve(control.path);
    const prior = expectedProjectControls.get(path);
    if (prior !== undefined && prior !== control.hash) {
      throw new Error(`Conflicting classifier project control: ${path}`);
    }
    expectedProjectControls.set(path, control.hash);
  }
  const controlPaths = [
    input.options.configFilePath,
    ...expectedProjectControls.keys(),
    facadePackageManifest,
    ...[
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ].map((name) => resolve(input.workspaceRoot, name)),
  ].filter((value): value is string => typeof value === "string");
  const proofPaths = [
    lexicalFacade,
    lexicalRoot,
    ...controlPaths,
    ...packageScopes.flatMap(({ lexicalRoot: root, manifestPath }) => [
      root,
      manifestPath,
    ]),
    ...projections.flatMap(({ lexicalRoot: root }) => [root]),
  ].toSorted(compareCanonicalStrings);
  const lstats = await Promise.all([...new Set(proofPaths)].map(portableLstat));
  const controls: Array<Readonly<{ hash: `sha256:${string}`; path: string }>> =
    [];
  for (const path of new Set(controlPaths)) {
    const identity = await portableLstat(path);
    if (identity.kind === "absent") {
      continue;
    }
    if (identity.kind !== "file") {
      throw new Error(`Classifier control must be a regular file: ${path}`);
    }
    const hash = sha256(await readFile(path));
    const expectedHash = expectedProjectControls.get(resolve(path));
    if (expectedHash !== undefined && expectedHash !== hash) {
      throw new Error(`Classifier project control mutated: ${path}`);
    }
    controls.push({ hash, path: resolve(path) });
  }
  controls.sort((left, right) =>
    compareCanonicalStrings(left.path, right.path)
  );
  const realpaths = [];
  for (const path of new Set(proofPaths)) {
    try {
      realpaths.push({ path, target: await realpath(path) });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }
  const mode: "filtered" | "owner-fallback" =
    reasons.size > 0 ? "owner-fallback" : "filtered";
  const indexWithoutHash = {
    activeConditions: activeConditionNames,
    analyzerAbi: "mirai-intl-classifier-v3-shadow" as const,
    barePackageProofs,
    canonicalRoot,
    candidateBoundaryRefs: candidateSet,
    controls,
    facade: canonicalFacade,
    lexicalRoot,
    lstats,
    mode,
    optionsHash,
    owner: input.owner,
    packageTopology: packageTopology.toSorted((left, right) =>
      compareCanonicalStrings(left.root.path, right.root.path)
    ),
    packageScopes: packageScopes.toSorted((left, right) =>
      compareCanonicalStrings(left.manifestPath, right.manifestPath)
    ),
    probes: referenceTransaction.frontier.probes,
    projections,
    realpaths: realpaths.toSorted((left, right) =>
      compareCanonicalStrings(left.path, right.path)
    ),
    reasons: [...reasons].toSorted(compareCanonicalStrings),
    resolverFrontier: referenceTransaction.frontier,
    resolverFrontierHash,
  };
  const index = {
    ...indexWithoutHash,
    indexHash: sha256(
      canonicalJson([
        "mirai-intl",
        "generated-facade-candidate-index",
        3,
        indexWithoutHash,
      ])
    ),
  };
  markPhase("portable-proof-evidence");
  const boundaryCategoryCounts = Object.fromEntries(
    [...new Set(flattened.map(({ kind }) => kind))]
      .toSorted(compareCanonicalStrings)
      .map((kind) => [
        kind,
        flattened.filter((boundary) => boundary.kind === kind).length,
      ])
  );
  const checkpointAHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-checkpoint-a",
      3,
      sourceResults
        .map((result) => [
          result.source,
          result.boundaryHash,
          result.decision,
          result.sourceHash,
        ])
        .toSorted(([leftSource], [rightSource]) =>
          compareCanonicalStrings(String(leftSource), String(rightSource))
        ),
    ])
  );
  const falsePositiveCount = optimizedFacadeSet.filter(
    (boundary) => !referenceFacadeSet.includes(boundary)
  ).length;
  timings.total = performance.now() - started;
  const facadeResolutionsBySource = sourceResults
    .map((result) => {
      const facadeOrdinals = new Set(result.generatedFacadeOrdinals);
      const resolutions = new Map<string, SemanticProviderResolution>();
      for (const { boundary, frontier } of result.requests) {
        if (!facadeOrdinals.has(boundary.ordinal)) {
          continue;
        }
        const existing = resolutions.get(boundary.specifier);
        if (existing && canonicalJson(existing) !== canonicalJson(frontier)) {
          throw new Error(
            `Conflicting classifier facade resolution for ${JSON.stringify(result.source)} ${JSON.stringify(boundary.specifier)}`
          );
        }
        resolutions.set(boundary.specifier, frontier);
      }
      return {
        resolutions: [...resolutions.values()].toSorted((left, right) =>
          compareCanonicalStrings(left.specifier, right.specifier)
        ),
        source: result.source,
      };
    })
    .filter(({ resolutions }) => resolutions.length > 0)
    .toSorted((left, right) =>
      compareCanonicalStrings(left.source, right.source)
    );
  const artifactBinding = {
    boundaryCategoryCounts,
    candidateRequests: candidateSet.length,
    candidateSet,
    checkpointAHash,
    fallbackReasonCounts: Object.fromEntries(
      [...reasons]
        .toSorted(compareCanonicalStrings)
        .map((reason) => [reason, 1])
    ),
    facadeImports: referenceFacadeSet.length,
    facadeResolutionsBySource,
    falseNegatives: falseNegatives.length,
    falsePositives: falsePositiveCount,
    index,
    optimizedFacadeSet,
    optimizedRequiresProgramVector: optimizedVector.vector,
    optimizedRequiresProgramVectorHash: optimizedVector.hash,
    ownerMode: mode,
    ownerFallbacks: mode === "owner-fallback" ? 1 : 0,
    referenceBoundaries: flattened.length,
    referenceFacadeSet,
    referenceRequiresProgramVector: referenceVector.vector,
    referenceRequiresProgramVectorHash: referenceVector.hash,
    resolverCounters: referenceTransaction.counters,
    resolverFrontier: referenceTransaction.frontier,
    sourceCount: input.sources.length,
    sourceIdentities: sourceResults
      .map(({ source, sourceHash }) => ({ source, sourceHash }))
      .toSorted((left, right) =>
        compareCanonicalStrings(left.source, right.source)
      ),
    unknownBoundaries: sourceResults.reduce(
      (count, result) => count + result.unknownBoundaries.length,
      0
    ),
  };
  return {
    ...artifactBinding,
    artifactHash: sha256(
      canonicalJson([
        "mirai-intl",
        "classifier-checkpoint-b",
        3,
        artifactBinding,
      ])
    ),
    sources: sourceResults,
    timings,
  };
}
