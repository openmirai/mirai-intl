import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import ts from "typescript";

import type {
  IntlCheckModuleBoundaryV3,
  IntlCheckUnknownModuleBoundaryV3,
  IntlRequiresProgramTupleV3,
} from "@openmirai/intl-abi";

import {
  canonicalJson,
  compareCanonicalStrings,
  decodeUtf8Fatal,
  sha256,
} from "./canonical";
import { mergeSemanticProviders } from "./semantic-providers";
import type { SemanticProviderResolution } from "./semantic-providers";
import { privateMessageSliceSpecifier } from "./private-module";

export type MiraiIntlTransformOptions = Readonly<{
  /** @internal Authorization-only evidence sink; does not alter transforms. */
  authorizationEvidence?: Readonly<{
    record(evidence: MiraiIntlSemanticEvidence): void;
    workspaceRoot: string;
  }>;
  generatedDirectory?: string;
  requireProof?: boolean;
  root?: string;
  /** @internal Canonical provider-resolution boundary for workspace adapters. */
  workspaceRoot?: string;
}>;

export type MiraiIntlSourceMap = Readonly<{
  file?: string;
  mappings: string;
  names: Array<string>;
  sourceRoot?: string;
  sources: Array<string>;
  sourcesContent?: Array<string>;
  version: 3;
}>;

export type MiraiIntlTransformResult = Readonly<{
  code: string;
  dependencies: ReadonlyArray<string>;
  map: MiraiIntlSourceMap;
}>;

/** @internal Benchmark/test observation only; never serialized into authority. */
export type MiraiIntlSemanticBatchObservation = Readonly<{
  fallbackFiles: number;
  fallbackPrograms: number;
  sharedFiles: number;
  sharedPrograms: number;
}>;

/** @internal Exact-owner batch input used by source authorization. */
export type MiraiIntlSemanticBatchSource = Readonly<{
  authorizationEvidence: NonNullable<
    MiraiIntlTransformOptions["authorizationEvidence"]
  >;
  id: string;
  classifierFacadeResolutions?: ReadonlyMap<string, SemanticProviderResolution>;
  source: string;
  sourceFile?: ts.SourceFile;
}>;

/** @internal Per-file result preserves reference-engine error isolation. */
export type MiraiIntlSemanticBatchResult = Readonly<{
  error?: unknown;
  id: string;
  result?: MiraiIntlTransformResult | null;
}>;

export type MiraiIntlClassifierResolutionMode =
  | "default"
  | "import"
  | "require";

export type MiraiIntlClassifierBoundaryKind =
  | "dynamic-import"
  | "export"
  | "import"
  | "import-equals"
  | "import-type"
  | "module-declaration"
  | "require";

/** @internal Phase-B shadow ledger; not serialized or used for authorization. */
export type MiraiIntlClassifierShadowBoundary = Readonly<{
  impliedNodeFormat: MiraiIntlClassifierResolutionMode;
  kind: MiraiIntlClassifierBoundaryKind;
  nodeKind: string;
  observationOrdinal: number;
  ordinal: number;
  resolutionMode: MiraiIntlClassifierResolutionMode;
  source: string;
  sourceExtension: string;
  specifier: string;
}>;

export type MiraiIntlClassifierBoundaryTuple = IntlCheckModuleBoundaryV3;

/** @internal Fail-conservative syntax observation excluded from static tuples. */
export type MiraiIntlClassifierShadowUnknownBoundary =
  IntlCheckUnknownModuleBoundaryV3;

export type MiraiIntlClassifierShadowDecision =
  | "facade-absent"
  | "facade-present"
  | "facade-unknown-active";

export type MiraiIntlClassifierShadowLedgerEntry =
  | MiraiIntlClassifierBoundaryTuple
  | MiraiIntlClassifierShadowUnknownBoundary;

export type MiraiIntlClassifierShadowResolutionFailure = Readonly<{
  boundaryOrdinal: number;
  reason: "target-realpath-failed";
  resolvedFileName: string;
}>;

/** @internal Unconditional reference request for Phase-B parity measurement. */
export type MiraiIntlClassifierShadowRequest = Readonly<{
  boundary: MiraiIntlClassifierShadowBoundary;
  canonicalTarget: string | null;
  frontier: SemanticProviderResolution;
  resolutionMode: MiraiIntlClassifierResolutionMode;
  resolvedFileName: string | null;
}>;

/** @internal Benchmark/test-only reference classifier result. */
export type MiraiIntlClassifierShadowResult = Readonly<{
  ambiguous: boolean;
  boundaries: ReadonlyArray<MiraiIntlClassifierShadowBoundary>;
  boundaryHash: `sha256:${string}`;
  boundaryHashInput: string;
  counters: Readonly<{
    boundaries: number;
    generatedFacadeBoundaries: number;
    referenceRequests: number;
    resolutionFailures: number;
    unknownBoundaries: number;
  }>;
  decision: MiraiIntlClassifierShadowDecision;
  generatedFacadeOrdinals: ReadonlyArray<number>;
  ledger: ReadonlyArray<MiraiIntlClassifierShadowLedgerEntry>;
  requests: ReadonlyArray<MiraiIntlClassifierShadowRequest>;
  requiresProgram: boolean;
  resolutionFailures: ReadonlyArray<MiraiIntlClassifierShadowResolutionFailure>;
  source: string;
  unknownBoundaries: ReadonlyArray<MiraiIntlClassifierShadowUnknownBoundary>;
}>;

/** @internal Exact V3 boundary-ledger hash domain used by shadow artifacts. */
export function hashMiraiIntlClassifierBoundariesShadow(
  records: ReadonlyArray<MiraiIntlClassifierShadowLedgerEntry>
): Readonly<{
  hash: `sha256:${string}`;
  preimage: string;
}> {
  const preimage = canonicalJson(["mirai-intl", "boundary-ledger", 3, records]);
  return { hash: sha256(preimage), preimage };
}

export function miraiIntlClassifierDecisionVectorShadow(
  results: ReadonlyArray<MiraiIntlClassifierShadowResult>
): Readonly<{
  hash: `sha256:${string}`;
  vector: ReadonlyArray<IntlRequiresProgramTupleV3>;
}> {
  const vector = results
    .map(
      (result): IntlRequiresProgramTupleV3 => [
        result.source,
        result.decision !== "facade-absent",
      ]
    )
    .toSorted(([leftSource], [rightSource]) =>
      compareCanonicalStrings(leftSource, rightSource)
    );
  return {
    hash: sha256(
      canonicalJson(["mirai-intl", "requires-program-vector", 3, vector])
    ),
    vector,
  };
}

export type MiraiIntlSemanticEvidence = Readonly<{
  ambientTypeFileLimit: 16;
  closureHash: `sha256:${string}`;
  declarations: ReadonlyArray<
    Readonly<{ hash: `sha256:${string}`; path: string }>
  >;
  libs: ReadonlyArray<Readonly<{ hash: `sha256:${string}`; path: string }>>;
  providerBudgetExceeded: boolean;
  providerRootLimit: 64;
  providers: ReadonlyArray<
    Readonly<{
      declarations: ReadonlyArray<
        Readonly<{ hash: `sha256:${string}`; path: string }>
      >;
      kind: "ambient" | "external" | "generated" | "workspace";
      resolutions: ReadonlyArray<SemanticProviderResolution>;
      root: string;
    }>
  >;
  source: string;
  sourceHash: `sha256:${string}`;
  unsupportedProviderResolutionOptions: ReadonlyArray<"typeRoots" | "types">;
}>;

/** Begin each build/HMR epoch with a freshly validated generated catalog. */
export function invalidateMiraiIntlCatalogCache(
  options: MiraiIntlTransformOptions = {}
): void {
  const root = resolve(options.root ?? process.cwd());
  catalogCache.delete(
    resolve(root, options.generatedDirectory ?? defaultGeneratedDirectory)
  );
}

type MessageKind = "rich" | "text" | "value";
type FactoryKind = "client" | "server";

type CatalogMessage = Readonly<{
  descriptor: string;
  descriptorModule: string;
  hasArguments: boolean;
  kind: MessageKind;
  path: string;
}>;

type CurrentCatalog = Readonly<{
  contentHash: string;
  contractPath: string;
  dependencies: ReadonlyArray<string>;
  generatedFacadePath: string;
  generatedFacadeHash: `sha256:${string}`;
  messages: ReadonlyMap<string, CatalogMessage>;
  privateCarrierPath: string;
  provenancePath: string;
  selectedCanonicalDirectory: string;
  selectedDirectory: string;
  selectedRelativeDirectory: string;
}>;

type CatalogCacheEntry = Readonly<{
  catalog: CurrentCatalog;
  pointerSource: string;
}>;

type TranslationTarget = Readonly<{
  namespace: string;
  operation: MessageKind | "dynamic" | "map";
}>;

type MapEntry = Readonly<{
  key: string;
  message?: CatalogMessage;
  nested?: ReadonlyArray<MapEntry>;
}>;

type Replacement =
  | Readonly<{ kind: "dynamic"; namespace: string; registry: string }>
  | Readonly<{
      kind: "form-error";
      namespace: string;
      registry: string;
      translator: ts.Expression;
    }>
  | Readonly<{
      build: ts.Expression;
      kind: "form-schema";
      namespace: string;
      registry: string;
    }>
  | Readonly<{ kind: "literal"; value: string }>
  | Readonly<{ kind: "map"; entries: ReadonlyArray<MapEntry> }>
  | Readonly<{ kind: "message"; local: string }>
  | Readonly<{ kind: "parse"; namespace: string; registry: string }>;

type GeneratedFacadeImportNames = Readonly<{
  facadeModules: ReadonlySet<string>;
  facadeResolutions: ReadonlyArray<SemanticProviderResolution>;
  formErrorFactories: ReadonlySet<string>;
  formSchemaFactories: ReadonlySet<string>;
  keyFactories: ReadonlySet<string>;
  keyParsers: ReadonlySet<string>;
  requiresCatalogContract: boolean;
  requiresFullFacade: boolean;
  translationKeyTypes: ReadonlySet<string>;
  translationNamespaceTypes: ReadonlySet<string>;
}>;

const defaultGeneratedDirectory = "src/i18n/generated";
const supportedSource = /\.[cm]?[jt]sx?$/u;
const privateMessageModule = /^catalog\.messages\.gen\.mjs$/u;
const contentHash = /^sha256:[a-f\d]{64}$/u;
const generatedFacadePrefix = "// @mirai-intl-selector ";
const reactDependencyHooks = new Set([
  "useCallback",
  "useEffect",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
]);
const catalogCache = new Map<string, CatalogCacheEntry>();
const miraiIntlImportedOperations = new Set([
  "createFormErrorTranslator",
  "createFormSchema",
  "createTranslationKey",
  "getServerTranslations",
  "parseTranslationKey",
  "useTranslations",
]);
const generatedFacadeImportedNames = new Set([
  "CatalogContract",
  "TranslationKey",
  "TranslationNamespace",
  "createFormErrorTranslator",
  "createFormSchema",
  "createTranslationKey",
  "parseTranslationKey",
]);
const generatedFacadeStableNames = new Set([
  ...generatedFacadeImportedNames,
  "CatalogLocale",
  "catalogManifest",
  "isCatalogLocale",
  "loadCatalogResource",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownString(
  value: Record<string, unknown>,
  key: string,
  label: string
): string {
  if (!Object.hasOwn(value, key) || typeof value[key] !== "string") {
    throw new TypeError(`${label}.${key} must be a string`);
  }
  return value[key];
}

function parseJson(source: string, label: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function assertGeneratedFacadeSelector(
  source: string,
  hash: string,
  directory: string
): void {
  const selectorLine = source.slice(0, source.indexOf("\n"));
  if (!selectorLine.startsWith(generatedFacadePrefix)) {
    throw new Error("Generated stable facade is missing its selector identity");
  }
  const selector = parseJson(
    selectorLine.slice(generatedFacadePrefix.length),
    "Generated stable facade selector"
  );
  if (
    !isRecord(selector) ||
    selector.schemaVersion !== 2 ||
    selector.contentHash !== hash ||
    selector.directory !== directory
  ) {
    throw new Error(
      "Generated stable facade selector does not match the current catalog"
    );
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
}

function isSamePath(left: string, right: string): boolean {
  return relative(left, right) === "" && relative(right, left) === "";
}

async function canonicalCatalogRoot(generatedRoot: string): Promise<string> {
  const stats = await lstat(generatedRoot);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Generated catalog root must be a non-symlink directory");
  }
  return realpath(generatedRoot);
}

async function assertConfinedDirectory(
  root: string,
  directory: string,
  label: string,
  rootLabel: string
): Promise<string> {
  const stats = await lstat(directory);
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  const canonical = await realpath(directory);
  if (!isWithin(root, canonical)) {
    throw new Error(`${label} escapes ${rootLabel}`);
  }
  return canonical;
}

async function assertConfinedRegularFile(
  root: string,
  file: string,
  label: string,
  rootLabel: string
): Promise<void> {
  const stats = await lstat(file);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a non-symlink regular file`);
  }
  const canonical = await realpath(file);
  if (!isWithin(root, canonical)) {
    throw new Error(`${label} escapes ${rootLabel}`);
  }
}

async function readConfinedTextFile(
  root: string,
  file: string,
  label: string,
  rootLabel: string
): Promise<string> {
  await assertConfinedRegularFile(root, file, label, rootLabel);
  return readFile(file, "utf8");
}

function confinedSelectedDirectory(
  generatedRoot: string,
  directory: string
): string {
  if (isAbsolute(directory)) {
    throw new Error("Generated current pointer directory must be relative");
  }
  const selected = resolve(generatedRoot, directory);
  const fromRoot = relative(generatedRoot, selected);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error("Generated current pointer escapes its catalog root");
  }
  return selected;
}

function parseCatalogMessages(
  contractSource: string,
  provenanceSource: string,
  selectedDirectory: string
): ReadonlyMap<string, CatalogMessage> {
  const contract = parseJson(contractSource, "Generated catalog contract");
  const provenance = parseJson(
    provenanceSource,
    "Generated catalog provenance"
  );
  if (!isRecord(contract) || contract.schemaVersion !== 1) {
    throw new Error("Generated catalog contract has an unsupported schema");
  }
  if (!Array.isArray(contract.messages)) {
    throw new TypeError("Generated catalog contract.messages must be an array");
  }
  if (!isRecord(provenance) || !Array.isArray(provenance.exports)) {
    throw new TypeError(
      "Generated catalog provenance.exports must contain compact exports"
    );
  }

  const contracts = new Map<
    string,
    Readonly<{ hasArguments: boolean; kind: MessageKind }>
  >();
  const contractPaths: Array<string> = [];
  for (const [index, value] of contract.messages.entries()) {
    if (!isRecord(value)) {
      throw new TypeError(
        `Generated catalog contract.messages[${index}] must be an object`
      );
    }
    const path = ownString(
      value,
      "path",
      `Generated catalog contract.messages[${index}]`
    );
    const kind = ownString(
      value,
      "kind",
      `Generated catalog contract.messages[${index}]`
    );
    if (kind !== "text" && kind !== "rich" && kind !== "value") {
      throw new TypeError(`Generated message ${path} has invalid kind ${kind}`);
    }
    const argumentSchema = value.argumentSchema;
    const hasArguments = isRecord(argumentSchema)
      ? isRecord(argumentSchema.properties) &&
        Object.keys(argumentSchema.properties).length > 0
      : false;
    if (contracts.has(path)) {
      throw new Error(`Generated catalog contract repeats ${path}`);
    }
    contracts.set(path, { hasArguments, kind });
    contractPaths.push(path);
  }

  const messages = new Map<string, CatalogMessage>();
  for (const [index, value] of provenance.exports.entries()) {
    if (!isRecord(value)) {
      throw new TypeError(
        `Generated catalog provenance.exports[${index}] must be an object`
      );
    }
    const label = `Generated catalog provenance.exports[${index}]`;
    const path = ownString(value, "path", label);
    if (path !== contractPaths[index]) {
      throw new Error(
        `${label}.path must match the canonical contract path ${contractPaths[index] ?? "at this index"}`
      );
    }
    const descriptor = ownString(value, "descriptorExport", label);
    const module = ownString(value, "module", label);
    const runtimeMessage = ownString(value, "runtimeExport", label);
    if (descriptor !== `m${index}`) {
      throw new TypeError(
        `${label}.descriptorExport must be the exact private export m${index}`
      );
    }
    if (runtimeMessage !== `r${index}`) {
      throw new TypeError(
        `${label}.runtimeExport must be the exact private export r${index}`
      );
    }
    if (!privateMessageModule.test(module)) {
      throw new TypeError(`${label}.module must be a private message module`);
    }
    const messageContract = contracts.get(path);
    if (!messageContract) {
      throw new Error(`Compact export ${descriptor} has unknown path ${path}`);
    }
    if (messages.has(path)) {
      throw new Error(`Generated catalog provenance repeats ${path}`);
    }
    messages.set(path, {
      descriptor,
      descriptorModule: resolve(selectedDirectory, module),
      hasArguments: messageContract.hasArguments,
      kind: messageContract.kind,
      path,
    });
  }
  if (messages.size !== contracts.size) {
    const missing = [...contracts.keys()].find((path) => !messages.has(path));
    throw new Error(
      `Generated catalog provenance is missing ${missing ?? "a message"}`
    );
  }
  return messages;
}

async function loadCurrentCatalog(
  options: MiraiIntlTransformOptions
): Promise<CurrentCatalog> {
  const root = resolve(options.root ?? process.cwd());
  const generatedRoot = resolve(
    root,
    options.generatedDirectory ?? defaultGeneratedDirectory
  );
  const pointerPath = resolve(generatedRoot, "current.json");
  // A Vite build and an exhaustive receipt check operate against an immutable
  // generated catalog. Re-validating every generated message module for every
  // application source file made authority checking O(files × catalog). A
  // single pointer-byte comparison retains warm-cache rotation correctness
  // without replaying the full artifact audit for unrelated source modules.
  const cached = catalogCache.get(generatedRoot);
  if (cached) {
    const pointerSource = await readFile(pointerPath, "utf8").catch(
      () => undefined
    );
    if (pointerSource === cached.pointerSource) {
      return cached.catalog;
    }
  }
  const canonicalGeneratedRoot = await canonicalCatalogRoot(generatedRoot);
  const pointerSource = await readConfinedTextFile(
    canonicalGeneratedRoot,
    pointerPath,
    "Generated current pointer",
    "generated catalog root"
  );
  const pointer = parseJson(pointerSource, "Generated current pointer");
  if (!isRecord(pointer)) {
    throw new TypeError("Generated current pointer must be an object");
  }
  const hash = ownString(pointer, "contentHash", "Generated current pointer");
  const directory = ownString(
    pointer,
    "directory",
    "Generated current pointer"
  );
  if (!contentHash.test(hash)) {
    throw new TypeError(
      "Generated current pointer.contentHash must be a SHA-256 value"
    );
  }
  const selected = confinedSelectedDirectory(generatedRoot, directory);
  const selectedCanonicalDirectory = await assertConfinedDirectory(
    canonicalGeneratedRoot,
    selected,
    "Generated selected directory",
    "generated catalog root"
  );
  const contractPath = resolve(selected, "catalog.contract.gen.json");
  const generatedFacadePath = resolve(generatedRoot, "index.ts");
  const privateCarrierPath = resolve(selected, "catalog.manifest.gen.mjs");
  const provenancePath = resolve(selected, "catalog.provenance.gen.json");
  const [contractSource, generatedFacadeSource, provenanceSource] =
    await Promise.all([
      readConfinedTextFile(
        selectedCanonicalDirectory,
        contractPath,
        "Generated catalog contract",
        "selected catalog directory"
      ),
      readConfinedTextFile(
        canonicalGeneratedRoot,
        generatedFacadePath,
        "Generated stable facade",
        "generated catalog root"
      ),
      readConfinedTextFile(
        selectedCanonicalDirectory,
        provenancePath,
        "Generated catalog provenance",
        "selected catalog directory"
      ),
      assertConfinedRegularFile(
        selectedCanonicalDirectory,
        privateCarrierPath,
        "Generated private carrier",
        "selected catalog directory"
      ),
    ]);
  assertGeneratedFacadeSelector(generatedFacadeSource, hash, directory);
  const messages = parseCatalogMessages(
    contractSource,
    provenanceSource,
    selected
  );
  await Promise.all(
    [
      ...new Set(
        [...messages.values()].map(({ descriptorModule }) => descriptorModule)
      ),
    ].map((module) =>
      assertConfinedRegularFile(
        selectedCanonicalDirectory,
        module,
        "Generated private message module",
        "selected catalog directory"
      )
    )
  );
  const catalog = {
    contentHash: hash,
    contractPath,
    dependencies: [
      pointerPath,
      generatedFacadePath,
      contractPath,
      provenancePath,
    ],
    generatedFacadePath: await realpath(generatedFacadePath),
    generatedFacadeHash: sha256(generatedFacadeSource),
    messages,
    privateCarrierPath,
    provenancePath,
    selectedCanonicalDirectory,
    selectedDirectory: selected,
    selectedRelativeDirectory: directory,
  } satisfies CurrentCatalog;
  catalogCache.set(generatedRoot, { catalog, pointerSource });
  return catalog;
}

function cleanModuleId(id: string): string {
  return id.replace(/[?#].*$/u, "");
}

function scriptKindFor(id: string): ts.ScriptKind {
  if (id.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  if (id.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }
  if (/\.[cm]?ts$/u.test(id)) {
    return ts.ScriptKind.TS;
  }
  return ts.ScriptKind.JS;
}

/**
 * Avoid opening and validating a catalog for source that cannot possibly be
 * translation-bearing. This is intentionally an AST preflight rather than an
 * authority decision: imported operations, i18next member calls, and
 * translator type references are all sent through the full TypeScript analysis
 * below. A bare identifier `t` is not authority (it is used throughout
 * ordinary application code); call-shaped `t`, `*.t`, and `t.*` uses are
 * conservatively analyzed because their authority can come from imported or
 * structurally typed props that this syntax-only preflight cannot prove.
 * False positives only cost work; false negatives would be a safety failure.
 */
function requiresMiraiIntlAnalysis(
  source: string,
  id: string,
  preparedSourceFile?: ts.SourceFile
): boolean {
  const sourceFile =
    preparedSourceFile ??
    ts.createSourceFile(
      id,
      source,
      ts.ScriptTarget.Latest,
      false,
      scriptKindFor(id)
    );
  let required = false;
  let importsI18next = false;
  let usesMemberTranslation = false;
  let usesControllerTranslation = false;
  const isTranslatorCallTarget = (expression: ts.Expression): boolean => {
    const target = unwrapExpression(expression);
    if (ts.isIdentifier(target)) {
      return target.text === "t";
    }
    if (!ts.isPropertyAccessExpression(target)) {
      return false;
    }
    if (target.name.text === "t") {
      return true;
    }
    let receiver = unwrapExpression(target.expression);
    while (ts.isPropertyAccessExpression(receiver)) {
      if (receiver.name.text === "t") {
        return true;
      }
      receiver = unwrapExpression(receiver.expression);
    }
    return ts.isIdentifier(receiver) && receiver.text === "t";
  };
  const visit = (node: ts.Node): void => {
    if (required) {
      return;
    }
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      if (miraiIntlImportedOperations.has(imported)) {
        required = true;
        return;
      }
    }
    if (
      ts.isImportClause(node) &&
      node.name &&
      factoryKind(node.name.text) !== undefined
    ) {
      required = true;
      return;
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      (node.moduleSpecifier.text === "i18next" ||
        node.moduleSpecifier.text === "react-i18next")
    ) {
      importsI18next = true;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "t") {
      usesMemberTranslation = true;
      const receiver = unwrapExpression(node.expression);
      const receiverCallee = ts.isCallExpression(receiver)
        ? unwrapExpression(receiver.expression)
        : undefined;
      if (
        receiverCallee &&
        ts.isPropertyAccessExpression(receiverCallee) &&
        receiverCallee.name.text === "getActiveInstance"
      ) {
        usesControllerTranslation = true;
      }
    }
    if (ts.isCallExpression(node) && isTranslatorCallTarget(node.expression)) {
      required = true;
      return;
    }
    if (
      ts.isIdentifier(node) &&
      (node.text === "Translator" || node.text === "TranslationFunction")
    ) {
      required = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return (
    required ||
    usesControllerTranslation ||
    (importsI18next && usesMemberTranslation)
  );
}

function moduleResolutionOptions(root: string): ts.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  if (!configPath) {
    return {
      allowJs: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.Latest,
    } satisfies ts.CompilerOptions;
  }
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(read.error.messageText, "\n")
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(configPath),
    undefined,
    configPath
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) =>
          ts.flattenDiagnosticMessageText(error.messageText, "\n")
        )
        .join("\n")
    );
  }
  return parsed.options;
}

function configuredAmbientTypeNames(
  options: ts.CompilerOptions | undefined
): Array<string> {
  if (options?.types) {
    return [...options.types];
  }
  if (!options?.typeRoots?.length || !ts.sys.getDirectories) {
    return [];
  }
  const names = new Set<string>();
  for (const root of options.typeRoots) {
    for (const directory of ts.sys.getDirectories(root)) {
      const name = basename(directory);
      if (!name.startsWith("@")) {
        names.add(name);
        continue;
      }
      for (const scopedDirectory of ts.sys.getDirectories(directory)) {
        names.add(`${name}/${basename(scopedDirectory)}`);
      }
    }
  }
  return [...names].toSorted(compareCanonicalStrings);
}

async function generatedFacadeImportNames(
  source: string,
  id: string,
  root: string,
  generatedFacadePath: string,
  compilerOptions?: ts.CompilerOptions,
  workspaceRoot: string = root,
  preparedSourceFile?: ts.SourceFile,
  classifierFacadeResolutions?: ReadonlyMap<string, SemanticProviderResolution>
): Promise<GeneratedFacadeImportNames> {
  const sourceFile =
    preparedSourceFile ??
    ts.createSourceFile(
      id,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(id)
    );
  const keyFactories = new Set<string>();
  const keyParsers = new Set<string>();
  const formErrorFactories = new Set<string>();
  const formSchemaFactories = new Set<string>();
  const translationKeyTypes = new Set<string>();
  const translationNamespaceTypes = new Set<string>();
  const facadeModules = new Set<string>();
  const facadeResolutions = new Map<string, SemanticProviderResolution>();
  const tracedModules = new Map<
    string,
    Readonly<{
      canonical: boolean;
      frontier: SemanticProviderResolution;
    }>
  >();
  let requiresFullFacade = false;
  let requiresCatalogContract = false;

  const traceFacadeModule = async (
    moduleName: string,
    node: ts.Node,
    requireCanonical: boolean
  ): Promise<boolean> => {
    let tracedModule = tracedModules.get(moduleName);
    if (!tracedModule) {
      const classifierFrontier = classifierFacadeResolutions?.get(moduleName);
      if (classifierFrontier) {
        tracedModule = { canonical: true, frontier: classifierFrontier };
      } else if (classifierFacadeResolutions) {
        tracedModule = {
          canonical: false,
          frontier: {
            controlFiles: [],
            from: id,
            packageName: null,
            packageVersion: null,
            probes: [],
            realpaths: [],
            specifier: moduleName,
          },
        };
      } else {
        const traced = resolveModuleWithFrontier(
          moduleName,
          id,
          compilerOptions ?? moduleResolutionOptions(root),
          workspaceRoot
        );
        let canonical: string | undefined;
        if (traced.resolvedModule) {
          try {
            canonical = await realpath(traced.resolvedModule.resolvedFileName);
          } catch {
            canonical = undefined;
          }
        }
        tracedModule = {
          canonical:
            canonical !== undefined &&
            isSamePath(canonical, generatedFacadePath),
          frontier: traced.frontier,
        };
      }
      tracedModules.set(moduleName, tracedModule);
    }
    if (tracedModule.canonical) {
      facadeModules.add(moduleName);
      facadeResolutions.set(
        `${normalizedSemanticPath(tracedModule.frontier.from)}\u0000${tracedModule.frontier.specifier}`,
        tracedModule.frontier
      );
      return true;
    }
    if (requireCanonical) {
      const start = node.getStart(sourceFile);
      const { character, line } =
        sourceFile.getLineAndCharacterOfPosition(start);
      throw new Error(
        `${id}:${line + 1}:${character + 1}: Translation key helpers and aliases must be imported directly from the configured generated facade`
      );
    }
    return false;
  };

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.importClause.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    const facadeImports = statement.importClause.namedBindings.elements.filter(
      (specifier) => {
        const importedName = (specifier.propertyName ?? specifier.name).text;
        return (
          importedName === "createTranslationKey" ||
          importedName === "parseTranslationKey" ||
          importedName === "createFormErrorTranslator" ||
          importedName === "createFormSchema" ||
          importedName === "CatalogContract" ||
          importedName === "TranslationKey" ||
          importedName === "TranslationNamespace"
        );
      }
    );
    if (facadeImports.length === 0) {
      continue;
    }
    await traceFacadeModule(
      statement.moduleSpecifier.text,
      statement.moduleSpecifier,
      true
    );
    for (const specifier of facadeImports) {
      const importedName = (specifier.propertyName ?? specifier.name).text;
      if (importedName === "TranslationKey") {
        translationKeyTypes.add(specifier.name.text);
      } else if (importedName === "TranslationNamespace") {
        translationNamespaceTypes.add(specifier.name.text);
        requiresFullFacade = true;
      } else if (importedName === "CatalogContract") {
        requiresCatalogContract = true;
        requiresFullFacade = true;
      }
    }
    if (statement.importClause.isTypeOnly) {
      continue;
    }
    for (const specifier of facadeImports) {
      if (specifier.isTypeOnly) {
        continue;
      }
      const importedName = (specifier.propertyName ?? specifier.name).text;
      if (importedName === "createTranslationKey") {
        keyFactories.add(specifier.name.text);
      } else if (importedName === "parseTranslationKey") {
        keyParsers.add(specifier.name.text);
      } else if (importedName === "createFormErrorTranslator") {
        formErrorFactories.add(specifier.name.text);
      } else if (importedName === "createFormSchema") {
        formSchemaFactories.add(specifier.name.text);
      }
    }
  }

  const facadeBoundaries: Array<
    Readonly<{
      invalidImports: ReadonlyArray<string>;
      moduleName: string;
      node: ts.Node;
      requiresFullFacade: boolean;
    }>
  > = [];
  const collectFacadeBoundaries = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const namedImports =
        bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map(
              (specifier) => (specifier.propertyName ?? specifier.name).text
            )
          : [];
      facadeBoundaries.push({
        invalidImports: [
          ...(clause?.name ? ["default"] : []),
          ...namedImports.filter(
            (name) => !generatedFacadeStableNames.has(name)
          ),
        ],
        moduleName: node.moduleSpecifier.text,
        node: node.moduleSpecifier,
        requiresFullFacade:
          clause === undefined ||
          clause.name !== undefined ||
          (bindings !== undefined && ts.isNamespaceImport(bindings)) ||
          namedImports.some((name) => !generatedFacadeStableNames.has(name)),
      });
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      facadeBoundaries.push({
        invalidImports: [],
        moduleName: node.moduleSpecifier.text,
        node: node.moduleSpecifier,
        requiresFullFacade: true,
      });
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      facadeBoundaries.push({
        invalidImports: [],
        moduleName: node.moduleReference.expression.text,
        node: node.moduleReference.expression,
        requiresFullFacade: true,
      });
      return;
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      facadeBoundaries.push({
        invalidImports: [],
        moduleName: node.argument.literal.text,
        node: node.argument.literal,
        requiresFullFacade: true,
      });
      return;
    }
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      facadeBoundaries.push({
        invalidImports: [],
        moduleName: node.name.text,
        node: node.name,
        requiresFullFacade: true,
      });
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      if (
        argument &&
        ts.isStringLiteral(argument) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        facadeBoundaries.push({
          invalidImports: [],
          moduleName: argument.text,
          node: argument,
          requiresFullFacade: true,
        });
      }
    }
    ts.forEachChild(node, collectFacadeBoundaries);
  };
  collectFacadeBoundaries(sourceFile);
  for (const boundary of facadeBoundaries) {
    const canonical = await traceFacadeModule(
      boundary.moduleName,
      boundary.node,
      false
    );
    if (canonical && boundary.invalidImports.length > 0) {
      const start = boundary.node.getStart(sourceFile);
      const { character, line } =
        sourceFile.getLineAndCharacterOfPosition(start);
      throw new Error(
        `${id}:${line + 1}:${character + 1}: Generated facade import is unsupported: ${boundary.invalidImports.join(", ")}`
      );
    }
    if (canonical && boundary.requiresFullFacade) {
      requiresFullFacade = true;
    }
  }

  return {
    facadeModules,
    facadeResolutions: [...facadeResolutions.values()].toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.from}\u0000${left.specifier}`,
        `${right.from}\u0000${right.specifier}`
      )
    ),
    formErrorFactories,
    formSchemaFactories,
    keyFactories,
    keyParsers,
    requiresCatalogContract,
    requiresFullFacade,
    translationKeyTypes,
    translationNamespaceTypes,
  };
}

