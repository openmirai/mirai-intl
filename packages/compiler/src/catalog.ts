import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  FORMAT_VERSION,
  RUNTIME_ABI,
  emptyObjectSchema,
} from "@openmirai/intl-abi";
import type {
  IrNode,
  JsonValue,
  RendererCapabilityId,
  ValueSchema,
} from "@openmirai/intl-abi";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical";
import { COMPILER_VERSION, compileCatalog } from "./compile";
import { emitArtifacts } from "./emit";
import type { DescriptorRepresentation, EmittedArtifacts } from "./emit";
import { inferMessageContract, inspectMessageSyntax } from "./parser";
import type { CatalogSource, MessageSource } from "./source";
import { verifyArtifactSet, writeArtifactSet } from "./writer";
import type { StableFacadeOptions, WriteResult } from "./writer";

const execFileAsync = promisify(execFile);
const requireFromCompiler = createRequire(import.meta.url);
const tuplePackages = [
  "i18next",
  "i18next-icu",
  "intl-messageformat",
  "react",
  "react-dom",
  "react-i18next",
  "typescript",
  "next",
  "vite",
] as const;

type JsonObject = Record<string, unknown>;

type ResolvedCatalogSource = Readonly<{
  dependency?: string;
  excludeDirectories: ReadonlyArray<string>;
  flattenDirectories: ReadonlyArray<string>;
  mount: ReadonlyArray<string>;
  physicalRoot: string;
  root: string;
  withinRoot: string;
}>;

type ResolvedCatalogConfig = Readonly<{
  catalog: Readonly<{
    buildId: string;
    id: string;
    locales: ReadonlyArray<string>;
    package: string;
    rendererCapabilityId: RendererCapabilityId;
    sourceLocale: string;
  }>;
  output: string;
  representation: DescriptorRepresentation;
  sources: ReadonlyArray<ResolvedCatalogSource>;
}>;

type MessageDeclaration = Readonly<{
  kind: "value";
  resultSchema: ValueSchema;
}>;

type MessageSchema = Readonly<{
  messages: Readonly<Record<string, MessageDeclaration>>;
}>;

type SourceFileEvidence = Readonly<{
  hash: `sha256:${string}`;
  path: string;
}>;

export type ConventionFramework = "next" | "vite";

export type ConventionDiscoveryManifest = Readonly<{
  catalogId: string;
  catalogPackage: string;
  excludedDirectories: ReadonlyArray<string>;
  flattenDirectories: ReadonlyArray<string>;
  framework: ConventionFramework;
  localeRoot: "locales" | "src/locales";
  locales: ReadonlyArray<string>;
  output: "src/i18n/generated";
  representation: "precompiled";
  schemaVersion: 1;
  sourceLocale: string;
}>;

type GitEvidence = Readonly<{
  dirty: boolean;
  head: string | null;
  root: string | null;
  status: ReadonlyArray<string>;
}>;

type CatalogEnvironmentEvidence = Readonly<{
  appGit: GitEvidence;
  compilerGit: GitEvidence;
  installedTuple: Readonly<Record<string, string | null>>;
  lockfileHash: `sha256:${string}`;
  packageJsonHash: `sha256:${string}`;
}>;

export type LoadedConventionCatalog = Readonly<{
  config: ResolvedCatalogConfig;
  configPath: string;
  discovery: ConventionDiscoveryManifest;
  inputs: Readonly<{
    discoveryPolicyHash: `sha256:${string}`;
    exceptionsHash: `sha256:${string}`;
    exceptionsPresent: boolean;
    messageContractHash: `sha256:${string}`;
    sourceFiles: ReadonlyArray<SourceFileEvidence>;
  }>;
  outputRoot: string;
  repositoryRoot: string;
  source: CatalogSource;
  watch: Readonly<{
    files: ReadonlyArray<string>;
    roots: ReadonlyArray<string>;
  }>;
}>;

export type ConventionReport = Readonly<{
  artifacts: Readonly<{
    files: Readonly<
      Record<string, Readonly<{ bytes: number; hash: `sha256:${string}` }>>
    >;
    totalBytes: number;
  }>;
  authoritative: boolean;
  catalog: Readonly<{
    argumentRoleCounts: Readonly<Record<string, number>>;
    buildId: string;
    buildToken: string;
    capabilitySetHash: `sha256:${string}`;
    catalogHash: `sha256:${string}`;
    catalogId: string;
    catalogPackage: string;
    contentHash: `sha256:${string}`;
    formatterVersions: Readonly<Record<string, string>>;
    formatVersion: number;
    localeCounts: Readonly<
      Record<
        string,
        Readonly<{ messageCount: number; sourceFileCount: number }>
      >
    >;
    localeHashes: Readonly<Record<string, `sha256:${string}`>>;
    locales: ReadonlyArray<string>;
    messageCounts: Readonly<Record<"rich" | "text" | "value", number>>;
    rendererCapabilityId: RendererCapabilityId;
    runtimeAbi: string;
    sourceLocale: string;
  }>;
  compiler: Readonly<{
    parserVersion: string | null;
    version: string;
  }>;
  diagnostics: ReadonlyArray<
    Readonly<{
      code: string;
      message: string;
      severity: "error" | "warning";
    }>
  >;
  discovery: ConventionDiscoveryManifest;
  environment: CatalogEnvironmentEvidence | null;
  inputs: LoadedConventionCatalog["inputs"];
  representation: DescriptorRepresentation;
  contracts: Readonly<{
    discovery: Readonly<{
      hash: `sha256:${string}`;
      mode: "convention";
      schemaVersion: 1;
    }>;
    exceptions: Readonly<{
      hash: `sha256:${string}`;
      present: boolean;
      schemaVersion: 1;
    }>;
    messages: Readonly<{
      generated: true;
      hash: `sha256:${string}`;
      schemaVersion: 1;
      source: "message-ast";
    }>;
  }>;
  schemaVersion: 1;
}>;

export type ConventionGenerationResult = Readonly<{
  report: ConventionReport;
  write: WriteResult;
}>;

export type ConventionOptions = Readonly<{
  collectEnvironment?: boolean;
}>;

function isPlainObject(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertObject(value: unknown, context: string): JsonObject {
  if (!isPlainObject(value)) {
    throw new TypeError(`${context} must be a plain object`);
  }
  return value;
}

function assertExactKeys(
  object: JsonObject,
  allowed: ReadonlyArray<string>,
  context: string
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(object).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new TypeError(
      `${context} contains unknown field ${JSON.stringify(unknown.toSorted()[0])}`
    );
  }
}

function requiredString(
  object: JsonObject,
  key: string,
  context: string
): string {
  const value = object[key];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.normalize("NFC") !== value
  ) {
    throw new TypeError(`${context}.${key} must be a non-empty NFC string`);
  }
  return value;
}

function requiredStringArray(
  object: JsonObject,
  key: string,
  context: string,
  allowEmpty = false
): ReadonlyArray<string> {
  const value = object[key];
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(
      `${context}.${key} must be ${allowEmpty ? "a" : "a non-empty"} string array`
    );
  }
  const strings = value.map((entry, index) => {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.normalize("NFC") !== entry
    ) {
      throw new TypeError(
        `${context}.${key}[${index}] must be a non-empty NFC string`
      );
    }
    return entry;
  });
  if (new Set(strings).size !== strings.length) {
    throw new TypeError(`${context}.${key} contains duplicates`);
  }
  return strings;
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function fileSystemErrorCode(error: unknown): unknown {
  return error && typeof error === "object"
    ? Reflect.get(error, "code")
    : undefined;
}

