import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

import ts from "typescript";

import { callSitePreludeName } from "./emit";

const privateCarrierModuleName = "catalog.manifest.gen.mjs";
const privateMessagesModuleName = "catalog.messages.gen.mjs";
const sliceParameter = "__mirai_intl_exports";
const descriptorExport = /^m(?:0|[1-9]\d*)$/u;
const declarationName = /^[mpr](?:0|[1-9]\d*)$/u;
const contentHash = /^sha256:(?<hash>[a-f\d]{64})$/u;
const generatedFacadePrefix = "// @mirai-intl-selector ";
const maximumCachedModules = 8;

type StatementRange = Readonly<{
  end: number;
  start: number;
}>;

type IndexedDeclaration = StatementRange &
  Readonly<{
    dependencies: ReadonlyArray<string>;
  }>;

type PrivateMessageModuleIndex = Readonly<{
  declarations: ReadonlyMap<string, IndexedDeclaration>;
  preamble: ReadonlyArray<StatementRange>;
  source: string;
}>;

const moduleIndexCache = new Map<string, PrivateMessageModuleIndex>();
const moduleSourceCache = new Map<string, Promise<string>>();
let moduleIndexBuilds = 0;
let moduleSourceReads = 0;

export type PrivateMessageSliceRequest = Readonly<{
  descriptorExports: ReadonlyArray<string>;
  file: string;
}>;

export type AuthorizedPrivateMessageSliceRequest = PrivateMessageSliceRequest &
  Readonly<{
    currentFile: string;
    messageFile: string;
  }>;

export type PrivateMessageCatalogOptions = Readonly<{
  generatedDirectory?: string;
  root?: string;
}>;

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

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" ||
    (pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromRoot))
  );
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
  const newline = source.indexOf("\n");
  const selectorLine = newline < 0 ? source : source.slice(0, newline);
  if (!selectorLine.startsWith(generatedFacadePrefix)) {
    throw new Error("Generated stable facade is missing its selector identity");
  }
  const selector = parseJson(
    selectorLine.slice(generatedFacadePrefix.length),
    "Generated stable facade selector"
  );
  if (
    !isRecord(selector) ||
    Object.keys(selector).length !== 3 ||
    selector.schemaVersion !== 2 ||
    selector.contentHash !== hash ||
    selector.directory !== directory
  ) {
    throw new Error(
      "Generated stable facade selector does not match the current catalog"
    );
  }
}

async function nonSymlinkDirectory(path: string, label: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory`);
  }
}

async function nonSymlinkFile(path: string, label: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a non-symlink regular file`);
  }
}

function canonicalDescriptorExports(
  descriptors: ReadonlyArray<string>
): ReadonlyArray<string> {
  const unique = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptorExport.test(descriptor)) {
      throw new TypeError(`Invalid private message export ${descriptor}`);
    }
    unique.add(descriptor);
  }
  if (unique.size === 0) {
    throw new TypeError("A private message slice requires at least one export");
  }
  return [...unique].toSorted((left, right) => {
    const leftIndex = Number(left.slice(1));
    const rightIndex = Number(right.slice(1));
    return leftIndex - rightIndex;
  });
}

export function privateMessageSliceSpecifier(
  moduleSpecifier: string,
  descriptors: ReadonlyArray<string>
): string {
  const exports = canonicalDescriptorExports(descriptors);
  return `${moduleSpecifier}?${sliceParameter}=${exports.join(",")}`;
}

export function parsePrivateMessageSliceRequest(
  id: string
): PrivateMessageSliceRequest | undefined {
  const queryIndex = id.indexOf("?");
  if (queryIndex < 0) {
    return undefined;
  }
  const file = id.slice(0, queryIndex);
  if (basename(file) !== privateCarrierModuleName) {
    return undefined;
  }
  const parameters = new URLSearchParams(id.slice(queryIndex + 1));
  const values = parameters.getAll(sliceParameter);
  const value = values[0];
  if (value === undefined) {
    return undefined;
  }
  if (
    values.length !== 1 ||
    [...parameters.keys()].some((key) => key !== sliceParameter)
  ) {
    throw new TypeError("Private message slice query has unexpected fields");
  }
  return {
    descriptorExports: canonicalDescriptorExports(value.split(",")),
    file,
  };
}