function factoryKind(name: string): FactoryKind | undefined {
  if (name === "useTranslations") {
    return "client";
  }
  if (name === "getServerTranslations") {
    return "server";
  }
  return undefined;
}

function generatedFacadeTypeModule(
  catalog: CurrentCatalog,
  root: string,
  selectedNamespaces?: ReadonlySet<string>,
  includeCatalogContract = false
): string {
  const namespaces = new Map<string, Set<string>>();
  for (const message of catalog.messages.values()) {
    const parts = message.path.split(".");
    for (let index = 1; index < parts.length; index += 1) {
      const namespace = parts.slice(0, index).join(".");
      if (selectedNamespaces && !selectedNamespaces.has(namespace)) {
        continue;
      }
      const entries = namespaces.get(namespace) ?? new Set<string>();
      if (message.kind === "text" && !message.hasArguments) {
        entries.add(parts.slice(index).join("."));
      }
      namespaces.set(namespace, entries);
    }
  }
  const entries = [...namespaces.entries()].toSorted(([left], [right]) =>
    compareCanonicalStrings(left, right)
  );
  const namespaceType =
    entries.map(([namespace]) => JSON.stringify(namespace)).join(" | ") ||
    "never";
  const keyMap = entries
    .map(([namespace, keys]) => {
      const keyType =
        [...keys]
          .toSorted()
          .map((key) => JSON.stringify(key))
          .join(" | ") || "never";
      return `  readonly ${JSON.stringify(namespace)}: ${keyType};`;
    })
    .join("\n");
  const formErrorEntries = entries
    .map(([namespace, keys]) => {
      const formErrorKeys = [...keys]
        .filter((key) => key.startsWith("error.form."))
        .map((key) => key.slice("error.form.".length));
      if (formErrorKeys.length === 0) {
        return undefined;
      }
      return `  readonly ${JSON.stringify(namespace)}: ${formErrorKeys
        .toSorted()
        .map((key) => JSON.stringify(key))
        .join(" | ")};`;
    })
    .filter((entry): entry is string => entry !== undefined)
    .join("\n");
  const generatedSpecifier = (name: string): string => {
    const path = relative(root, resolve(catalog.selectedDirectory, name))
      .split(sep)
      .join("/");
    return path.startsWith(".") ? path : `./${path}`;
  };
  return [
    ...(includeCatalogContract
      ? [
          `export type { CatalogContract } from ${JSON.stringify(generatedSpecifier("catalog.schema.gen.mjs"))};`,
        ]
      : []),
    `export type { CatalogLocale } from ${JSON.stringify(generatedSpecifier("catalog.resources.gen.mjs"))};`,
    `export { catalogManifest } from ${JSON.stringify(generatedSpecifier("catalog.manifest.gen.mjs"))};`,
    `export { isCatalogLocale, loadCatalogResource } from ${JSON.stringify(generatedSpecifier("catalog.resources.gen.mjs"))};`,
    `export type TranslationNamespace = ${namespaceType};`,
    "type __MiraiIntlTranslationKeys = {",
    keyMap,
    "};",
    "export type TranslationKey<Namespace extends TranslationNamespace> = __MiraiIntlTranslationKeys[Namespace];",
    "type __MiraiIntlFormErrorKeys = {",
    formErrorEntries,
    "};",
    "type __MiraiIntlFormNamespace = keyof __MiraiIntlFormErrorKeys;",
    "export declare const createTranslationKey: <const Namespace extends TranslationNamespace>(namespace: Namespace) => <const Key extends TranslationKey<Namespace>>(key: Key) => `${Namespace}.${Key}`;",
    "export declare const parseTranslationKey: <const Namespace extends TranslationNamespace>(namespace: Namespace, input: unknown) => `${Namespace}.${TranslationKey<Namespace>}` | undefined;",
    "export declare const createFormErrorTranslator: <const Namespace extends TranslationNamespace>(namespace: Namespace, translator: unknown) => { (input: string): string | undefined; has(input: string): boolean; };",
    "type __MiraiIntlCreateFormSchema = {",
    "  <const Namespace extends __MiraiIntlFormNamespace, Schema>(namespace: Namespace, build: (helpers: Readonly<{ error: <const Key extends __MiraiIntlFormErrorKeys[Namespace]>(key: Key) => `error.form.${Key}` }>) => Schema): Schema;",
    "  helper<Args extends ReadonlyArray<unknown>, Schema>(factory: (...args: Args) => Schema): (...args: Args) => Schema;",
    "};",
    "export declare const createFormSchema: __MiraiIntlCreateFormSchema;",
    "",
  ].join("\n");
}

function generatedFacadeSliceNamespaces(
  sourceFile: ts.SourceFile,
  imports: GeneratedFacadeImportNames
): ReadonlySet<string> | undefined {
  if (
    imports.requiresFullFacade ||
    imports.translationNamespaceTypes.size > 0
  ) {
    return undefined;
  }
  const namespaces = new Set<string>();
  const runtimeBindings = new Map<
    string,
    "form-error" | "form-schema" | "key-factory" | "key-parser"
  >();
  for (const name of imports.formErrorFactories) {
    runtimeBindings.set(name, "form-error");
  }
  for (const name of imports.formSchemaFactories) {
    runtimeBindings.set(name, "form-schema");
  }
  for (const name of imports.keyFactories) {
    runtimeBindings.set(name, "key-factory");
  }
  for (const name of imports.keyParsers) {
    runtimeBindings.set(name, "key-parser");
  }
  const importedBindings = new Set([
    ...runtimeBindings.keys(),
    ...imports.translationKeyTypes,
  ]);
  let safe = true;
  const recordNamespace = (node: ts.Node | undefined): boolean => {
    const literal = node && ts.isLiteralTypeNode(node) ? node.literal : node;
    if (!literal || !ts.isStringLiteralLike(literal)) {
      return false;
    }
    namespaces.add(literal.text);
    return true;
  };
  const visit = (node: ts.Node): void => {
    if (!safe) {
      return;
    }
    if (ts.isImportSpecifier(node) && importedBindings.has(node.name.text)) {
      return;
    }
    if (ts.isIdentifier(node)) {
      const runtimeKind = runtimeBindings.get(node.text);
      if (runtimeKind) {
        const parent = node.parent;
        if (
          runtimeKind === "form-schema" &&
          ts.isPropertyAccessExpression(parent) &&
          parent.expression === node &&
          parent.name.text === "helper" &&
          ts.isCallExpression(parent.parent) &&
          parent.parent.expression === parent
        ) {
          safe = false;
          return;
        }
        if (
          !ts.isCallExpression(parent) ||
          parent.expression !== node ||
          !recordNamespace(parent.arguments[0])
        ) {
          safe = false;
        }
        return;
      }
      if (imports.translationKeyTypes.has(node.text)) {
        const parent = node.parent;
        if (
          !ts.isTypeReferenceNode(parent) ||
          parent.typeName !== node ||
          parent.typeArguments?.length !== 1 ||
          !recordNamespace(parent.typeArguments[0])
        ) {
          safe = false;
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return safe ? namespaces : undefined;
}

function finiteDependencyModules(
  sourceFile: ts.SourceFile
): ReadonlySet<string> {
  const importedModules = new Map<string, string>();
  const sourceModules = new Set<string>();
  const declarations = new Map<string, Array<ts.Node>>();
  const translatorNames = new Set<string>();

  const addDeclaration = (name: ts.BindingName, declaration: ts.Node): void => {
    if (ts.isIdentifier(name)) {
      const entries = declarations.get(name.text) ?? [];
      entries.push(declaration);
      declarations.set(name.text, entries);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) {
        addDeclaration(element.name, element);
      }
    }
  };

  const collect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const module = node.moduleSpecifier.text;
      sourceModules.add(module);
      if (node.importClause.name) {
        importedModules.set(node.importClause.name.text, module);
      }
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const specifier of bindings.elements) {
          importedModules.set(specifier.name.text, module);
        }
      }
    } else if (ts.isVariableDeclaration(node)) {
      addDeclaration(node.name, node);
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const property = element.propertyName ?? element.name;
          if (
            (ts.isIdentifier(property) || ts.isStringLiteral(property)) &&
            property.text === "t" &&
            ts.isIdentifier(element.name)
          ) {
            translatorNames.add(element.name.text);
          }
        }
      }
    } else if (ts.isParameter(node)) {
      addDeclaration(node.name, node);
    } else if (
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) {
      if (node.name) {
        const entries = declarations.get(node.name.text) ?? [];
        entries.push(node);
        declarations.set(node.name.text, entries);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const modules = new Set<string>();
  const visitedNodes = new Set<ts.Node>();
  const visitedNames = new Set<string>();

  const traceName = (name: string): void => {
    if (name === "React" && sourceModules.has("react")) {
      modules.add("react");
    }
    const imported = importedModules.get(name);
    if (imported) {
      modules.add(imported);
    }
    if (visitedNames.has(name)) {
      return;
    }
    visitedNames.add(name);
    for (const declaration of declarations.get(name) ?? []) {
      traceDeclaration(declaration);
    }
  };

  const traceNode = (node: ts.Node): void => {
    if (visitedNodes.has(node)) {
      return;
    }
    visitedNodes.add(node);
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      if (
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isMethodSignature(parent) && parent.name === node)
      ) {
        return;
      }
      traceName(node.text);
      return;
    }
    ts.forEachChild(node, traceNode);
  };

  const traceCallbackReceiver = (node: ts.Node): void => {
    let current: ts.Node | undefined = node;
    while (current && !ts.isFunctionLike(current)) {
      current = current.parent;
    }
    const call = current?.parent;
    if (
      current &&
      call &&
      ts.isCallExpression(call) &&
      call.arguments.includes(current as ts.Expression)
    ) {
      const callee = unwrapExpression(call.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        traceNode(callee.expression);
      }
    }
  };

  const traceFunctionContext = (parameter: ts.ParameterDeclaration): void => {
    const functionLike = parameter.parent;
    if (
      !ts.isArrowFunction(functionLike) &&
      !ts.isFunctionExpression(functionLike)
    ) {
      return;
    }
    const owner = functionLike.parent;
    if (
      ts.isVariableDeclaration(owner) &&
      owner.initializer === functionLike &&
      owner.type
    ) {
      traceNode(owner.type);
    }
  };

  function traceDeclaration(declaration: ts.Node): void {
    if (ts.isVariableDeclaration(declaration)) {
      if (declaration.type) {
        traceNode(declaration.type);
      }
      if (declaration.initializer) {
        traceNode(declaration.initializer);
      }
      return;
    }
    if (ts.isParameter(declaration)) {
      if (declaration.type) {
        traceNode(declaration.type);
      }
      if (declaration.initializer) {
        traceNode(declaration.initializer);
      }
      traceCallbackReceiver(declaration);
      traceFunctionContext(declaration);
      return;
    }
    if (ts.isBindingElement(declaration)) {
      if (declaration.initializer) {
        traceNode(declaration.initializer);
      }
      traceCallbackReceiver(declaration);
      const container = declaration.parent.parent;
      if (ts.isVariableDeclaration(container) || ts.isParameter(container)) {
        traceDeclaration(container);
      }
      return;
    }
    ts.forEachChild(declaration, traceNode);
  }

  const collectDynamicDependencies = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments[0]) {
      const callee = unwrapExpression(node.expression);
      const translatorCall =
        (ts.isIdentifier(callee) && translatorNames.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === "t");
      if (translatorCall && literalString(node.arguments[0]) === undefined) {
        traceNode(node.arguments[0]);
      }
    }
    ts.forEachChild(node, collectDynamicDependencies);
  };
  collectDynamicDependencies(sourceFile);
  return modules;
}

function resolveModuleWithFrontier(
  moduleName: string,
  containingFile: string,
  options: ts.CompilerOptions,
  workspaceRoot: string,
  resolutionMode?: ts.ResolutionMode
): Readonly<{
  frontier: SemanticProviderResolution;
  resolvedModule: ts.ResolvedModuleFull | undefined;
}> {
  // TypeScript owns option semantics here. Tracing the host captures the exact
  // finite search frontier for paths/baseUrl, rootDirs, moduleSuffixes,
  // customConditions, package exports/imports, and arbitrary extensions.
  // Configured typeRoots/types bypass this resolver and are traced separately
  // through resolveTypeReferenceWithFrontier.
  const probes = new Map<
    string,
    Readonly<{
      kind: "directory" | "file";
      path: string;
      present: boolean;
    }>
  >();
  const controlFiles = new Map<
    string,
    Readonly<{ hash: `sha256:${string}`; path: string }>
  >();
  const realpaths = new Map<string, string>();
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const hostPath = (path: string): string =>
    resolve(resolvedWorkspaceRoot, path);
  const canonicalizeWithExistingAncestor = (path: string): string => {
    const absolute = resolve(path);
    let ancestor = absolute;
    while (
      !ts.sys.fileExists(ancestor) &&
      !(ts.sys.directoryExists?.(ancestor) ?? false)
    ) {
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        break;
      }
      ancestor = parent;
    }
    const canonicalAncestor = ts.sys.realpath?.(ancestor) ?? ancestor;
    return resolve(canonicalAncestor, relative(ancestor, absolute));
  };
  const canonicalWorkspaceRoot = canonicalizeWithExistingAncestor(
    resolvedWorkspaceRoot
  );
  const confinedPath = (
    path: string,
    relevant: boolean,
    kind: "control" | "probe" | "realpath"
  ): string | undefined => {
    const absolute = resolve(path);
    const canonical = canonicalizeWithExistingAncestor(absolute);
    if (isWithin(canonicalWorkspaceRoot, canonical)) {
      return resolve(
        resolvedWorkspaceRoot,
        relative(canonicalWorkspaceRoot, canonical)
      );
    }
    if (relevant) {
      throw new Error(
        `Provider resolution ${kind} for ${moduleName} escapes its workspace root: ${absolute}`
      );
    }
    return undefined;
  };
  if (!confinedPath(containingFile, true, "control")) {
    throw new Error(
      `Provider resolution source for ${moduleName} escapes its workspace root`
    );
  }
  const recordProbe = (
    path: string,
    kind: "directory" | "file",
    present: boolean
  ): void => {
    const lexicalPath = resolve(path);
    // TypeScript walks existing ancestor directories while looking for package
    // scopes. An ancestor outside the workspace is not provider evidence by
    // itself. A probe that starts inside the workspace remains fail-closed even
    // when a symlink redirects its nearest existing ancestor outside.
    const confined = confinedPath(
      lexicalPath,
      isWithin(resolvedWorkspaceRoot, lexicalPath) ||
        (present && kind === "file"),
      "probe"
    );
    if (!confined) {
      return;
    }
    const identity = `${confined}\u0000${kind}`;
    const previous = probes.get(identity);
    if (previous && previous.present !== present) {
      throw new Error(
        `Provider resolution frontier changed while resolving ${moduleName}`
      );
    }
    probes.set(identity, { kind, path: confined, present });
  };
  const resolutionHost: ts.ModuleResolutionHost = {
    ...ts.sys,
    directoryExists(path) {
      const absolute = hostPath(path);
      const present = ts.sys.directoryExists?.(absolute) ?? false;
      recordProbe(absolute, "directory", present);
      return present;
    },
    fileExists(path) {
      const absolute = hostPath(path);
      const present = ts.sys.fileExists(absolute);
      recordProbe(absolute, "file", present);
      return present;
    },
    getCurrentDirectory() {
      return resolvedWorkspaceRoot;
    },
    readFile(path) {
      const absolute = hostPath(path);
      let bytes: Buffer;
      try {
        bytes = readFileSync(absolute);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      }
      const value = decodeUtf8Fatal(
        bytes,
        `Provider resolution control ${absolute}`
      );
      {
        const confined = confinedPath(absolute, true, "control");
        if (confined) {
          const control = { hash: sha256(bytes), path: confined } as const;
          const existing = controlFiles.get(confined);
          if (existing && existing.hash !== control.hash) {
            throw new Error(
              `Provider resolution control changed while resolving ${moduleName}`
            );
          }
          controlFiles.set(confined, control);
          recordProbe(confined, "file", true);
          const target = ts.sys.realpath?.(absolute) ?? absolute;
          const confinedTarget = confinedPath(target, true, "realpath");
          if (confinedTarget) {
            const previousTarget = realpaths.get(confined);
            if (previousTarget && previousTarget !== confinedTarget) {
              throw new Error(
                `Provider resolution realpath changed while resolving ${moduleName}`
              );
            }
            realpaths.set(confined, confinedTarget);
          }
        }
      }
      return value;
    },
    realpath(path) {
      const absolute = hostPath(path);
      const target = ts.sys.realpath?.(absolute) ?? absolute;
      const confinedSource = confinedPath(absolute, true, "realpath");
      const confinedTarget = confinedPath(target, true, "realpath");
      if (confinedSource && confinedTarget) {
        realpaths.set(confinedSource, confinedTarget);
      }
      return target;
    },
  };
  const result = ts.resolveModuleName(
    moduleName,
    containingFile,
    options,
    resolutionHost,
    undefined,
    undefined,
    resolutionMode
  );
  const resolvedModule = result.resolvedModule;
  if (resolvedModule) {
    const target =
      ts.sys.realpath?.(resolvedModule.resolvedFileName) ??
      resolve(resolvedModule.resolvedFileName);
    const confinedSource = confinedPath(
      resolvedModule.resolvedFileName,
      true,
      "realpath"
    );
    const confinedTarget = confinedPath(target, true, "realpath");
    if (confinedSource && confinedTarget) {
      realpaths.set(confinedSource, confinedTarget);
    }
    recordProbe(
      resolvedModule.resolvedFileName,
      "file",
      ts.sys.fileExists(resolvedModule.resolvedFileName)
    );
  }
  return {
    frontier: {
      controlFiles: [...controlFiles.values()],
      from: containingFile,
      packageName: resolvedModule?.packageId?.name ?? null,
      packageVersion: resolvedModule?.packageId?.version ?? null,
      probes: [...probes.values()],
      realpaths: [...realpaths].map(([path, target]) => ({ path, target })),
      specifier: moduleName,
    },
    resolvedModule,
  };
}

function classifierResolutionMode(
  mode: ts.ResolutionMode
): MiraiIntlClassifierResolutionMode | undefined {
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

function classifierSourceExtension(id: string): string {
  const lower = id.toLowerCase();
  for (const extension of [
    ".d.mts",
    ".d.cts",
    ".d.ts",
    ".tsx",
    ".mts",
    ".cts",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".js",
    ".json",
  ]) {
    if (lower.endsWith(extension)) {
      return extension;
    }
  }
  const name = basename(lower);
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index);
}

/**
 * Builds the Phase-B unconditional reference ledger in shadow mode.
 *
 * This API is intentionally disconnected from transform and authorization
 * entrypoints. Tests and benchmarks must invoke it explicitly, so the current
 * production classifier, receipts, resolution count, and Program count remain
 * unchanged until the optimized classifier is qualified.
 */
export async function classifyMiraiIntlModuleBoundariesShadow(
  source: string,
  id: string,
  options: ts.CompilerOptions,
  workspaceRoot: string,
  generatedFacadePath: string
): Promise<MiraiIntlClassifierShadowResult> {
  const cleanId = resolve(cleanModuleId(id));
  const impliedNodeFormat = ts.getImpliedNodeFormatForFile(
    cleanId,
    undefined,
    ts.sys,
    options
  );
  const sourceFile = ts.createSourceFile(
    cleanId,
    source,
    {
      impliedNodeFormat,
      languageVersion: ts.ScriptTarget.Latest,
    },
    true,
    scriptKindFor(cleanId)
  );
  const sourceExtension = classifierSourceExtension(cleanId);
  const impliedNodeFormatName =
    classifierResolutionMode(sourceFile.impliedNodeFormat) ?? "default";
  const canonicalGeneratedFacade = await realpath(generatedFacadePath);
  const boundaries: Array<MiraiIntlClassifierShadowBoundary> = [];
  const unknownBoundaries: Array<MiraiIntlClassifierShadowUnknownBoundary> = [];
  let nextBoundaryOrdinal = 0;
  let nextObservationOrdinal = 0;

  const recordUnknown = (
    kind: MiraiIntlClassifierBoundaryKind,
    node: ts.Node,
    observationOrdinal: number,
    reason: MiraiIntlClassifierShadowUnknownBoundary["reason"]
  ): void => {
    const characterStart = node.getStart(sourceFile);
    const characterEnd = node.getEnd();
    const byteStart = Buffer.byteLength(source.slice(0, characterStart));
    const byteEnd = Buffer.byteLength(source.slice(0, characterEnd));
    const sourceSliceHash = sha256(
      Buffer.from(source.slice(characterStart, characterEnd))
    );
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
            observationOrdinal,
            reason,
            cleanId,
            byteStart,
            byteEnd,
            sourceSliceHash,
          ],
        ])
      ),
      nodeKind,
      observationOrdinal,
      reason,
      source: cleanId,
      sourceSliceHash,
    });
  };

  const record = (
    kind: MiraiIntlClassifierBoundaryKind,
    node: ts.Node,
    moduleReference: ts.StringLiteralLike | undefined
  ): void => {
    const observationOrdinal = nextObservationOrdinal;
    nextObservationOrdinal += 1;
    if (!moduleReference) {
      recordUnknown(kind, node, observationOrdinal, "nonliteral-specifier");
      return;
    }
    const rawResolutionMode = ts.getModeForUsageLocation(
      sourceFile,
      moduleReference,
      options
    );
    const resolutionMode = classifierResolutionMode(rawResolutionMode);
    if (!resolutionMode) {
      recordUnknown(
        kind,
        moduleReference,
        observationOrdinal,
        "unknown-resolution-mode"
      );
      return;
    }
    const ordinal = nextBoundaryOrdinal;
    nextBoundaryOrdinal += 1;
    boundaries.push({
      impliedNodeFormat: impliedNodeFormatName,
      kind,
      nodeKind:
        ts.SyntaxKind[moduleReference.kind] ?? String(moduleReference.kind),
      ordinal,
      observationOrdinal,
      resolutionMode,
      source: cleanId,
      sourceExtension,
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
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
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

  const requests = await Promise.all(
    boundaries.map(
      async (boundary): Promise<MiraiIntlClassifierShadowRequest> => {
        let rawResolutionMode: ts.ResolutionMode;
        if (boundary.resolutionMode === "import") {
          rawResolutionMode = ts.ModuleKind.ESNext;
        } else if (boundary.resolutionMode === "require") {
          rawResolutionMode = ts.ModuleKind.CommonJS;
        }
        const traced = resolveModuleWithFrontier(
          boundary.specifier,
          boundary.source,
          options,
          workspaceRoot,
          rawResolutionMode
        );
        let canonicalTarget: string | null = null;
        if (traced.resolvedModule) {
          try {
            canonicalTarget = await realpath(
              traced.resolvedModule.resolvedFileName
            );
          } catch {
            canonicalTarget = null;
          }
        }
        return {
          boundary,
          canonicalTarget,
          frontier: traced.frontier,
          resolutionMode: boundary.resolutionMode,
          resolvedFileName: traced.resolvedModule?.resolvedFileName ?? null,
        };
      }
    )
  );
  const resolutionFailures = requests.flatMap(
    ({ boundary, canonicalTarget, resolvedFileName }) =>
      resolvedFileName !== null && canonicalTarget === null
        ? [
            {
              boundaryOrdinal: boundary.ordinal,
              reason: "target-realpath-failed" as const,
              resolvedFileName,
            },
          ]
        : []
  );
  const generatedFacadeOrdinals = requests
    .filter(
      ({ canonicalTarget }) =>
        canonicalTarget !== null &&
        isSamePath(canonicalTarget, canonicalGeneratedFacade)
    )
    .map(({ boundary }) => boundary.ordinal);
  const ledger: Array<MiraiIntlClassifierShadowLedgerEntry> = [
    ...boundaries.map(
      ({
        kind,
        observationOrdinal,
        ordinal,
        resolutionMode,
        source: boundarySource,
        specifier,
      }): MiraiIntlClassifierBoundaryTuple => ({
        kind,
        observationOrdinal,
        ordinal,
        resolutionMode,
        source: boundarySource,
        specifier,
      })
    ),
    ...unknownBoundaries,
  ].toSorted(
    (left, right) => left.observationOrdinal - right.observationOrdinal
  );
  const boundaryIdentity = hashMiraiIntlClassifierBoundariesShadow(ledger);
  let decision: MiraiIntlClassifierShadowDecision = "facade-absent";
  if (generatedFacadeOrdinals.length > 0) {
    decision = "facade-present";
  } else if (unknownBoundaries.length > 0) {
    decision = "facade-unknown-active";
  }
  return {
    ambiguous: resolutionFailures.length > 0,
    boundaries,
    boundaryHash: boundaryIdentity.hash,
    boundaryHashInput: boundaryIdentity.preimage,
    counters: {
      boundaries: boundaries.length,
      generatedFacadeBoundaries: generatedFacadeOrdinals.length,
      referenceRequests: requests.length,
      resolutionFailures: resolutionFailures.length,
      unknownBoundaries: unknownBoundaries.length,
    },
    decision,
    generatedFacadeOrdinals,
    ledger,
    requests,
    requiresProgram: decision !== "facade-absent",
    resolutionFailures,
    source: cleanId,
    unknownBoundaries,
  };
}

function resolveTypeReferenceWithFrontier(
  directiveName: string,
  containingFile: string,
  options: ts.CompilerOptions,
  workspaceRoot: string
): Readonly<{
  frontier: SemanticProviderResolution;
  resolvedTypeReferenceDirective: ts.ResolvedTypeReferenceDirective | undefined;
}> {
  const probes = new Map<
    string,
    Readonly<{
      kind: "directory" | "file";
      path: string;
      present: boolean;
    }>
  >();
  const controlFiles = new Map<
    string,
    Readonly<{ hash: `sha256:${string}`; path: string }>
  >();
  const realpaths = new Map<string, string>();
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const hostPath = (path: string): string =>
    resolve(resolvedWorkspaceRoot, path);
  const canonicalizeWithExistingAncestor = (path: string): string => {
    const absolute = resolve(path);
    let ancestor = absolute;
    while (
      !ts.sys.fileExists(ancestor) &&
      !(ts.sys.directoryExists?.(ancestor) ?? false)
    ) {
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        break;
      }
      ancestor = parent;
    }
    const canonicalAncestor = ts.sys.realpath?.(ancestor) ?? ancestor;
    return resolve(canonicalAncestor, relative(ancestor, absolute));
  };
  const canonicalWorkspaceRoot = canonicalizeWithExistingAncestor(
    resolvedWorkspaceRoot
  );
  const confinedPath = (
    path: string,
    relevant: boolean,
    kind: "control" | "probe" | "realpath"
  ): string | undefined => {
    const absolute = resolve(path);
    const canonical = canonicalizeWithExistingAncestor(absolute);
    if (isWithin(canonicalWorkspaceRoot, canonical)) {
      return resolve(
        resolvedWorkspaceRoot,
        relative(canonicalWorkspaceRoot, canonical)
      );
    }
    if (relevant) {
      throw new Error(
        `Type-reference resolution ${kind} for ${directiveName} escapes its workspace root: ${absolute}`
      );
    }
    return undefined;
  };
  const recordProbe = (
    path: string,
    kind: "directory" | "file",
    present: boolean
  ): void => {
    const lexicalPath = resolve(path);
    const confined = confinedPath(
      lexicalPath,
      isWithin(resolvedWorkspaceRoot, lexicalPath) ||
        (present && kind === "file"),
      "probe"
    );
    if (!confined) {
      return;
    }
    const identity = `${confined}\u0000${kind}`;
    const previous = probes.get(identity);
    if (previous && previous.present !== present) {
      throw new Error(
        `Type-reference resolution frontier changed while resolving ${directiveName}`
      );
    }
    probes.set(identity, { kind, path: confined, present });
  };
  const resolutionHost: ts.ModuleResolutionHost = {
    ...ts.sys,
    directoryExists(path) {
      const absolute = hostPath(path);
      const present = ts.sys.directoryExists?.(absolute) ?? false;
      recordProbe(absolute, "directory", present);
      return present;
    },
    fileExists(path) {
      const absolute = hostPath(path);
      const present = ts.sys.fileExists(absolute);
      recordProbe(absolute, "file", present);
      return present;
    },
    getCurrentDirectory() {
      return resolvedWorkspaceRoot;
    },
    readFile(path) {
      const absolute = hostPath(path);
      let bytes: Buffer;
      try {
        bytes = readFileSync(absolute);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      }
      const value = decodeUtf8Fatal(
        bytes,
        `Type-reference resolution control ${absolute}`
      );
      {
        const confined = confinedPath(absolute, true, "control");
        if (confined) {
          const control = { hash: sha256(bytes), path: confined } as const;
          const existing = controlFiles.get(confined);
          if (existing && existing.hash !== control.hash) {
            throw new Error(
              `Type-reference resolution control changed while resolving ${directiveName}`
            );
          }
          controlFiles.set(confined, control);
          recordProbe(confined, "file", true);
          const target = ts.sys.realpath?.(absolute) ?? absolute;
          const confinedTarget = confinedPath(target, true, "realpath");
          if (confinedTarget) {
            const previousTarget = realpaths.get(confined);
            if (previousTarget && previousTarget !== confinedTarget) {
              throw new Error(
                `Type-reference resolution realpath changed while resolving ${directiveName}`
              );
            }
            realpaths.set(confined, confinedTarget);
          }
        }
      }
      return value;
    },
    realpath(path) {
      const absolute = hostPath(path);
      const target = ts.sys.realpath?.(absolute) ?? absolute;
      const confinedSource = confinedPath(absolute, true, "realpath");
      const confinedTarget = confinedPath(target, true, "realpath");
      if (confinedSource && confinedTarget) {
        realpaths.set(confinedSource, confinedTarget);
      }
      return target;
    },
  };
  const resolvedTypeReferenceDirective = ts.resolveTypeReferenceDirective(
    directiveName,
    containingFile,
    options,
    resolutionHost
  ).resolvedTypeReferenceDirective;
  if (resolvedTypeReferenceDirective?.resolvedFileName) {
    const target =
      ts.sys.realpath?.(resolvedTypeReferenceDirective.resolvedFileName) ??
      resolve(resolvedTypeReferenceDirective.resolvedFileName);
    const confinedSource = confinedPath(
      resolvedTypeReferenceDirective.resolvedFileName,
      true,
      "realpath"
    );
    const confinedTarget = confinedPath(target, true, "realpath");
    if (confinedSource && confinedTarget) {
      realpaths.set(confinedSource, confinedTarget);
    }
    recordProbe(
      resolvedTypeReferenceDirective.resolvedFileName,
      "file",
      ts.sys.fileExists(resolvedTypeReferenceDirective.resolvedFileName)
    );
  }
  return {
    frontier: {
      controlFiles: [...controlFiles.values()],
      from: containingFile,
      packageName: resolvedTypeReferenceDirective?.packageId?.name ?? null,
      packageVersion:
        resolvedTypeReferenceDirective?.packageId?.version ?? null,
      probes: [...probes.values()],
      realpaths: [...realpaths].map(([path, target]) => ({ path, target })),
      specifier: directiveName,
    },
    resolvedTypeReferenceDirective,
  };
}

function nodeModulesProviderBoundary(canonical: string): string | undefined {
  const segments = canonical.split(sep);
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || !segments[nodeModulesIndex + 1]) {
    return undefined;
  }
  const packageEnd =
    segments[nodeModulesIndex + 1]?.startsWith("@") === true
      ? nodeModulesIndex + 3
      : nodeModulesIndex + 2;
  return segments.slice(0, packageEnd).join(sep) || sep;
}