async function confinedProspectivePath(
  repositoryRoot: string,
  path: string,
  context: string
): Promise<string> {
  let existingPath = path;
  const missingSegments: Array<string> = [];
  for (;;) {
    try {
      const canonicalBase = await realpath(existingPath);
      const canonicalPath = resolve(canonicalBase, ...missingSegments);
      if (!within(repositoryRoot, canonicalPath)) {
        throw new Error(`${context} symlink escapes the config directory`);
      }
      return canonicalPath;
    } catch (error) {
      const code = fileSystemErrorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw error;
      }
      let existingEntry = false;
      try {
        await lstat(existingPath);
        existingEntry = true;
      } catch (entryError) {
        const entryCode = fileSystemErrorCode(entryError);
        if (entryCode !== "ENOENT" && entryCode !== "ENOTDIR") {
          throw entryError;
        }
      }
      if (existingEntry) {
        throw new Error(`Unable to resolve ${context}`, { cause: error });
      }
      const parent = dirname(existingPath);
      if (parent === existingPath) {
        throw new Error(`Unable to resolve ${context}`, { cause: error });
      }
      missingSegments.unshift(basename(existingPath));
      existingPath = parent;
    }
  }
}

function parseValueSchema(value: unknown, context: string): ValueSchema {
  const object = assertObject(value, context);
  const type = requiredString(object, "type", context);
  switch (type) {
    case "scalar":
      assertExactKeys(object, ["type"], context);
      return { type: "scalar" };
    case "string": {
      assertExactKeys(object, ["type", "maxLength", "minLength"], context);
      for (const key of ["maxLength", "minLength"] as const) {
        if (
          key in object &&
          (!Number.isSafeInteger(object[key]) || Number(object[key]) < 0)
        ) {
          throw new TypeError(
            `${context}.${key} must be a non-negative integer`
          );
        }
      }
      return {
        ...(typeof object.maxLength === "number"
          ? { maxLength: object.maxLength }
          : {}),
        ...(typeof object.minLength === "number"
          ? { minLength: object.minLength }
          : {}),
        type: "string",
      };
    }
    case "number": {
      assertExactKeys(
        object,
        ["type", "finite", "integer", "maximum", "minimum", "safeInteger"],
        context
      );
      if (object.finite !== true) {
        throw new TypeError(`${context}.finite must be true`);
      }
      for (const key of ["integer", "safeInteger"] as const) {
        if (key in object && typeof object[key] !== "boolean") {
          throw new TypeError(`${context}.${key} must be boolean`);
        }
      }
      for (const key of ["maximum", "minimum"] as const) {
        if (key in object && typeof object[key] !== "number") {
          throw new TypeError(`${context}.${key} must be a number`);
        }
      }
      return {
        finite: true,
        ...(typeof object.integer === "boolean"
          ? { integer: object.integer }
          : {}),
        ...(typeof object.maximum === "number"
          ? { maximum: object.maximum }
          : {}),
        ...(typeof object.minimum === "number"
          ? { minimum: object.minimum }
          : {}),
        ...(typeof object.safeInteger === "boolean"
          ? { safeInteger: object.safeInteger }
          : {}),
        type: "number",
      };
    }
    case "boolean":
      assertExactKeys(object, ["type"], context);
      return { type: "boolean" };
    case "date-time":
      assertExactKeys(object, ["type"], context);
      return { type: "date-time" };
    case "literal": {
      assertExactKeys(object, ["type", "value"], context);
      const literal = object.value;
      if (
        literal !== null &&
        typeof literal !== "boolean" &&
        typeof literal !== "number" &&
        typeof literal !== "string"
      ) {
        throw new TypeError(`${context}.value must be a JSON primitive`);
      }
      return { type: "literal", value: literal };
    }
    case "enum": {
      assertExactKeys(object, ["type", "values"], context);
      if (!Array.isArray(object.values) || object.values.length === 0) {
        throw new TypeError(`${context}.values must be non-empty`);
      }
      const values = object.values.map((entry) => {
        if (
          entry !== null &&
          typeof entry !== "boolean" &&
          typeof entry !== "number" &&
          typeof entry !== "string"
        ) {
          throw new TypeError(`${context}.values must contain JSON primitives`);
        }
        return entry;
      });
      return { type: "enum", values };
    }
    case "array": {
      assertExactKeys(
        object,
        ["type", "items", "maxItems", "minItems"],
        context
      );
      for (const key of ["maxItems", "minItems"] as const) {
        if (
          key in object &&
          (!Number.isSafeInteger(object[key]) || Number(object[key]) < 0)
        ) {
          throw new TypeError(
            `${context}.${key} must be a non-negative integer`
          );
        }
      }
      return {
        items: parseValueSchema(object.items, `${context}.items`),
        ...(typeof object.maxItems === "number"
          ? { maxItems: object.maxItems }
          : {}),
        ...(typeof object.minItems === "number"
          ? { minItems: object.minItems }
          : {}),
        type: "array",
      };
    }
    case "object": {
      assertExactKeys(
        object,
        ["type", "additionalProperties", "properties", "required"],
        context
      );
      if (object.additionalProperties !== false) {
        throw new TypeError(`${context}.additionalProperties must be false`);
      }
      const propertiesObject = assertObject(
        object.properties,
        `${context}.properties`
      );
      const properties = Object.fromEntries(
        Object.entries(propertiesObject)
          .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
          .map(([key, entry]) => [
            key,
            parseValueSchema(entry, `${context}.properties.${key}`),
          ])
      );
      const required = requiredStringArray(object, "required", context, true);
      for (const key of required) {
        if (!Object.hasOwn(properties, key)) {
          throw new TypeError(`${context}.required references unknown ${key}`);
        }
      }
      return {
        additionalProperties: false,
        properties,
        required: [...required].toSorted(compareCanonicalStrings),
        type: "object",
      };
    }
    default:
      throw new TypeError(
        `${context}.type ${JSON.stringify(type)} is unsupported`
      );
  }
}

function stableFacadeOptions(
  _loaded: LoadedConventionCatalog,
  _compiled: ReturnType<typeof compileCatalog>
): StableFacadeOptions {
  return { exports: [] };
}

type LocaleFile = Readonly<{
  absolutePath: string;
  content: string;
  relativePath: string;
  value: JsonValue;
}>;

type LocaleDirectory = Readonly<{
  kind: "namespace" | "value";
  localeFiles: Readonly<Record<string, LocaleFile>>;
  mount: ReadonlyArray<string>;
}>;

function assertMessagePathSegment(segment: string, context: string): void {
  if (
    segment.length === 0 ||
    segment.normalize("NFC") !== segment ||
    segment.includes(".")
  ) {
    throw new Error(
      `${context} must be a non-empty NFC message-path segment without dots`
    );
  }
}

async function discoverSource(
  source: ResolvedCatalogConfig["sources"][number],
  locales: ReadonlyArray<string>
): Promise<
  Readonly<{
    directories: ReadonlyArray<LocaleDirectory>;
    files: ReadonlyArray<SourceFileEvidence>;
    root: string;
    watchFiles: ReadonlyArray<string>;
  }>
