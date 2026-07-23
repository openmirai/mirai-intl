import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import ts from "typescript";

import { privateMessageSliceSpecifier } from "./private-module";

export type MiraiIntlTransformOptions = Readonly<{
  generatedDirectory?: string;
  root?: string;
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
  formErrorFactories: ReadonlySet<string>;
  formSchemaFactories: ReadonlySet<string>;
  keyFactories: ReadonlySet<string>;
  keyParsers: ReadonlySet<string>;
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
const moduleResolutionOptionsCache = new Map<string, ts.CompilerOptions>();

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
    selector.schemaVersion !== 1 ||
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
  const canonicalGeneratedRoot = await canonicalCatalogRoot(generatedRoot);
  const pointerPath = resolve(generatedRoot, "current.json");
  const pointerSource = await readConfinedTextFile(
    canonicalGeneratedRoot,
    pointerPath,
    "Generated current pointer",
    "generated catalog root"
  );
  const cached = catalogCache.get(generatedRoot);
  if (cached?.pointerSource === pointerSource) {
    const selectedCanonicalDirectory = await assertConfinedDirectory(
      canonicalGeneratedRoot,
      cached.catalog.selectedDirectory,
      "Generated selected directory",
      "generated catalog root"
    );
    if (
      !isSamePath(
        selectedCanonicalDirectory,
        cached.catalog.selectedCanonicalDirectory
      )
    ) {
      throw new Error(
        "Generated selected directory canonical path changed while cached"
      );
    }
    const generatedFacadePath = resolve(generatedRoot, "index.ts");
    const [, generatedFacadeSource] = await Promise.all([
      assertConfinedRegularFile(
        selectedCanonicalDirectory,
        cached.catalog.contractPath,
        "Generated catalog contract",
        "selected catalog directory"
      ),
      readConfinedTextFile(
        canonicalGeneratedRoot,
        generatedFacadePath,
        "Generated stable facade",
        "generated catalog root"
      ),
      assertConfinedRegularFile(
        selectedCanonicalDirectory,
        cached.catalog.provenancePath,
        "Generated catalog provenance",
        "selected catalog directory"
      ),
      assertConfinedRegularFile(
        selectedCanonicalDirectory,
        cached.catalog.privateCarrierPath,
        "Generated private carrier",
        "selected catalog directory"
      ),
      ...[
        ...new Set(
          [...cached.catalog.messages.values()].map(
            ({ descriptorModule }) => descriptorModule
          )
        ),
      ].map((module) =>
        assertConfinedRegularFile(
          selectedCanonicalDirectory,
          module,
          "Generated private message module",
          "selected catalog directory"
        )
      ),
    ]);
    assertGeneratedFacadeSelector(
      generatedFacadeSource,
      cached.catalog.contentHash,
      cached.catalog.selectedRelativeDirectory
    );
    return cached.catalog;
  }

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

function moduleResolutionOptions(root: string): ts.CompilerOptions {
  const cached = moduleResolutionOptionsCache.get(root);
  if (cached) {
    return cached;
  }
  const configPath = ts.findConfigFile(root, ts.sys.fileExists);
  if (!configPath) {
    const fallback = {
      allowJs: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.Latest,
    } satisfies ts.CompilerOptions;
    moduleResolutionOptionsCache.set(root, fallback);
    return fallback;
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
  moduleResolutionOptionsCache.set(root, parsed.options);
  return parsed.options;
}

async function generatedFacadeImportNames(
  source: string,
  id: string,
  root: string,
  generatedFacadePath: string
): Promise<GeneratedFacadeImportNames> {
  const sourceFile = ts.createSourceFile(
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
  const facadeModules = new Set<string>();
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
          importedName === "TranslationKey" ||
          importedName === "TranslationNamespace"
        );
      }
    );
    if (facadeImports.length === 0) {
      continue;
    }
    const resolution = ts.resolveModuleName(
      statement.moduleSpecifier.text,
      id,
      moduleResolutionOptions(root),
      ts.sys
    ).resolvedModule;
    let canonical: string | undefined;
    if (resolution) {
      try {
        canonical = await realpath(resolution.resolvedFileName);
      } catch {
        canonical = undefined;
      }
    }
    if (!canonical || !isSamePath(canonical, generatedFacadePath)) {
      const start = statement.moduleSpecifier.getStart(sourceFile);
      const { character, line } =
        sourceFile.getLineAndCharacterOfPosition(start);
      throw new Error(
        `${id}:${line + 1}:${character + 1}: Translation key helpers and aliases must be imported directly from the configured generated facade`
      );
    }
    facadeModules.add(statement.moduleSpecifier.text);
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
  return {
    facadeModules,
    formErrorFactories,
    formSchemaFactories,
    keyFactories,
    keyParsers,
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

function generatedFacadeTypeModule(catalog: CurrentCatalog): string {
  const namespaces = new Map<string, Set<string>>();
  for (const message of catalog.messages.values()) {
    const parts = message.path.split(".");
    for (let index = 1; index < parts.length; index += 1) {
      const namespace = parts.slice(0, index).join(".");
      const entries = namespaces.get(namespace) ?? new Set<string>();
      if (message.kind === "text" && !message.hasArguments) {
        entries.add(parts.slice(index).join("."));
      }
      namespaces.set(namespace, entries);
    }
  }
  const entries = [...namespaces.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right)
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
  return [
    `export type { CatalogLocale } from ${JSON.stringify(resolve(catalog.selectedDirectory, "catalog.resources.gen.mjs"))};`,
    `export { catalogManifest } from ${JSON.stringify(resolve(catalog.selectedDirectory, "catalog.manifest.gen.mjs"))};`,
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

function createProgram(
  source: string,
  id: string,
  root: string,
  catalog: CurrentCatalog,
  generatedFacadeModules: ReadonlySet<string>
): Readonly<{
  checker: ts.TypeChecker;
  providerBudgetExceeded: string | undefined;
  sourceFile: ts.SourceFile;
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
  const projectOptions = resolvesDependencies
    ? moduleResolutionOptions(root)
    : undefined;
  const configuredAmbientTypes = projectOptions?.types ?? [];
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
  const generatedFacadeId = resolve(
    dirname(id),
    ".mirai-intl-generated-facade.d.ts"
  );
  const generatedFacadeSource = resolvesDependencies
    ? generatedFacadeTypeModule(catalog)
    : "";
  const generatedFacadeFile = ts.createSourceFile(
    generatedFacadeId,
    generatedFacadeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const canonicalRoot = ts.sys.realpath ? ts.sys.realpath(root) : resolve(root);
  const maximumProviderFiles = 64;
  const providerFiles = new Set<string>();
  const providerRootNames = new Set<string>();
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
      resolution.isExternalLibraryImport === true &&
      /\.d\.[cm]?ts$/u.test(canonical)
    );
  };
  const claimProvider = (canonical: string, moduleName: string): boolean => {
    if (providerFiles.has(canonical)) {
      return true;
    }
    if (providerFiles.size >= maximumProviderFiles) {
      providerBudgetExceeded ??= moduleName;
      return false;
    }
    providerFiles.add(canonical);
    return true;
  };
  if (projectOptions) {
    for (const moduleName of finiteModules) {
      if (generatedFacadeModules.has(moduleName)) {
        continue;
      }
      const resolution = ts.resolveModuleName(
        moduleName,
        id,
        projectOptions,
        ts.sys
      ).resolvedModule;
      if (!resolution) {
        continue;
      }
      const canonical = ts.sys.realpath
        ? ts.sys.realpath(resolution.resolvedFileName)
        : resolve(resolution.resolvedFileName);
      if (
        isAllowedProvider(canonical, resolution) &&
        claimProvider(canonical, moduleName)
      ) {
        providerRootNames.add(resolution.resolvedFileName);
      }
    }
  }
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
      const resolution = ts.resolveModuleName(
        moduleName,
        containingFile,
        projectOptions,
        ts.sys
      ).resolvedModule;
      if (!resolution) {
        return undefined;
      }
      const canonical = ts.sys.realpath
        ? ts.sys.realpath(resolution.resolvedFileName)
        : resolve(resolution.resolvedFileName);
      if (isSamePath(canonical, catalog.generatedFacadePath)) {
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
      if (containingFile === id && !finiteModules.has(moduleName)) {
        return undefined;
      }
      if (!isAllowedProvider(canonical, resolution)) {
        return undefined;
      }
      if (!claimProvider(canonical, moduleName)) {
        return undefined;
      }
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
    providerBudgetExceeded,
    sourceFile,
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
  generatedImports: GeneratedFacadeImportNames
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
  const { checker, providerBudgetExceeded, sourceFile } = createProgram(
    source,
    id,
    root,
    catalog,
    generatedImports.facadeModules
  );
  const factorySymbols = new Map<ts.Symbol, FactoryKind>();
  const objectSymbols = new Map<ts.Symbol, string>();
  const translationKeyFactorySymbols = new Set<ts.Symbol>();
  const translationKeyParserSymbols = new Set<ts.Symbol>();
  const formErrorTranslatorFactorySymbols = new Set<ts.Symbol>();
  const formSchemaFactorySymbols = new Set<ts.Symbol>();
  const translationKeySymbols = new Map<ts.Symbol, string>();
  const translatorSymbols = new Map<ts.Symbol, string>();
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
        left.path.localeCompare(right.path)
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
      left.path.localeCompare(right.path)
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
  validateTranslatorReferences(sourceFile);

  return {
    dynamicHelpers,
    dynamicRegistries: [...dynamicRegistries.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([, registry]) => ({
        entries: [...registry.entries.values()].toSorted((left, right) =>
          left.key.localeCompare(right.key)
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
                    ...node.arguments.slice(1),
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
                  factory.createStringLiteral("@openmirai/intl-runtime")
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

export async function transformMiraiIntlSource(
  source: string,
  id: string,
  options: MiraiIntlTransformOptions = {}
): Promise<MiraiIntlTransformResult | null> {
  const cleanId = cleanModuleId(id);
  if (!isMiraiIntlTransformCandidate(source, cleanId)) {
    return null;
  }
  const catalog = await loadCurrentCatalog(options);
  if (
    cleanId === catalog.selectedDirectory ||
    cleanId.startsWith(`${catalog.selectedDirectory}${sep}`)
  ) {
    return null;
  }
  const root = resolve(options.root ?? process.cwd());
  const generatedImports = await generatedFacadeImportNames(
    source,
    cleanId,
    root,
    catalog.generatedFacadePath
  );
  const analysis = analyzeSource(
    source,
    cleanId,
    root,
    catalog,
    generatedImports
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

const TRANSLATION_CALL_CANDIDATE =
  /(?:\buseTranslations\b|\bgetServerTranslations\b|\bcreateFormErrorTranslator\b|\bcreateFormSchema\b|\bcreateTranslationKey\b|\bparseTranslationKey\b|\bt\.rich\s*\(|\bt\.value\s*\(|\bt\.map\s*\(|\bt\s*\(\s*["'`])/u;

export function isMiraiIntlTransformCandidate(
  source: string,
  id: string
): boolean {
  const cleanId = cleanModuleId(id);
  return (
    !cleanId.includes(`${sep}node_modules${sep}`) &&
    supportedSource.test(cleanId) &&
    TRANSLATION_CALL_CANDIDATE.test(source)
  );
}