function semanticProviderBoundary(canonical: string): string {
  return nodeModulesProviderBoundary(canonical) ?? canonical;
}

function createProgram(
  source: string,
  id: string,
  root: string,
  catalog: CurrentCatalog,
  generatedFacadeModules: ReadonlySet<string>,
  includeCatalogContract: boolean,
  ownerCompilerOptions?: ts.CompilerOptions,
  workspaceRoot: string = root
): Readonly<{
  checker: ts.TypeChecker;
  evidenceFiles?: ReadonlyMap<string, `sha256:${string}`>;
  evidenceRecords?: SemanticEvidenceRecords;
  generatedFacadeId: string;
  generatedFacadeResolutions?: ReadonlyArray<SemanticProviderResolution>;
  program: ts.Program;
  providerBudgetExceeded: string | undefined;
  providerRoots: ReadonlyArray<
    Readonly<{
      entryRoots: ReadonlyArray<string>;
      includeDeclarations: boolean;
      kind?: "ambient";
      resolutions: ReadonlyArray<SemanticProviderResolution>;
      root: string;
    }>
  >;
  sourceFile: ts.SourceFile;
  sourceRoots: ReadonlySet<string>;
  tripleSlashControls: number;
  unsupportedProviderResolutionOptions: ReadonlyArray<"typeRoots" | "types">;
}> {
  const finiteModules = finiteDependencyModules(
    ts.createSourceFile(
      id,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(id)
    )
  );
  const resolvesDependencies =
    generatedFacadeModules.size > 0 || finiteModules.size > 0;
  const projectOptions =
    ownerCompilerOptions ??
    (resolvesDependencies ? moduleResolutionOptions(root) : undefined);
  if (projectOptions?.preserveSymlinks === true) {
    throw new Error(
      "Finite Mirai Intl semantic authorization does not support preserveSymlinks=true"
    );
  }
  const configuredAmbientTypes = configuredAmbientTypeNames(projectOptions);
  const maximumAmbientTypes = 16;
  if (configuredAmbientTypes.length > maximumAmbientTypes) {
    throw new Error(
      `Finite translation key analysis supports at most ${maximumAmbientTypes} configured ambient type packages; received ${configuredAmbientTypes.length}`
    );
  }
  const compilerOptions: ts.CompilerOptions = {
    ...projectOptions,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    ...(resolvesDependencies ? {} : { lib: ["lib.es5.d.ts"] }),
    module: ts.ModuleKind.ESNext,
    moduleResolution:
      projectOptions?.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
    noResolve: !resolvesDependencies,
    target: ts.ScriptTarget.Latest,
    types: configuredAmbientTypes,
  };
  const sourceFile = ts.createSourceFile(
    id,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(id)
  );
  const canonicalRoot = ts.sys.realpath ? ts.sys.realpath(root) : resolve(root);
  const maximumProviderFiles = 64;
  const providerFiles = new Set<string>();
  const providerRootByBoundary = new Map<string, string>();
  const providerEntryRoots = new Map<string, Set<string>>();
  const providerRootNames = new Set<string>();
  const providerResolutions = new Map<
    string,
    Map<string, SemanticProviderResolution>
  >();
  const transitiveGeneratedFacadeResolutions = new Map<
    string,
    SemanticProviderResolution
  >();
  const ambientProviderRoots = new Set<string>();
  const unresolvedProviderRoots = new Set<string>();
  let providerBudgetExceeded: string | undefined;
  const isAllowedProvider = (
    canonical: string,
    resolution: ts.ResolvedModuleFull
  ): boolean => {
    if (isWithin(canonicalRoot, canonical)) {
      if (!canonical.includes(`${sep}node_modules${sep}`)) {
        return true;
      }
    }
    return (
      /\.d\.[cm]?ts$/u.test(canonical) &&
      (resolution.isExternalLibraryImport === true ||
        providerRootByBoundary.has(
          nodeModulesProviderBoundary(canonical) ?? canonical
        ))
    );
  };
  const claimProvider = (
    canonical: string,
    moduleName: string,
    resolution: ts.ResolvedModuleFull
  ): string | undefined => {
    const boundary = semanticProviderBoundary(canonical);
    const existing = providerRootByBoundary.get(boundary);
    if (existing) {
      const entries = providerEntryRoots.get(existing) ?? new Set<string>();
      entries.add(resolution.resolvedFileName);
      providerEntryRoots.set(existing, entries);
      return existing;
    }
    if (providerFiles.size >= maximumProviderFiles) {
      providerBudgetExceeded ??= moduleName;
      return undefined;
    }
    providerFiles.add(boundary);
    providerRootByBoundary.set(boundary, resolution.resolvedFileName);
    providerEntryRoots.set(
      resolution.resolvedFileName,
      new Set([resolution.resolvedFileName])
    );
    return resolution.resolvedFileName;
  };
  const recordProviderResolution = (
    resolution: ts.ResolvedModuleFull | undefined,
    frontier: SemanticProviderResolution,
    claimedProviderRoot?: string
  ): void => {
    const providerRoot =
      claimedProviderRoot ?? resolution?.resolvedFileName ?? frontier.from;
    if (!resolution) {
      unresolvedProviderRoots.add(providerRoot);
    }
    let entries = providerResolutions.get(providerRoot);
    if (!entries) {
      entries = new Map();
      providerResolutions.set(providerRoot, entries);
    }
    entries.set(`${frontier.from}\u0000${frontier.specifier}`, frontier);
  };
  if (projectOptions) {
    const inferredTypeNamesSource = resolve(root, "__inferred type names__.ts");
    for (const directiveName of configuredAmbientTypes) {
      const traced = resolveTypeReferenceWithFrontier(
        directiveName,
        inferredTypeNamesSource,
        compilerOptions,
        workspaceRoot
      );
      const resolution = traced.resolvedTypeReferenceDirective;
      const providerRoot = resolution?.resolvedFileName ?? traced.frontier.from;
      ambientProviderRoots.add(providerRoot);
      if (!resolution?.resolvedFileName) {
        unresolvedProviderRoots.add(providerRoot);
      } else {
        providerRootNames.add(resolution.resolvedFileName);
      }
      const entries =
        providerResolutions.get(providerRoot) ??
        new Map<string, SemanticProviderResolution>();
      entries.set(
        `${traced.frontier.from}\u0000${traced.frontier.specifier}`,
        traced.frontier
      );
      providerResolutions.set(providerRoot, entries);
    }
  }
  if (projectOptions) {
    for (const moduleName of finiteModules) {
      if (generatedFacadeModules.has(moduleName)) {
        continue;
      }
      const traced = resolveModuleWithFrontier(
        moduleName,
        id,
        projectOptions,
        workspaceRoot
      );
      const resolution = traced.resolvedModule;
      if (!resolution) {
        recordProviderResolution(undefined, traced.frontier);
        continue;
      }
      const canonical = ts.sys.realpath
        ? ts.sys.realpath(resolution.resolvedFileName)
        : resolve(resolution.resolvedFileName);
      if (isAllowedProvider(canonical, resolution)) {
        const providerRoot = claimProvider(canonical, moduleName, resolution);
        if (providerRoot) {
          providerRootNames.add(resolution.resolvedFileName);
          recordProviderResolution(resolution, traced.frontier, providerRoot);
        }
      }
    }
  }
  let transitiveRequiresFullFacade = false;
  const providerQueue = [...providerRootNames];
  const traversedProviders = new Set<string>();
  while (providerQueue.length > 0) {
    const containingFile = providerQueue.shift();
    if (!containingFile || traversedProviders.has(containingFile)) {
      continue;
    }
    traversedProviders.add(containingFile);
    const containingSource = ts.sys.readFile(containingFile);
    if (containingSource === undefined) {
      continue;
    }
    const providerSourceFile = ts.createSourceFile(
      containingFile,
      containingSource,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(containingFile)
    );
    for (const moduleName of semanticModuleSpecifiers(
      containingSource,
      containingFile,
      providerSourceFile
    )) {
      const traced = resolveModuleWithFrontier(
        moduleName,
        containingFile,
        compilerOptions,
        workspaceRoot
      );
      const resolution = traced.resolvedModule;
      if (!resolution) {
        recordProviderResolution(undefined, traced.frontier);
        continue;
      }
      const canonical = ts.sys.realpath
        ? ts.sys.realpath(resolution.resolvedFileName)
        : resolve(resolution.resolvedFileName);
      if (isSamePath(canonical, catalog.generatedFacadePath)) {
        transitiveRequiresFullFacade = true;
        transitiveGeneratedFacadeResolutions.set(
          `${traced.frontier.from}\u0000${traced.frontier.specifier}`,
          traced.frontier
        );
        continue;
      }
      if (!isAllowedProvider(canonical, resolution)) {
        continue;
      }
      const providerRoot = claimProvider(canonical, moduleName, resolution);
      if (!providerRoot) {
        continue;
      }
      providerRootNames.add(resolution.resolvedFileName);
      recordProviderResolution(resolution, traced.frontier, providerRoot);
      if (!traversedProviders.has(resolution.resolvedFileName)) {
        providerQueue.push(resolution.resolvedFileName);
      }
    }
  }
  const generatedFacadeSource = resolvesDependencies
    ? generatedFacadeTypeModule(
        catalog,
        root,
        undefined,
        includeCatalogContract || transitiveRequiresFullFacade
      )
    : "";
  const generatedFacadeId = resolve(
    root,
    `.mirai-intl-generated-facade.${sha256(generatedFacadeSource).slice("sha256:".length)}.d.ts`
  );
  assertUnoccupiedVirtualGeneratedFacadePath(generatedFacadeId, [
    id,
    ...providerRootNames,
  ]);
  const generatedFacadeFile = ts.createSourceFile(
    generatedFacadeId,
    generatedFacadeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const host = ts.createCompilerHost(compilerOptions, true);
  const fileExists = host.fileExists.bind(host);
  const readHostFile = host.readFile.bind(host);
  const getHostSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) =>
    fileName === id || fileName === generatedFacadeId || fileExists(fileName);
  host.readFile = (fileName) => {
    if (fileName === id) {
      return source;
    }
    if (fileName === generatedFacadeId) {
      return generatedFacadeSource;
    }
    return readHostFile(fileName);
  };
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (fileName === id) {
      return sourceFile;
    }
    if (fileName === generatedFacadeId) {
      return generatedFacadeFile;
    }
    return getHostSourceFile(fileName, languageVersion, onError, shouldCreate);
  };
  if (resolvesDependencies) {
    if (!projectOptions) {
      throw new Error("Project module-resolution options are unavailable");
    }
    const resolveSelectedModule = (
      moduleName: string,
      containingFile: string
    ): ts.ResolvedModuleFull | undefined => {
      if (containingFile === id && generatedFacadeModules.has(moduleName)) {
        return {
          extension: ts.Extension.Dts,
          isExternalLibraryImport: false,
          resolvedFileName: generatedFacadeId,
        };
      }
      if (containingFile === id && !finiteModules.has(moduleName)) {
        return undefined;
      }
      const traced = resolveModuleWithFrontier(
        moduleName,
        containingFile,
        projectOptions,
        workspaceRoot
      );
      const resolution = traced.resolvedModule;
      if (!resolution) {
        recordProviderResolution(undefined, traced.frontier);
        return undefined;
      }
      const canonical = ts.sys.realpath
        ? ts.sys.realpath(resolution.resolvedFileName)
        : resolve(resolution.resolvedFileName);
      if (isSamePath(canonical, catalog.generatedFacadePath)) {
        transitiveGeneratedFacadeResolutions.set(
          `${traced.frontier.from}\u0000${traced.frontier.specifier}`,
          traced.frontier
        );
        return {
          extension: ts.Extension.Dts,
          isExternalLibraryImport: false,
          resolvedFileName: generatedFacadeId,
        };
      }
      if (containingFile === generatedFacadeId) {
        return isWithin(catalog.selectedCanonicalDirectory, canonical)
          ? resolution
          : undefined;
      }
      if (!isAllowedProvider(canonical, resolution)) {
        return undefined;
      }
      const providerRoot = claimProvider(canonical, moduleName, resolution);
      if (!providerRoot) {
        return undefined;
      }
      recordProviderResolution(resolution, traced.frontier, providerRoot);
      return resolution;
    };
    host.resolveModuleNameLiterals = (moduleLiterals, containingFile) =>
      moduleLiterals.map((moduleLiteral) => ({
        resolvedModule: resolveSelectedModule(
          moduleLiteral.text,
          containingFile
        ),
      }));
  }
  const program = ts.createProgram(
    [
      id,
      ...(generatedFacadeModules.size > 0 ? [generatedFacadeId] : []),
      ...providerRootNames,
    ],
    compilerOptions,
    host
  );
  return {
    checker: program.getTypeChecker(),
    generatedFacadeId,
    generatedFacadeResolutions: [
      ...transitiveGeneratedFacadeResolutions.values(),
    ].toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.from}\u0000${left.specifier}`,
        `${right.from}\u0000${right.specifier}`
      )
    ),
    program,
    providerBudgetExceeded,
    providerRoots: [...providerResolutions.keys()]
      .toSorted(compareCanonicalStrings)
      .map((providerRoot) => ({
        entryRoots: [
          ...(providerEntryRoots.get(providerRoot) ?? [providerRoot]),
        ].toSorted(compareCanonicalStrings),
        includeDeclarations: !unresolvedProviderRoots.has(providerRoot),
        ...(ambientProviderRoots.has(providerRoot)
          ? ({ kind: "ambient" } as const)
          : {}),
        resolutions: [
          ...(providerResolutions.get(providerRoot)?.values() ?? []),
        ].toSorted((left, right) =>
          compareCanonicalStrings(
            `${left.from}\u0000${left.specifier}`,
            `${right.from}\u0000${right.specifier}`
          )
        ),
        root: providerRoot,
      })),
    sourceFile,
    sourceRoots: new Set([id]),
    tripleSlashControls:
      sourceFile.referencedFiles.length +
      sourceFile.typeReferenceDirectives.length +
      sourceFile.libReferenceDirectives.length,
    unsupportedProviderResolutionOptions: projectOptions?.typeRoots?.length
      ? (["typeRoots"] as const)
      : [],
  };
}

type SemanticProgramContext = ReturnType<typeof createProgram>;

function hasMappedNonliteralTranslationKey(sourceFile: ts.SourceFile): boolean {
  const callbacks = new Map<string, ts.ConciseBody>();
  const collectCallbacks = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      callbacks.set(node.name.text, node.initializer.body);
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      callbacks.set(node.name.text, node.body);
    }
    ts.forEachChild(node, collectCallbacks);
  };
  collectCallbacks(sourceFile);
  let found = false;
  const callbackHasUncertainCall = (body: ts.ConciseBody): boolean => {
    let uncertain = false;
    const inspect = (node: ts.Node): void => {
      if (uncertain) {
        return;
      }
      if (ts.isCallExpression(node) && node.arguments.length === 1) {
        const argument = node.arguments[0];
        if (argument && literalString(argument) === undefined) {
          uncertain = true;
          return;
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(body);
    return uncertain;
  };
  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = unwrapExpression(node.expression);
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === "map") {
        for (const argument of node.arguments) {
          const callback = unwrapExpression(argument);
          let body: ts.ConciseBody | undefined;
          if (
            ts.isArrowFunction(callback) ||
            ts.isFunctionExpression(callback)
          ) {
            body = callback.body;
          } else if (ts.isIdentifier(callback)) {
            body = callbacks.get(callback.text);
          }
          if (body && callbackHasUncertainCall(body)) {
            found = true;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function isSafeSharedSemanticSourceFile(sourceFile: ts.SourceFile): boolean {
  if (
    !ts.isExternalModule(sourceFile) ||
    sourceFile.referencedFiles.length > 0 ||
    sourceFile.typeReferenceDirectives.length > 0 ||
    sourceFile.libReferenceDirectives.length > 0
  ) {
    return false;
  }
  let unsafe = false;
  const visit = (node: ts.Node): void => {
    if (unsafe) {
      return;
    }
    if (
      (ts.isModuleDeclaration(node) &&
        ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0 ||
          node.name.text === "global" ||
          ts.isStringLiteral(node.name))) ||
      ts.isNamespaceExportDeclaration(node)
    ) {
      unsafe = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return !unsafe;
}

function hasPotentialGeneratedFacadeImport(
  sourceFile: ts.SourceFile,
  id: string,
  compilerOptions: ts.CompilerOptions,
  generatedFacadePath: string
): boolean {
  let potential = false;
  const visit = (node: ts.Node): void => {
    if (potential) {
      return;
    }
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const resolution = ts.resolveModuleName(
        node.moduleSpecifier.text,
        id,
        compilerOptions,
        ts.sys
      ).resolvedModule;
      if (resolution) {
        const canonical =
          ts.sys.realpath?.(resolution.resolvedFileName) ??
          resolve(resolution.resolvedFileName);
        potential = isSamePath(canonical, generatedFacadePath);
      }
      return;
    }
    if (
      (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) ||
      (ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference)) ||
      ts.isImportTypeNode(node) ||
      (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
    ) {
      potential = true;
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      potential = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return potential;
}

type SealedSemanticFile = Readonly<{
  hash: `sha256:${string}`;
  path: string;
  source: string;
}>;

type SealedSemanticResolution = Readonly<{
  containingFile: string;
  moduleName: string;
  resolvedModule: ts.ResolvedModuleFull | undefined;
}>;

type SealedSemanticTypeResolution = Readonly<{
  containingFile: string;
  directiveName: string;
  resolvedTypeReferenceDirective: ts.ResolvedTypeReferenceDirective | undefined;
}>;

type PreparedSemanticClosure = Readonly<{
  compilerOptions: ts.CompilerOptions;
  files: ReadonlyArray<SealedSemanticFile>;
  generatedImports: GeneratedFacadeImportNames;
  generatedFacadeId: string;
  groupKey: `sha256:${string}`;
  hostFileProbes: ReadonlyArray<Readonly<{ path: string; present: boolean }>>;
  hostRealpaths: ReadonlyArray<Readonly<{ path: string; target: string }>>;
  id: string;
  providerBudgetExceeded: string | undefined;
  providerRoots: SemanticProgramContext["providerRoots"];
  resolutions: ReadonlyArray<SealedSemanticResolution>;
  root: string;
  /** Exact common closure inherited by a source-only facade clone. */
  sharedBase?: PreparedSemanticClosure;
  source: string;
  sourceFile: ts.SourceFile;
  tripleSlashControls: number;
  typeResolutions: ReadonlyArray<SealedSemanticTypeResolution>;
  unsupportedProviderResolutionOptions: ReadonlyArray<"typeRoots" | "types">;
  vfsResolutions: ReadonlyArray<SemanticProviderResolution>;
  workspaceRoot: string;
}>;

const semanticPreparationProfile = new Map<string, number>();

function recordSemanticPreparationProfile(
  phase: string,
  milliseconds: number
): void {
  if (process.env.MIRAI_INTL_INTERNAL_TRANSFORM_PROFILE !== "1") {
    return;
  }
  semanticPreparationProfile.set(
    phase,
    (semanticPreparationProfile.get(phase) ?? 0) + milliseconds
  );
}

type SemanticEvidenceRecords = Readonly<{
  declarations: ReadonlyArray<
    Readonly<{ hash: `sha256:${string}`; path: string }>
  >;
  libs: ReadonlyArray<Readonly<{ hash: `sha256:${string}`; path: string }>>;
}>;

type SemanticOwnerOccupancyIndex = Readonly<{
  canonicalPaths: ReadonlyMap<string, string>;
  lexicalPaths: ReadonlyMap<string, string>;
}>;

function semanticEvidenceRecords(
  closure: PreparedSemanticClosure,
  catalog: CurrentCatalog,
  sourceRoots: ReadonlySet<string>,
  programEvidenceHashes?: ReadonlyMap<string, `sha256:${string}`>
): SemanticEvidenceRecords {
  const entries = closure.files
    .filter(({ path }) => !sourceRoots.has(path) && /\.d\.[cm]?ts$/u.test(path))
    .map(({ hash, path }) => {
      const programPath = resolve(path);
      const absolute =
        programPath === closure.generatedFacadeId
          ? catalog.generatedFacadePath
          : programPath;
      return {
        absolute,
        hash:
          programPath === closure.generatedFacadeId
            ? catalog.generatedFacadeHash
            : (programEvidenceHashes?.get(programPath) ?? hash),
        path: evidencePath(closure.workspaceRoot, absolute),
      };
    })
    .toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
  return {
    declarations: entries
      .filter(
        ({ absolute }) =>
          !/[/\\]typescript[/\\]lib[/\\]lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u.test(
            absolute
          )
      )
      .map(({ hash, path }) => ({ hash, path })),
    libs: entries
      .filter(({ absolute }) =>
        /[/\\]typescript[/\\]lib[/\\]lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u.test(
          absolute
        )
      )
      .map(({ hash, path }) => ({ hash, path })),
  };
}

type SemanticPreparationCache = Readonly<{
  declarationInterference: Map<string, boolean>;
  directoryModuleFrontiers: Map<
    string,
    ReturnType<typeof resolveModuleWithFrontier>
  >;
  generatedFacades: Map<string, string>;
  libraries: Map<string, ReadonlyArray<SealedSemanticFile>>;
  moduleFrontiers: Map<string, ReturnType<typeof resolveModuleWithFrontier>>;
  moduleSpecifiers: Map<string, ReadonlyArray<string>>;
  normalizedPaths: Map<string, string>;
  ownerOccupancy: SemanticOwnerOccupancyIndex;
  packageFiles: Map<string, string | undefined>;
  parsedFiles: Map<string, ts.SourceFile>;
  preprocessedFiles: Map<string, ReturnType<typeof ts.preProcessFile>>;
  realpathIdentities: Map<string, string>;
  resolvedModules: Map<string, ts.ResolvedModuleFull>;
  resolvedTypes: Map<string, ts.ResolvedTypeReferenceDirective>;
  sealedFiles: Map<string, SealedSemanticFile>;
  semanticFileHashes: Map<string, `sha256:${string}`>;
  semanticFiles: Map<string, string>;
  typeFrontiers: Map<
    string,
    ReturnType<typeof resolveTypeReferenceWithFrontier>
  >;
}>;

function semanticCompilerOptions(
  source: string,
  id: string,
  root: string,
  generatedFacadeModules: ReadonlySet<string>,
  ownerCompilerOptions?: ts.CompilerOptions,
  preparedFiniteModules?: ReadonlySet<string>
): ts.CompilerOptions {
  const finiteModules =
    preparedFiniteModules ??
    finiteDependencyModules(
      ts.createSourceFile(
        id,
        source,
        ts.ScriptTarget.Latest,
        true,
        scriptKindFor(id)
      )
    );
  const resolvesDependencies =
    generatedFacadeModules.size > 0 || finiteModules.size > 0;
  const projectOptions =
    ownerCompilerOptions ??
    (resolvesDependencies ? moduleResolutionOptions(root) : undefined);
  if (projectOptions?.preserveSymlinks === true) {
    throw new Error(
      "Finite Mirai Intl semantic authorization does not support preserveSymlinks=true"
    );
  }
  const configuredAmbientTypes = configuredAmbientTypeNames(projectOptions);
  const maximumAmbientTypes = 16;
  if (configuredAmbientTypes.length > maximumAmbientTypes) {
    throw new Error(
      `Finite translation key analysis supports at most ${maximumAmbientTypes} configured ambient type packages; received ${configuredAmbientTypes.length}`
    );
  }
  return {
    ...projectOptions,
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    ...(resolvesDependencies ? {} : { lib: ["lib.es5.d.ts"] }),
    module: ts.ModuleKind.ESNext,
    moduleResolution:
      projectOptions?.moduleResolution ?? ts.ModuleResolutionKind.Bundler,
    noResolve: !resolvesDependencies,
    target: ts.ScriptTarget.Latest,
    types: configuredAmbientTypes,
  };
}

function normalizedSemanticPath(
  path: string,
  cache?: Pick<SemanticPreparationCache, "normalizedPaths">
): string {
  const absolute = resolve(path);
  const cached = cache?.normalizedPaths.get(absolute);
  if (cached) {
    return cached;
  }
  let normalized: string;
  if (
    ts.sys.fileExists(absolute) ||
    (ts.sys.directoryExists?.(absolute) ?? false)
  ) {
    normalized = ts.sys.realpath?.(absolute) ?? absolute;
    cache?.normalizedPaths.set(absolute, normalized);
    return normalized;
  }
  let ancestor = dirname(absolute);
  while (
    ancestor !== dirname(ancestor) &&
    !ts.sys.fileExists(ancestor) &&
    !(ts.sys.directoryExists?.(ancestor) ?? false)
  ) {
    ancestor = dirname(ancestor);
  }
  const canonicalAncestor = ts.sys.realpath?.(ancestor) ?? ancestor;
  normalized = resolve(canonicalAncestor, relative(ancestor, absolute));
  cache?.normalizedPaths.set(absolute, normalized);
  return normalized;
}

function foldedSemanticPath(path: string): string {
  return resolve(path).normalize("NFC").toLowerCase();
}

function semanticOwnerOccupancyIndex(
  paths: ReadonlyArray<Readonly<{ canonical: string; lexical: string }>>
): SemanticOwnerOccupancyIndex {
  return Object.freeze({
    canonicalPaths: new Map(
      paths.map(({ canonical, lexical }) => [
        foldedSemanticPath(canonical),
        lexical,
      ])
    ),
    lexicalPaths: new Map(
      paths.map(({ lexical }) => [foldedSemanticPath(lexical), lexical])
    ),
  });
}

function assertUnoccupiedVirtualGeneratedFacadePath(
  path: string,
  occupiedPaths: Iterable<string> = [],
  ownerOccupancy?: SemanticOwnerOccupancyIndex
): void {
  const absolute = resolve(path);
  const fail = (detail: string): never => {
    throw new Error(
      `Virtual generated facade path is occupied or aliased: ${absolute} (${detail})`
    );
  };
  try {
    lstatSync(absolute);
    fail("existing file, directory, or symbolic link");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  const foldedAbsolute = foldedSemanticPath(absolute);
  for (const entry of readdirSync(dirname(absolute), { withFileTypes: true })) {
    const entryPath = resolve(dirname(absolute), entry.name);
    if (
      entry.name !== basename(absolute) &&
      foldedSemanticPath(entryPath) === foldedAbsolute
    ) {
      fail(`case-colliding directory entry ${entryPath}`);
    }
  }
  const canonicalParent =
    ts.sys.realpath?.(dirname(absolute)) ?? resolve(dirname(absolute));
  const foldedCanonical = foldedSemanticPath(
    resolve(canonicalParent, basename(absolute))
  );
  const occupiedOwnerPath =
    ownerOccupancy?.lexicalPaths.get(foldedAbsolute) ??
    ownerOccupancy?.canonicalPaths.get(foldedCanonical);
  if (occupiedOwnerPath) {
    fail(`snapshot path ${occupiedOwnerPath}`);
  }
  for (const occupied of occupiedPaths) {
    const lexical = resolve(occupied);
    const canonical = normalizedSemanticPath(lexical);
    if (
      foldedSemanticPath(lexical) === foldedAbsolute ||
      foldedSemanticPath(canonical) === foldedCanonical
    ) {
      fail(`snapshot path ${lexical}`);
    }
  }
}

function semanticResolutionKey(
  containingFile: string,
  moduleName: string,
  cache?: Pick<SemanticPreparationCache, "normalizedPaths">
): string {
  return `${normalizedSemanticPath(containingFile, cache)}\u0000${moduleName}`;
}

function sealedSemanticResolutionKey(
  containingFile: string,
  moduleName: string
): string {
  return `${resolve(containingFile)}\u0000${moduleName}`;
}

function readSemanticFile(
  path: string
): Readonly<{ hash: `sha256:${string}`; source: string }> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Sealed semantic closure is missing ${path}`, {
        cause: error,
      });
    }
    throw error;
  }
  return {
    hash: sha256(bytes),
    source: decodeUtf8Fatal(bytes, `Semantic provider ${path}`),
  };
}