> {
  const configuredRoot = resolve(source.physicalRoot);
  const root = await realpath(configuredRoot).catch((error: unknown) => {
    throw new Error(`Unable to resolve source root ${source.root}`, {
      cause: error,
    });
  });
  if (!within(source.withinRoot, root)) {
    throw new Error(
      source.dependency
        ? `Source root ${source.root} escapes dependency package root ${source.dependency}`
        : `Source root ${source.root} escapes the config directory`
    );
  }
  const exclusions = new Set(source.excludeDirectories);
  const flatten = new Set(source.flattenDirectories);
  const directories: Array<LocaleDirectory> = [];
  const files: Array<SourceFileEvidence> = [];
  const visited = new Set<string>();

  const walk = async (
    physicalDirectory: string,
    logicalParts: ReadonlyArray<string>
  ): Promise<void> => {
    const canonicalDirectory = await realpath(physicalDirectory);
    if (visited.has(canonicalDirectory)) {
      throw new Error(
        `Source symlink cycle or duplicate directory at ${logicalParts.join("/")}`
      );
    }
    visited.add(canonicalDirectory);
    const entries = (
      await readdir(physicalDirectory, { withFileTypes: true })
    ).toSorted((left, right) => compareCanonicalStrings(left.name, right.name));
    const jsonEntries = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json")
    );
    if (jsonEntries.length > 0) {
      const valueEntries = jsonEntries.filter((entry) =>
        entry.name.endsWith(".value.json")
      );
      const namespaceEntries = jsonEntries.filter(
        (entry) => !entry.name.endsWith(".value.json")
      );
      if (valueEntries.length > 0 && namespaceEntries.length > 0) {
        throw new Error(
          `${logicalParts.join("/") || source.root} cannot mix <locale>.json and <locale>.value.json files`
        );
      }
      const kind = valueEntries.length > 0 ? "value" : "namespace";
      const selectedEntries =
        kind === "value" ? valueEntries : namespaceEntries;
      const suffix = kind === "value" ? ".value.json" : ".json";
      const byLocale = new Map(
        selectedEntries.map((entry) => [
          entry.name.slice(0, -suffix.length),
          entry,
        ])
      );
      for (const locale of locales) {
        if (!byLocale.has(locale)) {
          throw new Error(
            `${logicalParts.join("/") || source.root} is missing configured locale ${locale}`
          );
        }
      }
      const extra = [...byLocale.keys()].filter(
        (locale) => !locales.includes(locale)
      );
      if (extra.length > 0) {
        throw new Error(
          `${logicalParts.join("/") || source.root} contains unconfigured locale ${extra.toSorted()[0]}`
        );
      }
      const localeFiles: Record<string, LocaleFile> = {};
      for (const locale of locales) {
        const entry = byLocale.get(locale);
        if (!entry) {
          throw new Error(`Missing locale ${locale}`);
        }
        const absolutePath = join(physicalDirectory, entry.name);
        const content = await readFile(absolutePath, "utf8");
        let parsed: unknown;
        try {
          parsed = JSON.parse(content) as unknown;
        } catch (error) {
          throw new Error(
            `Malformed JSON in ${[source.root, ...logicalParts, entry.name].join("/")}`,
            { cause: error }
          );
        }
        const relativePath = [source.root, ...logicalParts, entry.name].join(
          "/"
        );
        localeFiles[locale] = {
          absolutePath,
          content,
          relativePath,
          value:
            kind === "namespace"
              ? toJsonValue(assertObject(parsed, relativePath), relativePath)
              : toJsonValue(parsed, relativePath),
        };
        files.push({ hash: sha256(content), path: relativePath });
      }
      const mount =
        logicalParts.length > 0 && flatten.has(logicalParts[0] ?? "")
          ? logicalParts.slice(1)
          : logicalParts;
      const mountedPath = [...source.mount, ...mount];
      if (kind === "value" && mountedPath.length === 0) {
        throw new Error(
          `${logicalParts.join("/") || source.root} value locale files require a message path directory`
        );
      }
      directories.push({ kind, localeFiles, mount: mountedPath });
    }

    for (const entry of entries) {
      if (
        entry.name.endsWith(".json") ||
        exclusions.has(entry.name) ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      assertMessagePathSegment(
        entry.name,
        `Source directory ${[...logicalParts, entry.name].join("/")}`
      );
      const absolutePath = join(physicalDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(absolutePath);
        if (!within(root, target)) {
          throw new Error(
            `Source symlink escapes configured source root: ${[...logicalParts, entry.name].join("/")}`
          );
        }
        const targetStat = await stat(target);
        if (targetStat.isDirectory()) {
          await walk(target, [...logicalParts, entry.name]);
        }
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolutePath, [...logicalParts, entry.name]);
      }
    }
  };

  await walk(root, []);
  if (directories.length === 0) {
    throw new Error(`Source root ${source.root} contains no locale files`);
  }
  return {
    directories: directories.toSorted((left, right) =>
      compareCanonicalStrings(left.mount.join("."), right.mount.join("."))
    ),
    files: files.toSorted((left, right) =>
      compareCanonicalStrings(left.path, right.path)
    ),
    root,
    watchFiles: directories
      .flatMap((directory) =>
        Object.values(directory.localeFiles).map((file) => file.absolutePath)
      )
      .toSorted(compareCanonicalStrings),
  };
}

function jsonValueKind(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value === "object" ? "object" : typeof value;
}

function toJsonValue(value: unknown, context: string): JsonValue {
  try {
    canonicalJson(value);
  } catch (error) {
    throw new TypeError(`${context} is not a canonical JSON value`, {
      cause: error,
    });
  }
  return value as JsonValue;
}

function mergeValueSchemas(
  schemas: ReadonlyArray<ValueSchema>,
  context: string
): ValueSchema {
  const first = schemas[0];
  if (!first) {
    throw new Error(`${context} cannot infer a schema from no values`);
  }
  if (schemas.some((schema) => schema.type !== first.type)) {
    throw new Error(`${context} contains heterogeneous values`);
  }
  if (first.type === "number") {
    return {
      finite: true,
      ...(schemas.every(
        (schema) => schema.type === "number" && schema.integer === true
      )
        ? { integer: true }
        : {}),
      type: "number",
    };
  }
  if (first.type === "array") {
    return {
      items: mergeValueSchemas(
        schemas.map((schema) => {
          if (schema.type !== "array") {
            throw new Error(`${context} contains heterogeneous values`);
          }
          return schema.items;
        }),
        `${context}[]`
      ),
      minItems: 1,
      type: "array",
    };
  }
  if (first.type === "object") {
    const required = first.required.toSorted(compareCanonicalStrings);
    for (const schema of schemas) {
      if (
        schema.type !== "object" ||
        canonicalJson(schema.required.toSorted(compareCanonicalStrings)) !==
          canonicalJson(required)
      ) {
        throw new Error(`${context} contains objects with different shapes`);
      }
    }
    return {
      additionalProperties: false,
      properties: Object.fromEntries(
        required.map((key) => [
          key,
          mergeValueSchemas(
            schemas.map((schema) => {
              if (schema.type !== "object") {
                throw new Error(`${context} contains heterogeneous values`);
              }
              const property = schema.properties[key];
              if (!property) {
                throw new Error(
                  `${context} contains objects with different shapes`
                );
              }
              return property;
            }),
            `${context}.${key}`
          ),
        ])
      ),
      required,
      type: "object",
    };
  }
  return first;
}

function inferValueSchema(value: JsonValue, context: string): ValueSchema {
  if (value === null) {
    throw new Error(`${context} cannot infer a value schema from null`);
  }
  if (typeof value === "string") {
    return { type: "string" };
  }
  if (typeof value === "boolean") {
    return { type: "boolean" };
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${context} requires a finite number`);
    }
    return {
      finite: true,
      ...(Number.isInteger(value) ? { integer: true } : {}),
      type: "number",
    };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(`${context} cannot infer an empty value array`);
    }
    return {
      items: mergeValueSchemas(
        value.map((entry, index) =>
          inferValueSchema(entry, `${context}[${String(index)}]`)
        ),
        context
      ),
      minItems: 1,
      type: "array",
    };
  }

  const required = Object.keys(value).toSorted(compareCanonicalStrings);
  return {
    additionalProperties: false,
    properties: Object.fromEntries(
      required.map((key) => [
        key,
        inferValueSchema(value[key] as JsonValue, `${context}.${key}`),
      ])
    ),
    required,
    type: "object",
  };
}

function validateInferredValue(
  value: JsonValue,
  schema: ValueSchema,
  context: string
): void {
  if (value === null) {
    throw new Error(`${context} cannot be null`);
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") {
        throw new Error(`${context} must be a string`);
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(`${context} must be a boolean`);
      }
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${context} must be a finite number`);
      }
      if (schema.integer === true && !Number.isInteger(value)) {
        throw new Error(`${context} must be an integer`);
      }
      return;
    case "array":
      if (!Array.isArray(value)) {
        throw new Error(`${context} must be an array`);
      }
      if (value.length === 0) {
        throw new Error(`${context} cannot be an empty value array`);
      }
      value.forEach((entry, index) =>
        validateInferredValue(
          entry,
          schema.items,
          `${context}[${String(index)}]`
        )
      );
      return;
    case "object": {
      if (Array.isArray(value) || typeof value !== "object") {
        throw new Error(`${context} must be an object`);
      }
      const keys = Object.keys(value).toSorted(compareCanonicalStrings);
      if (canonicalJson(keys) !== canonicalJson(schema.required)) {
        throw new Error(`${context} has a fixed-shape object mismatch`);
      }
      for (const key of schema.required) {
        const property = schema.properties[key];
        if (!property) {
          throw new Error(`${context} schema is missing property ${key}`);
        }
        validateInferredValue(
          value[key] as JsonValue,
          property,
          `${context}.${key}`
        );
      }
      return;
    }
    default:
      throw new Error(`${context} uses an unsupported inferred value schema`);
  }
}