export async function authorizePrivateMessageSliceRequest(
  id: string,
  options: PrivateMessageCatalogOptions = {}
): Promise<AuthorizedPrivateMessageSliceRequest | undefined> {
  const request = parsePrivateMessageSliceRequest(id);
  if (!request) {
    return undefined;
  }
  if (!isAbsolute(request.file)) {
    throw new Error("Private message slice paths must be absolute");
  }
  if (request.file.split(sep).includes("..")) {
    throw new Error(
      "Private message slice paths must not contain escape segments"
    );
  }

  const root = resolve(options.root ?? process.cwd());
  const generatedRoot = resolve(
    root,
    options.generatedDirectory ?? "src/i18n/generated"
  );
  await nonSymlinkDirectory(generatedRoot, "Generated catalog root");
  const canonicalGeneratedRoot = await realpath(generatedRoot);
  const currentFile = resolve(generatedRoot, "current.json");
  await nonSymlinkFile(currentFile, "Generated current pointer");
  let pointerValue: unknown;
  try {
    pointerValue = JSON.parse(await readFile(currentFile, "utf8")) as unknown;
  } catch (error) {
    throw new Error("Generated current pointer is not valid JSON", {
      cause: error,
    });
  }
  if (!isRecord(pointerValue)) {
    throw new TypeError("Generated current pointer must be an object");
  }
  const hashValue = ownString(
    pointerValue,
    "contentHash",
    "Generated current pointer"
  );
  const hash = contentHash.exec(hashValue)?.groups?.hash;
  if (!hash) {
    throw new TypeError(
      "Generated current pointer.contentHash must be a SHA-256 value"
    );
  }
  const directory = ownString(
    pointerValue,
    "directory",
    "Generated current pointer"
  );
  if (directory !== `builds/${hash}`) {
    throw new Error(
      "Generated current pointer directory must match its content hash"
    );
  }

  const buildsDirectory = resolve(generatedRoot, "builds");
  await nonSymlinkDirectory(buildsDirectory, "Generated builds directory");
  const selectedDirectory = resolve(generatedRoot, directory);
  await nonSymlinkDirectory(selectedDirectory, "Generated selected directory");
  const canonicalSelectedDirectory = await realpath(selectedDirectory);
  if (!isWithin(canonicalGeneratedRoot, canonicalSelectedDirectory)) {
    throw new Error("Generated selected directory escapes its catalog root");
  }

  const facadeFile = resolve(generatedRoot, "index.ts");
  await nonSymlinkFile(facadeFile, "Generated stable facade");
  const canonicalFacadeFile = await realpath(facadeFile);
  if (!isWithin(canonicalGeneratedRoot, canonicalFacadeFile)) {
    throw new Error("Generated stable facade escapes its catalog root");
  }
  assertGeneratedFacadeSelector(
    await readFile(facadeFile, "utf8"),
    hashValue,
    directory
  );

  const expectedCarrier = resolve(selectedDirectory, privateCarrierModuleName);
  await nonSymlinkFile(expectedCarrier, "Generated selected private carrier");
  const canonicalExpectedCarrier = await realpath(expectedCarrier);
  if (!isWithin(canonicalSelectedDirectory, canonicalExpectedCarrier)) {
    throw new Error("Generated selected private carrier escapes its build");
  }
  const requestedFile = resolve(request.file);
  if (
    requestedFile !== expectedCarrier &&
    requestedFile !== canonicalExpectedCarrier
  ) {
    throw new Error("Private message slice must target the selected carrier");
  }
  await nonSymlinkFile(request.file, "Requested private carrier");
  if ((await realpath(request.file)) !== canonicalExpectedCarrier) {
    throw new Error("Private message slice must target the selected carrier");
  }

  const messageFile = resolve(selectedDirectory, privateMessagesModuleName);
  await nonSymlinkFile(messageFile, "Generated selected private message file");
  const canonicalMessageFile = await realpath(messageFile);
  if (!isWithin(canonicalSelectedDirectory, canonicalMessageFile)) {
    throw new Error(
      "Generated selected private message file escapes its build"
    );
  }
  return {
    ...request,
    currentFile,
    file: expectedCarrier,
    messageFile,
  };
}

/**
 * Collect the same-module declarations an emitted statement depends on. The
 * generated shapes are `const pN = …`, `export const rN = …` and
 * `export const mN = …`; a call-site export may reference its own `pN` renderer
 * and legacy payloads also reference `rN`. Property names are skipped so the
 * shared `__c.text` prelude never contributes a dependency.
 */
function declarationDependencies(
  initializer: ts.Expression | undefined
): ReadonlyArray<string> {
  if (!initializer) {
    return [];
  }
  const dependencies = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      if (declarationName.test(node.text)) {
        dependencies.add(node.text);
      }
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return [...dependencies];
}