function captureSealedHostRealpaths(
  filePaths: Iterable<string>,
  virtualFiles: ReadonlySet<string>,
  explicitRealpaths: ReadonlyMap<string, string> = new Map(),
  identityCache?: Map<string, string>
): ReadonlyArray<Readonly<{ path: string; target: string }>> {
  const identities = new Map<string, string>();
  const virtualDirectories = new Set<string>();
  for (const file of virtualFiles) {
    let directory = dirname(resolve(file));
    for (;;) {
      virtualDirectories.add(directory);
      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }
  const record = (path: string, kind: "directory" | "file"): void => {
    const absolute = resolve(path);
    const existing = identities.get(absolute);
    if (existing) {
      return;
    }
    if (kind === "file" && virtualFiles.has(absolute)) {
      identities.set(absolute, absolute);
      return;
    }
    const cached = identityCache?.get(absolute);
    if (cached) {
      identities.set(absolute, cached);
      return;
    }
    let entry: ReturnType<typeof lstatSync>;
    try {
      entry = lstatSync(absolute);
    } catch (error) {
      if (
        kind === "directory" &&
        virtualDirectories.has(absolute) &&
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        identities.set(absolute, absolute);
        return;
      }
      throw error;
    }
    if (entry.isSymbolicLink()) {
      const target = explicitRealpaths.get(absolute) ?? realpathSync(absolute);
      identities.set(absolute, resolve(target));
      identityCache?.set(absolute, resolve(target));
      return;
    }
    if (kind === "file" ? !entry.isFile() : !entry.isDirectory()) {
      throw new Error(
        `Sealed semantic ${kind} identity is not a regular non-symlink path: ${absolute}`
      );
    }
    const target = resolve(realpathSync(absolute));
    identities.set(absolute, target);
    identityCache?.set(absolute, target);
  };
  for (const path of filePaths) {
    const absolute = resolve(path);
    record(absolute, "file");
    let directory = dirname(absolute);
    for (;;) {
      record(directory, "directory");
      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }
  return [...identities].map(([path, target]) => ({ path, target }));
}

/** @internal Test-visible fail-closed sealed-host realpath lookup. */
export function resolveSealedSemanticRealpath(
  realpaths: ReadonlyMap<string, string>,
  path: string
): string {
  const absolute = resolve(path);
  const target = realpaths.get(absolute);
  if (!target) {
    throw new Error(
      `Sealed semantic VFS rejected unrecorded realpath query: ${path}`
    );
  }
  return target;
}

function readCachedSemanticFile(
  path: string,
  cache: SemanticPreparationCache
): string {
  const normalized = normalizedSemanticPath(path, cache);
  const cached = cache.semanticFiles.get(normalized);
  if (cached !== undefined) {
    return cached;
  }
  const { hash, source } = readSemanticFile(normalized);
  cache.semanticFileHashes.set(normalized, hash);
  cache.semanticFiles.set(normalized, source);
  return source;
}

function internSealedSemanticFile(
  path: string,
  source: string,
  cache: SemanticPreparationCache
): SealedSemanticFile {
  const hash = cache.semanticFileHashes.get(resolve(path)) ?? sha256(source);
  const identity = `${path}\u0000${hash}`;
  const cached = cache.sealedFiles.get(identity);
  if (cached) {
    return cached;
  }
  const file = { hash, path, source } as const;
  cache.sealedFiles.set(identity, file);
  return file;
}

function internResolvedSemanticModule(
  resolution: ts.ResolvedModuleFull,
  cache: SemanticPreparationCache
): ts.ResolvedModuleFull {
  const normalized = {
    ...resolution,
    resolvedFileName: normalizedSemanticPath(
      resolution.resolvedFileName,
      cache
    ),
  };
  const identity = semanticResolutionIdentity(normalized);
  const cached = cache.resolvedModules.get(identity);
  if (cached) {
    return cached;
  }
  cache.resolvedModules.set(identity, normalized);
  return normalized;
}

function internResolvedSemanticType(
  resolution: ts.ResolvedTypeReferenceDirective,
  cache: SemanticPreparationCache
): ts.ResolvedTypeReferenceDirective {
  const normalized = resolution.resolvedFileName
    ? {
        ...resolution,
        resolvedFileName: normalizedSemanticPath(
          resolution.resolvedFileName,
          cache
        ),
      }
    : resolution;
  const identity = semanticResolutionIdentity(normalized);
  const cached = cache.resolvedTypes.get(identity);
  if (cached) {
    return cached;
  }
  cache.resolvedTypes.set(identity, normalized);
  return normalized;
}

function semanticModuleSpecifiers(
  source: string,
  path: string,
  preparedSourceFile?: ts.SourceFile
): ReadonlyArray<string> {
  const modules = new Set<string>();
  const sourceFile =
    preparedSourceFile ??
    ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(path)
    );
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      modules.add(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      modules.add(node.moduleReference.expression.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      modules.add(node.argument.literal.text);
    } else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
      modules.add(node.name.text);
    } else if (ts.isCallExpression(node)) {
      const argument = node.arguments[0];
      if (
        argument &&
        ts.isStringLiteral(argument) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        modules.add(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...modules].toSorted(compareCanonicalStrings);
}

function parsedSemanticSourceFile(
  source: string,
  path: string,
  cache: SemanticPreparationCache,
  preparedSourceFile?: ts.SourceFile
): ts.SourceFile {
  const identity = `${path}\u0000${sha256(source)}`;
  const cached = cache.parsedFiles.get(identity);
  if (cached) {
    return cached;
  }
  const sourceFile =
    preparedSourceFile ??
    ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKindFor(path)
    );
  cache.parsedFiles.set(identity, sourceFile);
  return sourceFile;
}

function standardLibPath(
  compilerOptions: ts.CompilerOptions,
  reference: string
): string {
  const libraryDirectory = dirname(ts.getDefaultLibFilePath(compilerOptions));
  const name = reference.startsWith("lib.")
    ? reference
    : `lib.${reference}.d.ts`;
  return resolve(libraryDirectory, name);
}

function stableSemanticValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableSemanticValue);
  }
  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [String(key), stableSemanticValue(entry)] as const)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right));
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([, entry]) => typeof entry !== "function")
      .map(([key, entry]) => [key, stableSemanticValue(entry)] as const)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right));
  }
  return value;
}

function stableCompilerOptions(
  compilerOptions: ts.CompilerOptions
): ReadonlyArray<readonly [string, unknown]> {
  return stableSemanticValue(compilerOptions) as ReadonlyArray<
    readonly [string, unknown]
  >;
}

function prepareSealedSemanticClosure(
  source: string,
  id: string,
  root: string,
  catalog: CurrentCatalog,
  generatedImports: GeneratedFacadeImportNames,
  ownerCompilerOptions: ts.CompilerOptions,
  workspaceRoot: string,
  cache: SemanticPreparationCache,
  preparedSourceFile?: ts.SourceFile,
  preparedFiniteModules?: ReadonlySet<string>,
  sharedFacade?: Readonly<{
    includeCatalogContract: boolean;
    namespaces: ReadonlySet<string> | undefined;
  }>
): PreparedSemanticClosure {
  let preparationProfilePrior = performance.now();
  const markPreparationProfile = (phase: string): void => {
    const now = performance.now();
    recordSemanticPreparationProfile(phase, now - preparationProfilePrior);
    preparationProfilePrior = now;
  };
  const { facadeModules: generatedFacadeModules } = generatedImports;
  const cleanId = normalizedSemanticPath(id, cache);
  const sourceFile = parsedSemanticSourceFile(
    source,
    cleanId,
    cache,
    preparedSourceFile
  );
  const finiteModules =
    preparedFiniteModules ?? finiteDependencyModules(sourceFile);
  const compilerOptions = semanticCompilerOptions(
    source,
    cleanId,
    root,
    generatedFacadeModules,
    ownerCompilerOptions,
    finiteModules
  );
  const compilerOptionsIdentity = sha256(
    JSON.stringify(stableCompilerOptions(compilerOptions))
  );
  let facadeNamespaces =
    sharedFacade === undefined
      ? generatedFacadeSliceNamespaces(sourceFile, generatedImports)
      : sharedFacade.namespaces;
  let includeCatalogContract =
    sharedFacade?.includeCatalogContract ??
    generatedImports.requiresCatalogContract;
  let generatedFacadeSource: string | undefined;
  const getGeneratedFacadeSource = (): string => {
    if (generatedFacadeSource !== undefined) {
      return generatedFacadeSource;
    }
    const facadeCacheKey = `${catalog.generatedFacadeHash}\u0000${
      includeCatalogContract ? "catalog-contract" : "named-keys"
    }\u0000${
      facadeNamespaces
        ? [...facadeNamespaces].toSorted(compareCanonicalStrings).join("\u0000")
        : "<full>"
    }`;
    generatedFacadeSource =
      cache.generatedFacades.get(facadeCacheKey) ??
      generatedFacadeTypeModule(
        catalog,
        root,
        facadeNamespaces,
        includeCatalogContract
      );
    cache.generatedFacades.set(facadeCacheKey, generatedFacadeSource);
    return generatedFacadeSource;
  };
  let facadeSource =
    generatedFacadeModules.size > 0 ? getGeneratedFacadeSource() : undefined;
  const initialGeneratedFacadePath =
    facadeSource !== undefined
      ? resolve(
          root,
          `.mirai-intl-generated-facade.${sha256(facadeSource).slice("sha256:".length)}.d.ts`
        )
      : resolve(root, ".mirai-intl-generated-facade.d.ts");
  assertUnoccupiedVirtualGeneratedFacadePath(
    initialGeneratedFacadePath,
    [],
    cache.ownerOccupancy
  );
  let generatedFacadeId = normalizedSemanticPath(
    initialGeneratedFacadePath,
    cache
  );
  const generatedFacadeResolutions = new Map<
    string,
    SemanticProviderResolution
  >(
    generatedImports.facadeResolutions.map(
      (resolution) =>
        [
          `${normalizedSemanticPath(resolution.from, cache)}\u0000${resolution.specifier}`,
          resolution,
        ] as const
    )
  );
  const vfsResolutions = new Map<string, SemanticProviderResolution>();
  const files = new Map<string, string>([[cleanId, source]]);
  if (facadeSource !== undefined) {
    files.set(generatedFacadeId, facadeSource);
  }
  const resolutions = new Map<string, SealedSemanticResolution>();
  const typeResolutions = new Map<string, SealedSemanticTypeResolution>();
  const providerFiles = new Set<string>();
  const providerRootByBoundary = new Map<string, string>();
  const providerEntryRoots = new Map<string, Set<string>>();
  const providerRootNames = new Set<string>();
  const providerResolutions = new Map<
    string,
    Map<string, SemanticProviderResolution>
  >();
  const ambientProviderRoots = new Set<string>();
  const unresolvedProviderRoots = new Set<string>();
  const canonicalRoot = ts.sys.realpath ? ts.sys.realpath(root) : resolve(root);
  const maximumProviderFiles = 64;
  let providerBudgetExceeded: string | undefined;
  const isAllowedProvider = (
    canonical: string,
    resolution: ts.ResolvedModuleFull
  ): boolean => {
    if (
      isWithin(canonicalRoot, canonical) &&
      !canonical.includes(`${sep}node_modules${sep}`)
    ) {
      return true;
    }
    return (
      /\.d\.[cm]?ts$/u.test(canonical) &&
      (resolution.isExternalLibraryImport === true ||
        providerRootByBoundary.has(
          nodeModulesProviderBoundary(canonical) ?? canonical
        ))
    );
  };
  const claimProvider = (
    canonical: string,
    moduleName: string,
    resolution: ts.ResolvedModuleFull
  ): string | undefined => {
    const boundary = semanticProviderBoundary(canonical);
    const existing = providerRootByBoundary.get(boundary);
    if (existing) {
      const entries = providerEntryRoots.get(existing) ?? new Set<string>();
      entries.add(normalizedSemanticPath(resolution.resolvedFileName, cache));
      providerEntryRoots.set(existing, entries);
      return existing;
    }
    if (providerFiles.size >= maximumProviderFiles) {
      providerBudgetExceeded ??= moduleName;
      return undefined;
    }
    providerFiles.add(boundary);
    const providerRoot = normalizedSemanticPath(
      resolution.resolvedFileName,
      cache
    );
    providerRootByBoundary.set(boundary, providerRoot);
    providerEntryRoots.set(providerRoot, new Set([providerRoot]));
    return providerRoot;
  };
  const recordProviderResolution = (
    resolution: ts.ResolvedModuleFull | undefined,
    frontier: SemanticProviderResolution,
    claimedProviderRoot?: string
  ): void => {
    const providerRoot =
      claimedProviderRoot ?? resolution?.resolvedFileName ?? frontier.from;
    if (!resolution) {
      unresolvedProviderRoots.add(providerRoot);
    }
    const entries =
      providerResolutions.get(providerRoot) ??
      new Map<string, SemanticProviderResolution>();
    entries.set(`${frontier.from}\u0000${frontier.specifier}`, frontier);
    providerResolutions.set(providerRoot, entries);
  };
  const queue: Array<string> = [];
  const queued = new Set<string>();
  const pending = new Set<string>();
  const providerLibReferences = new Set<string>();
  const enqueue = (path: string): void => {
    const normalized = normalizedSemanticPath(path, cache);
    if (!queued.has(normalized)) {
      queued.add(normalized);
      pending.add(normalized);
      queue.push(normalized);
    }
  };
  const upgradeGeneratedFacade = (requiresCatalogContract: boolean): void => {
    if (
      facadeNamespaces === undefined &&
      (!requiresCatalogContract || includeCatalogContract)
    ) {
      return;
    }
    const previousId = generatedFacadeId;
    facadeNamespaces = undefined;
    includeCatalogContract ||= requiresCatalogContract;
    generatedFacadeSource = undefined;
    facadeSource = getGeneratedFacadeSource();
    const nextPath = resolve(
      root,
      `.mirai-intl-generated-facade.${sha256(facadeSource).slice("sha256:".length)}.d.ts`
    );
    assertUnoccupiedVirtualGeneratedFacadePath(
      nextPath,
      [...files.keys()].filter((path) => path !== previousId),
      cache.ownerOccupancy
    );
    const nextId = normalizedSemanticPath(nextPath, cache);
    generatedFacadeId = nextId;
    files.delete(previousId);
    files.set(nextId, facadeSource);
    if (previousId === nextId) {
      enqueue(nextId);
      return;
    }
    if (pending.delete(previousId)) {
      queued.delete(previousId);
      queued.add(nextId);
      pending.add(nextId);
    }
    for (let index = 0; index < queue.length; index += 1) {
      if (queue[index] === previousId) {
        queue[index] = nextId;
      }
    }
    for (const [key, entry] of Array.from(resolutions)) {
      const containingFile =
        entry.containingFile === previousId ? nextId : entry.containingFile;
      const resolvedModule =
        entry.resolvedModule?.resolvedFileName === previousId
          ? { ...entry.resolvedModule, resolvedFileName: nextId }
          : entry.resolvedModule;
      if (
        containingFile !== entry.containingFile ||
        resolvedModule !== entry.resolvedModule
      ) {
        resolutions.delete(key);
        resolutions.set(
          semanticResolutionKey(containingFile, entry.moduleName, cache),
          { containingFile, moduleName: entry.moduleName, resolvedModule }
        );
      }
    }
    for (const [key, entry] of Array.from(typeResolutions)) {
      if (entry.containingFile === previousId) {
        typeResolutions.delete(key);
        typeResolutions.set(
          semanticResolutionKey(nextId, entry.directiveName, cache),
          { ...entry, containingFile: nextId }
        );
      }
    }
    enqueue(nextId);
  };
  enqueue(cleanId);
  if (generatedFacadeModules.size > 0) {
    enqueue(generatedFacadeId);
  }
  const resolveModule = (
    moduleName: string,
    containingFile: string
  ): ts.ResolvedModuleFull | undefined => {
    const key = semanticResolutionKey(containingFile, moduleName, cache);
    const existing = resolutions.get(key);
    if (existing) {
      return existing.resolvedModule;
    }
    if (containingFile === cleanId && generatedFacadeModules.has(moduleName)) {
      const resolvedModule: ts.ResolvedModuleFull = {
        extension: ts.Extension.Dts,
        isExternalLibraryImport: false,
        resolvedFileName: generatedFacadeId,
      };
      resolutions.set(key, { containingFile, moduleName, resolvedModule });
      return resolvedModule;
    }
    if (containingFile === cleanId && !finiteModules.has(moduleName)) {
      resolutions.set(key, {
        containingFile,
        moduleName,
        resolvedModule: undefined,
      });
      return undefined;
    }
    const frontierKey = `${compilerOptionsIdentity}\u0000${workspaceRoot}\u0000${normalizedSemanticPath(
      containingFile,
      cache
    )}\u0000${moduleName}`;
    const directoryFrontierKey = `${compilerOptionsIdentity}\u0000${workspaceRoot}\u0000${dirname(
      normalizedSemanticPath(containingFile, cache)
    )}\u0000${moduleName}`;
    const directoryTraced =
      cache.directoryModuleFrontiers.get(directoryFrontierKey);
    const traced =
      cache.moduleFrontiers.get(frontierKey) ??
      (directoryTraced
        ? {
            frontier: {
              ...directoryTraced.frontier,
              from: normalizedSemanticPath(containingFile, cache),
            },
            resolvedModule: directoryTraced.resolvedModule,
          }
        : resolveModuleWithFrontier(
            moduleName,
            containingFile,
            compilerOptions,
            workspaceRoot
          ));
    cache.moduleFrontiers.set(frontierKey, traced);
    cache.directoryModuleFrontiers.set(directoryFrontierKey, traced);
    const resolution = traced.resolvedModule;
    if (!resolution) {
      recordProviderResolution(undefined, traced.frontier);
      resolutions.set(key, {
        containingFile,
        moduleName,
        resolvedModule: undefined,
      });
      return undefined;
    }
    const canonical = ts.sys.realpath
      ? ts.sys.realpath(resolution.resolvedFileName)
      : resolve(resolution.resolvedFileName);
    if (isSamePath(canonical, catalog.generatedFacadePath)) {
      const generatedResolutionKey = `${normalizedSemanticPath(traced.frontier.from, cache)}\u0000${traced.frontier.specifier}`;
      if (!generatedFacadeResolutions.has(generatedResolutionKey)) {
        generatedFacadeResolutions.set(generatedResolutionKey, traced.frontier);
      }
      if (containingFile !== cleanId) {
        upgradeGeneratedFacade(
          /\bCatalogContract\b/u.test(files.get(containingFile) ?? "")
        );
      }
      if (!files.has(generatedFacadeId)) {
        files.set(generatedFacadeId, getGeneratedFacadeSource());
        enqueue(generatedFacadeId);
      }
      const resolvedModule: ts.ResolvedModuleFull = {
        extension: ts.Extension.Dts,
        isExternalLibraryImport: false,
        resolvedFileName: generatedFacadeId,
      };
      resolutions.set(key, { containingFile, moduleName, resolvedModule });
      return resolvedModule;
    }
    if (
      containingFile === generatedFacadeId &&
      !isWithin(catalog.selectedCanonicalDirectory, canonical)
    ) {
      resolutions.set(key, {
        containingFile,
        moduleName,
        resolvedModule: undefined,
      });
      return undefined;
    }
    if (isWithin(catalog.selectedCanonicalDirectory, canonical)) {
      vfsResolutions.set(
        `${normalizedSemanticPath(traced.frontier.from, cache)}\u0000${traced.frontier.specifier}`,
        traced.frontier
      );
      const resolvedModule = internResolvedSemanticModule(resolution, cache);
      if (containingFile !== generatedFacadeId) {
        providerRootNames.add(resolvedModule.resolvedFileName);
        recordProviderResolution(resolvedModule, traced.frontier);
      }
      resolutions.set(key, { containingFile, moduleName, resolvedModule });
      if (!files.has(resolvedModule.resolvedFileName)) {
        files.set(
          resolvedModule.resolvedFileName,
          readCachedSemanticFile(resolvedModule.resolvedFileName, cache)
        );
        enqueue(resolvedModule.resolvedFileName);
      }
      return resolvedModule;
    }
    if (!isAllowedProvider(canonical, resolution)) {
      resolutions.set(key, {
        containingFile,
        moduleName,
        resolvedModule: undefined,
      });
      return undefined;
    }
    const providerRoot = claimProvider(canonical, moduleName, resolution);
    if (!providerRoot) {
      resolutions.set(key, {
        containingFile,
        moduleName,
        resolvedModule: undefined,
      });
      return undefined;
    }
    const resolvedModule = internResolvedSemanticModule(resolution, cache);
    providerRootNames.add(resolvedModule.resolvedFileName);
    recordProviderResolution(resolvedModule, traced.frontier, providerRoot);
    resolutions.set(key, { containingFile, moduleName, resolvedModule });
    if (!files.has(resolvedModule.resolvedFileName)) {
      files.set(
        resolvedModule.resolvedFileName,
        readCachedSemanticFile(resolvedModule.resolvedFileName, cache)
      );
      enqueue(resolvedModule.resolvedFileName);
    }
    return resolvedModule;
  };
  const resolveTypeReference = (
    directiveName: string,
    containingFile: string
  ): ts.ResolvedTypeReferenceDirective | undefined => {
    const key = semanticResolutionKey(containingFile, directiveName, cache);
    const existing = typeResolutions.get(key);
    if (existing) {
      return existing.resolvedTypeReferenceDirective;
    }
    const frontierKey = `${compilerOptionsIdentity}\u0000${workspaceRoot}\u0000${normalizedSemanticPath(
      containingFile,
      cache
    )}\u0000${directiveName}`;
    const traced =
      cache.typeFrontiers.get(frontierKey) ??
      resolveTypeReferenceWithFrontier(
        directiveName,
        containingFile,
        compilerOptions,
        workspaceRoot
      );
    cache.typeFrontiers.set(frontierKey, traced);
    const resolution = traced.resolvedTypeReferenceDirective;
    const normalizedResolution = resolution
      ? internResolvedSemanticType(resolution, cache)
      : resolution;
    typeResolutions.set(key, {
      containingFile,
      directiveName,
      resolvedTypeReferenceDirective: normalizedResolution,
    });
    const providerRoot =
      normalizedResolution?.resolvedFileName ?? traced.frontier.from;
    ambientProviderRoots.add(providerRoot);
    const entries =
      providerResolutions.get(providerRoot) ??
      new Map<string, SemanticProviderResolution>();
    entries.set(
      `${traced.frontier.from}\u0000${traced.frontier.specifier}`,
      traced.frontier
    );
    providerResolutions.set(providerRoot, entries);
    if (!normalizedResolution?.resolvedFileName) {
      unresolvedProviderRoots.add(providerRoot);
      return undefined;
    }
    if (!files.has(normalizedResolution.resolvedFileName)) {
      files.set(
        normalizedResolution.resolvedFileName,
        readCachedSemanticFile(normalizedResolution.resolvedFileName, cache)
      );
      enqueue(normalizedResolution.resolvedFileName);
    }
    return normalizedResolution;
  };
  const inferredTypeNamesSource = resolve(root, "__inferred type names__.ts");
  for (const directiveName of compilerOptions.types ?? []) {
    resolveTypeReference(directiveName, inferredTypeNamesSource);
  }
  for (const moduleName of generatedFacadeModules) {
    resolveModule(moduleName, cleanId);
  }
  for (const moduleName of finiteModules) {
    resolveModule(moduleName, cleanId);
  }
  for (const moduleName of semanticModuleSpecifiers(
    source,
    cleanId,
    sourceFile
  )) {
    resolveModule(moduleName, cleanId);
  }
  markPreparationProfile("setup-and-root-resolution");
  while (queue.length > 0) {
    const containingFile = queue.shift();
    if (!containingFile) {
      break;
    }
    pending.delete(containingFile);
    const containingSource = files.get(containingFile);
    if (containingSource === undefined) {
      throw new Error(`Sealed semantic closure omitted ${containingFile}`);
    }
    const sourceIdentity = `${containingFile}\u0000${sha256(containingSource)}`;
    const preprocessed =
      cache.preprocessedFiles.get(sourceIdentity) ??
      ts.preProcessFile(containingSource, true, true);
    cache.preprocessedFiles.set(sourceIdentity, preprocessed);
    for (const reference of preprocessed.typeReferenceDirectives) {
      resolveTypeReference(reference.fileName, containingFile);
    }
    for (const reference of preprocessed.libReferenceDirectives) {
      providerLibReferences.add(reference.fileName);
    }
    const moduleSpecifiers =
      cache.moduleSpecifiers.get(sourceIdentity) ??
      semanticModuleSpecifiers(
        containingSource,
        containingFile,
        parsedSemanticSourceFile(
          containingSource,
          containingFile,
          cache,
          containingFile === cleanId ? sourceFile : undefined
        )
      );
    cache.moduleSpecifiers.set(sourceIdentity, moduleSpecifiers);
    for (const moduleName of moduleSpecifiers) {
      resolveModule(moduleName, containingFile);
    }
    for (const reference of preprocessed.referencedFiles) {
      const referencedFile = normalizedSemanticPath(
        resolve(dirname(containingFile), reference.fileName),
        cache
      );
      if (!files.has(referencedFile)) {
        files.set(
          referencedFile,
          readCachedSemanticFile(referencedFile, cache)
        );
        enqueue(referencedFile);
      }
    }
  }
  markPreparationProfile("dependency-traversal");
  const libraryKey = sha256(
    JSON.stringify({
      compilerOptions: stableCompilerOptions(compilerOptions),
      referencedLibs: [...providerLibReferences].toSorted(
        compareCanonicalStrings
      ),
    })
  );
  const cachedLibraries = cache.libraries.get(libraryKey);
  if (cachedLibraries) {
    for (const file of cachedLibraries) {
      files.set(file.path, file.source);
    }
  } else {
    const libraryFiles = new Map<string, string>();
    const libQueue: Array<string> = [];
    const enqueueLib = (path: string): void => {
      const normalized = normalizedSemanticPath(path, cache);
      if (!libraryFiles.has(normalized)) {
        const librarySource = readCachedSemanticFile(normalized, cache);
        libraryFiles.set(normalized, librarySource);
        files.set(normalized, librarySource);
        libQueue.push(normalized);
      }
    };
    const configuredLibs = compilerOptions.lib;
    if (configuredLibs && configuredLibs.length > 0) {
      for (const library of configuredLibs) {
        enqueueLib(standardLibPath(compilerOptions, library));
      }
    } else {
      enqueueLib(ts.getDefaultLibFilePath(compilerOptions));
    }
    for (const library of providerLibReferences) {
      enqueueLib(standardLibPath(compilerOptions, library));
    }
    while (libQueue.length > 0) {
      const library = libQueue.shift();
      if (!library) {
        break;
      }
      const librarySource = libraryFiles.get(library);
      if (librarySource === undefined) {
        throw new Error(`Sealed semantic library closure omitted ${library}`);
      }
      const parsed = ts.createSourceFile(
        library,
        librarySource,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      );
      for (const reference of parsed.libReferenceDirectives) {
        enqueueLib(standardLibPath(compilerOptions, reference.fileName));
      }
      for (const reference of parsed.referencedFiles) {
        enqueueLib(resolve(dirname(library), reference.fileName));
      }
    }
    cache.libraries.set(
      libraryKey,
      [...libraryFiles].map(([path, librarySource]) =>
        internSealedSemanticFile(path, librarySource, cache)
      )
    );
  }
  markPreparationProfile("libraries");
  const hostFileProbes = new Map<string, boolean>();
  const semanticFilePaths = new Set<string>();
  files.forEach((_source, path) => {
    semanticFilePaths.add(path);
  });
  const packageEntryDirectories = new Set<string>();
  for (const resolution of resolutions.values()) {
    const resolvedModule = resolution.resolvedModule;
    if (!resolvedModule) {
      continue;
    }
    const originalPath =
      "originalPath" in resolvedModule &&
      typeof resolvedModule.originalPath === "string"
        ? resolvedModule.originalPath
        : undefined;
    semanticFilePaths.add(resolvedModule.resolvedFileName);
    if (originalPath) {
      semanticFilePaths.add(resolve(originalPath));
    }
    if (resolvedModule.packageId) {
      packageEntryDirectories.add(dirname(resolvedModule.resolvedFileName));
      if (originalPath) {
        packageEntryDirectories.add(dirname(resolve(originalPath)));
      }
    }
  }
  for (const resolution of typeResolutions.values()) {
    const resolvedTypeReferenceDirective =
      resolution.resolvedTypeReferenceDirective;
    if (!resolvedTypeReferenceDirective?.resolvedFileName) {
      continue;
    }
    const originalPath =
      "originalPath" in resolvedTypeReferenceDirective &&
      typeof resolvedTypeReferenceDirective.originalPath === "string"
        ? resolvedTypeReferenceDirective.originalPath
        : undefined;
    semanticFilePaths.add(resolvedTypeReferenceDirective.resolvedFileName);
    if (originalPath) {
      semanticFilePaths.add(resolve(originalPath));
    }
    if (resolvedTypeReferenceDirective.packageId) {
      packageEntryDirectories.add(
        dirname(resolvedTypeReferenceDirective.resolvedFileName)
      );
      if (originalPath) {
        packageEntryDirectories.add(dirname(resolve(originalPath)));
      }
    }
  }
  for (const path of semanticFilePaths) {
    let directory = dirname(path);
    for (;;) {
      const packagePath = resolve(directory, "package.json");
      if (!hostFileProbes.has(packagePath)) {
        let packageSource = cache.packageFiles.get(packagePath);
        if (!cache.packageFiles.has(packagePath)) {
          packageSource = ts.sys.readFile(packagePath);
          cache.packageFiles.set(packagePath, packageSource);
        }
        const present = packageSource !== undefined;
        hostFileProbes.set(packagePath, present);
        if (packageSource !== undefined) {
          files.set(packagePath, packageSource);
          break;
        }
      }
      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }
  const packageEntryExtensions = [
    ".ts",
    ".tsx",
    ".d.ts",
    ".js",
    ".jsx",
    ".json",
    ".mts",
    ".cts",
    ".d.mts",
    ".d.cts",
    ".mjs",
    ".cjs",
  ] as const;
  for (const directory of packageEntryDirectories) {
    for (const extension of packageEntryExtensions) {
      const candidate = `${directory}${extension}`;
      if (!hostFileProbes.has(candidate)) {
        hostFileProbes.set(candidate, ts.sys.fileExists(candidate));
      }
    }
  }
  markPreparationProfile("package-probes");
  const providerRoots = [...providerResolutions.keys()]
    .toSorted(compareCanonicalStrings)
    .map((providerRoot) => ({
      entryRoots: [
        ...(providerEntryRoots.get(providerRoot) ?? [providerRoot]),
      ].toSorted(compareCanonicalStrings),
      includeDeclarations: !unresolvedProviderRoots.has(providerRoot),
      ...(ambientProviderRoots.has(providerRoot)
        ? { kind: "ambient" as const }
        : {}),
      resolutions: [
        ...(providerResolutions.get(providerRoot)?.values() ?? []),
      ].toSorted((left, right) =>
        compareCanonicalStrings(
          `${left.from}\u0000${left.specifier}`,
          `${right.from}\u0000${right.specifier}`
        )
      ),
      root: providerRoot,
    }));
  const normalizedForGroup = (path: string): string => {
    if (path === cleanId) {
      return "<source>";
    }
    if (path === generatedFacadeId) {
      return "<generated-facade>";
    }
    return path;
  };
  const closureIdentity = {
    analyzerAbi: "mirai-intl-semantic-closure-v1",
    compilerOptions: stableCompilerOptions(compilerOptions),
    files: [...files]
      .filter(([path]) => path !== cleanId && path !== generatedFacadeId)
      .map(([path, value]) => [path, sha256(value)] as const)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right)),
    generatedFacadeHash: catalog.generatedFacadeHash,
    generatedFacadeSliceHash:
      facadeSource === undefined ? null : sha256(facadeSource),
    generatedFacadeModules: [...generatedFacadeModules].toSorted(
      compareCanonicalStrings
    ),
    providerBudgetExceeded: providerBudgetExceeded ?? null,
    providerRoots: providerRoots.map((provider) => ({
      entryRoots: provider.entryRoots.map(normalizedForGroup),
      includeDeclarations: provider.includeDeclarations,
      kind: provider.kind ?? null,
      root: normalizedForGroup(provider.root),
    })),
    resolutions: [...resolutions.values()]
      .filter(
        (resolution) =>
          resolution.containingFile !== cleanId ||
          resolution.resolvedModule !== undefined ||
          finiteModules.has(resolution.moduleName) ||
          generatedFacadeModules.has(resolution.moduleName)
      )
      .map((resolution) => ({
        containingFile: normalizedForGroup(resolution.containingFile),
        moduleName: resolution.moduleName,
        resolvedFileName: resolution.resolvedModule
          ? normalizedForGroup(resolution.resolvedModule.resolvedFileName)
          : null,
      }))
      .toSorted((left, right) =>
        compareCanonicalStrings(
          `${left.containingFile}\u0000${left.moduleName}`,
          `${right.containingFile}\u0000${right.moduleName}`
        )
      ),
    typeResolutions: [...typeResolutions.values()]
      .map((resolution) => ({
        containingFile: normalizedForGroup(resolution.containingFile),
        directiveName: resolution.directiveName,
        resolvedFileName:
          resolution.resolvedTypeReferenceDirective?.resolvedFileName ?? null,
      }))
      .toSorted((left, right) =>
        compareCanonicalStrings(
          `${left.containingFile}\u0000${left.directiveName}`,
          `${right.containingFile}\u0000${right.directiveName}`
        )
      ),
    typescriptVersion: ts.version,
  };
  const explicitRealpaths = new Map<string, string>();
  for (const resolution of [
    ...generatedFacadeResolutions.values(),
    ...vfsResolutions.values(),
    ...providerRoots.flatMap((provider) => provider.resolutions),
  ]) {
    for (const entry of resolution.realpaths) {
      explicitRealpaths.set(resolve(entry.path), resolve(entry.target));
    }
  }
  const hostRealpaths = captureSealedHostRealpaths(
    files.keys(),
    new Set([cleanId, generatedFacadeId]),
    explicitRealpaths,
    cache.realpathIdentities
  );
  markPreparationProfile("closure-identity-and-realpaths");
  return {
    compilerOptions,
    files: [...files].map(([path, value]) =>
      internSealedSemanticFile(path, value, cache)
    ),
    generatedImports: {
      ...generatedImports,
      facadeResolutions: [...generatedFacadeResolutions.values()].toSorted(
        (left, right) =>
          compareCanonicalStrings(
            `${left.from}\u0000${left.specifier}`,
            `${right.from}\u0000${right.specifier}`
          )
      ),
    },
    generatedFacadeId,
    groupKey: sha256(JSON.stringify(closureIdentity)),
    hostFileProbes: [...hostFileProbes].map(([path, present]) => ({
      path,
      present,
    })),
    hostRealpaths,
    id: cleanId,
    providerBudgetExceeded,
    providerRoots,
    resolutions: [...resolutions.values()],
    root,
    source,
    sourceFile,
    tripleSlashControls:
      sourceFile.referencedFiles.length +
      sourceFile.typeReferenceDirectives.length +
      sourceFile.libReferenceDirectives.length,
    typeResolutions: [...typeResolutions.values()],
    unsupportedProviderResolutionOptions: ownerCompilerOptions?.typeRoots
      ?.length
      ? ["typeRoots"]
      : [],
    vfsResolutions: [...vfsResolutions.values()],
    workspaceRoot,
  };
}