function messagesFromDirectory(
  directory: LocaleDirectory,
  locales: ReadonlyArray<string>,
  sourceLocale: string,
  schema: MessageSchema,
  usedDeclarations: Set<string>
): ReadonlyArray<MessageSource> {
  const messages: Array<MessageSource> = [];

  if (directory.kind === "value") {
    const path = directory.mount.join(".");
    if (schema.messages[path]) {
      throw new Error(
        `${path} cannot use both <locale>.value.json inference and a configured value schema`
      );
    }
    const sourceValue = directory.localeFiles[sourceLocale]?.value;
    if (sourceValue === undefined) {
      throw new Error(`Missing source locale ${sourceLocale}`);
    }
    const resultSchema = inferValueSchema(
      sourceValue,
      `${path} ${sourceLocale}`
    );
    const translations = Object.fromEntries(
      locales.map((locale) => {
        const file = directory.localeFiles[locale];
        if (!file) {
          throw new Error(`Missing locale ${locale}`);
        }
        validateInferredValue(file.value, resultSchema, `${path} ${locale}`);
        return [locale, file.value];
      })
    );
    messages.push({
      kind: "value",
      path,
      provenance: locales
        .map((locale) => directory.localeFiles[locale]?.relativePath ?? locale)
        .join(" | "),
      resultSchema,
      translations,
      valuesSchema: emptyObjectSchema,
    });
    return messages;
  }

  const walk = (
    pathParts: ReadonlyArray<string>,
    values: Readonly<Record<string, unknown>>,
    jsonPath: ReadonlyArray<string>
  ): void => {
    const path = pathParts.join(".");
    const declaration = path ? schema.messages[path] : undefined;
    if (declaration?.kind === "value") {
      usedDeclarations.add(path);
      const translations = Object.fromEntries(
        locales.map((locale) => [
          locale,
          toJsonValue(values[locale], `${path} ${locale}`),
        ])
      );
      messages.push({
        kind: "value",
        path,
        provenance: locales
          .map(
            (locale) =>
              `${directory.localeFiles[locale]?.relativePath ?? locale}#${jsonPath.join(".")}`
          )
          .join(" | "),
        resultSchema: declaration.resultSchema ?? { type: "string" },
        translations,
        valuesSchema: emptyObjectSchema,
      });
      return;
    }

    const kinds = new Set(
      locales.map((locale) => jsonValueKind(values[locale]))
    );
    if (kinds.size !== 1) {
      throw new Error(
        `${path || "<root>"} has cross-locale kind mismatch: ${locales
          .map((locale) => `${locale}=${jsonValueKind(values[locale])}`)
          .join(", ")}`
      );
    }
    const kind = kinds.values().next().value;
    if (kind === "string") {
      const translations = Object.fromEntries(
        locales.map((locale) => [locale, values[locale] as string])
      );
      const inferred = inferMessageContract(path, translations, locales);
      messages.push({
        formatterIds: inferred.formatterIds,
        kind: inferred.kind,
        path,
        provenance: locales
          .map(
            (locale) =>
              `${directory.localeFiles[locale]?.relativePath ?? locale}#${jsonPath.join(".")}`
          )
          .join(" | "),
        resultSchema: { type: "string" },
        tags: inferred.tags,
        translations,
        valuesSchema: inferred.valuesSchema,
      });
      return;
    }
    if (kind !== "object") {
      throw new Error(
        `${path || "<root>"} is ${kind}; declare the exact path as a value message`
      );
    }
    const objects = Object.fromEntries(
      locales.map((locale) => [
        locale,
        assertObject(values[locale], `${path || "<root>"} ${locale}`),
      ])
    );
    const baseline = objects[sourceLocale];
    if (!baseline) {
      throw new Error(`Missing source locale ${sourceLocale}`);
    }
    const expectedKeys = Object.keys(baseline).toSorted(
      compareCanonicalStrings
    );
    for (const locale of locales) {
      const currentKeys = Object.keys(objects[locale] ?? {}).toSorted(
        compareCanonicalStrings
      );
      if (canonicalJson(currentKeys) !== canonicalJson(expectedKeys)) {
        throw new Error(
          `${path || "<root>"} locale keys differ between ${sourceLocale} and ${locale}`
        );
      }
    }
    for (const key of expectedKeys) {
      assertMessagePathSegment(
        key,
        `Translation key ${[...jsonPath, key].join(".")}`
      );
      walk(
        [...pathParts, key],
        Object.fromEntries(
          locales.map((locale) => [locale, objects[locale]?.[key]])
        ),
        [...jsonPath, key]
      );
    }
  };

  walk(
    directory.mount,
    Object.fromEntries(
      locales.map((locale) => [locale, directory.localeFiles[locale]?.value])
    ),
    []
  );
  return messages;
}

function messageContractIdentity(
  messages: ReadonlyArray<MessageSource>
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return messages.map((message) => ({
    formatterIds: message.formatterIds ?? [],
    kind: message.kind,
    path: message.path,
    resultSchema: message.resultSchema,
    tags: message.tags ?? [],
    valuesSchema: message.valuesSchema,
  }));
}