function indexPrivateMessagesModule(
  source: string,
  fileName: string
): PrivateMessageModuleIndex {
  const cached = moduleIndexCache.get(fileName);
  if (cached?.source === source) {
    moduleIndexCache.delete(fileName);
    moduleIndexCache.set(fileName, cached);
    return cached;
  }

  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const declarations = new Map<string, IndexedDeclaration>();
  const preamble: Array<StatementRange> = [];
  let prelude = false;
  for (const statement of sourceFile.statements) {
    const range = {
      end: statement.getEnd(),
      start: statement.getFullStart(),
    };
    if (ts.isImportDeclaration(statement)) {
      preamble.push(range);
      continue;
    }
    if (!ts.isVariableStatement(statement)) {
      throw new TypeError(
        "Private message module contains an unexpected top-level statement"
      );
    }
    if (statement.declarationList.declarations.length !== 1) {
      throw new TypeError(
        "Private message module declarations must contain one binding"
      );
    }
    const declaration = statement.declarationList.declarations[0];
    if (!declaration || !ts.isIdentifier(declaration.name)) {
      throw new TypeError(
        "Private message module declarations must use identifier bindings"
      );
    }
    const name = declaration.name.text;
    if (name === callSitePreludeName) {
      if (prelude) {
        throw new TypeError(
          `Private message module repeats ${callSitePreludeName}`
        );
      }
      prelude = true;
      preamble.push(range);
      continue;
    }
    if (!declarationName.test(name)) {
      throw new TypeError(
        `Private message module has unexpected binding ${name}`
      );
    }
    if (declarations.has(name)) {
      throw new TypeError(`Private message module repeats ${name}`);
    }
    declarations.set(name, {
      ...range,
      dependencies: declarationDependencies(declaration.initializer),
    });
  }

  const indexed = {
    declarations,
    preamble,
    source,
  } satisfies PrivateMessageModuleIndex;
  moduleIndexCache.delete(fileName);
  moduleIndexCache.set(fileName, indexed);
  while (moduleIndexCache.size > maximumCachedModules) {
    const oldest = moduleIndexCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    moduleIndexCache.delete(oldest);
  }
  moduleIndexBuilds += 1;
  return indexed;
}

/** @internal Test-only cache reset. */
export function clearPrivateMessageModuleIndexCache(): void {
  moduleIndexCache.clear();
  moduleSourceCache.clear();
  moduleIndexBuilds = 0;
  moduleSourceReads = 0;
}

/** @internal Test-only parser build count. */
export function privateMessageModuleIndexBuildCount(): number {
  return moduleIndexBuilds;
}

/** @internal Test-only content-addressed module read count. */
export function privateMessageModuleReadCount(): number {
  return moduleSourceReads;
}

async function readPrivateMessagesModule(fileName: string): Promise<string> {
  const cacheKey = await realpath(fileName);
  const cached = moduleSourceCache.get(cacheKey);
  if (cached) {
    moduleSourceCache.delete(cacheKey);
    moduleSourceCache.set(cacheKey, cached);
    return cached;
  }
  moduleSourceReads += 1;
  const source = readFile(cacheKey, "utf8").then((payload) => {
    // Raw payloads are canonical because native compression output can vary
    // across zlib versions. Deflated payloads remain readable for compatibility.
    const headerEnd = payload.indexOf(
      "// @generated by @openmirai/intl-compiler. Do not edit.\n"
    );
    const encoded =
      headerEnd >= 0
        ? payload.slice(
            headerEnd +
              "// @generated by @openmirai/intl-compiler. Do not edit.\n".length
          )
        : payload;
    if (encoded.startsWith("import ")) {
      return payload;
    }
    try {
      return inflateRawSync(Buffer.from(encoded.trim(), "base64")).toString(
        "utf8"
      );
    } catch (error) {
      throw new TypeError("Generated private message payload is invalid", {
        cause: error,
      });
    }
  });
  moduleSourceCache.set(cacheKey, source);
  while (moduleSourceCache.size > maximumCachedModules) {
    const oldest = moduleSourceCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      break;
    }
    moduleSourceCache.delete(oldest);
  }
  try {
    return await source;
  } catch (error) {
    if (moduleSourceCache.get(cacheKey) === source) {
      moduleSourceCache.delete(cacheKey);
    }
    throw error;
  }
}

export async function loadPrivateMessageSlice(
  request: AuthorizedPrivateMessageSliceRequest
): Promise<string> {
  return slicePrivateMessagesModule(
    await readPrivateMessagesModule(request.messageFile),
    request.descriptorExports,
    request.messageFile
  );
}

export function slicePrivateMessagesModule(
  source: string,
  descriptors: ReadonlyArray<string>,
  fileName = privateMessagesModuleName
): string {
  const moduleIndex = indexPrivateMessagesModule(source, fileName);
  const selected = new Map<string, IndexedDeclaration>();
  const order: Array<string> = [];
  const include = (name: string, requiredBy?: string): void => {
    if (selected.has(name)) {
      return;
    }
    const declaration = moduleIndex.declarations.get(name);
    if (!declaration) {
      throw new TypeError(
        requiredBy
          ? `Private message slice requires the ${name} declaration referenced by ${requiredBy}`
          : `Private message slice requires the ${name} declaration`
      );
    }
    selected.set(name, declaration);
    order.push(name);
  };
  for (const descriptor of canonicalDescriptorExports(descriptors)) {
    include(descriptor);
  }
  for (let cursor = 0; cursor < order.length; cursor += 1) {
    const name = order[cursor];
    const declaration = name === undefined ? undefined : selected.get(name);
    if (name === undefined || !declaration) {
      continue;
    }
    for (const dependency of declaration.dependencies) {
      include(dependency, name);
    }
  }
  const statements: ReadonlyArray<StatementRange> = [
    ...moduleIndex.preamble,
    ...[...selected.values()].toSorted(
      (left, right) => left.start - right.start
    ),
  ];
  return `${statements
    .map((statement) => source.slice(statement.start, statement.end).trim())
    .join("\n\n")}\n`;
}