function cloneInertSemanticClosure(
  template: PreparedSemanticClosure,
  source: string,
  id: string,
  sourceFile: ts.SourceFile
): PreparedSemanticClosure {
  const cleanId = normalizedSemanticPath(id);
  const generatedFacadeId = template.generatedFacadeId;
  const files = template.files
    .filter(
      (file) =>
        file.path !== template.id &&
        /[/\\]typescript[/\\]lib[/\\]lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u.test(
          file.path
        )
    )
    .concat({ hash: sha256(source), path: cleanId, source });
  const resolutions = semanticModuleSpecifiers(source, cleanId, sourceFile).map(
    (moduleName): SealedSemanticResolution => ({
      containingFile: cleanId,
      moduleName,
      resolvedModule: undefined,
    })
  );
  const hostRealpaths = captureSealedHostRealpaths(
    files.map(({ path }) => path),
    new Set([cleanId, generatedFacadeId]),
    new Map(template.hostRealpaths.map(({ path, target }) => [path, target]))
  );
  return {
    compilerOptions: template.compilerOptions,
    files,
    generatedImports: {
      facadeModules: new Set(),
      facadeResolutions: [],
      formErrorFactories: new Set(),
      formSchemaFactories: new Set(),
      keyFactories: new Set(),
      keyParsers: new Set(),
      requiresCatalogContract: false,
      requiresFullFacade: false,
      translationKeyTypes: new Set(),
      translationNamespaceTypes: new Set(),
    },
    generatedFacadeId,
    groupKey: template.groupKey,
    hostFileProbes: [],
    hostRealpaths,
    id: cleanId,
    providerBudgetExceeded: undefined,
    providerRoots: [],
    resolutions,
    root: template.root,
    source,
    sourceFile,
    tripleSlashControls: 0,
    typeResolutions: [],
    unsupportedProviderResolutionOptions: [],
    vfsResolutions: [],
    workspaceRoot: template.workspaceRoot,
  };
}