async function gitEvidence(start: string): Promise<GitEvidence> {
  try {
    const { stdout: rootOutput } = await execFileAsync("git", [
      "-C",
      start,
      "rev-parse",
      "--show-toplevel",
    ]);
    const root = rootOutput.trim();
    const head = await execFileAsync("git", ["-C", root, "rev-parse", "HEAD"])
      .then(({ stdout }) => stdout.trim())
      .catch(() => null);
    const { stdout } = await execFileAsync("git", [
      "-C",
      root,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    const status = stdout
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .toSorted(compareCanonicalStrings);
    return { dirty: status.length > 0, head, root, status };
  } catch {
    return { dirty: true, head: null, root: null, status: ["git-unavailable"] };
  }
}

async function packageVersion(
  repositoryRoot: string,
  packageName: string
): Promise<string | null> {
  const direct = join(
    repositoryRoot,
    "node_modules",
    ...packageName.split("/"),
    "package.json"
  );
  try {
    const value = assertObject(
      JSON.parse(await readFile(direct, "utf8")) as unknown,
      `${packageName} package.json`
    );
    return typeof value.version === "string" ? value.version : null;
  } catch {
    return null;
  }
}

async function resolvedPackageVersion(
  packageName: string
): Promise<string | null> {
  try {
    let current = dirname(requireFromCompiler.resolve(packageName));
    for (;;) {
      const packageJsonPath = join(current, "package.json");
      try {
        const value = assertObject(
          JSON.parse(await readFile(packageJsonPath, "utf8")) as unknown,
          `${packageName} package.json`
        );
        if (value.name === packageName) {
          return typeof value.version === "string" ? value.version : null;
        }
      } catch (error) {
        const code =
          error && typeof error === "object"
            ? Reflect.get(error, "code")
            : undefined;
        if (code !== "ENOENT") {
          throw error;
        }
      }
      const parent = dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  } catch {
    return null;
  }
}

function dependencyRecords(value: JsonObject): ReadonlyArray<JsonObject> {
  return [
    value.dependencies,
    value.devDependencies,
    value.optionalDependencies,
    value.unsavedDependencies,
  ].filter(isPlainObject);
}

export function resolvePnpmInstalledTuple(
  input: unknown
): Readonly<Record<string, string | null>> {
  const roots = Array.isArray(input) ? input.filter(isPlainObject) : [];
  const versions = new Map<string, Set<string>>(
    tuplePackages.map((packageName) => [packageName, new Set<string>()])
  );
  const directVersions = new Map<string, string>();
  const visited = new Set<JsonObject>();

  const visit = (node: JsonObject, root: boolean): void => {
    if (visited.has(node)) {
      return;
    }
    visited.add(node);
    for (const dependencies of dependencyRecords(node)) {
      for (const [packageName, dependency] of Object.entries(dependencies)) {
        if (!isPlainObject(dependency)) {
          continue;
        }
        if (
          tuplePackages.includes(
            packageName as (typeof tuplePackages)[number]
          ) &&
          typeof dependency.version === "string"
        ) {
          versions.get(packageName)?.add(dependency.version);
          if (root) {
            directVersions.set(packageName, dependency.version);
          }
        }
        visit(dependency, false);
      }
    }
  };

  for (const root of roots) {
    visit(root, true);
  }

  return Object.fromEntries(
    tuplePackages.map((packageName) => {
      const direct = directVersions.get(packageName);
      const discovered = [...(versions.get(packageName) ?? [])].toSorted(
        compareCanonicalStrings
      );
      return [
        packageName,
        direct ?? (discovered.length === 1 ? (discovered[0] ?? null) : null),
      ];
    })
  );
}

async function targetPnpmProject(
  input: unknown,
  repositoryRoot: string
): Promise<JsonObject> {
  if (!Array.isArray(input)) {
    throw new TypeError("pnpm list output must be an array");
  }
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const matches: Array<JsonObject> = [];
  for (const project of input) {
    if (!isPlainObject(project) || typeof project.path !== "string") {
      continue;
    }
    const canonicalProjectPath = await realpath(project.path).catch(() => null);
    if (canonicalProjectPath === canonicalRepositoryRoot) {
      matches.push(project);
    }
  }
  if (matches.length !== 1) {
    throw new Error(
      `pnpm list output must contain exactly one target project for ${canonicalRepositoryRoot}`
    );
  }
  return matches[0] as JsonObject;
}

async function installedTuple(
  repositoryRoot: string,
  packageManager: unknown
): Promise<Readonly<Record<string, string | null>>> {
  if (
    typeof packageManager === "string" &&
    packageManager.startsWith("pnpm@")
  ) {
    try {
      const { stdout } = await execFileAsync(
        "pnpm",
        ["list", "--json", "--depth", "Infinity", ...tuplePackages],
        { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
      );
      const output = JSON.parse(stdout) as unknown;
      const targetProject = await targetPnpmProject(output, repositoryRoot);
      return resolvePnpmInstalledTuple([targetProject]);
    } catch {
      // Preserve a useful non-authoritative report when the declared package
      // manager is unavailable; direct links still prove their own versions.
    }
  }
  return Object.fromEntries(
    await Promise.all(
      tuplePackages.map(async (packageName) => [
        packageName,
        await packageVersion(repositoryRoot, packageName),
      ])
    )
  );
}

async function regularFileExists(
  path: string,
  label: string
): Promise<boolean> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
    return true;
  } catch (error) {
    if (fileSystemErrorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function lockfileHasImporter(lockfile: string, importer: string): boolean {
  const importerKeys = [
    importer,
    `'${importer.replaceAll("'", "''")}'`,
    JSON.stringify(importer),
  ];
  let inImporters = false;
  for (const rawLine of lockfile.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!inImporters) {
      inImporters = line === "importers:";
      continue;
    }
    if (line.trim().length === 0) {
      continue;
    }
    if (!line.startsWith(" ")) {
      return false;
    }
    if (importerKeys.some((key) => line === `  ${key}:`)) {
      return true;
    }
  }
  return false;
}

async function workspaceIncludesPackage(
  workspaceRoot: string,
  packageRoot: string
): Promise<boolean> {
  let projects: unknown;
  try {
    const { stdout } = await execFileAsync(
      "pnpm",
      [
        "--dir",
        workspaceRoot,
        "list",
        "--recursive",
        "--depth",
        "-1",
        "--json",
      ],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
    );
    projects =
      stdout.trim().length === 0 ? [] : (JSON.parse(stdout) as unknown);
  } catch (error) {
    throw new Error(
      "Unable to collect environment evidence: pnpm could not verify workspace package membership",
      { cause: error }
    );
  }
  if (!Array.isArray(projects)) {
    throw new Error(
      "Unable to collect environment evidence: pnpm workspace package membership was not an array"
    );
  }
  for (const project of projects) {
    if (!isPlainObject(project) || typeof project.path !== "string") {
      continue;
    }
    const canonicalPath = await realpath(project.path).catch(() => null);
    if (canonicalPath === packageRoot) {
      return true;
    }
  }
  return false;
}

async function pnpmLockfileEvidence(
  packageRoot: string
): Promise<Readonly<{ content: string }>> {
  let directory = packageRoot;
  while (true) {
    const lockfilePath = join(directory, "pnpm-lock.yaml");
    const hasLockfile = await regularFileExists(lockfilePath, "pnpm-lock.yaml");
    if (directory === packageRoot && hasLockfile) {
      return { content: await readFile(lockfilePath, "utf8") };
    }

    const hasWorkspaceManifest = await regularFileExists(
      join(directory, "pnpm-workspace.yaml"),
      "pnpm-workspace.yaml"
    );
    if (hasWorkspaceManifest && hasLockfile) {
      const content = await readFile(lockfilePath, "utf8");
      const importer = relative(directory, packageRoot).split(sep).join("/");
      if (
        lockfileHasImporter(content, importer) &&
        (await workspaceIncludesPackage(directory, packageRoot))
      ) {
        return { content };
      }
    }

    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        "Unable to collect environment evidence: no pnpm-lock.yaml exists at the package root and no parent pnpm workspace lockfile includes the target package importer"
      );
    }
    directory = parent;
  }
}

async function collectEnvironment(
  loaded: LoadedConventionCatalog
): Promise<CatalogEnvironmentEvidence> {
  const packageJsonPath = join(loaded.repositoryRoot, "package.json");
  const [packageJson, lockfileEvidence, appGit] = await Promise.all([
    readFile(packageJsonPath, "utf8"),
    pnpmLockfileEvidence(loaded.repositoryRoot),
    gitEvidence(loaded.repositoryRoot),
  ]);
  const compilerStart = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );
  const compilerGit = await gitEvidence(compilerStart);
  const packageJsonObject = assertObject(
    JSON.parse(packageJson) as unknown,
    "application package.json"
  );
  const resolvedInstalledTuple = await installedTuple(
    loaded.repositoryRoot,
    packageJsonObject.packageManager
  );
  return {
    appGit,
    compilerGit,
    installedTuple: resolvedInstalledTuple,
    lockfileHash: sha256(lockfileEvidence.content),
    packageJsonHash: sha256(packageJson),
  };
}

function artifactBytes(artifacts: EmittedArtifacts): number {
  return Object.values(artifacts).reduce(
    (total, content) => total + Buffer.byteLength(content, "utf8"),
    0
  );
}

function artifactEvidence(
  artifacts: EmittedArtifacts
): ConventionReport["artifacts"] {
  return {
    files: Object.fromEntries(
      Object.entries(artifacts)
        .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([name, content]) => [
          name,
          {
            bytes: Buffer.byteLength(content, "utf8"),
            hash: sha256(content),
          },
        ])
    ) as ConventionReport["artifacts"]["files"],
    totalBytes: artifactBytes(artifacts),
  };
}