function cloneFacadeOnlySemanticClosure(
  template: PreparedSemanticClosure,
  source: string,
  id: string,
  sourceFile: ts.SourceFile,
  generatedImports: GeneratedFacadeImportNames,
  cache: SemanticPreparationCache
): PreparedSemanticClosure {
  const cleanId = normalizedSemanticPath(id, cache);
  const files = template.files
    .filter((file) => file.path !== template.id)
    .concat(internSealedSemanticFile(cleanId, source, cache));
  const transitiveFacadeResolutions =
    template.generatedImports.facadeResolutions.filter(
      ({ from }) => normalizedSemanticPath(from, cache) !== template.id
    );
  const facadeResolutions = new Map<string, SemanticProviderResolution>();
  for (const resolution of [
    ...generatedImports.facadeResolutions,
    ...transitiveFacadeResolutions,
  ]) {
    facadeResolutions.set(
      `${normalizedSemanticPath(resolution.from, cache)}\u0000${resolution.specifier}`,
      resolution
    );
  }
  const resolutions = template.resolutions
    .filter(({ containingFile }) => containingFile !== template.id)
    .concat(
      semanticModuleSpecifiers(source, cleanId, sourceFile).map(
        (moduleName): SealedSemanticResolution => ({
          containingFile: cleanId,
          moduleName,
          resolvedModule: generatedImports.facadeModules.has(moduleName)
            ? {
                extension: ts.Extension.Dts,
                isExternalLibraryImport: false,
                resolvedFileName: template.generatedFacadeId,
              }
            : undefined,
        })
      )
    );
  const hostFileProbes = new Map(
    template.hostFileProbes.map(({ path, present }) => [path, present])
  );
  let directory = dirname(cleanId);
  for (;;) {
    const packagePath = resolve(directory, "package.json");
    if (!hostFileProbes.has(packagePath)) {
      let packageSource = cache.packageFiles.get(packagePath);
      if (!cache.packageFiles.has(packagePath)) {
        packageSource = ts.sys.readFile(packagePath);
        cache.packageFiles.set(packagePath, packageSource);
      }
      hostFileProbes.set(packagePath, packageSource !== undefined);
      if (packageSource !== undefined) {
        break;
      }
    } else if (hostFileProbes.get(packagePath)) {
      break;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  const hostRealpaths = new Map(
    template.hostRealpaths.map(({ path, target }) => [path, target])
  );
  for (const { path, target } of captureSealedHostRealpaths(
    [cleanId],
    new Set([cleanId, template.generatedFacadeId]),
    hostRealpaths,
    cache.realpathIdentities
  )) {
    const existing = hostRealpaths.get(path);
    if (existing && existing !== target) {
      throw new Error(`Conflicting sealed semantic realpath: ${path}`);
    }
    hostRealpaths.set(path, target);
  }
  return {
    ...template,
    files,
    generatedImports: {
      ...generatedImports,
      facadeResolutions: [...facadeResolutions.values()].toSorted(
        (left, right) =>
          compareCanonicalStrings(
            `${left.from}\u0000${left.specifier}`,
            `${right.from}\u0000${right.specifier}`
          )
      ),
    },
    hostFileProbes: [...hostFileProbes].map(([path, present]) => ({
      path,
      present,
    })),
    hostRealpaths: [...hostRealpaths].map(([path, target]) => ({
      path,
      target,
    })),
    id: cleanId,
    resolutions,
    sharedBase: template,
    source,
    sourceFile,
    tripleSlashControls: 0,
  };
}

function isSemanticInterferenceDeclaration(
  file: SealedSemanticFile,
  cache: SemanticPreparationCache
): boolean {
  if (
    /[/\\]typescript[/\\]lib[/\\]lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u.test(
      file.path
    )
  ) {
    return true;
  }
  if (!/\.d\.[cm]?ts$/u.test(file.path)) {
    return false;
  }
  const identity = `${file.path}\u0000${file.hash}`;
  const cached = cache.declarationInterference.get(identity);
  if (cached !== undefined) {
    return cached;
  }
  const sourceFile = parsedSemanticSourceFile(file.source, file.path, cache);
  let interferes = !ts.isExternalModule(sourceFile);
  const visit = (node: ts.Node): void => {
    if (interferes) {
      return;
    }
    if (
      (ts.isModuleDeclaration(node) &&
        ((node.flags & ts.NodeFlags.GlobalAugmentation) !== 0 ||
          node.name.text === "global" ||
          ts.isStringLiteral(node.name))) ||
      ts.isNamespaceExportDeclaration(node)
    ) {
      interferes = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  cache.declarationInterference.set(identity, interferes);
  return interferes;
}

function semanticResolutionIdentity(
  resolution:
    | ts.ResolvedModuleFull
    | ts.ResolvedTypeReferenceDirective
    | undefined
): string {
  if (!resolution) {
    return "unresolved";
  }
  return JSON.stringify(
    stableSemanticValue({
      extension: "extension" in resolution ? resolution.extension : null,
      isExternalLibraryImport:
        "isExternalLibraryImport" in resolution
          ? resolution.isExternalLibraryImport
          : null,
      packageId: resolution.packageId ?? null,
      resolvedFileName: resolution.resolvedFileName,
    })
  );
}

interface SemanticFusionState {
  closures: WeakSet<PreparedSemanticClosure>;
  files: Map<string, string>;
  probes: Map<string, boolean>;
  realpaths: Map<string, string>;
  resolutions: Map<string, string>;
  typeResolutions: Map<string, string>;
}

function createSemanticFusionState(): SemanticFusionState {
  return {
    closures: new WeakSet(),
    files: new Map(),
    probes: new Map(),
    realpaths: new Map(),
    resolutions: new Map(),
    typeResolutions: new Map(),
  };
}

type SemanticClosureMaterialization = Readonly<{
  facadeResolutions: ReadonlyArray<SemanticProviderResolution>;
  files: ReadonlyArray<SealedSemanticFile>;
  hostFileProbes: PreparedSemanticClosure["hostFileProbes"];
  hostRealpaths: PreparedSemanticClosure["hostRealpaths"];
  providerRoots: PreparedSemanticClosure["providerRoots"];
  resolutions: PreparedSemanticClosure["resolutions"];
  typeResolutions: PreparedSemanticClosure["typeResolutions"];
  vfsResolutions: PreparedSemanticClosure["vfsResolutions"];
}>;

const semanticClosureIdentityCache = new WeakMap<
  PreparedSemanticClosure,
  Readonly<{
    facadeResolutions: ReadonlySet<string>;
    files: ReadonlySet<string>;
    hostFileProbes: ReadonlySet<string>;
    hostRealpaths: ReadonlySet<string>;
    resolutions: ReadonlySet<string>;
    typeResolutions: ReadonlySet<string>;
  }>
>();

function semanticClosureIdentities(
  closure: PreparedSemanticClosure
): NonNullable<ReturnType<typeof semanticClosureIdentityCache.get>> {
  const cached = semanticClosureIdentityCache.get(closure);
  if (cached) {
    return cached;
  }
  const identities = {
    facadeResolutions: new Set(
      closure.generatedImports.facadeResolutions.map(
        (resolution) =>
          `${normalizedSemanticPath(resolution.from)}\u0000${resolution.specifier}\u0000${canonicalJson(resolution)}`
      )
    ),
    files: new Set(
      closure.files.map(({ hash, path }) => `${path}\u0000${hash}`)
    ),
    hostFileProbes: new Set(
      closure.hostFileProbes.map(
        ({ path, present }) => `${resolve(path)}\u0000${String(present)}`
      )
    ),
    hostRealpaths: new Set(
      closure.hostRealpaths.map(
        ({ path, target }) => `${resolve(path)}\u0000${resolve(target)}`
      )
    ),
    resolutions: new Set(
      closure.resolutions.map(
        (resolution) =>
          `${sealedSemanticResolutionKey(resolution.containingFile, resolution.moduleName)}\u0000${semanticResolutionIdentity(resolution.resolvedModule)}`
      )
    ),
    typeResolutions: new Set(
      closure.typeResolutions.map(
        (resolution) =>
          `${sealedSemanticResolutionKey(resolution.containingFile, resolution.directiveName)}\u0000${semanticResolutionIdentity(resolution.resolvedTypeReferenceDirective)}`
      )
    ),
  } as const;
  semanticClosureIdentityCache.set(closure, identities);
  return identities;
}

function semanticClosureMaterialization(
  closure: PreparedSemanticClosure,
  sharedBaseAvailable: boolean
): SemanticClosureMaterialization {
  const base = closure.sharedBase;
  if (!base || !sharedBaseAvailable) {
    return {
      facadeResolutions: closure.generatedImports.facadeResolutions,
      files: closure.files,
      hostFileProbes: closure.hostFileProbes,
      hostRealpaths: closure.hostRealpaths,
      providerRoots: closure.providerRoots,
      resolutions: closure.resolutions,
      typeResolutions: closure.typeResolutions,
      vfsResolutions: closure.vfsResolutions,
    };
  }
  const identities = semanticClosureIdentities(base);
  return {
    facadeResolutions: closure.generatedImports.facadeResolutions.filter(
      (resolution) =>
        !identities.facadeResolutions.has(
          `${normalizedSemanticPath(resolution.from)}\u0000${resolution.specifier}\u0000${canonicalJson(resolution)}`
        )
    ),
    files: closure.files.filter(
      ({ hash, path }) => !identities.files.has(`${path}\u0000${hash}`)
    ),
    hostFileProbes: closure.hostFileProbes.filter(
      ({ path, present }) =>
        !identities.hostFileProbes.has(
          `${resolve(path)}\u0000${String(present)}`
        )
    ),
    hostRealpaths: closure.hostRealpaths.filter(
      ({ path, target }) =>
        !identities.hostRealpaths.has(
          `${resolve(path)}\u0000${resolve(target)}`
        )
    ),
    providerRoots:
      closure.providerRoots === base.providerRoots ? [] : closure.providerRoots,
    resolutions: closure.resolutions.filter(
      (resolution) =>
        !identities.resolutions.has(
          `${sealedSemanticResolutionKey(resolution.containingFile, resolution.moduleName)}\u0000${semanticResolutionIdentity(resolution.resolvedModule)}`
        )
    ),
    typeResolutions: closure.typeResolutions.filter(
      (resolution) =>
        !identities.typeResolutions.has(
          `${sealedSemanticResolutionKey(resolution.containingFile, resolution.directiveName)}\u0000${semanticResolutionIdentity(resolution.resolvedTypeReferenceDirective)}`
        )
    ),
    vfsResolutions:
      closure.vfsResolutions === base.vfsResolutions
        ? []
        : closure.vfsResolutions,
  };
}

function tryFuseSemanticClosure(
  state: SemanticFusionState,
  candidate: PreparedSemanticClosure
): boolean {
  const materialization = semanticClosureMaterialization(
    candidate,
    candidate.sharedBase !== undefined &&
      state.closures.has(candidate.sharedBase)
  );
  const frontiers = [
    ...materialization.facadeResolutions,
    ...materialization.vfsResolutions,
    ...materialization.providerRoots.flatMap(({ resolutions }) => resolutions),
  ];
  const validatesFrontier = (frontier: SemanticProviderResolution): boolean => {
    for (const probe of frontier.probes) {
      const current = state.probes.get(resolve(probe.path));
      if (current !== undefined && current !== probe.present) {
        return false;
      }
    }
    for (const entry of frontier.realpaths) {
      const path = resolve(entry.path);
      const target = resolve(entry.target);
      const current = state.realpaths.get(path);
      if (current !== undefined && current !== target) {
        return false;
      }
    }
    return true;
  };
  for (const file of materialization.files) {
    const current = state.files.get(file.path);
    if (current !== undefined && current !== file.source) {
      return false;
    }
  }
  for (const resolution of materialization.resolutions) {
    const key = sealedSemanticResolutionKey(
      resolution.containingFile,
      resolution.moduleName
    );
    const identity = semanticResolutionIdentity(resolution.resolvedModule);
    const current = state.resolutions.get(key);
    if (
      current !== undefined &&
      current !== identity &&
      current !== "unresolved" &&
      identity !== "unresolved"
    ) {
      return false;
    }
  }
  for (const resolution of materialization.typeResolutions) {
    const key = sealedSemanticResolutionKey(
      resolution.containingFile,
      resolution.directiveName
    );
    const identity = semanticResolutionIdentity(
      resolution.resolvedTypeReferenceDirective
    );
    const current = state.typeResolutions.get(key);
    if (
      current !== undefined &&
      current !== identity &&
      current !== "unresolved" &&
      identity !== "unresolved"
    ) {
      return false;
    }
  }
  for (const probe of materialization.hostFileProbes) {
    const path = resolve(probe.path);
    const current = state.probes.get(path);
    if (current !== undefined && current !== probe.present) {
      return false;
    }
  }
  for (const entry of materialization.hostRealpaths) {
    const path = resolve(entry.path);
    const target = resolve(entry.target);
    const current = state.realpaths.get(path);
    if (current !== undefined && current !== target) {
      return false;
    }
  }
  if (!frontiers.every(validatesFrontier)) {
    return false;
  }
  for (const file of materialization.files) {
    state.files.set(file.path, file.source);
  }
  for (const resolution of materialization.resolutions) {
    const key = sealedSemanticResolutionKey(
      resolution.containingFile,
      resolution.moduleName
    );
    const identity = semanticResolutionIdentity(resolution.resolvedModule);
    if (identity !== "unresolved" || !state.resolutions.has(key)) {
      state.resolutions.set(key, identity);
    }
  }
  for (const resolution of materialization.typeResolutions) {
    const key = sealedSemanticResolutionKey(
      resolution.containingFile,
      resolution.directiveName
    );
    const identity = semanticResolutionIdentity(
      resolution.resolvedTypeReferenceDirective
    );
    if (identity !== "unresolved" || !state.typeResolutions.has(key)) {
      state.typeResolutions.set(key, identity);
    }
  }
  for (const probe of materialization.hostFileProbes) {
    state.probes.set(resolve(probe.path), probe.present);
  }
  for (const entry of materialization.hostRealpaths) {
    state.realpaths.set(resolve(entry.path), resolve(entry.target));
  }
  for (const frontier of frontiers) {
    for (const probe of frontier.probes) {
      state.probes.set(resolve(probe.path), probe.present);
    }
    for (const entry of frontier.realpaths) {
      state.realpaths.set(resolve(entry.path), resolve(entry.target));
    }
  }
  state.closures.add(candidate);
  return true;
}

function createSealedSemanticGroup(
  closures: ReadonlyArray<PreparedSemanticClosure>,
  catalog: CurrentCatalog,
  cache: SemanticPreparationCache
): ReadonlyMap<string, SemanticProgramContext> {
  const first = closures[0];
  if (!first) {
    return new Map();
  }
  const files = new Map<string, string>();
  const resolutions = new Map<string, ts.ResolvedModuleFull | undefined>();
  const typeResolutions = new Map<
    string,
    ts.ResolvedTypeReferenceDirective | undefined
  >();
  const materializedClosures = new WeakSet<PreparedSemanticClosure>();
  for (const closure of closures) {
    const materialization = semanticClosureMaterialization(
      closure,
      closure.sharedBase !== undefined &&
        materializedClosures.has(closure.sharedBase)
    );
    for (const file of materialization.files) {
      const current = files.get(file.path);
      if (current !== undefined && current !== file.source) {
        throw new Error(`Sealed semantic closure disagrees on ${file.path}`);
      }
      files.set(file.path, file.source);
    }
    for (const resolution of materialization.resolutions) {
      const key = sealedSemanticResolutionKey(
        resolution.containingFile,
        resolution.moduleName
      );
      if (resolutions.has(key)) {
        const current = resolutions.get(key);
        if (
          current !== undefined &&
          resolution.resolvedModule !== undefined &&
          current?.resolvedFileName !==
            resolution.resolvedModule?.resolvedFileName
        ) {
          throw new Error(
            `Sealed semantic closure disagrees on ${resolution.moduleName}`
          );
        }
        if (current === undefined && resolution.resolvedModule !== undefined) {
          resolutions.set(key, resolution.resolvedModule);
        }
      } else {
        resolutions.set(key, resolution.resolvedModule);
      }
    }
    for (const resolution of materialization.typeResolutions) {
      const key = sealedSemanticResolutionKey(
        resolution.containingFile,
        resolution.directiveName
      );
      if (typeResolutions.has(key)) {
        const current = typeResolutions.get(key);
        if (
          current !== undefined &&
          resolution.resolvedTypeReferenceDirective !== undefined &&
          current?.resolvedFileName !==
            resolution.resolvedTypeReferenceDirective?.resolvedFileName
        ) {
          throw new Error(
            `Sealed semantic closure disagrees on type reference ${resolution.directiveName}`
          );
        }
        if (
          current === undefined &&
          resolution.resolvedTypeReferenceDirective !== undefined
        ) {
          typeResolutions.set(key, resolution.resolvedTypeReferenceDirective);
        }
      } else {
        typeResolutions.set(key, resolution.resolvedTypeReferenceDirective);
      }
    }
    materializedClosures.add(closure);
  }
  const directories = new Set<string>();
  const directoryChildren = new Map<string, Set<string>>();
  const negativeFiles = new Set<string>();
  const negativeDirectories = new Set<string>();
  const positiveProbeFiles = new Set<string>();
  const positiveProbeDirectories = new Set<string>();
  const realpaths = new Map<string, string>();
  const recordResolutionFrontier = (
    resolution: SemanticProviderResolution
  ): void => {
    for (const probe of resolution.probes) {
      const path = resolve(probe.path);
      if (probe.kind === "file") {
        (probe.present ? positiveProbeFiles : negativeFiles).add(path);
      } else {
        (probe.present ? positiveProbeDirectories : negativeDirectories).add(
          path
        );
      }
    }
    for (const entry of resolution.realpaths) {
      const path = resolve(entry.path);
      const target = resolve(entry.target);
      const existing = realpaths.get(path);
      if (existing && existing !== target) {
        throw new Error(
          `Sealed semantic closure disagrees on realpath ${path}`
        );
      }
      realpaths.set(path, target);
    }
  };
  const frontierClosures = new WeakSet<PreparedSemanticClosure>();
  for (const closure of closures) {
    const materialization = semanticClosureMaterialization(
      closure,
      closure.sharedBase !== undefined &&
        frontierClosures.has(closure.sharedBase)
    );
    for (const entry of materialization.hostRealpaths) {
      const path = resolve(entry.path);
      const target = resolve(entry.target);
      const existing = realpaths.get(path);
      if (existing && existing !== target) {
        throw new Error(
          `Sealed semantic closure disagrees on realpath ${path}`
        );
      }
      realpaths.set(path, target);
    }
    for (const probe of materialization.hostFileProbes) {
      (probe.present ? positiveProbeFiles : negativeFiles).add(
        resolve(probe.path)
      );
    }
    for (const resolution of materialization.facadeResolutions) {
      recordResolutionFrontier(resolution);
    }
    for (const resolution of materialization.vfsResolutions) {
      recordResolutionFrontier(resolution);
    }
    for (const provider of materialization.providerRoots) {
      for (const resolution of provider.resolutions) {
        recordResolutionFrontier(resolution);
      }
    }
    frontierClosures.add(closure);
  }
  for (const path of files.keys()) {
    let current = dirname(path);
    for (;;) {
      directories.add(current);
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      const children = directoryChildren.get(parent) ?? new Set<string>();
      children.add(current);
      directoryChildren.set(parent, children);
      current = parent;
    }
  }
  const resolveHostPath = (path: string): string =>
    resolve(isAbsolute(path) ? path : resolve(first.root, path));
  const sourceFiles = new Map<string, ts.SourceFile>(
    closures.flatMap((closure) => [
      [resolveHostPath(closure.id), closure.sourceFile],
      [resolveHostPath(closure.sourceFile.fileName), closure.sourceFile],
    ])
  );
  const unrecorded = (operation: string, path: string): never => {
    throw new Error(
      `Sealed semantic VFS rejected unrecorded ${operation} query: ${path}`
    );
  };
  const host: ts.CompilerHost = {
    directoryExists(directoryName) {
      const normalized = resolveHostPath(directoryName);
      if (
        directories.has(normalized) ||
        positiveProbeDirectories.has(normalized)
      ) {
        return true;
      }
      if (negativeDirectories.has(normalized)) {
        return false;
      }
      return unrecorded("directoryExists", directoryName);
    },
    fileExists(fileName) {
      const normalized = resolveHostPath(fileName);
      if (files.has(normalized) || positiveProbeFiles.has(normalized)) {
        return true;
      }
      if (negativeFiles.has(normalized)) {
        return false;
      }
      return unrecorded("fileExists", fileName);
    },
    getCanonicalFileName(fileName) {
      const normalized = resolveHostPath(fileName);
      return ts.sys.useCaseSensitiveFileNames
        ? normalized
        : normalized.toLowerCase();
    },
    getCurrentDirectory() {
      return first.root;
    },
    getDefaultLibFileName() {
      return ts.getDefaultLibFilePath(first.compilerOptions);
    },
    getDirectories(directoryName) {
      const normalized = resolveHostPath(directoryName);
      if (!directories.has(normalized)) {
        return unrecorded("getDirectories", directoryName);
      }
      return [...(directoryChildren.get(normalized) ?? [])].toSorted(
        compareCanonicalStrings
      );
    },
    getNewLine() {
      return "\n";
    },
    getSourceFile(fileName, languageVersion) {
      const normalized = resolveHostPath(fileName);
      const cached = sourceFiles.get(normalized);
      if (cached) {
        return cached;
      }
      const source = files.get(normalized);
      if (source === undefined) {
        return unrecorded("getSourceFile", fileName);
      }
      const file = ts.createSourceFile(
        normalized,
        source,
        languageVersion,
        true,
        scriptKindFor(normalized)
      );
      sourceFiles.set(normalized, file);
      return file;
    },
    readFile(fileName) {
      const normalized = resolveHostPath(fileName);
      const source = files.get(normalized);
      return source ?? unrecorded("readFile", fileName);
    },
    realpath(path) {
      const normalized = resolveHostPath(path);
      return resolveSealedSemanticRealpath(realpaths, normalized);
    },
    resolveModuleNameLiterals(moduleLiterals, containingFile) {
      return moduleLiterals.map((moduleLiteral) => {
        const key = sealedSemanticResolutionKey(
          containingFile,
          moduleLiteral.text
        );
        if (!resolutions.has(key)) {
          return unrecorded(
            "module-resolution",
            `${containingFile} -> ${moduleLiteral.text}`
          );
        }
        return { resolvedModule: resolutions.get(key) };
      });
    },
    resolveTypeReferenceDirectives(typeDirectiveNames, containingFile) {
      return typeDirectiveNames.map((directive) => {
        const directiveName =
          typeof directive === "string" ? directive : directive.fileName;
        const key = sealedSemanticResolutionKey(containingFile, directiveName);
        if (!typeResolutions.has(key)) {
          return unrecorded(
            "type-reference-resolution",
            `${containingFile} -> ${directiveName}`
          );
        }
        return typeResolutions.get(key);
      });
    },
    useCaseSensitiveFileNames() {
      return ts.sys.useCaseSensitiveFileNames;
    },
    writeFile() {
      throw new Error("Sealed semantic VFS is read-only");
    },
  };
  const rootNameSet = new Set<string>();
  const rootClosures = new WeakSet<PreparedSemanticClosure>();
  for (const closure of closures) {
    rootNameSet.add(closure.id);
    if (closure.generatedFacadeId && files.has(closure.generatedFacadeId)) {
      rootNameSet.add(closure.generatedFacadeId);
    }
    const materialization = semanticClosureMaterialization(
      closure,
      closure.sharedBase !== undefined && rootClosures.has(closure.sharedBase)
    );
    for (const file of materialization.files) {
      if (
        /\.d\.[cm]?ts$/u.test(file.path) &&
        (closure.tripleSlashControls > 0 ||
          isSemanticInterferenceDeclaration(file, cache))
      ) {
        rootNameSet.add(file.path);
      }
    }
    for (const provider of materialization.providerRoots) {
      if (provider.includeDeclarations) {
        provider.entryRoots.forEach((entry) => rootNameSet.add(entry));
      }
    }
    rootClosures.add(closure);
  }
  const rootNames = [...rootNameSet].toSorted(compareCanonicalStrings);
  const program = ts.createProgram(rootNames, first.compilerOptions, host);
  const checker = program.getTypeChecker();
  const allSources = new Set(closures.map(({ id }) => id));
  const allFacades = new Set(
    closures.map(({ generatedFacadeId }) => generatedFacadeId)
  );
  const expectedEvidenceFiles = new Map<string, `sha256:${string}`>();
  const evidenceClosures = new WeakSet<PreparedSemanticClosure>();
  for (const closure of closures) {
    const materialization = semanticClosureMaterialization(
      closure,
      closure.sharedBase !== undefined &&
        evidenceClosures.has(closure.sharedBase)
    );
    for (const file of materialization.files) {
      if (!/\.d\.[cm]?ts$/u.test(file.path)) {
        continue;
      }
      const path = resolve(file.path);
      const current = expectedEvidenceFiles.get(path);
      if (current !== undefined && current !== file.hash) {
        throw new Error(`Sealed semantic evidence disagrees on ${path}`);
      }
      expectedEvidenceFiles.set(path, file.hash);
    }
    evidenceClosures.add(closure);
  }
  const programEvidenceHashes = new Map<string, `sha256:${string}`>();
  for (const [path, expectedHash] of expectedEvidenceFiles) {
    const file = program.getSourceFile(path);
    if (!file) {
      throw new Error(`Sealed semantic Program omitted evidence file ${path}`);
    }
    if (sha256(file.text) !== expectedHash) {
      throw new Error(`Sealed semantic Program changed evidence file ${path}`);
    }
    programEvidenceHashes.set(path, expectedHash);
  }
  const evidenceRecordsCache = new Map<string, SemanticEvidenceRecords>();
  const evidenceIdentityCache = new WeakMap<PreparedSemanticClosure, string>();
  const evidenceIdentityFor = (
    closure: PreparedSemanticClosure,
    sourceRoots: ReadonlySet<string>
  ): string => {
    const cached = evidenceIdentityCache.get(closure);
    if (cached) {
      return cached;
    }
    if (closure.sharedBase) {
      const shared = evidenceIdentityFor(closure.sharedBase, sourceRoots);
      evidenceIdentityCache.set(closure, shared);
      return shared;
    }
    const identity = sha256(
      JSON.stringify({
        files: closure.files
          .filter(
            ({ path }) => !sourceRoots.has(path) && /\.d\.[cm]?ts$/u.test(path)
          )
          .map(({ hash, path }) => [
            resolve(path),
            programEvidenceHashes.get(resolve(path)) ?? hash,
          ]),
        generatedFacadeId: closure.generatedFacadeId,
        workspaceRoot: closure.workspaceRoot,
      })
    );
    evidenceIdentityCache.set(closure, identity);
    return identity;
  };
  return new Map(
    closures.map((closure) => {
      const sourceFile = program.getSourceFile(closure.id);
      if (!sourceFile) {
        throw new Error(`Sealed semantic Program omitted ${closure.id}`);
      }
      const sourceRoots = new Set([
        ...allSources,
        ...[...allFacades].filter((path) => path !== closure.generatedFacadeId),
      ]);
      const evidenceIdentity = evidenceIdentityFor(closure, sourceRoots);
      let evidenceRecords = evidenceRecordsCache.get(evidenceIdentity);
      if (!evidenceRecords) {
        evidenceRecords = semanticEvidenceRecords(
          closure,
          catalog,
          sourceRoots,
          programEvidenceHashes
        );
        evidenceRecordsCache.set(evidenceIdentity, evidenceRecords);
      }
      return [
        closure.id,
        {
          checker,
          // The group-level Program/evidence pass above validated this exact
          // map once. Per-source analysis consumes the canonical records and
          // must not rewalk thousands of identical declaration entries.
          evidenceRecords,
          generatedFacadeId: closure.generatedFacadeId,
          program,
          providerBudgetExceeded: closure.providerBudgetExceeded,
          providerRoots: closure.providerRoots,
          sourceFile,
          sourceRoots,
          tripleSlashControls: closure.tripleSlashControls,
          unsupportedProviderResolutionOptions:
            closure.unsupportedProviderResolutionOptions,
        },
      ];
    })
  );
}

function evidencePath(workspaceRoot: string, file: string): string {
  const path = relative(workspaceRoot, file).split(sep).join("/");
  if (
    /[/\\]typescript[/\\]lib[/\\]lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u.test(file)
  ) {
    return `@typescript/lib/${file.split(/[\\/]/u).at(-1)}`;
  }
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error(`Semantic evidence path escapes its workspace root`);
  }
  return path;
}

function semanticEvidence(
  program: ts.Program | undefined,
  evidenceFiles: ReadonlyMap<string, `sha256:${string}`> | undefined,
  evidenceRecords: SemanticEvidenceRecords | undefined,
  providerBudgetExceeded: string | undefined,
  providerRoots: ReadonlyArray<
    Readonly<{
      includeDeclarations: boolean;
      kind?: "ambient";
      resolutions: ReadonlyArray<SemanticProviderResolution>;
      root: string;
    }>
  >,
  sourceFile: ts.SourceFile,
  sourceRoots: ReadonlySet<string>,
  generatedFacadeId: string,
  generatedFacadeModules: ReadonlySet<string>,
  generatedFacadeResolutions: ReadonlyArray<SemanticProviderResolution>,
  catalog: CurrentCatalog,
  workspaceRoot: string,
  unsupportedProviderResolutionOptions: ReadonlyArray<"typeRoots" | "types">,
  sourceIdentity: string = sourceFile.fileName
): MiraiIntlSemanticEvidence {
  const cleanId = cleanModuleId(sourceIdentity);
  const virtualGeneratedFacade = generatedFacadeId;
  let evidenceSourceFiles: ReadonlyArray<ts.SourceFile>;
  if (evidenceRecords) {
    // The sealed owner batch already validated every evidence file once and
    // materialized the exact declaration/lib records. Do not walk the same
    // Program evidence map again for every source in that owner.
    evidenceSourceFiles = [];
  } else if (evidenceFiles) {
    if (!program) {
      throw new Error(
        "Sealed semantic evidence files require a TypeScript Program"
      );
    }
    evidenceSourceFiles = [...evidenceFiles].map(([path]) => {
      const file = program.getSourceFile(path);
      if (!file) {
        throw new Error(
          `Sealed semantic Program omitted evidence file ${path}`
        );
      }
      return file;
    });
  } else {
    if (!program) {
      throw new Error(
        "Semantic evidence requires records or a TypeScript Program"
      );
    }
    evidenceSourceFiles = program.getSourceFiles();
  }
  const declarationEntries = evidenceRecords
    ? []
    : evidenceSourceFiles
        .filter(
          (file) =>
            !sourceRoots.has(file.fileName) &&
            /\.d\.[cm]?ts$/u.test(file.fileName)
        )
        .map((file) => {
          const programPath = resolve(file.fileName);
          const absolute =
            programPath === virtualGeneratedFacade
              ? catalog.generatedFacadePath
              : programPath;
          return {
            absolute,
            hash:
              programPath === virtualGeneratedFacade
                ? catalog.generatedFacadeHash
                : (evidenceFiles?.get(programPath) ?? sha256(file.text)),
            path: evidencePath(workspaceRoot, absolute),
          };
        })
        .toSorted((left, right) =>
          compareCanonicalStrings(left.path, right.path)
        );
  const libs =
    evidenceRecords?.libs ??
    declarationEntries
      .filter(({ absolute }) =>
        /[/\\]typescript[/\\]lib[/\\]lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u.test(
          absolute
        )
      )
      .map(({ hash, path }) => ({ hash, path }));
  const declarations =
    evidenceRecords?.declarations ??
    declarationEntries
      .filter(
        ({ absolute }) =>
          !/[/\\]typescript[/\\]lib[/\\]lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u.test(
            absolute
          )
      )
      .map(({ hash, path }) => ({ hash, path }));
  const generatedFacadePath = evidencePath(
    workspaceRoot,
    catalog.generatedFacadePath
  );
  const canonicalGeneratedFacadeRoot = (providerRoot: string): string =>
    isSamePath(resolve(providerRoot), virtualGeneratedFacade)
      ? catalog.generatedFacadePath
      : providerRoot;
  const canonicalGeneratedFacadeResolution = (
    resolution: SemanticProviderResolution
  ): SemanticProviderResolution =>
    isSamePath(resolve(resolution.from), virtualGeneratedFacade)
      ? { ...resolution, from: catalog.generatedFacadePath }
      : resolution;
  const evidenceProviderRoots = [
    ...(generatedFacadeResolutions.length > 0
      ? [
          {
            includeDeclarations: true,
            resolutions: generatedFacadeResolutions,
            root: catalog.generatedFacadePath,
          },
        ]
      : []),
    ...providerRoots,
  ];
  const providers = mergeSemanticProviders(
    evidenceProviderRoots.map((provider) => {
      const providerRoot = canonicalGeneratedFacadeRoot(provider.root);
      const providerPath = evidencePath(workspaceRoot, resolve(providerRoot));
      const providerDirectory = dirname(providerPath).split(sep).join("/");
      const providerDeclarations = provider.includeDeclarations
        ? declarations.filter(
            (declaration) =>
              declaration.path === providerPath ||
              declaration.path.startsWith(`${providerDirectory}/`)
          )
        : [];
      let kind: "ambient" | "external" | "generated" | "workspace" =
        "kind" in provider && provider.kind === "ambient"
          ? "ambient"
          : "workspace";
      if (kind !== "ambient" && providerPath === generatedFacadePath) {
        kind = "generated";
      } else if (
        kind !== "ambient" &&
        (providerPath.startsWith("node_modules/") ||
          providerPath.includes("/node_modules/"))
      ) {
        kind = "external";
      }
      return {
        declarations: providerDeclarations,
        kind,
        resolutions: provider.resolutions.map(
          canonicalGeneratedFacadeResolution
        ),
        root: providerPath,
      };
    })
  );
  const sourcePath = evidencePath(workspaceRoot, cleanId);
  const sourceHash = sha256(sourceFile.text);
  const observedClosure = {
    ambientTypeFileLimit: 16 as const,
    declarations,
    libs,
    providerBudgetExceeded: providerBudgetExceeded !== undefined,
    providerRootLimit: 64 as const,
    providers,
    source: sourcePath,
    sourceHash,
    unsupportedProviderResolutionOptions,
  };
  return {
    ...observedClosure,
    closureHash: sha256(JSON.stringify(stableSemanticValue(observedClosure))),
  };
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  for (;;) {
    if (
      ts.isAwaitExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function literalString(expression: ts.Expression): string | undefined {
  const value = unwrapExpression(expression);
  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

function isConstAssertion(expression: ts.Expression): boolean {
  return (
    ts.isAsExpression(expression) &&
    ts.isTypeReferenceNode(expression.type) &&
    ts.isIdentifier(expression.type.typeName) &&
    expression.type.typeName.text === "const"
  );
}

function nodeKey(node: ts.Node): string {
  return `${node.pos}:${node.end}`;
}

function isDeclarationIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node)
  );
}

function analyzeSource(
  source: string,
  id: string,
  root: string,
  catalog: CurrentCatalog,
  generatedImports: GeneratedFacadeImportNames,
  workspaceRoot: string,
  authorizationEvidence?: MiraiIntlTransformOptions["authorizationEvidence"],
  semanticProgram?: SemanticProgramContext,
  ownerCompilerOptions?: ts.CompilerOptions
): Readonly<{
  imports: ReadonlyArray<
    Readonly<{ descriptor: string; local: string; module: string }>
  >;
  dynamicHelpers:
    | Readonly<{ createRegistry: string; translate: string }>
    | undefined;
  dynamicRegistries: ReadonlyArray<
    Readonly<{
      entries: ReadonlyArray<Readonly<{ key: string; local: string }>>;
      local: string;
    }>
  >;
  translationKeyParserHelper: string | undefined;
  formErrorTranslatorHelper: string | undefined;
  formSchemaHelper: string | undefined;
  removedNodes: ReadonlySet<string>;
  replacements: ReadonlyMap<string, Replacement>;
}> {
  const analysisStarted = performance.now();
  const {
    checker,
    evidenceFiles,
    evidenceRecords,
    generatedFacadeId,
    generatedFacadeResolutions,
    program,
    providerBudgetExceeded,
    providerRoots,
    sourceFile,
    sourceRoots,
    tripleSlashControls,
    unsupportedProviderResolutionOptions,
  } =
    semanticProgram ??
    createProgram(
      source,
      id,
      root,
      catalog,
      generatedImports.facadeModules,
      generatedImports.requiresCatalogContract,
      ownerCompilerOptions,
      workspaceRoot
    );
  authorizationEvidence?.record(
    semanticEvidence(
      program,
      evidenceFiles,
      evidenceRecords,
      providerBudgetExceeded,
      providerRoots,
      sourceFile,
      sourceRoots,
      generatedFacadeId,
      generatedImports.facadeModules,
      [
        ...generatedImports.facadeResolutions,
        ...(generatedFacadeResolutions ?? []),
      ].toSorted((left, right) =>
        compareCanonicalStrings(
          `${left.from}\u0000${left.specifier}`,
          `${right.from}\u0000${right.specifier}`
        )
      ),
      catalog,
      authorizationEvidence.workspaceRoot,
      unsupportedProviderResolutionOptions,
      id
    )
  );
  const evidenceRecordedAt = performance.now();
  recordSemanticPreparationProfile(
    "semantic-evidence-recording",
    evidenceRecordedAt - analysisStarted
  );
  if (tripleSlashControls > 0) {
    throw new Error(
      `${id}:1:1: Triple-slash reference controls are not supported by finite Mirai Intl semantic authorization`
    );
  }
  const factorySymbols = new Map<ts.Symbol, FactoryKind>();
  const objectSymbols = new Map<ts.Symbol, string>();
  const translationKeyFactorySymbols = new Set<ts.Symbol>();
  const translationKeyParserSymbols = new Set<ts.Symbol>();
  const formErrorTranslatorFactorySymbols = new Set<ts.Symbol>();
  const formSchemaFactorySymbols = new Set<ts.Symbol>();
  const translationKeySymbols = new Map<ts.Symbol, string>();
  const translatorSymbols = new Map<ts.Symbol, string>();
  const i18nextFactoryNames = new Set<string>();
  const i18nextInstanceNames = new Set<string>();
  const allowedTranslationKeyFactoryReferences = new Set<string>();
  const allowedTranslationKeyParserReferences = new Set<string>();
  const allowedFormErrorTranslatorFactoryReferences = new Set<string>();
  const allowedFormSchemaFactoryReferences = new Set<string>();
  const allowedTranslationKeyReferences = new Set<string>();
  const allowedTranslatorReferences = new Set<string>();
  const declaredNames = new Set<string>();
  const finiteSelectorDeclarations = new Map<ts.Symbol, ts.Expression>();
  const removedNodes = new Set<string>();
  let dynamicHelpers:
    | Readonly<{ createRegistry: string; translate: string }>
    | undefined;
  let translationKeyParserHelper: string | undefined;
  let formErrorTranslatorHelper: string | undefined;
  let formSchemaHelper: string | undefined;
  const dynamicRegistries = new Map<
    string,
    {
      complete: boolean;
      entries: Map<string, Readonly<{ key: string; local: string }>>;
      local: string;
    }
  >();

  const symbolAt = (identifier: ts.Identifier): ts.Symbol | undefined =>
    checker.getSymbolAtLocation(identifier);

  const collectFormSchemaHelperReferences = (symbol: ts.Symbol): boolean => {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "helper") {
        const expression = unwrapExpression(node.expression);
        if (ts.isIdentifier(expression) && symbolAt(expression) === symbol) {
          allowedFormSchemaFactoryReferences.add(nodeKey(expression));
          found = true;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  };

  const referenceSymbol = (
    identifier: ts.Identifier
  ): ts.Symbol | undefined => {
    if (
      ts.isShorthandPropertyAssignment(identifier.parent) &&
      identifier.parent.name === identifier
    ) {
      return (
        checker.getShorthandAssignmentValueSymbol(identifier.parent) ??
        checker.resolveName(
          identifier.text,
          identifier,
          ts.SymbolFlags.Value | ts.SymbolFlags.Alias,
          false
        ) ??
        symbolAt(identifier)
      );
    }
    return symbolAt(identifier);
  };

  const diagnostic = (node: ts.Node, message: string): never => {
    const start = node.getStart(sourceFile);
    const { character, line } = sourceFile.getLineAndCharacterOfPosition(start);
    throw new Error(`${id}:${line + 1}:${character + 1}: ${message}`);
  };

  const validateInlineFormSchemaErrorKeys = (
    build: ts.Expression,
    namespace: string,
    allowedKeys: ReadonlySet<string>
  ): void => {
    const builder = unwrapExpression(build);
    if (!ts.isArrowFunction(builder) && !ts.isFunctionExpression(builder)) {
      return;
    }

    const contextSymbols = new Set<ts.Symbol>();
    const errorSymbols = new Set<ts.Symbol>();
    for (const parameter of builder.parameters) {
      if (ts.isIdentifier(parameter.name)) {
        const symbol = symbolAt(parameter.name);
        if (symbol) {
          contextSymbols.add(symbol);
        }
        continue;
      }
      if (!ts.isObjectBindingPattern(parameter.name)) {
        continue;
      }
      for (const element of parameter.name.elements) {
        if (!ts.isIdentifier(element.name)) {
          continue;
        }
        const property = element.propertyName
          ? propertyNameText(element.propertyName)
          : element.name.text;
        if (property !== "error") {
          continue;
        }
        const symbol = symbolAt(element.name);
        if (symbol) {
          errorSymbols.add(symbol);
        }
      }
    }

    const validateErrorKey = (node: ts.CallExpression): void => {
      if (node.arguments.length !== 1) {
        diagnostic(node, "Form schema error requires exactly one literal key");
      }
      const argument = node.arguments[0];
      const key = argument ? literalString(argument) : undefined;
      if (key === undefined) {
        diagnostic(
          argument ?? node,
          "Form schema error keys must be literal registered keys"
        );
        return;
      }
      if (!allowedKeys.has(key)) {
        diagnostic(
          argument ?? node,
          `Unknown form error key ${namespace}.error.form.${key}`
        );
      }
    };

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const callee = unwrapExpression(node.expression);
        if (ts.isIdentifier(callee)) {
          const symbol = symbolAt(callee);
          if (symbol && errorSymbols.has(symbol)) {
            validateErrorKey(node);
          }
        }
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "error"
        ) {
          const context = unwrapExpression(callee.expression);
          if (ts.isIdentifier(context)) {
            const symbol = symbolAt(context);
            if (symbol && contextSymbols.has(symbol)) {
              validateErrorKey(node);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(builder.body);
  };

  const visitIdentifiers = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      declaredNames.add(node.text);
    }
    ts.forEachChild(node, visitIdentifiers);
  };
  visitIdentifiers(sourceFile);

  const collectFiniteSelectors = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isConstAssertion(node.initializer) &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const symbol = symbolAt(node.name);
      if (symbol) {
        finiteSelectorDeclarations.set(symbol, node.initializer);
      }
    }
    ts.forEachChild(node, collectFiniteSelectors);
  };
  collectFiniteSelectors(sourceFile);

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "i18next" ||
      !statement.importClause
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause.name) {
      i18nextInstanceNames.add(clause.name.text);
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      i18nextInstanceNames.add(clause.namedBindings.name.text);
      continue;
    }
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      continue;
    }
    for (const specifier of clause.namedBindings.elements) {
      if (
        (specifier.propertyName ?? specifier.name).text === "createInstance"
      ) {
        i18nextFactoryNames.add(specifier.name.text);
      }
    }
  }

  const collectI18nextInstances = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);
      const callee = ts.isCallExpression(initializer)
        ? unwrapExpression(initializer.expression)
        : undefined;
      if (
        ts.isCallExpression(initializer) &&
        callee &&
        ts.isIdentifier(callee) &&
        i18nextFactoryNames.has(callee.text)
      ) {
        i18nextInstanceNames.add(node.name.text);
      }
      if (/\bi18n\b/u.test(node.type?.getText(sourceFile) ?? "")) {
        i18nextInstanceNames.add(node.name.text);
      }
    }
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      /\bi18n\b/u.test(node.type?.getText(sourceFile) ?? "")
    ) {
      i18nextInstanceNames.add(node.name.text);
    }
    ts.forEachChild(node, collectI18nextInstances);
  };
  collectI18nextInstances(sourceFile);

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }
    const clause = statement.importClause;
    if (clause.isTypeOnly) {
      continue;
    }
    if (clause.name) {
      const kind = factoryKind(clause.name.text);
      const symbol = symbolAt(clause.name);
      if (kind && symbol) {
        factorySymbols.set(symbol, kind);
      }
    }
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      continue;
    }
    for (const specifier of clause.namedBindings.elements) {
      if (specifier.isTypeOnly) {
        continue;
      }
      const importedName = (specifier.propertyName ?? specifier.name).text;
      const kind = factoryKind(importedName);
      const symbol = symbolAt(specifier.name);
      if (kind && symbol) {
        factorySymbols.set(symbol, kind);
      }
      if (
        importedName === "createTranslationKey" &&
        generatedImports.keyFactories.has(specifier.name.text) &&
        symbol
      ) {
        translationKeyFactorySymbols.add(symbol);
        removedNodes.add(nodeKey(specifier));
      }
      if (
        importedName === "parseTranslationKey" &&
        generatedImports.keyParsers.has(specifier.name.text) &&
        symbol
      ) {
        translationKeyParserSymbols.add(symbol);
        removedNodes.add(nodeKey(specifier));
      }
      if (
        importedName === "createFormErrorTranslator" &&
        generatedImports.formErrorFactories.has(specifier.name.text) &&
        symbol
      ) {
        formErrorTranslatorFactorySymbols.add(symbol);
        removedNodes.add(nodeKey(specifier));
      }
      if (
        importedName === "createFormSchema" &&
        generatedImports.formSchemaFactories.has(specifier.name.text) &&
        symbol
      ) {
        formSchemaFactorySymbols.add(symbol);
        if (!collectFormSchemaHelperReferences(symbol)) {
          removedNodes.add(nodeKey(specifier));
        }
      }
    }
  }

  const factoryNamespace = (
    expression: ts.Expression
  ): Readonly<{ call: ts.CallExpression; namespace: string }> | undefined => {
    const value = unwrapExpression(expression);
    if (!ts.isCallExpression(value)) {
      return undefined;
    }
    const callee = unwrapExpression(value.expression);
    if (!ts.isIdentifier(callee)) {
      return undefined;
    }
    const symbol = symbolAt(callee);
    const kind = symbol ? factorySymbols.get(symbol) : undefined;
    if (!kind) {
      return undefined;
    }

    if (kind === "client") {
      if (value.arguments.length === 0) {
        return { call: value, namespace: "" };
      }
      const namespace = literalString(value.arguments[0] as ts.Expression);
      if (namespace === undefined) {
        return diagnostic(
          value.arguments[0] ?? value,
          "Dynamic useTranslations namespaces are not supported; use a literal namespace"
        );
      }
      return { call: value, namespace };
    }

    const first = value.arguments[0];
    if (!first) {
      return diagnostic(
        value,
        "getServerTranslations requires a literal namespace"
      );
    }
    const positional = literalString(first);
    if (positional !== undefined) {
      return { call: value, namespace: positional };
    }
    const optionsValue = unwrapExpression(first);
    if (!ts.isObjectLiteralExpression(optionsValue)) {
      return diagnostic(
        first,
        "Dynamic getServerTranslations namespaces are not supported; use a literal namespace"
      );
    }
    const namespaceProperty = optionsValue.properties.find(
      (property): property is ts.PropertyAssignment =>
        ts.isPropertyAssignment(property) &&
        propertyNameText(property.name) === "namespace"
    );
    if (!namespaceProperty) {
      return diagnostic(
        first,
        "getServerTranslations options require a namespace property"
      );
    }
    const namespace = literalString(namespaceProperty.initializer);
    if (namespace === undefined) {
      return diagnostic(
        namespaceProperty.initializer,
        "Dynamic getServerTranslations namespaces are not supported; use a literal namespace"
      );
    }
    return { call: value, namespace };
  };

  const objectNamespace = (expression: ts.Expression): string | undefined => {
    const value = unwrapExpression(expression);
    const factory = factoryNamespace(value);
    if (factory) {
      return factory.namespace;
    }
    if (ts.isIdentifier(value)) {
      const symbol = symbolAt(value);
      return symbol ? objectSymbols.get(symbol) : undefined;
    }
    return undefined;
  };

  const translationKeyFactoryNamespace = (
    expression: ts.Expression
  ): string | undefined => {
    const value = unwrapExpression(expression);
    if (!ts.isCallExpression(value)) {
      return undefined;
    }
    const callee = unwrapExpression(value.expression);
    if (!ts.isIdentifier(callee)) {
      return undefined;
    }
    const symbol = symbolAt(callee);
    if (!symbol || !translationKeyFactorySymbols.has(symbol)) {
      return undefined;
    }
    allowedTranslationKeyFactoryReferences.add(nodeKey(callee));
    if (value.arguments.length !== 1) {
      return diagnostic(
        value,
        "createTranslationKey requires exactly one literal namespace"
      );
    }
    const namespaceArgument = value.arguments[0];
    const namespace = namespaceArgument
      ? literalString(namespaceArgument)
      : undefined;
    if (namespace === undefined) {
      return diagnostic(
        namespaceArgument ?? value,
        "Dynamic translation-key namespaces are not supported; use a literal namespace"
      );
    }
    const prefix = `${namespace}.`;
    if (![...catalog.messages.keys()].some((path) => path.startsWith(prefix))) {
      return diagnostic(
        namespaceArgument ?? value,
        `Unknown translation namespace ${namespace}`
      );
    }
    return namespace;
  };

  const textTranslator = (expression: ts.Expression): string | undefined => {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) {
      const symbol = symbolAt(value);
      const namespace = symbol ? translatorSymbols.get(symbol) : undefined;
      if (namespace !== undefined) {
        allowedTranslatorReferences.add(nodeKey(value));
      }
      return namespace;
    }
    if (ts.isPropertyAccessExpression(value) && value.name.text === "t") {
      return objectNamespace(value.expression);
    }
    return undefined;
  };

  const bindTranslator = (name: ts.BindingName, namespace: string): boolean => {
    if (!ts.isIdentifier(name)) {
      return diagnostic(
        name,
        "Translator aliases must bind to a single identifier"
      );
    }
    const symbol = symbolAt(name);
    if (!symbol || translatorSymbols.has(symbol)) {
      return false;
    }
    translatorSymbols.set(symbol, namespace);
    return true;
  };

  const bindObject = (name: ts.BindingName, namespace: string): boolean => {
    if (ts.isIdentifier(name)) {
      const symbol = symbolAt(name);
      if (!symbol || objectSymbols.has(symbol)) {
        return false;
      }
      objectSymbols.set(symbol, namespace);
      return true;
    }
    if (!ts.isObjectBindingPattern(name)) {
      return diagnostic(name, "Translation results must use an object binding");
    }
    let changed = false;
    for (const element of name.elements) {
      let property: string | undefined;
      if (element.propertyName) {
        property = propertyNameText(element.propertyName);
      } else if (ts.isIdentifier(element.name)) {
        property = element.name.text;
      }
      if (property === "t") {
        changed = bindTranslator(element.name, namespace) || changed;
      }
    }
    return changed;
  };

  const promiseAllNamespaces = (
    expression: ts.Expression
  ): ReadonlyArray<string | undefined> | undefined => {
    const value = unwrapExpression(expression);
    if (
      !ts.isCallExpression(value) ||
      !ts.isPropertyAccessExpression(value.expression) ||
      value.expression.name.text !== "all" ||
      !ts.isIdentifier(value.expression.expression) ||
      value.expression.expression.text !== "Promise"
    ) {
      return undefined;
    }
    const array = value.arguments[0]
      ? unwrapExpression(value.arguments[0])
      : undefined;
    if (!array || !ts.isArrayLiteralExpression(array)) {
      return undefined;
    }
    return array.elements.map((element) =>
      ts.isSpreadElement(element) ? undefined : objectNamespace(element)
    );
  };

  const declarations: Array<ts.VariableDeclaration> = [];
  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      declarations.push(node);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(sourceFile);

  for (const declaration of declarations) {
    if (!declaration.initializer) {
      continue;
    }
    const namespace = translationKeyFactoryNamespace(declaration.initializer);
    if (namespace === undefined) {
      continue;
    }
    const name = ts.isIdentifier(declaration.name)
      ? declaration.name
      : diagnostic(
          declaration.name,
          "Translation-key factories must bind to one const identifier"
        );
    if (
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return diagnostic(
        name,
        "Translation-key factories must bind to one const identifier"
      );
    }
    const keySymbol =
      symbolAt(name) ??
      diagnostic(name, "Translation-key factory binding cannot be resolved");
    if (translationKeySymbols.has(keySymbol)) {
      diagnostic(name, "Translation-key factory binding cannot be resolved");
    }
    translationKeySymbols.set(keySymbol, namespace);
    removedNodes.add(nodeKey(declaration));
  }

  for (let pass = 0; pass <= declarations.length; pass += 1) {
    let changed = false;
    for (const declaration of declarations) {
      if (!declaration.initializer) {
        continue;
      }
      if (ts.isArrayBindingPattern(declaration.name)) {
        const namespaces = promiseAllNamespaces(declaration.initializer);
        if (!namespaces) {
          continue;
        }
        declaration.name.elements.forEach((element, index) => {
          const namespace = namespaces[index];
          if (namespace !== undefined && !ts.isOmittedExpression(element)) {
            changed = bindObject(element.name, namespace) || changed;
          }
        });
        continue;
      }
      const namespace = objectNamespace(declaration.initializer);
      if (namespace !== undefined) {
        changed = bindObject(declaration.name, namespace) || changed;
        continue;
      }
      const translatorNamespace = textTranslator(declaration.initializer);
      if (translatorNamespace !== undefined) {
        changed =
          bindTranslator(declaration.name, translatorNamespace) || changed;
      }
    }
    if (!changed) {
      break;
    }
  }

  const operationTarget = (
    expression: ts.Expression
  ): TranslationTarget | undefined => {
    const value = unwrapExpression(expression);
    const direct = textTranslator(value);
    if (direct !== undefined) {
      return { namespace: direct, operation: "text" };
    }
    if (!ts.isPropertyAccessExpression(value)) {
      return undefined;
    }
    const operation = value.name.text;
    if (
      operation !== "rich" &&
      operation !== "value" &&
      operation !== "dynamic" &&
      operation !== "map"
    ) {
      return undefined;
    }
    const namespace = textTranslator(value.expression);
    return namespace === undefined ? undefined : { namespace, operation };
  };

  const bindingPatternDefinesName = (
    name: ts.BindingName,
    expected: string
  ): boolean => {
    if (ts.isIdentifier(name)) {
      return name.text === expected;
    }
    return name.elements.some(
      (element) =>
        !ts.isOmittedExpression(element) &&
        bindingPatternDefinesName(element.name, expected)
    );
  };

  const typeMentionsTranslator = (
    typeNode: ts.TypeNode | undefined
  ): boolean => {
    if (!typeNode) {
      return false;
    }
    if (/Translator|TranslationFunction/u.test(typeNode.getText(sourceFile))) {
      return true;
    }
    const type = checker.getTypeFromTypeNode(typeNode);
    if (/Translator|TranslationFunction/u.test(checker.typeToString(type))) {
      return true;
    }
    for (const property of type.getProperties()) {
      const propertyType = checker.getTypeOfSymbolAtLocation(
        property,
        typeNode
      );
      if (
        /Translator|TranslationFunction/u.test(
          checker.typeToString(propertyType)
        )
      ) {
        return true;
      }
    }
    return false;
  };

  const parameterDefinesTranslatorProp = (
    parameter: ts.ParameterDeclaration,
    name: string
  ): boolean => {
    if (!bindingPatternDefinesName(parameter.name, name)) {
      return false;
    }
    if (!parameter.type) {
      return false;
    }
    if (
      /Translator|TranslationFunction/u.test(parameter.type.getText(sourceFile))
    ) {
      return true;
    }
    const type = checker.getTypeFromTypeNode(parameter.type);
    const property = type.getProperty(name);
    if (!property) {
      return typeMentionsTranslator(parameter.type);
    }
    const propertyType = checker.getTypeOfSymbolAtLocation(property, parameter);
    return /Translator|TranslationFunction/u.test(
      checker.typeToString(propertyType)
    );
  };

  const isTranslatorPropIdentifier = (identifier: ts.Identifier): boolean => {
    const symbol = symbolAt(identifier);
    if (symbol && translatorSymbols.has(symbol)) {
      return false;
    }

    let current: ts.Node | undefined = identifier.parent;
    while (current) {
      if (ts.isFunctionLike(current)) {
        for (const parameter of current.parameters) {
          if (parameterDefinesTranslatorProp(parameter, identifier.text)) {
            return true;
          }
        }
        // Nested function with its own non-Translator `t` parameter shadows outer props.
        if (
          current.parameters.some(
            (parameter) =>
              bindingPatternDefinesName(parameter.name, identifier.text) &&
              !parameterDefinesTranslatorProp(parameter, identifier.text)
          )
        ) {
          return false;
        }
      }
      current = current.parent;
    }
    return false;
  };

  const unboundTranslationCallee = (
    expression: ts.Expression
  ): ts.Node | undefined => {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value) && value.text === "t") {
      return isTranslatorPropIdentifier(value) ? value : undefined;
    }
    if (!ts.isPropertyAccessExpression(value)) {
      return undefined;
    }
    const operation = value.name.text;
    if (
      operation !== "rich" &&
      operation !== "value" &&
      operation !== "dynamic" &&
      operation !== "map"
    ) {
      return undefined;
    }
    const object = unwrapExpression(value.expression);
    if (!ts.isIdentifier(object) || object.text !== "t") {
      return undefined;
    }
    return isTranslatorPropIdentifier(object) ? object : undefined;
  };

  const isI18nextInstance = (expression: ts.Expression): boolean => {
    const unwrapped = unwrapExpression(expression);
    if (
      ts.isIdentifier(unwrapped) &&
      i18nextInstanceNames.has(unwrapped.text)
    ) {
      return true;
    }
    const type = checker.getTypeAtLocation(expression);
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (symbol?.getName() === "i18n") {
      return true;
    }
    const properties = new Set(
      type.getProperties().map((property) => property.getName())
    );
    return (
      properties.has("changeLanguage") &&
      properties.has("exists") &&
      properties.has("getResource") &&
      properties.has("init") &&
      properties.has("t")
    );
  };

  const directI18nextCallee = (
    expression: ts.Expression
  ): ts.PropertyAccessExpression | undefined => {
    const value = unwrapExpression(expression);
    if (!ts.isPropertyAccessExpression(value) || value.name.text !== "t") {
      return undefined;
    }
    const receiver = unwrapExpression(value.expression);
    const receiverCallee = ts.isCallExpression(receiver)
      ? unwrapExpression(receiver.expression)
      : undefined;
    if (
      receiverCallee &&
      ts.isPropertyAccessExpression(receiverCallee) &&
      receiverCallee.name.text === "getActiveInstance"
    ) {
      return value;
    }
    if (!isI18nextInstance(value.expression)) {
      return undefined;
    }
    return value;
  };

  const translationKeyNamespace = (
    expression: ts.Expression
  ): string | undefined => {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) {
      const symbol = symbolAt(value);
      const namespace = symbol ? translationKeySymbols.get(symbol) : undefined;
      if (namespace !== undefined) {
        allowedTranslationKeyReferences.add(nodeKey(value));
      }
      return namespace;
    }
    return translationKeyFactoryNamespace(value);
  };

  const replacements = new Map<string, Replacement>();
  const importAliases = new Map<
    string,
    Readonly<{ descriptor: string; local: string; module: string }>
  >();
  const uniqueAlias = (message: CatalogMessage): string => {
    const existing = importAliases.get(message.path);
    if (existing) {
      return existing.local;
    }
    const base = `__miraiIntlMessage${importAliases.size}`;
    let candidate = base;
    let suffix = 1;
    while (declaredNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    declaredNames.add(candidate);
    importAliases.set(message.path, {
      descriptor: message.descriptor,
      local: candidate,
      module: message.descriptorModule,
    });
    return candidate;
  };

  const uniqueName = (base: string): string => {
    let candidate = base;
    let suffix = 1;
    while (declaredNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    declaredNames.add(candidate);
    return candidate;
  };

  const ensureDynamicHelpers = (): NonNullable<typeof dynamicHelpers> => {
    dynamicHelpers ??= {
      createRegistry: uniqueName("__miraiIntlCreateDynamicTextRegistry"),
      translate: uniqueName("__miraiIntlTranslateDynamicText"),
    };
    return dynamicHelpers;
  };

  const ensureTranslationKeyParserHelper = (): string => {
    translationKeyParserHelper ??= uniqueName("__miraiIntlParseTranslationKey");
    return translationKeyParserHelper;
  };

  const dynamicRegistry = (
    namespace: string,
    selectedMessages?: ReadonlyArray<CatalogMessage>
  ): Readonly<{
    entries: Map<string, Readonly<{ key: string; local: string }>>;
    local: string;
  }> => {
    ensureDynamicHelpers();
    let registry = dynamicRegistries.get(namespace);
    if (!registry) {
      registry = {
        complete: false,
        entries: new Map(),
        local: uniqueName("__miraiIntlDynamicTextRegistry"),
      };
      dynamicRegistries.set(namespace, registry);
    }
    const messages =
      selectedMessages ??
      [...catalog.messages.values()].filter(
        (message) =>
          message.path.startsWith(`${namespace}.`) &&
          message.kind === "text" &&
          !message.hasArguments
      );
    if (selectedMessages === undefined) {
      registry.complete = true;
    }
    if (registry.complete || selectedMessages !== undefined) {
      for (const message of messages.toSorted((left, right) =>
        compareCanonicalStrings(left.path, right.path)
      )) {
        if (!registry.entries.has(message.path)) {
          registry.entries.set(message.path, {
            key: message.path,
            local: uniqueAlias(message),
          });
        }
      }
    }
    return registry;
  };

  const finiteStringKeys = (
    expression: ts.Expression
  ): ReadonlyArray<string> | undefined => {
    const collect = (value: ts.Type): ReadonlyArray<string> | undefined => {
      if ((value.flags & ts.TypeFlags.StringLiteral) !== 0) {
        return [(value as ts.StringLiteralType).value];
      }
      if (value.isUnion()) {
        const entries = value.types.map(collect);
        return entries.every(
          (entry): entry is ReadonlyArray<string> => entry !== undefined
        )
          ? entries.flat()
          : undefined;
      }
      if (value.isIntersection()) {
        for (const entry of value.types) {
          const strings = collect(entry);
          if (strings) {
            return strings;
          }
        }
      }
      return undefined;
    };
    const fromType = collect(checker.getTypeAtLocation(expression));
    if (fromType) {
      return fromType;
    }
    const value = unwrapExpression(expression);
    if (!ts.isTemplateExpression(value)) {
      return undefined;
    }
    let combinations = [value.head.text];
    const maximumCombinations = 4096;
    for (const span of value.templateSpans) {
      const spanReplacements = finiteStringKeys(span.expression);
      if (
        !spanReplacements ||
        combinations.length * spanReplacements.length > maximumCombinations
      ) {
        return undefined;
      }
      combinations = combinations.flatMap((prefix) =>
        spanReplacements.map(
          (replacement) => `${prefix}${replacement}${span.literal.text}`
        )
      );
    }
    return [...new Set(combinations)].toSorted();
  };

  const validateNamedDynamicKeys = (
    expression: ts.Expression,
    namespace: string
  ): ReadonlyArray<CatalogMessage> => {
    const keys = finiteStringKeys(expression);
    if (!keys) {
      if (providerBudgetExceeded) {
        return diagnostic(
          expression,
          `Finite translation key analysis exceeded the 64-file provider budget while resolving ${providerBudgetExceeded}`
        );
      }
      return diagnostic(
        expression,
        "Translation key expressions must be finite named-key unions or generated deferred keys; widened string and unknown values are not supported"
      );
    }
    const prefix = `${namespace}.`;
    const messages = new Map<string, CatalogMessage>();
    for (const key of keys) {
      const path = key.startsWith(prefix) ? key : `${prefix}${key}`;
      const message =
        catalog.messages.get(path) ??
        diagnostic(expression, `Unknown translation path ${path}`);
      if (message.kind !== "text") {
        diagnostic(
          expression,
          `Named translation key ${path} must be text, not ${message.kind}`
        );
      }
      if (message.hasArguments) {
        diagnostic(
          expression,
          `Named translation key ${path} cannot require arguments`
        );
      }
      messages.set(path, message);
    }
    return [...messages.values()].toSorted((left, right) =>
      compareCanonicalStrings(left.path, right.path)
    );
  };

  const finiteSelectorLiteral = (expression: ts.Expression): ts.Expression => {
    if (isConstAssertion(expression)) {
      return unwrapExpression(expression);
    }
    const value = unwrapExpression(expression);
    if (
      ts.isArrayLiteralExpression(value) ||
      ts.isObjectLiteralExpression(value)
    ) {
      return value;
    }
    if (ts.isIdentifier(value)) {
      const symbol = symbolAt(value);
      const declaration = symbol
        ? finiteSelectorDeclarations.get(symbol)
        : undefined;
      if (declaration) {
        return unwrapExpression(declaration);
      }
    }
    return diagnostic(
      expression,
      "t.map selectors must be inline or locally declared as const literals"
    );
  };

  const tupleSelector = (
    expression: ts.Expression
  ): ReadonlyArray<Readonly<{ key: string; node: ts.Node }>> => {
    const value = finiteSelectorLiteral(expression);
    if (!ts.isArrayLiteralExpression(value)) {
      return diagnostic(expression, "t.map tuple selectors must be arrays");
    }
    const seen = new Set<string>();
    return value.elements.map((element) => {
      if (ts.isSpreadElement(element)) {
        return diagnostic(element, "t.map selectors must not contain spreads");
      }
      const key = literalString(element);
      if (key === undefined) {
        return diagnostic(
          element,
          "t.map tuple entries must be string literals"
        );
      }
      if (seen.has(key)) {
        return diagnostic(element, `t.map repeats output key ${key}`);
      }
      seen.add(key);
      return { key, node: element };
    });
  };

  const selectedMessage = (
    namespace: string,
    key: string,
    node: ts.Node
  ): CatalogMessage => {
    const path = namespace ? `${namespace}.${key}` : key;
    const message = catalog.messages.get(path);
    if (!message) {
      return diagnostic(node, `Unknown translation path ${path}`);
    }
    if (message.kind !== "text") {
      return diagnostic(
        node,
        `t.map only supports text messages; ${path} is ${message.kind}`
      );
    }
    if (message.hasArguments) {
      return diagnostic(
        node,
        `t.map cannot select parameterized message ${path} without values`
      );
    }
    uniqueAlias(message);
    return message;
  };

  const mapEntries = (
    node: ts.CallExpression,
    namespace: string
  ): ReadonlyArray<MapEntry> => {
    if (node.arguments.length === 0 || node.arguments.length > 2) {
      return diagnostic(
        node,
        "t.map accepts one finite selector or two tuples"
      );
    }
    const first = node.arguments[0];
    if (!first) {
      return diagnostic(node, "t.map requires a finite selector");
    }
    if (node.arguments.length === 2) {
      const second = node.arguments[1];
      if (!second) {
        return diagnostic(node, "t.map requires a second tuple selector");
      }
      const rows = tupleSelector(first);
      const columns = tupleSelector(second);
      return rows.map((row) => ({
        key: row.key,
        nested: columns.map((column) => ({
          key: column.key,
          message: selectedMessage(
            namespace,
            `${row.key}.${column.key}`,
            column.node
          ),
        })),
      }));
    }

    const value = finiteSelectorLiteral(first);
    if (ts.isArrayLiteralExpression(value)) {
      return tupleSelector(first).map(({ key, node: entryNode }) => ({
        key,
        message: selectedMessage(namespace, key, entryNode),
      }));
    }
    if (!ts.isObjectLiteralExpression(value)) {
      return diagnostic(first, "t.map selectors must be tuples or records");
    }
    const outputKeys = new Set<string>();
    const selectedPaths = new Set<string>();
    return value.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) {
        return diagnostic(
          property,
          "t.map records allow only static property assignments"
        );
      }
      const key = propertyNameText(property.name);
      if (key === undefined || ts.isComputedPropertyName(property.name)) {
        return diagnostic(property.name, "t.map record keys must be literals");
      }
      const selectedPath = literalString(property.initializer);
      if (selectedPath === undefined) {
        return diagnostic(
          property.initializer,
          "t.map record values must be string literals"
        );
      }
      if (outputKeys.has(key)) {
        return diagnostic(property.name, `t.map repeats output key ${key}`);
      }
      if (selectedPaths.has(selectedPath)) {
        return diagnostic(
          property.initializer,
          `t.map repeats selected path ${selectedPath}`
        );
      }
      outputKeys.add(key);
      selectedPaths.add(selectedPath);
      return {
        key,
        message: selectedMessage(namespace, selectedPath, property.initializer),
      };
    });
  };

  const visitCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const parserExpression = unwrapExpression(node.expression);
      const parserSymbol = ts.isIdentifier(parserExpression)
        ? symbolAt(parserExpression)
        : undefined;
      if (parserSymbol && translationKeyParserSymbols.has(parserSymbol)) {
        allowedTranslationKeyParserReferences.add(nodeKey(parserExpression));
        if (node.arguments.length !== 2) {
          diagnostic(
            node,
            "parseTranslationKey requires one literal namespace and one input"
          );
        }
        const namespaceArgument = node.arguments[0];
        const namespace =
          (namespaceArgument ? literalString(namespaceArgument) : undefined) ??
          diagnostic(
            namespaceArgument ?? node,
            "parseTranslationKey requires a literal namespace"
          );
        const prefix = `${namespace}.`;
        if (
          ![...catalog.messages.keys()].some((path) => path.startsWith(prefix))
        ) {
          diagnostic(
            namespaceArgument ?? node,
            `Unknown translation namespace ${namespace}`
          );
        }
        const registry = dynamicRegistry(namespace);
        ensureTranslationKeyParserHelper();
        replacements.set(nodeKey(node), {
          kind: "parse",
          namespace,
          registry: registry.local,
        });
        ts.forEachChild(node, visitCalls);
        return;
      }
      if (parserSymbol && formErrorTranslatorFactorySymbols.has(parserSymbol)) {
        allowedFormErrorTranslatorFactoryReferences.add(
          nodeKey(parserExpression)
        );
        if (node.arguments.length !== 2) {
          diagnostic(
            node,
            "createFormErrorTranslator requires one literal namespace and one translator"
          );
        }
        const namespaceArgument = node.arguments[0];
        const namespace =
          (namespaceArgument ? literalString(namespaceArgument) : undefined) ??
          diagnostic(
            namespaceArgument ?? node,
            "createFormErrorTranslator requires a literal namespace"
          );
        if (
          ![...catalog.messages.keys()].some((path) =>
            path.startsWith(`${namespace}.`)
          )
        ) {
          diagnostic(
            namespaceArgument ?? node,
            `Unknown translation namespace ${namespace}`
          );
        }
        const formMessages = [...catalog.messages.values()].filter(
          (message) =>
            message.path.startsWith(`${namespace}.error.form.`) &&
            message.kind === "text" &&
            !message.hasArguments
        );
        const translator =
          node.arguments[1] ??
          diagnostic(node, "createFormErrorTranslator requires a translator");
        const translatorIdentifier = unwrapExpression(translator);
        if (ts.isIdentifier(translatorIdentifier)) {
          allowedTranslatorReferences.add(nodeKey(translatorIdentifier));
        }
        const registry = dynamicRegistry(namespace, formMessages);
        formErrorTranslatorHelper ??= uniqueName(
          "__miraiIntlCreateFormErrorTranslator"
        );
        replacements.set(nodeKey(node), {
          kind: "form-error",
          namespace,
          registry: registry.local,
          translator,
        });
        ts.forEachChild(node, visitCalls);
        return;
      }
      if (parserSymbol && formSchemaFactorySymbols.has(parserSymbol)) {
        allowedFormSchemaFactoryReferences.add(nodeKey(parserExpression));
        if (node.arguments.length !== 2) {
          diagnostic(
            node,
            "createFormSchema requires one literal namespace and one schema builder"
          );
        }
        const namespaceArgument = node.arguments[0];
        const namespace =
          (namespaceArgument ? literalString(namespaceArgument) : undefined) ??
          diagnostic(
            namespaceArgument ?? node,
            "createFormSchema requires a literal namespace"
          );
        const formMessages = [...catalog.messages.values()].filter(
          (message) =>
            message.path.startsWith(`${namespace}.error.form.`) &&
            message.kind === "text" &&
            !message.hasArguments
        );
        if (formMessages.length === 0) {
          diagnostic(
            namespaceArgument ?? node,
            `Translation namespace ${namespace} has no argument-free error.form messages`
          );
        }
        const build =
          node.arguments[1] ??
          diagnostic(node, "createFormSchema requires a schema builder");
        const formPrefix = `${namespace}.error.form.`;
        validateInlineFormSchemaErrorKeys(
          build,
          namespace,
          new Set(
            formMessages.map((message) => message.path.slice(formPrefix.length))
          )
        );
        const registry = dynamicRegistry(namespace, formMessages);
        formSchemaHelper ??= uniqueName("__miraiIntlCreateCompilerFormSchema");
        replacements.set(nodeKey(node), {
          build,
          kind: "form-schema",
          namespace,
          registry: registry.local,
        });
        ts.forEachChild(node, visitCalls);
        return;
      }
      const keyNamespace = translationKeyNamespace(node.expression);
      if (keyNamespace !== undefined) {
        if (node.arguments.length !== 1) {
          diagnostic(
            node,
            "A deferred translation key requires exactly one literal key"
          );
        }
        const keyArgument = node.arguments[0];
        const key = keyArgument ? literalString(keyArgument) : undefined;
        if (key === undefined) {
          diagnostic(
            keyArgument ?? node,
            "Dynamic deferred translation keys are not supported; use a literal key"
          );
        }
        const path = `${keyNamespace}.${key}`;
        const message =
          catalog.messages.get(path) ??
          diagnostic(keyArgument ?? node, `Unknown translation path ${path}`);
        if (message.kind !== "text") {
          diagnostic(
            keyArgument ?? node,
            `Deferred translation key ${path} must be text, not ${message.kind}`
          );
        }
        if (message.hasArguments) {
          diagnostic(
            keyArgument ?? node,
            `Deferred translation key ${path} cannot require arguments`
          );
        }
        replacements.set(nodeKey(node), { kind: "literal", value: path });
        ts.forEachChild(node, visitCalls);
        return;
      }
      const target = operationTarget(node.expression);
      if (target) {
        if (target.operation === "dynamic") {
          diagnostic(
            node,
            "t.dynamic is unavailable because this catalog has no namespace-partitioned dynamic registry"
          );
        }
        if (target.operation === "map") {
          replacements.set(nodeKey(node), {
            entries: mapEntries(node, target.namespace),
            kind: "map",
          });
          ts.forEachChild(node, visitCalls);
          return;
        }
        const keyArgument = node.arguments[0];
        const key = keyArgument ? literalString(keyArgument) : undefined;
        if (key === undefined) {
          if (target.operation !== "text") {
            return diagnostic(
              keyArgument ?? node,
              "Dynamic translation keys are supported only for direct t(...) calls"
            );
          }
          if (!target.namespace) {
            return diagnostic(
              keyArgument ?? node,
              "Dynamic translation keys require a literal non-root namespace"
            );
          }
          if (node.arguments.length !== 1) {
            return diagnostic(
              node,
              "Dynamic translation calls require exactly one argument"
            );
          }
          const selectedMessages = validateNamedDynamicKeys(
            keyArgument ??
              diagnostic(node, "Dynamic translation calls require a key"),
            target.namespace
          );
          const registry = dynamicRegistry(target.namespace, selectedMessages);
          replacements.set(nodeKey(node), {
            kind: "dynamic",
            namespace: target.namespace,
            registry: registry.local,
          });
          ts.forEachChild(node, visitCalls);
          return;
        }
        const path = target.namespace ? `${target.namespace}.${key}` : key;
        const message = catalog.messages.get(path);
        if (!message) {
          return diagnostic(
            keyArgument ?? node,
            `Unknown translation path ${path}`
          );
        }
        if (message.kind !== target.operation) {
          const required = message.kind === "text" ? "t" : `t.${message.kind}`;
          diagnostic(
            node,
            `Translation call ${path} requires ${required} but ${key} is a ${message.kind} message`
          );
        }
        replacements.set(nodeKey(node), {
          kind: "message",
          local: uniqueAlias(message),
        });
      } else {
        const directI18next = directI18nextCallee(node.expression);
        if (directI18next) {
          diagnostic(
            directI18next,
            "Direct i18next.t(...) is not type-safe; use a generated useTranslations()/getServerTranslations() binding"
          );
        }
        const unbound = unboundTranslationCallee(node.expression);
        if (unbound) {
          diagnostic(
            unbound,
            "Translation call must use a useTranslations()/getServerTranslations() binding in this module"
          );
        }
      }
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sourceFile);

  const validateTranslatorReferences = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = referenceSymbol(node);
      const dependencyArray = ts.isArrayLiteralExpression(node.parent)
        ? node.parent
        : undefined;
      const dependencyCall =
        dependencyArray && ts.isCallExpression(dependencyArray.parent)
          ? dependencyArray.parent
          : undefined;
      const dependencyCallee = dependencyCall
        ? unwrapExpression(dependencyCall.expression)
        : undefined;
      let dependencyHook: string | undefined;
      if (dependencyCallee && ts.isIdentifier(dependencyCallee)) {
        dependencyHook = dependencyCallee.text;
      } else if (
        dependencyCallee &&
        ts.isPropertyAccessExpression(dependencyCallee)
      ) {
        dependencyHook = dependencyCallee.name.text;
      }
      const isDependency = Boolean(
        dependencyArray &&
        dependencyCall?.arguments.at(-1) === dependencyArray &&
        dependencyHook &&
        reactDependencyHooks.has(dependencyHook)
      );
      if (
        symbol &&
        translatorSymbols.has(symbol) &&
        !isDeclarationIdentifier(node) &&
        !isDependency &&
        !allowedTranslatorReferences.has(nodeKey(node))
      ) {
        diagnostic(
          node,
          `Translator binding ${node.text} escapes the supported call syntax`
        );
      }
      if (
        symbol &&
        translationKeySymbols.has(symbol) &&
        !isDeclarationIdentifier(node) &&
        !(ts.isTypeQueryNode(node.parent) && node.parent.exprName === node) &&
        !allowedTranslationKeyReferences.has(nodeKey(node))
      ) {
        diagnostic(
          node,
          `Translation-key binding ${node.text} escapes the supported call syntax`
        );
      }
      if (
        symbol &&
        translationKeyFactorySymbols.has(symbol) &&
        !isDeclarationIdentifier(node) &&
        !allowedTranslationKeyFactoryReferences.has(nodeKey(node))
      ) {
        diagnostic(
          node,
          `createTranslationKey escapes the supported generated-factory syntax`
        );
      }
      if (
        symbol &&
        translationKeyParserSymbols.has(symbol) &&
        !isDeclarationIdentifier(node) &&
        !allowedTranslationKeyParserReferences.has(nodeKey(node))
      ) {
        diagnostic(
          node,
          `parseTranslationKey escapes the supported generated-parser syntax`
        );
      }
      if (
        symbol &&
        formErrorTranslatorFactorySymbols.has(symbol) &&
        !isDeclarationIdentifier(node) &&
        !allowedFormErrorTranslatorFactoryReferences.has(nodeKey(node))
      ) {
        diagnostic(
          node,
          "createFormErrorTranslator escapes the supported generated-factory syntax"
        );
      }
      if (
        symbol &&
        formSchemaFactorySymbols.has(symbol) &&
        !isDeclarationIdentifier(node) &&
        !allowedFormSchemaFactoryReferences.has(nodeKey(node))
      ) {
        diagnostic(
          node,
          "createFormSchema escapes the supported generated-factory syntax"
        );
      }
    }
    ts.forEachChild(node, validateTranslatorReferences);
  };
  if (
    translatorSymbols.size > 0 ||
    translationKeySymbols.size > 0 ||
    translationKeyFactorySymbols.size > 0 ||
    translationKeyParserSymbols.size > 0 ||
    formErrorTranslatorFactorySymbols.size > 0 ||
    formSchemaFactorySymbols.size > 0
  ) {
    validateTranslatorReferences(sourceFile);
  }

  recordSemanticPreparationProfile(
    "semantic-source-analysis",
    performance.now() - evidenceRecordedAt
  );

  return {
    dynamicHelpers,
    dynamicRegistries: [...dynamicRegistries.entries()]
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([, registry]) => ({
        entries: [...registry.entries.values()].toSorted((left, right) =>
          compareCanonicalStrings(left.key, right.key)
        ),
        local: registry.local,
      })),
    imports: [...importAliases.values()].toSorted((left, right) => {
      if (left.module === right.module) {
        return 0;
      }
      return left.module < right.module ? -1 : 1;
    }),
    removedNodes,
    replacements,
    formErrorTranslatorHelper,
    formSchemaHelper,
    translationKeyParserHelper,
  };
}

function moduleSpecifier(fromFile: string, moduleFile: string): string {
  const path = relative(dirname(fromFile), moduleFile).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function stripSourceMapComment(code: string): string {
  return code.replace(/\n?\/\/# sourceMappingURL=.*?(?:\r?\n|$)/u, "\n");
}

function transformSource(
  source: string,
  id: string,
  analysis: ReturnType<typeof analyzeSource>,
  privateCarrierPath: string
): Omit<MiraiIntlTransformResult, "dependencies"> {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      inlineSources: true,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      newLine: ts.NewLineKind.LineFeed,
      sourceMap: true,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: true,
    },
    fileName: id,
    transformers: {
      before: [
        (context) => {
          const { factory } = context;
          const mapObject = (
            translator: ts.Expression,
            entries: ReadonlyArray<MapEntry>
          ): ts.Expression =>
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createIdentifier("Object"),
                "freeze"
              ),
              undefined,
              [
                factory.createObjectLiteralExpression(
                  entries.map((entry) => {
                    const value = entry.nested
                      ? mapObject(translator, entry.nested)
                      : factory.createCallExpression(translator, undefined, [
                          factory.createIdentifier(
                            analysis.imports.find(
                              ({ descriptor }) =>
                                descriptor === entry.message?.descriptor
                            )?.local ?? "__miraiIntlMissingMessage"
                          ),
                        ]);
                    return factory.createPropertyAssignment(
                      factory.createComputedPropertyName(
                        factory.createStringLiteral(entry.key)
                      ),
                      value
                    );
                  }),
                  true
                ),
              ]
            );
          const visitor: ts.Visitor = (node) => {
            if (
              ts.isImportDeclaration(node) &&
              node.importClause?.namedBindings &&
              ts.isNamedImports(node.importClause.namedBindings)
            ) {
              const elements = node.importClause.namedBindings.elements.filter(
                (specifier) => !analysis.removedNodes.has(nodeKey(specifier))
              );
              if (
                elements.length !==
                node.importClause.namedBindings.elements.length
              ) {
                if (elements.length === 0 && !node.importClause.name) {
                  return undefined;
                }
                const bindings = factory.updateNamedImports(
                  node.importClause.namedBindings,
                  elements
                );
                const clause = factory.updateImportClause(
                  node.importClause,
                  node.importClause.isTypeOnly,
                  node.importClause.name,
                  bindings
                );
                return factory.updateImportDeclaration(
                  node,
                  node.modifiers,
                  clause,
                  node.moduleSpecifier,
                  node.attributes
                );
              }
            }
            if (ts.isVariableStatement(node)) {
              const declarations = node.declarationList.declarations.filter(
                (declaration) =>
                  !analysis.removedNodes.has(nodeKey(declaration))
              );
              if (
                declarations.length !== node.declarationList.declarations.length
              ) {
                if (declarations.length === 0) {
                  return undefined;
                }
                return factory.updateVariableStatement(
                  node,
                  node.modifiers,
                  factory.updateVariableDeclarationList(
                    node.declarationList,
                    declarations
                  )
                );
              }
            }
            if (ts.isCallExpression(node)) {
              const replacement = analysis.replacements.get(nodeKey(node));
              if (replacement?.kind === "dynamic") {
                const helpers = analysis.dynamicHelpers;
                if (!helpers) {
                  throw new Error("Dynamic translation helpers are missing");
                }
                return factory.createCallExpression(
                  factory.createIdentifier(helpers.translate),
                  undefined,
                  [
                    node.expression,
                    ts.visitNode(
                      node.arguments[0] as ts.Expression,
                      visitor
                    ) as ts.Expression,
                    factory.createStringLiteral(replacement.namespace),
                    factory.createIdentifier(replacement.registry),
                  ]
                );
              }
              if (replacement?.kind === "form-error") {
                const helper = analysis.formErrorTranslatorHelper;
                if (!helper) {
                  throw new Error("Form error translator helper is missing");
                }
                return factory.createCallExpression(
                  factory.createIdentifier(helper),
                  undefined,
                  [
                    ts.visitNode(
                      replacement.translator,
                      visitor
                    ) as ts.Expression,
                    factory.createStringLiteral(replacement.namespace),
                    factory.createIdentifier(replacement.registry),
                  ]
                );
              }
              if (replacement?.kind === "form-schema") {
                const helper = analysis.formSchemaHelper;
                if (!helper) {
                  throw new Error("Form schema helper is missing");
                }
                return factory.createCallExpression(
                  factory.createIdentifier(helper),
                  undefined,
                  [
                    factory.createStringLiteral(replacement.namespace),
                    factory.createIdentifier(replacement.registry),
                    ts.visitNode(replacement.build, visitor) as ts.Expression,
                  ]
                );
              }
              if (replacement?.kind === "parse") {
                const helper = analysis.translationKeyParserHelper;
                if (!helper) {
                  throw new Error("Translation key parser helper is missing");
                }
                return factory.createCallExpression(
                  factory.createIdentifier(helper),
                  undefined,
                  [
                    ts.visitNode(
                      node.arguments[1] as ts.Expression,
                      visitor
                    ) as ts.Expression,
                    factory.createStringLiteral(replacement.namespace),
                    factory.createIdentifier(replacement.registry),
                  ]
                );
              }
              if (replacement?.kind === "literal") {
                return factory.createStringLiteral(replacement.value);
              }
              if (replacement?.kind === "message") {
                return factory.updateCallExpression(
                  node,
                  node.expression,
                  node.typeArguments,
                  [
                    factory.createIdentifier(replacement.local),
                    ...node.arguments
                      .slice(1)
                      .map(
                        (argument) =>
                          ts.visitNode(argument, visitor) as ts.Expression
                      ),
                  ]
                );
              }
              if (
                replacement?.kind === "map" &&
                ts.isPropertyAccessExpression(node.expression)
              ) {
                return mapObject(
                  node.expression.expression,
                  replacement.entries
                );
              }
            }
            return ts.visitEachChild(node, visitor, context);
          };
          return (sourceFile) => {
            const visited = ts.visitEachChild(sourceFile, visitor, context);
            const importsByModule = new Map<
              string,
              Array<(typeof analysis.imports)[number]>
            >();
            for (const imported of analysis.imports) {
              const entries = importsByModule.get(imported.module) ?? [];
              entries.push(imported);
              importsByModule.set(imported.module, entries);
            }
            const importDeclarations = [...importsByModule.entries()].map(
              ([, imports]) =>
                factory.createImportDeclaration(
                  undefined,
                  factory.createImportClause(
                    false,
                    undefined,
                    factory.createNamedImports(
                      imports.map(({ descriptor, local }) =>
                        factory.createImportSpecifier(
                          false,
                          factory.createIdentifier(descriptor),
                          factory.createIdentifier(local)
                        )
                      )
                    )
                  ),
                  factory.createStringLiteral(
                    privateMessageSliceSpecifier(
                      moduleSpecifier(id, privateCarrierPath),
                      imports.map(({ descriptor }) => descriptor)
                    )
                  )
                )
            );
            if (analysis.dynamicHelpers) {
              const runtimeSpecifiers = [
                factory.createImportSpecifier(
                  false,
                  factory.createIdentifier("createCompilerDynamicTextRegistry"),
                  factory.createIdentifier(
                    analysis.dynamicHelpers.createRegistry
                  )
                ),
              ];
              if (
                [...analysis.replacements.values()].some(
                  (replacement) => replacement.kind === "dynamic"
                )
              ) {
                runtimeSpecifiers.push(
                  factory.createImportSpecifier(
                    false,
                    factory.createIdentifier("translateCompilerDynamicText"),
                    factory.createIdentifier(analysis.dynamicHelpers.translate)
                  )
                );
              }
              if (analysis.translationKeyParserHelper) {
                runtimeSpecifiers.push(
                  factory.createImportSpecifier(
                    false,
                    factory.createIdentifier("parseCompilerTranslationKey"),
                    factory.createIdentifier(
                      analysis.translationKeyParserHelper
                    )
                  )
                );
              }
              if (analysis.formErrorTranslatorHelper) {
                runtimeSpecifiers.push(
                  factory.createImportSpecifier(
                    false,
                    factory.createIdentifier(
                      "createCompilerFormErrorTranslator"
                    ),
                    factory.createIdentifier(analysis.formErrorTranslatorHelper)
                  )
                );
              }
              if (analysis.formSchemaHelper) {
                runtimeSpecifiers.push(
                  factory.createImportSpecifier(
                    false,
                    factory.createIdentifier("createCompilerFormSchema"),
                    factory.createIdentifier(analysis.formSchemaHelper)
                  )
                );
              }
              importDeclarations.push(
                factory.createImportDeclaration(
                  undefined,
                  factory.createImportClause(
                    false,
                    undefined,
                    factory.createNamedImports(runtimeSpecifiers)
                  ),
                  factory.createStringLiteral("@openmirai/intl/runtime")
                )
              );
            }
            const registryFactory = analysis.dynamicHelpers?.createRegistry;
            const dynamicRegistryDeclarations = registryFactory
              ? analysis.dynamicRegistries.map((registry) => {
                  const initializer = factory.createCallExpression(
                    factory.createIdentifier(registryFactory),
                    undefined,
                    [
                      factory.createObjectLiteralExpression(
                        registry.entries.map((entry) =>
                          factory.createPropertyAssignment(
                            factory.createComputedPropertyName(
                              factory.createStringLiteral(entry.key)
                            ),
                            factory.createIdentifier(entry.local)
                          )
                        ),
                        true
                      ),
                    ]
                  );
                  ts.addSyntheticLeadingComment(
                    initializer,
                    ts.SyntaxKind.MultiLineCommentTrivia,
                    " @__PURE__ ",
                    false
                  );
                  return factory.createVariableStatement(
                    undefined,
                    factory.createVariableDeclarationList(
                      [
                        factory.createVariableDeclaration(
                          factory.createIdentifier(registry.local),
                          undefined,
                          undefined,
                          initializer
                        ),
                      ],
                      ts.NodeFlags.Const
                    )
                  );
                })
              : [];
            const statements = [...visited.statements];
            let directiveEnd = 0;
            for (;;) {
              const statement = statements[directiveEnd];
              if (
                !statement ||
                !ts.isExpressionStatement(statement) ||
                !ts.isStringLiteral(statement.expression)
              ) {
                break;
              }
              directiveEnd += 1;
            }
            statements.splice(
              directiveEnd,
              0,
              ...importDeclarations,
              ...dynamicRegistryDeclarations
            );
            return factory.updateSourceFile(visited, statements);
          };
        },
      ],
    },
  });
  if (!result.sourceMapText) {
    throw new Error("TypeScript did not emit a source map for intl lowering");
  }
  const mapValue = parseJson(result.sourceMapText, "TypeScript source map");
  if (
    !isRecord(mapValue) ||
    mapValue.version !== 3 ||
    typeof mapValue.mappings !== "string" ||
    !Array.isArray(mapValue.names)
  ) {
    throw new Error("TypeScript emitted an invalid source map");
  }
  const map = {
    ...mapValue,
    sources: [id],
    sourcesContent: [source],
    version: 3,
  } as unknown as MiraiIntlSourceMap;
  return { code: stripSourceMapComment(result.outputText), map };
}