function visitIrNodes(
  nodes: ReadonlyArray<IrNode>,
  visit: (node: IrNode) => void
): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === "plural" || node.type === "select") {
      for (const option of Object.values(node.options)) {
        visitIrNodes(option, visit);
      }
    } else if (node.type === "tag") {
      visitIrNodes(node.children, visit);
    }
  }
}

function argumentRoleCounts(
  source: CatalogSource
): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const message of source.messages) {
    if (message.kind === "value") {
      continue;
    }
    const translation = message.translations[source.sourceLocale];
    if (typeof translation !== "string") {
      throw new Error(
        `${message.path} ${source.sourceLocale} must be a string for report generation`
      );
    }
    const roles = new Set<string>();
    visitIrNodes(inspectMessageSyntax(translation).nodes, (node) => {
      let role: string | undefined;
      switch (node.type) {
        case "argument": {
          const property = message.valuesSchema.properties[node.name];
          role = `argument:${property?.type ?? "unknown"}`;
          break;
        }
        case "date":
        case "number":
        case "select":
        case "time":
          role = node.type;
          break;
        case "plural":
          role = `plural:${node.pluralType}`;
          break;
        case "literal":
        case "pound":
        case "tag":
          break;
      }
      if (role) {
        let argumentName = "";
        if ("name" in node && typeof node.name === "string") {
          argumentName = node.name;
        }
        roles.add(`${argumentName}\u0000${role}`);
      }
    });
    for (const entry of roles) {
      const role = entry.slice(entry.indexOf("\u0000") + 1);
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].toSorted(([left], [right]) =>
      compareCanonicalStrings(left, right)
    )
  );
}

function localeCounts(
  loaded: LoadedConventionCatalog
): ConventionReport["catalog"]["localeCounts"] {
  return Object.fromEntries(
    loaded.source.locales.map((locale) => [
      locale,
      {
        messageCount: loaded.source.messages.length,
        sourceFileCount: loaded.inputs.sourceFiles.filter(
          (file) =>
            file.path === `${locale}.json` ||
            file.path.endsWith(`/${locale}.json`)
        ).length,
      },
    ])
  );
}

function installedTupleComplete(
  tuple: Readonly<Record<string, string | null>>
): boolean {
  const commonPackages = tuplePackages.filter(
    (packageName) => packageName !== "next" && packageName !== "vite"
  );
  return (
    commonPackages.every(
      (packageName) => typeof tuple[packageName] === "string"
    ) &&
    (typeof tuple.next === "string" || typeof tuple.vite === "string")
  );
}

async function createReport(
  loaded: LoadedConventionCatalog,
  artifacts: EmittedArtifacts,
  options: ConventionOptions
): Promise<ConventionReport> {
  const compiled = compileCatalog(loaded.source);
  const environment =
    options.collectEnvironment === false
      ? null
      : await collectEnvironment(loaded);
  const parserVersion = await resolvedPackageVersion(
    "@formatjs/icu-messageformat-parser"
  );
  const messageCounts = { rich: 0, text: 0, value: 0 };
  for (const message of compiled.catalog.messages) {
    messageCounts[message.kind] += 1;
  }
  const contentHash = sha256(canonicalJson(artifacts));
  const authoritative = Boolean(
    environment &&
    environment.appGit.head &&
    !environment.appGit.dirty &&
    environment.compilerGit.head &&
    !environment.compilerGit.dirty &&
    installedTupleComplete(environment.installedTuple) &&
    parserVersion
  );
  return {
    artifacts: artifactEvidence(artifacts),
    authoritative,
    catalog: {
      argumentRoleCounts: argumentRoleCounts(loaded.source),
      buildId: compiled.catalog.manifest.buildId,
      buildToken: compiled.catalog.manifest.buildToken,
      capabilitySetHash: compiled.catalog.manifest.capabilitySetHash,
      catalogHash: compiled.catalog.manifest.hash,
      catalogId: compiled.catalog.manifest.catalogId,
      catalogPackage: compiled.catalog.manifest.catalogPackage,
      contentHash,
      formatterVersions: compiled.catalog.manifest.formatterVersions,
      formatVersion: FORMAT_VERSION,
      localeCounts: localeCounts(loaded),
      localeHashes: compiled.catalog.manifest.localeHashes,
      locales: compiled.catalog.manifest.locales,
      messageCounts,
      rendererCapabilityId: compiled.catalog.manifest.rendererCapabilityId,
      runtimeAbi: RUNTIME_ABI,
      sourceLocale: compiled.catalog.manifest.sourceLocale,
    },
    compiler: { parserVersion, version: COMPILER_VERSION },
    contracts: {
      discovery: {
        hash: loaded.inputs.discoveryPolicyHash,
        mode: "convention",
        schemaVersion: 1,
      },
      exceptions: {
        hash: loaded.inputs.exceptionsHash,
        present: loaded.inputs.exceptionsPresent,
        schemaVersion: 1,
      },
      messages: {
        generated: true,
        hash: loaded.inputs.messageContractHash,
        schemaVersion: 1,
        source: "message-ast",
      },
    },
    diagnostics: [],
    discovery: loaded.discovery,
    environment,
    inputs: loaded.inputs,
    representation: loaded.config.representation,
    schemaVersion: 1,
  };
}

async function conventionalLocales(
  sourceRoot: string
): Promise<ReadonlyArray<string>> {
  const localeSets: Array<ReadonlyArray<string>> = [];
  const excluded = new Set(["combined", "generated", "node_modules"]);
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const locales = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const suffix = entry.name.endsWith(".value.json")
          ? ".value.json"
          : ".json";
        const locale = entry.name.slice(0, -suffix.length);
        assertMessagePathSegment(locale, `Locale file ${entry.name}`);
        return locale;
      })
      .toSorted(compareCanonicalStrings);
    if (locales.length > 0) {
      localeSets.push(locales);
    }
    for (const entry of entries) {
      if (excluded.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Convention locale discovery does not follow symbolic link ${relative(sourceRoot, path)}`
        );
      }
      if (entry.isDirectory()) {
        await walk(path);
      }
    }
  };
  await walk(sourceRoot);
  const baseline = localeSets[0];
  if (!baseline || baseline.length === 0) {
    throw new Error("Convention locale discovery found no paired locale files");
  }
  for (const current of localeSets) {
    if (canonicalJson(current) !== canonicalJson(baseline)) {
      throw new Error(
        `Convention locale directories disagree: expected ${baseline.join(",")}, found ${current.join(",")}`
      );
    }
  }
  return baseline;
}

function packageDependencies(packageJson: JsonObject): ReadonlySet<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"] as const) {
    const value = packageJson[field];
    if (value === undefined) {
      continue;
    }
    for (const name of Object.keys(
      assertObject(value, `package.json ${field}`)
    )) {
      names.add(name);
    }
  }
  return names;
}

type MountedSourceDeclaration = Readonly<{
  from: string;
  mount: string;
  mountParts: ReadonlyArray<string>;
  path: string;
}>;

const dependencyPackageName = /^(?:@[a-z\d][a-z\d._-]*\/)?[a-z\d][a-z\d._-]*$/u;

function normalizedMountedSourcePath(path: string, context: string): string {
  const segments = path.split(/[\\/]/u);
  if (
    segments.length === 0 ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new TypeError(`${context} must stay inside its dependency package`);
  }
  return segments.join("/");
}

function mountedSourceDeclarations(
  value: unknown,
  configContext: string
): ReadonlyArray<MountedSourceDeclaration> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${configContext}.sources must be a non-empty array`);
  }
  const declarations = value.map((entry, index) => {
    const context = `${configContext}.sources[${index}]`;
    const object = assertObject(entry, context);
    assertExactKeys(object, ["from", "mount", "path"], context);
    const from = requiredString(object, "from", context);
    if (!dependencyPackageName.test(from)) {
      throw new TypeError(`${context}.from must be an exact npm package name`);
    }
    const path = normalizedMountedSourcePath(
      requiredString(object, "path", context),
      `${context}.path`
    );
    const mount = requiredString(object, "mount", context);
    const mountParts = mount.split(".");
    for (const segment of mountParts) {
      assertMessagePathSegment(segment, `${context}.mount`);
    }
    return { from, mount, mountParts, path };
  });
  const ordered = declarations.toSorted(
    (left, right) =>
      compareCanonicalStrings(left.mount, right.mount) ||
      compareCanonicalStrings(left.from, right.from) ||
      compareCanonicalStrings(left.path, right.path)
  );
  for (const [index, declaration] of ordered.entries()) {
    if (index > 0 && ordered[index - 1]?.mount === declaration.mount) {
      throw new Error(
        `${configContext}.sources has duplicate mount ${declaration.mount}`
      );
    }
  }
  return ordered;
}