async function transformMiraiIntlSourceWithCatalog(
  source: string,
  id: string,
  options: MiraiIntlTransformOptions,
  catalog: CurrentCatalog,
  semanticProgram?: SemanticProgramContext,
  ownerCompilerOptions?: ts.CompilerOptions,
  preparedGeneratedImports?: GeneratedFacadeImportNames,
  preparedSourceFile?: ts.SourceFile,
  analysisOnly = false
): Promise<MiraiIntlTransformResult | null> {
  const cleanId = cleanModuleId(id);
  const root = resolve(options.root ?? process.cwd());
  const workspaceRoot =
    options.authorizationEvidence?.workspaceRoot ??
    options.workspaceRoot ??
    root;
  if (
    !options.authorizationEvidence &&
    !isMiraiIntlTransformCandidate(source, cleanId)
  ) {
    return null;
  }
  if (
    !options.authorizationEvidence &&
    !isWithin(
      normalizedSemanticPath(workspaceRoot),
      normalizedSemanticPath(cleanId)
    )
  ) {
    return null;
  }
  if (
    !options.authorizationEvidence &&
    !requiresMiraiIntlAnalysis(source, cleanId, preparedSourceFile)
  ) {
    return null;
  }
  if (
    cleanId === catalog.selectedDirectory ||
    cleanId.startsWith(`${catalog.selectedDirectory}${sep}`)
  ) {
    return null;
  }
  const generatedImports =
    preparedGeneratedImports ??
    (await generatedFacadeImportNames(
      source,
      cleanId,
      root,
      catalog.generatedFacadePath,
      undefined,
      workspaceRoot,
      preparedSourceFile
    ));
  const analysis = analyzeSource(
    source,
    cleanId,
    root,
    catalog,
    generatedImports,
    workspaceRoot,
    options.authorizationEvidence,
    semanticProgram,
    ownerCompilerOptions
  );
  if (analysis.replacements.size === 0 && analysis.removedNodes.size === 0) {
    return null;
  }
  await Promise.all(
    analysis.imports.map(({ module }) =>
      assertConfinedRegularFile(
        catalog.selectedCanonicalDirectory,
        module,
        "Generated private message module",
        "selected catalog directory"
      )
    )
  );
  if (analysisOnly) {
    return null;
  }
  const transformed = transformSource(
    source,
    cleanId,
    analysis,
    catalog.privateCarrierPath
  );
  return {
    ...transformed,
    dependencies: [...catalog.dependencies].toSorted(),
  };
}

export async function transformMiraiIntlSource(
  source: string,
  id: string,
  options: MiraiIntlTransformOptions = {}
): Promise<MiraiIntlTransformResult | null> {
  return transformMiraiIntlSourceWithCatalog(
    source,
    id,
    options,
    await loadCurrentCatalog(options)
  );
}

/**
 * Analyze an exact owner batch. Safe external modules with compatible sealed
 * provider, library, and type-reference closures share a checker. Global
 * scripts, augmentations, triple-slash-controlled sources, and reference-mode
 * analyses retain an isolated finite Program per source.
 */
export async function transformMiraiIntlOwnerBatch(
  sources: ReadonlyArray<MiraiIntlSemanticBatchSource>,
  options: Omit<MiraiIntlTransformOptions, "authorizationEvidence"> = {},
  observe?: (observation: MiraiIntlSemanticBatchObservation) => void,
  forceFiniteClosure = false,
  owner: Readonly<{
    compilerOptions: ts.CompilerOptions;
  }> = { compilerOptions: {} },
  analysisOnly = false
): Promise<ReadonlyArray<MiraiIntlSemanticBatchResult>> {
  const profileStarted = performance.now();
  if (process.env.MIRAI_INTL_INTERNAL_TRANSFORM_PROFILE === "1") {
    semanticPreparationProfile.clear();
  }
  let profilePrior = profileStarted;
  const profilePhases: Array<
    Readonly<{ milliseconds: number; phase: string }>
  > = [];
  const markProfilePhase = (phase: string): void => {
    if (process.env.MIRAI_INTL_INTERNAL_TRANSFORM_PROFILE !== "1") {
      return;
    }
    const now = performance.now();
    profilePhases.push({ milliseconds: now - profilePrior, phase });
    profilePrior = now;
  };
  if (sources.length === 0) {
    observe?.({
      fallbackFiles: 0,
      fallbackPrograms: 0,
      sharedFiles: 0,
      sharedPrograms: 0,
    });
    return [];
  }
  const catalog = await loadCurrentCatalog(options);
  const candidateSources = sources;
  const normalizedPaths = new Map<string, string>();
  const ownerSourceIdentities = candidateSources.map((entry) => {
    const lexical = resolve(cleanModuleId(entry.id));
    return {
      canonical: normalizedSemanticPath(lexical, { normalizedPaths }),
      lexical,
    };
  });
  const preparationCache: SemanticPreparationCache = {
    declarationInterference: new Map(),
    directoryModuleFrontiers: new Map(),
    generatedFacades: new Map(),
    libraries: new Map(),
    moduleFrontiers: new Map(),
    moduleSpecifiers: new Map(),
    normalizedPaths,
    ownerOccupancy: semanticOwnerOccupancyIndex(ownerSourceIdentities),
    packageFiles: new Map(),
    parsedFiles: new Map(),
    preprocessedFiles: new Map(),
    realpathIdentities: new Map(),
    resolvedModules: new Map(),
    resolvedTypes: new Map(),
    sealedFiles: new Map(),
    semanticFileHashes: new Map(),
    semanticFiles: new Map(),
    typeFrontiers: new Map(),
  };
  const root = resolve(options.root ?? process.cwd());
  const sourcePlans = candidateSources.map((entry, index) => {
    const cleanId = ownerSourceIdentities[index]?.canonical;
    if (!cleanId) {
      throw new Error(`Missing semantic owner source identity for ${entry.id}`);
    }
    const sourceFile = parsedSemanticSourceFile(
      entry.source,
      cleanId,
      preparationCache,
      entry.sourceFile
    );
    const safe = isSafeSharedSemanticSourceFile(sourceFile);
    const mappedNonliteral = hasMappedNonliteralTranslationKey(sourceFile);
    const finiteModules = finiteDependencyModules(sourceFile);
    const inert =
      !forceFiniteClosure &&
      safe &&
      !mappedNonliteral &&
      finiteModules.size === 0 &&
      !hasPotentialGeneratedFacadeImport(
        sourceFile,
        cleanId,
        owner.compilerOptions,
        catalog.generatedFacadePath
      ) &&
      (owner.compilerOptions.types?.length ?? 0) === 0 &&
      (owner.compilerOptions.typeRoots?.length ?? 0) === 0;
    return {
      cleanId,
      entry,
      finiteModules,
      inert,
      mappedNonliteral,
      noProgram:
        inert && !requiresMiraiIntlAnalysis(entry.source, cleanId, sourceFile),
      safe,
      sourceFile,
    };
  });
  markProfilePhase("source-plans");
  const isolatedIds = new Set(
    sourcePlans
      .filter(({ safe }) => forceFiniteClosure || !safe)
      .map(({ cleanId }) => cleanId)
  );
  const preparationErrors = new Map<string, unknown>();
  const inertPlans = sourcePlans.filter(({ inert }) => inert);
  const noProgramInertPlans = inertPlans.filter(({ noProgram }) => noProgram);
  const programInertPlans = inertPlans.filter(({ noProgram }) => !noProgram);
  const preparedInert: Array<PreparedSemanticClosure> = [];
  const noProgramResults = new Map<string, MiraiIntlSemanticBatchResult>();
  const firstInert = programInertPlans[0] ?? noProgramInertPlans[0];
  if (firstInert) {
    try {
      const generatedImports: GeneratedFacadeImportNames = {
        facadeModules: new Set(),
        facadeResolutions: [],
        formErrorFactories: new Set(),
        formSchemaFactories: new Set(),
        keyFactories: new Set(),
        keyParsers: new Set(),
        requiresCatalogContract: false,
        requiresFullFacade: false,
        translationKeyTypes: new Set(),
        translationNamespaceTypes: new Set(),
      };
      const template = prepareSealedSemanticClosure(
        firstInert.entry.source,
        firstInert.cleanId,
        root,
        catalog,
        generatedImports,
        owner.compilerOptions,
        firstInert.entry.authorizationEvidence.workspaceRoot,
        preparationCache,
        firstInert.sourceFile,
        firstInert.finiteModules
      );
      for (const plan of programInertPlans) {
        preparedInert.push(
          plan.cleanId === template.id
            ? template
            : cloneInertSemanticClosure(
                template,
                plan.entry.source,
                plan.cleanId,
                plan.sourceFile
              )
        );
      }
      for (const plan of noProgramInertPlans) {
        const closure =
          plan.cleanId === template.id
            ? template
            : cloneInertSemanticClosure(
                template,
                plan.entry.source,
                plan.cleanId,
                plan.sourceFile
              );
        const sourceRoots = new Set([closure.id]);
        plan.entry.authorizationEvidence.record(
          semanticEvidence(
            undefined,
            undefined,
            semanticEvidenceRecords(closure, catalog, sourceRoots),
            closure.providerBudgetExceeded,
            closure.providerRoots,
            plan.sourceFile,
            sourceRoots,
            closure.generatedFacadeId,
            closure.generatedImports.facadeModules,
            closure.generatedImports.facadeResolutions,
            catalog,
            closure.workspaceRoot,
            closure.unsupportedProviderResolutionOptions,
            plan.entry.id
          )
        );
        noProgramResults.set(closure.id, {
          id: plan.entry.id,
          result: null,
        });
      }
    } catch (error) {
      for (const plan of inertPlans) {
        preparationErrors.set(plan.cleanId, error);
      }
    }
  }
  markProfilePhase("inert-closures");
  const activeSelections = (
    await Promise.all(
      sourcePlans
        .filter(({ inert }) => !inert)
        .map(
          async (
            plan
          ): Promise<
            | Readonly<{
                generatedImports: GeneratedFacadeImportNames;
                namespaces: ReadonlySet<string> | undefined;
                plan: (typeof sourcePlans)[number];
              }>
            | undefined
          > => {
            const {
              cleanId,
              entry: {
                authorizationEvidence,
                classifierFacadeResolutions,
                source,
              },
              sourceFile,
            } = plan;
            try {
              const generatedImports = await generatedFacadeImportNames(
                source,
                cleanId,
                root,
                catalog.generatedFacadePath,
                owner.compilerOptions,
                authorizationEvidence.workspaceRoot,
                sourceFile,
                classifierFacadeResolutions
              );
              return {
                generatedImports,
                namespaces: generatedFacadeSliceNamespaces(
                  sourceFile,
                  generatedImports
                ),
                plan,
              };
            } catch (error) {
              preparationErrors.set(cleanId, error);
              return undefined;
            }
          }
        )
    )
  ).filter(
    (selection): selection is NonNullable<typeof selection> =>
      selection !== undefined
  );
  markProfilePhase("active-import-selection");
  let sharedNamespaces: Set<string> | undefined = new Set<string>();
  for (const { namespaces } of activeSelections) {
    if (namespaces === undefined) {
      sharedNamespaces = undefined;
      break;
    }
    for (const namespace of namespaces) {
      sharedNamespaces.add(namespace);
    }
  }
  const sharedFacade = {
    includeCatalogContract: activeSelections.some(
      ({ generatedImports }) => generatedImports.requiresCatalogContract
    ),
    namespaces: sharedNamespaces,
  };
  const preparedActive: Array<PreparedSemanticClosure> = [];
  const facadeOnlySelections = activeSelections.filter(
    ({ generatedImports, plan }) =>
      plan.safe &&
      [...plan.finiteModules].every((moduleName) =>
        generatedImports.facadeModules.has(moduleName)
      ) &&
      generatedImports.facadeModules.size > 0
  );
  const firstFacadeOnly = facadeOnlySelections[0];
  if (firstFacadeOnly) {
    try {
      const template = prepareSealedSemanticClosure(
        firstFacadeOnly.plan.entry.source,
        firstFacadeOnly.plan.cleanId,
        root,
        catalog,
        firstFacadeOnly.generatedImports,
        owner.compilerOptions,
        firstFacadeOnly.plan.entry.authorizationEvidence.workspaceRoot,
        preparationCache,
        firstFacadeOnly.plan.sourceFile,
        firstFacadeOnly.plan.finiteModules,
        sharedFacade
      );
      preparedActive.push(template);
      for (const { generatedImports, plan } of facadeOnlySelections.slice(1)) {
        preparedActive.push(
          cloneFacadeOnlySemanticClosure(
            template,
            plan.entry.source,
            plan.cleanId,
            plan.sourceFile,
            generatedImports,
            preparationCache
          )
        );
      }
    } catch (error) {
      for (const { plan } of facadeOnlySelections) {
        preparationErrors.set(plan.cleanId, error);
      }
    }
  }
  const facadeOnlyIds = new Set(
    facadeOnlySelections.map(({ plan }) => plan.cleanId)
  );
  for (const { generatedImports, plan } of activeSelections) {
    if (facadeOnlyIds.has(plan.cleanId)) {
      continue;
    }
    {
      const {
        cleanId,
        entry: { authorizationEvidence, source },
        finiteModules,
        sourceFile,
      } = plan;
      try {
        preparedActive.push(
          prepareSealedSemanticClosure(
            source,
            cleanId,
            root,
            catalog,
            generatedImports,
            owner.compilerOptions,
            authorizationEvidence.workspaceRoot,
            preparationCache,
            sourceFile,
            finiteModules,
            sharedFacade
          )
        );
      } catch (error) {
        preparationErrors.set(cleanId, error);
      }
    }
  }
  const activeOrder = new Map(
    activeSelections.map(({ plan }, index) => [plan.cleanId, index])
  );
  preparedActive.sort(
    (left, right) =>
      (activeOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (activeOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
  );
  markProfilePhase("active-closure-preparation");
  const prepared = [...preparedInert, ...preparedActive];
  const groups = new Map<string, Array<PreparedSemanticClosure>>();
  const fusionStates = new Map<string, SemanticFusionState>();
  const sharedGroupKeys = new Set<string>();
  const preparedById = new Map(
    prepared.map((closure) => [closure.id, closure])
  );
  for (const closure of prepared) {
    if (isolatedIds.has(closure.id)) {
      groups.set(`${closure.groupKey}\u0000isolated\u0000${closure.id}`, [
        closure,
      ]);
      continue;
    }
    // Model the actual owner project: one sealed Program per compatible
    // owner/options group. The cumulative fusion state still rejects every
    // conflicting file, resolution, probe, and realpath frontier.
    const baseKey = "owner";
    let partition = 0;
    for (;;) {
      const groupKey = `${baseKey}\u0000partition\u0000${partition}`;
      const entries = groups.get(groupKey);
      if (!entries) {
        const state = createSemanticFusionState();
        if (!tryFuseSemanticClosure(state, closure)) {
          throw new Error(`Unable to initialize sealed semantic fusion group`);
        }
        groups.set(groupKey, [closure]);
        fusionStates.set(groupKey, state);
        sharedGroupKeys.add(groupKey);
        break;
      }
      const state = fusionStates.get(groupKey);
      if (!state) {
        throw new Error(`Sealed semantic fusion state omitted ${groupKey}`);
      }
      const representative = entries[0];
      if (
        representative?.groupKey === closure.groupKey &&
        representative.files === closure.files &&
        representative.resolutions === closure.resolutions &&
        representative.typeResolutions === closure.typeResolutions
      ) {
        entries.push(closure);
        sharedGroupKeys.add(groupKey);
        break;
      }
      // Group size is not a semantic safety boundary. The cumulative fusion
      // state binds every file, resolution, probe, and realpath observed by
      // prior closures; a candidate joins only when it agrees with that exact
      // sealed frontier. Arbitrarily splitting a proven-compatible owner made
      // TypeScript rebuild the same dependency graph in multiple Programs.
      if (tryFuseSemanticClosure(state, closure)) {
        entries.push(closure);
        sharedGroupKeys.add(groupKey);
        break;
      }
      partition += 1;
    }
  }
  markProfilePhase("fusion-partitioning");
  const fallbackFiles = isolatedIds.size;
  if (process.env.MIRAI_INTL_INTERNAL_FUSION_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_FUSION_PROFILE=${JSON.stringify(
        [...groups].map(([key, closures]) => ({
          closures: closures.length,
          key: sha256(key),
        }))
      )}\n`
    );
  }
  observe?.({
    fallbackFiles,
    fallbackPrograms: fallbackFiles,
    sharedFiles: forceFiniteClosure ? 0 : sources.length - isolatedIds.size,
    sharedPrograms: sharedGroupKeys.size,
  });
  const sourcesById = new Map(
    sources.map((entry) => [
      normalizedSemanticPath(cleanModuleId(entry.id), preparationCache),
      entry,
    ])
  );
  const resultsById = new Map<string, MiraiIntlSemanticBatchResult>(
    noProgramResults
  );
  for (const [id, error] of preparationErrors) {
    const normalizedId = normalizedSemanticPath(id, preparationCache);
    const sourceEntry = sourcesById.get(normalizedId);
    resultsById.set(normalizedId, {
      error,
      id: sourceEntry?.id ?? id,
    });
  }
  for (const [groupKey, closures] of groups) {
    const contexts = createSealedSemanticGroup(
      closures,
      catalog,
      preparationCache
    );
    markProfilePhase(`program:${closures.length}`);
    for (const closure of closures) {
      const sourceEntry = sourcesById.get(closure.id);
      if (!sourceEntry) {
        throw new Error(`Prepared semantic source omitted ${closure.id}`);
      }
      try {
        resultsById.set(closure.id, {
          id: sourceEntry.id,
          result: await transformMiraiIntlSourceWithCatalog(
            sourceEntry.source,
            cleanModuleId(sourceEntry.id),
            {
              ...options,
              authorizationEvidence: sourceEntry.authorizationEvidence,
            },
            catalog,
            contexts.get(closure.id),
            owner.compilerOptions,
            preparedById.get(closure.id)?.generatedImports,
            preparedById.get(closure.id)?.sourceFile,
            analysisOnly
          ),
        });
      } catch (error) {
        resultsById.set(closure.id, { error, id: sourceEntry.id });
      }
    }
    markProfilePhase(`transforms:${closures.length}`);
    groups.delete(groupKey);
  }
  if (process.env.MIRAI_INTL_INTERNAL_TRANSFORM_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_TRANSFORM_PROFILE=${JSON.stringify({
        activeSources: sourcePlans.filter(({ inert }) => !inert).length,
        facadeOnlySources: facadeOnlySelections.length,
        finiteModuleGroups: Object.fromEntries(
          [...sourcePlans]
            .filter(({ finiteModules }) => finiteModules.size > 0)
            .reduce((groups, { finiteModules }) => {
              const key = [...finiteModules]
                .toSorted(compareCanonicalStrings)
                .join("\u0000");
              groups.set(key, (groups.get(key) ?? 0) + 1);
              return groups;
            }, new Map<string, number>())
        ),
        mappedNonliteralSources: sourcePlans.filter(
          ({ mappedNonliteral }) => mappedNonliteral
        ).length,
        phases: profilePhases,
        preparationPhases: Object.fromEntries(semanticPreparationProfile),
        totalMilliseconds: performance.now() - profileStarted,
      })}\n`
    );
  }
  return sources.map(({ id }) => {
    const result = resultsById.get(
      normalizedSemanticPath(cleanModuleId(id), preparationCache)
    );
    if (!result) {
      throw new Error(`Semantic owner batch omitted ${id}`);
    }
    return result;
  });
}

export function isMiraiIntlTransformCandidate(
  _source: string,
  id: string
): boolean {
  const cleanId = cleanModuleId(id);
  // Source text is deliberately not used here. This function establishes the
  // transform's eligible-file boundary only; translation ownership and safety
  // are decided by the TypeScript analysis performed for every eligible file.
  // A source regex previously made aliases and escaped translator references
  // invisible to both the checker and production transforms.
  return (
    !cleanId.includes(`${sep}node_modules${sep}`) &&
    supportedSource.test(cleanId)
  );
}