async function resolveMountedSource(
  repositoryRoot: string,
  dependencies: ReadonlySet<string>,
  declaration: MountedSourceDeclaration
): Promise<ResolvedCatalogSource> {
  if (!dependencies.has(declaration.from)) {
    throw new Error(
      `Mounted translation source ${declaration.from} must be declared in package.json dependencies`
    );
  }
  const requireFromApp = createRequire(join(repositoryRoot, "package.json"));
  const packageSegments = declaration.from.split("/");
  const searchRoots = [
    join(repositoryRoot, "node_modules"),
    ...(requireFromApp.resolve.paths(declaration.from) ?? []),
  ];
  let dependencyRoot: string | undefined;
  for (const searchRoot of new Set(searchRoots)) {
    const installedPath = join(searchRoot, ...packageSegments);
    try {
      dependencyRoot = await realpath(installedPath);
    } catch (error) {
      if (
        fileSystemErrorCode(error) === "ENOENT" ||
        fileSystemErrorCode(error) === "ENOTDIR"
      ) {
        continue;
      }
      throw error;
    }
    const dependencyStat = await stat(dependencyRoot);
    if (!dependencyStat.isDirectory()) {
      throw new Error(
        `Mounted translation dependency ${declaration.from} must resolve to a package directory`
      );
    }
    const dependencyPackagePath = join(dependencyRoot, "package.json");
    const dependencyPackage = assertObject(
      JSON.parse(await readFile(dependencyPackagePath, "utf8")) as unknown,
      `${declaration.from} package.json`
    );
    const resolvedName = requiredString(
      dependencyPackage,
      "name",
      `${declaration.from} package.json`
    );
    if (resolvedName !== declaration.from) {
      throw new Error(
        `Mounted translation dependency ${declaration.from} resolved package name ${resolvedName}`
      );
    }
    break;
  }
  if (!dependencyRoot) {
    throw new Error(
      `Mounted translation dependency ${declaration.from} must be installed for package ${repositoryRoot}`
    );
  }
  const physicalRoot = resolve(dependencyRoot, declaration.path);
  if (!within(dependencyRoot, physicalRoot)) {
    throw new Error(
      `Mounted translation source ${declaration.from} path must stay inside its dependency package`
    );
  }
  const canonicalSourceRoot = await realpath(physicalRoot).catch(
    (error: unknown) => {
      throw new Error(
        `Unable to resolve mounted translation source ${declaration.from}/${declaration.path}`,
        { cause: error }
      );
    }
  );
  if (!within(dependencyRoot, canonicalSourceRoot)) {
    throw new Error(
      `Mounted translation source ${declaration.from}/${declaration.path} escapes dependency package root`
    );
  }
  return {
    dependency: declaration.from,
    excludeDirectories: ["combined", "generated", "node_modules"],
    flattenDirectories: ["global"],
    mount: declaration.mountParts,
    physicalRoot: canonicalSourceRoot,
    root: `node_modules/${declaration.from}/${declaration.path}`,
    withinRoot: dependencyRoot,
  };
}

type ConventionExceptions = Readonly<{
  formatterVersions: Readonly<Record<string, string>>;
  present: boolean;
  schema: MessageSchema;
  sources: ReadonlyArray<MountedSourceDeclaration>;
  sourceLocale?: string;
}>;

function emptyConventionExceptions(): ConventionExceptions {
  return {
    formatterVersions: {},
    present: false,
    schema: { messages: {} },
    sources: [],
  };
}

function conventionExceptions(
  value: unknown,
  configContext: string
): ConventionExceptions {
  const root = assertObject(value, configContext);
  assertExactKeys(
    root,
    ["formatterVersions", "sourceLocale", "sources", "values"],
    configContext
  );
  const formatterObject =
    "formatterVersions" in root
      ? assertObject(
          root.formatterVersions,
          `${configContext}.formatterVersions`
        )
      : {};
  const formatterVersions = Object.fromEntries(
    Object.entries(formatterObject)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([id, version]) => {
        if (
          id.length === 0 ||
          id.normalize("NFC") !== id ||
          typeof version !== "string" ||
          version.length === 0 ||
          version.normalize("NFC") !== version
        ) {
          throw new TypeError(
            `${configContext} formatter registrations require non-empty NFC IDs and versions`
          );
        }
        return [id, version];
      })
  );
  const valuesObject =
    "values" in root
      ? assertObject(root.values, `${configContext}.values`)
      : {};
  const messages = Object.fromEntries(
    Object.entries(valuesObject)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([path, resultSchema]) => [
        path,
        {
          kind: "value" as const,
          resultSchema: parseValueSchema(
            resultSchema,
            `${configContext}.values.${path}`
          ),
        },
      ])
  );
  const sourceLocaleValue = root.sourceLocale;
  if (
    sourceLocaleValue !== undefined &&
    (typeof sourceLocaleValue !== "string" ||
      sourceLocaleValue.length === 0 ||
      sourceLocaleValue.normalize("NFC") !== sourceLocaleValue)
  ) {
    throw new TypeError(
      `${configContext}.sourceLocale must be a non-empty NFC locale`
    );
  }
  return {
    formatterVersions,
    present: true,
    schema: { messages },
    sources: mountedSourceDeclarations(root.sources, configContext),
    ...(sourceLocaleValue === undefined
      ? {}
      : { sourceLocale: sourceLocaleValue }),
  };
}

export async function loadConventionCatalog(
  packageRoot: string
): Promise<LoadedConventionCatalog> {
  const repositoryRoot = await realpath(resolve(packageRoot));
  const packagePath = join(repositoryRoot, "package.json");
  const packageContent = await readFile(packagePath, "utf8");
  const packageJson = assertObject(
    JSON.parse(packageContent) as unknown,
    "package.json"
  );
  const packageName = requiredString(packageJson, "name", "package.json");
  const packageVersionValue = requiredString(
    packageJson,
    "version",
    "package.json"
  );
  const jsonConfigPath = join(repositoryRoot, "mirai-intl.config.json");
  const hasJsonConfig = await regularFileExists(
    jsonConfigPath,
    "mirai-intl.config.json"
  );
  const hasPackageConfig = Object.hasOwn(packageJson, "miraiIntl");
  if (hasJsonConfig && hasPackageConfig) {
    throw new Error(
      "mirai-intl.config.json and package.json miraiIntl cannot both be present"
    );
  }
  let configPath = packagePath;
  let exceptions = emptyConventionExceptions();
  if (hasJsonConfig) {
    configPath = jsonConfigPath;
    const configContent = await readFile(jsonConfigPath, "utf8");
    let configValue: unknown;
    try {
      configValue = JSON.parse(configContent) as unknown;
    } catch (error) {
      throw new Error("mirai-intl.config.json must contain valid JSON", {
        cause: error,
      });
    }
    exceptions = conventionExceptions(configValue, "mirai-intl.config.json");
  } else if (hasPackageConfig) {
    exceptions = conventionExceptions(
      packageJson.miraiIntl,
      "package.json miraiIntl"
    );
  }
  const dependencies = packageDependencies(packageJson);
  const frameworks: Array<ConventionFramework> = [
    dependencies.has("next") ? "next" : undefined,
    dependencies.has("vite") ? "vite" : undefined,
  ].filter((value): value is ConventionFramework => value !== undefined);
  if (frameworks.length !== 1) {
    throw new Error(
      "Convention discovery requires exactly one Next or Vite framework dependency"
    );
  }

  const framework = frameworks[0];
  if (!framework) {
    throw new Error("Convention framework discovery is missing");
  }
  const candidates = ["src/locales", "locales"] as const;
  const roots: Array<(typeof candidates)[number]> = [];
  for (const candidate of candidates) {
    const path = join(repositoryRoot, candidate);
    try {
      const entry = await lstat(path);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(
          `Convention locale root ${candidate} must be a directory`
        );
      }
      roots.push(candidate);
    } catch (error) {
      if (fileSystemErrorCode(error) !== "ENOENT") {
        throw error;
      }
    }
  }
  if (roots.length !== 1) {
    throw new Error(
      `Convention discovery requires exactly one locale root, found ${roots.join(",") || "none"}`
    );
  }
  const sourceRoot = roots[0];
  if (!sourceRoot) {
    throw new Error("Convention locale root is missing");
  }
  const locales = await conventionalLocales(join(repositoryRoot, sourceRoot));
  let inferredSourceLocale: string | undefined;
  if (locales.includes("en")) {
    inferredSourceLocale = "en";
  } else if (locales.length === 1) {
    inferredSourceLocale = locales[0];
  }
  const sourceLocale = exceptions.sourceLocale ?? inferredSourceLocale;
  if (!sourceLocale) {
    throw new Error(
      `Convention source locale is ambiguous across ${locales.join(",")}; set sourceLocale in mirai-intl.config.json or package.json miraiIntl`
    );
  }
  if (!locales.includes(sourceLocale)) {
    throw new Error(
      `Convention source locale ${sourceLocale} is not one of ${locales.join(",")}`
    );
  }
  const excludedDirectories = [
    "combined",
    "generated",
    "node_modules",
  ] as const;
  const catalogPackage = `${packageName}-intl-catalog`;
  const mountedSources = await Promise.all(
    exceptions.sources.map((source) =>
      resolveMountedSource(repositoryRoot, dependencies, source)
    )
  );
  const config: ResolvedCatalogConfig = {
    catalog: {
      buildId: packageVersionValue,
      id: packageName,
      locales,
      package: catalogPackage,
      rendererCapabilityId: "portable-ir-v1",
      sourceLocale,
    },
    output: "src/i18n/generated",
    representation: "precompiled",
    sources: [
      {
        excludeDirectories: excludedDirectories,
        flattenDirectories: ["global"],
        mount: [],
        physicalRoot: join(repositoryRoot, sourceRoot),
        root: sourceRoot,
        withinRoot: repositoryRoot,
      },
      ...mountedSources,
    ],
  };
  const discovered = await Promise.all(
    config.sources.map((source) =>
      discoverSource(source, config.catalog.locales)
    )
  );
  const usedDeclarations = new Set<string>();
  const messages = discovered
    .flatMap((source) => source.directories)
    .flatMap((directory) =>
      messagesFromDirectory(
        directory,
        config.catalog.locales,
        config.catalog.sourceLocale,
        exceptions.schema,
        usedDeclarations
      )
    )
    .toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
  const unusedDeclarations = Object.keys(exceptions.schema.messages).filter(
    (path) => !usedDeclarations.has(path)
  );
  if (unusedDeclarations.length > 0) {
    throw new Error(
      `Convention value declaration ${unusedDeclarations.toSorted(compareCanonicalStrings)[0]} has no matching source message`
    );
  }
  const source: CatalogSource = {
    buildId: config.catalog.buildId,
    catalogPackage: config.catalog.package,
    id: config.catalog.id,
    locales: config.catalog.locales,
    messages,
    formatterVersions: exceptions.formatterVersions,
    rendererCapabilityId: config.catalog.rendererCapabilityId,
    sourceLocale: config.catalog.sourceLocale,
  };
  compileCatalog(source);
  const outputRoot = await confinedProspectivePath(
    repositoryRoot,
    resolve(repositoryRoot, config.output),
    "output"
  );
  const discovery: ConventionDiscoveryManifest = {
    catalogId: packageName,
    catalogPackage,
    excludedDirectories,
    flattenDirectories: ["global"],
    framework,
    localeRoot: sourceRoot,
    locales,
    output: "src/i18n/generated",
    representation: "precompiled",
    schemaVersion: 1,
    sourceLocale,
  };
  const discoverySources = config.sources
    .map((catalogSource) => ({
      dependency: catalogSource.dependency ?? null,
      mount: catalogSource.mount,
      root: catalogSource.root,
    }))
    .toSorted(
      (left, right) =>
        compareCanonicalStrings(left.mount.join("."), right.mount.join(".")) ||
        compareCanonicalStrings(
          left.dependency ?? "",
          right.dependency ?? ""
        ) ||
        compareCanonicalStrings(left.root, right.root)
    );
  return {
    config,
    configPath,
    discovery,
    inputs: {
      discoveryPolicyHash: sha256(
        canonicalJson({ discovery, sources: discoverySources })
      ),
      exceptionsHash: sha256(
        canonicalJson({
          ...(hasJsonConfig ? { configFile: "mirai-intl.config.json" } : {}),
          formatterVersions: exceptions.formatterVersions,
          sourceLocale: exceptions.sourceLocale ?? null,
          sources: exceptions.sources.map(({ from, mount, path }) => ({
            from,
            mount,
            path,
          })),
          values: exceptions.schema.messages,
        })
      ),
      exceptionsPresent: exceptions.present,
      messageContractHash: sha256(
        canonicalJson(messageContractIdentity(messages))
      ),
      sourceFiles: discovered
        .flatMap((entry) => entry.files)
        .toSorted((left, right) =>
          compareCanonicalStrings(left.path, right.path)
        ),
    },
    outputRoot,
    repositoryRoot,
    source,
    watch: {
      files: [
        ...(hasJsonConfig ? [configPath] : []),
        ...discovered.flatMap((entry) => entry.watchFiles),
      ].toSorted(compareCanonicalStrings),
      roots: discovered
        .map((entry) => entry.root)
        .toSorted(compareCanonicalStrings),
    },
  };
}

export async function generateConventionCatalog(
  packageRoot: string,
  options: ConventionOptions = {}
): Promise<ConventionGenerationResult> {
  const loaded = await loadConventionCatalog(packageRoot);
  const compiled = compileCatalog(loaded.source);
  const artifacts = emitArtifacts(compiled, loaded.config.representation, {
    compact: true,
  });
  const facade = stableFacadeOptions(loaded, compiled);
  const report = await createReport(loaded, artifacts, options);
  const write = await writeArtifactSet(loaded.outputRoot, artifacts, facade, {
    expectedCanonicalRoot: loaded.outputRoot,
  });
  return { report, write };
}

export async function verifyConventionCatalog(
  packageRoot: string,
  options: ConventionOptions = {}
): Promise<
  Readonly<{ report: ConventionReport; valid: true; write: WriteResult }>
> {
  const loaded = await loadConventionCatalog(packageRoot);
  const compiled = compileCatalog(loaded.source);
  const artifacts = emitArtifacts(compiled, loaded.config.representation, {
    compact: true,
  });
  const facade = stableFacadeOptions(loaded, compiled);
  const report = await createReport(loaded, artifacts, options);
  const write = await verifyArtifactSet(loaded.outputRoot, artifacts, facade, {
    expectedCanonicalRoot: loaded.outputRoot,
  });
  return { report, valid: true, write };
}
