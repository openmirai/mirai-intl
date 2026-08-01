import { readFileSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { performance } from "node:perf_hooks";

import { GeneratedFacadeProjectionProofKindV3 } from "@openmirai/intl-abi";
import type {
  GeneratedFacadeCandidateIndexV3,
  GeneratedFacadeProjectedRootV3,
  GeneratedFacadeRootEvidenceV3,
  IntlCheckApplicationIdentityV2,
  IntlCheckApplicationIdentityV3,
  IntlBuildVerificationCountersV2,
  IntlCheckCanonicalJsonV2,
  IntlCheckControlSetV3,
  IntlCheckExceptionV1,
  IntlCheckFileIdentityV2,
  IntlCheckLstatV3,
  IntlCheckModuleBoundaryV3,
  IntlCheckPackageIdentityV2,
  IntlCheckPackageScopeV3,
  IntlCheckPhysicalFrontierV3,
  IntlCheckProbeV3,
  IntlCheckProjectV2,
  IntlCheckProjectV3,
  IntlCheckProviderClosureV2,
  IntlCheckProviderClosureV3,
  IntlCheckProviderKindV2,
  IntlCheckProviderResolutionV3,
  IntlCheckProviderResolutionV2,
  IntlCheckProviderV2,
  IntlCheckProviderV3,
  IntlCheckRealpathV3,
  IntlCheckReceipt,
  IntlCheckReceiptCountersV2,
  IntlCheckReceiptCountersV3,
  IntlCheckReceiptV2,
  IntlCheckReceiptV3,
  IntlCheckResolutionBindingV3,
  IntlCheckResolutionModeV3,
  IntlCheckTablesV3,
  IntlCheckTsconfigFileV3,
  IntlCheckTsconfigFileV2,
  IntlCheckTypeScriptIdentityV2,
  IntlCheckTypeScriptIdentityV3,
  IntlCheckUnknownModuleBoundaryV3,
  IntlSourceClassifierBindingV3,
  IntlSourceLedgerEntryV2,
  IntlSourceLedgerEntryV3,
  IntlSemanticAuthorizationObservationV2,
  Ref,
  RuntimeAbi,
  Sha256,
} from "@openmirai/intl-abi";

import {
  canonicalHash,
  canonicalJson,
  compareCanonicalStrings,
  decodeUtf8Fatal,
  sha256,
} from "./canonical";
import {
  buildMiraiIntlClassifierAuthorityEnvelopeV3,
  buildMiraiIntlPersistedClassifierAuthorityV3,
  canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes,
  hashMiraiIntlClassifierAuthorityEnvelopeV3,
  validateMiraiIntlClassifierAuthorityV3,
} from "./classifier-authority";
import type {
  MiraiIntlClassifierAuthorityEnvelopeV3,
  MiraiIntlClassifierAuthorityV3,
  MiraiIntlPersistedClassifierAuthorityV3,
} from "./classifier-authority";
import type { MiraiIntlClassifierReceiptProjectionV3 } from "./classifier-candidate";
import { hashMiraiIntlClassifierReceiptProjectionV3 } from "./classifier-projection";

const SHA256_PATTERN = /^sha256:[\da-f]{64}$/u;
const WINDOWS_ROOT_PATTERN = /^[A-Za-z]:\//u;
function projectionProofKind(
  value: unknown,
  context: string
): GeneratedFacadeProjectionProofKindV3 {
  switch (value) {
    case GeneratedFacadeProjectionProofKindV3.ABSOLUTE_DIRECT:
    case GeneratedFacadeProjectionProofKindV3.FACADE_PACKAGE_EXPORT:
    case GeneratedFacadeProjectionProofKindV3.PACKAGE_IMPORTS:
    case GeneratedFacadeProjectionProofKindV3.RELATIVE_DIRECT:
    case GeneratedFacadeProjectionProofKindV3.RELATIVE_ROOT_DIRS:
    case GeneratedFacadeProjectionProofKindV3.TSCONFIG_PATHS:
    case GeneratedFacadeProjectionProofKindV3.TSCONFIG_BASE_URL:
    case GeneratedFacadeProjectionProofKindV3.UNMAPPED_EXTERNAL:
      return value;
    default:
      return fail(context, "has an unsupported projection proof kind");
  }
}
const PROVIDER_KINDS = [
  "ambient",
  "external",
  "generated",
  "workspace",
] as const satisfies ReadonlyArray<IntlCheckProviderKindV2>;

type ProjectInput = Omit<
  IntlCheckProjectV2,
  "configManifestHash" | "normalizedOptionsHash"
>;
type ProviderInput = Omit<IntlCheckProviderV2, "declarationHash" | "hash">;
type ProviderClosureInput = Omit<
  IntlCheckProviderClosureV2,
  "closureHash" | "declarationHash" | "libHash" | "providers"
> &
  Readonly<{ providers: ReadonlyArray<ProviderInput> }>;
type SourceInput = Omit<IntlSourceLedgerEntryV2, "providerClosureHash">;

export interface AuthorizationSnapshotCanonicalizationMetrics {
  canonicalHashComputations: number;
  canonicalPathComputations: number;
  fileIdentityComputations: number;
  fileIdentityReuses: number;
  fileListComputations: number;
  fileListReuses: number;
  trustedReceiptReuses: number;
  trustedSnapshotReuses: number;
}

interface CanonicalizationContext {
  fileIdentities: Map<string, IntlCheckFileIdentityV2>;
  fileLists: Map<string, ReadonlyArray<IntlCheckFileIdentityV2>>;
  hashes: WeakMap<object, Sha256>;
  metrics: AuthorizationSnapshotCanonicalizationMetrics;
  paths: Map<string, string>;
}

const trustedReceipts = new WeakSet<object>();
const trustedSnapshots = new WeakSet<object>();

export function createAuthorizationSnapshotCanonicalizationMetrics(): AuthorizationSnapshotCanonicalizationMetrics {
  return {
    canonicalHashComputations: 0,
    canonicalPathComputations: 0,
    fileIdentityComputations: 0,
    fileIdentityReuses: 0,
    fileListComputations: 0,
    fileListReuses: 0,
    trustedReceiptReuses: 0,
    trustedSnapshotReuses: 0,
  };
}

function canonicalizationContext(
  metrics: AuthorizationSnapshotCanonicalizationMetrics
): CanonicalizationContext {
  return {
    fileIdentities: new Map(),
    fileLists: new Map(),
    hashes: new WeakMap(),
    metrics,
    paths: new Map(),
  };
}

export type SourceAuthorizationSnapshot = Readonly<{
  application: IntlCheckApplicationIdentityV2;
  artifactAbi: string;
  compilerManifest: ReadonlyArray<IntlCheckFileIdentityV2>;
  compilerManifestHash: Sha256;
  counters: IntlCheckReceiptCountersV2;
  exceptions: ReadonlyArray<IntlCheckExceptionV1>;
  exceptionsHash: Sha256;
  generationReceiptHash: Sha256;
  icu: IntlCheckPackageIdentityV2;
  projects: ReadonlyArray<IntlCheckProjectV2>;
  providerClosures: ReadonlyArray<IntlCheckProviderClosureV2>;
  runtimeAbi: RuntimeAbi;
  schemaVersion: 1;
  sources: ReadonlyArray<IntlSourceLedgerEntryV2>;
  typescript: IntlCheckTypeScriptIdentityV2;
}>;

export type SourceAuthorizationSnapshotInput = Readonly<{
  application: IntlCheckApplicationIdentityV2;
  artifactAbi: string;
  compilerManifest: ReadonlyArray<IntlCheckFileIdentityV2>;
  exceptions: ReadonlyArray<IntlCheckExceptionV1>;
  generationReceiptHash: Sha256;
  icu: IntlCheckPackageIdentityV2;
  observedCounters: IntlSemanticAuthorizationObservationV2;
  projects: ReadonlyArray<ProjectInput>;
  providerClosures: ReadonlyArray<ProviderClosureInput>;
  runtimeAbi: RuntimeAbi;
  sources: ReadonlyArray<SourceInput>;
  typescript: Readonly<{
    libs: ReadonlyArray<IntlCheckFileIdentityV2>;
    package: IntlCheckPackageIdentityV2;
  }>;
}>;

function fail(context: string, detail: string): never {
  throw new TypeError(`${context} ${detail}`);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail(context, "must be a plain object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail(`${context}.${key}`, "must be an enumerable data property");
    }
  }
  return value as Record<string, unknown>;
}

function exact(
  value: unknown,
  keys: ReadonlyArray<string>,
  context: string
): Record<string, unknown> {
  const object = record(value, context);
  const actual = Object.keys(object);
  if (
    actual.length !== keys.length ||
    keys.some((key) => !Object.hasOwn(object, key))
  ) {
    fail(context, "has unexpected or missing fields");
  }
  return object;
}

function text(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.normalize("NFC") !== value
  ) {
    return fail(context, "must be a non-empty NFC string");
  }
  return value;
}

function sha(value: unknown, context: string): Sha256 {
  const result = text(value, context);
  if (!SHA256_PATTERN.test(result)) {
    return fail(context, "must be a canonical SHA-256 identity");
  }
  return result as Sha256;
}

function count(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return fail(context, "must be a non-negative safe integer");
  }
  return value;
}

function path(
  value: unknown,
  context: string,
  normalizeSeparators: boolean
): string {
  if (typeof value !== "string" || value.length === 0) {
    return fail(context, "must be a non-empty path string");
  }
  const original = normalizeSeparators
    ? value.normalize("NFC")
    : text(value, context);
  const normalized = original.replaceAll("\\", "/");
  if (
    (!normalizeSeparators && normalized !== original) ||
    normalized.startsWith("/") ||
    WINDOWS_ROOT_PATTERN.test(normalized) ||
    normalized
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    return fail(context, "must be a confined canonical relative path");
  }
  return normalized;
}

function canonicalPath(
  value: unknown,
  context: string,
  canonicalizer: CanonicalizationContext
): string {
  if (typeof value !== "string") {
    return path(value, context, true);
  }
  const cached = canonicalizer.paths.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = path(value, context, true);
  canonicalizer.metrics.canonicalPathComputations += 1;
  canonicalizer.paths.set(value, normalized);
  return normalized;
}

function canonicalHashMemo(
  value: unknown,
  canonicalizer: CanonicalizationContext
): Sha256 {
  if (value !== null && typeof value === "object") {
    const cached = canonicalizer.hashes.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const result = canonicalHash(value);
    canonicalizer.metrics.canonicalHashComputations += 1;
    canonicalizer.hashes.set(value, result);
    return result;
  }
  canonicalizer.metrics.canonicalHashComputations += 1;
  return canonicalHash(value);
}

function framed(value: string): string {
  return `${value.length}:${value}`;
}

function fileIdentityKey(filePath: string, hash: Sha256): string {
  return `${framed(filePath)}${framed(hash)}`;
}

function canonicalFile(
  value: unknown,
  context: string,
  canonicalizer: CanonicalizationContext
): IntlCheckFileIdentityV2 {
  const object = exact(value, ["hash", "path"], context);
  const filePath = canonicalPath(object.path, `${context}.path`, canonicalizer);
  const fileHash = sha(object.hash, `${context}.hash`);
  const key = fileIdentityKey(filePath, fileHash);
  const cached = canonicalizer.fileIdentities.get(key);
  if (cached !== undefined) {
    canonicalizer.metrics.fileIdentityReuses += 1;
    return cached;
  }
  const result = { hash: fileHash, path: filePath };
  canonicalizer.metrics.fileIdentityComputations += 1;
  canonicalizer.fileIdentities.set(key, result);
  return result;
}

function canonicalFiles(
  values: ReadonlyArray<unknown>,
  context: string,
  canonicalizer: CanonicalizationContext
): ReadonlyArray<IntlCheckFileIdentityV2> {
  const files = sortBy(
    values.map((entry, index) =>
      canonicalFile(entry, `${context}[${index}]`, canonicalizer)
    ),
    (entry) => entry.path
  );
  sortedUnique(files, (entry) => entry.path, context);
  const key = files
    .map((entry) => framed(fileIdentityKey(entry.path, entry.hash)))
    .join("");
  const cached = canonicalizer.fileLists.get(key);
  if (cached !== undefined) {
    canonicalizer.metrics.fileListReuses += 1;
    return cached;
  }
  canonicalizer.metrics.fileListComputations += 1;
  canonicalizer.fileLists.set(key, files);
  return files;
}

const trustedDeepFrozenValues = new WeakSet<object>();

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (
    value === null ||
    typeof value !== "object" ||
    seen.has(value) ||
    trustedDeepFrozenValues.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const entry of Object.values(value)) {
    deepFreeze(entry, seen);
  }
  const frozen = Object.freeze(value);
  trustedDeepFrozenValues.add(value);
  return frozen;
}

function sortedUnique<T>(
  values: ReadonlyArray<T>,
  identity: (value: T) => string,
  context: string
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previousEntry = values[index - 1];
    const currentEntry = values[index];
    if (previousEntry === undefined || currentEntry === undefined) {
      fail(context, "contains an undefined entry");
    }
    const previous = identity(previousEntry);
    const current = identity(currentEntry);
    if (compareCanonicalStrings(previous, current) >= 0) {
      fail(
        context,
        previous === current
          ? `contains duplicate identity ${JSON.stringify(current)}`
          : "must be canonically sorted"
      );
    }
  }
}

function sortBy<T>(
  values: ReadonlyArray<T>,
  identity: (value: T) => string
): Array<T> {
  return [...values].toSorted((left, right) =>
    compareCanonicalStrings(identity(left), identity(right))
  );
}

function parseFile(
  value: unknown,
  context: string,
  normalize = false
): IntlCheckFileIdentityV2 {
  const object = exact(value, ["hash", "path"], context);
  return {
    hash: sha(object.hash, `${context}.hash`),
    path: path(object.path, `${context}.path`, normalize),
  };
}

function parseFiles(
  value: unknown,
  context: string,
  normalize = false
): ReadonlyArray<IntlCheckFileIdentityV2> {
  if (!Array.isArray(value)) {
    return fail(context, "must be an array");
  }
  const files = value.map((entry, index) =>
    parseFile(entry, `${context}[${index}]`, normalize)
  );
  sortedUnique(files, (entry) => entry.path, context);
  return files;
}

function parsePackage(
  value: unknown,
  context: string
): IntlCheckPackageIdentityV2 {
  const object = exact(
    value,
    ["name", "packageHash", "packageManifestHash", "version"],
    context
  );
  return {
    name: text(object.name, `${context}.name`),
    packageHash: sha(object.packageHash, `${context}.packageHash`),
    packageManifestHash: sha(
      object.packageManifestHash,
      `${context}.packageManifestHash`
    ),
    version: text(object.version, `${context}.version`),
  };
}

function parseApplication(
  value: unknown,
  context: string
): IntlCheckApplicationIdentityV2 {
  const object = exact(
    value,
    ["packageManifest", "workspaceLockfile"],
    context
  );
  return {
    packageManifest: parseFile(
      object.packageManifest,
      `${context}.packageManifest`
    ),
    workspaceLockfile: parseFile(
      object.workspaceLockfile,
      `${context}.workspaceLockfile`
    ),
  };
}

function assertCanonicalJsonValue(
  value: unknown,
  context: string
): asserts value is IntlCheckCanonicalJsonV2 {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === "string") {
    if (value.normalize("NFC") !== value) {
      fail(context, "contains a non-NFC string");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertCanonicalJsonValue(entry, `${context}[${index}]`)
    );
    return;
  }
  const object = record(value, context);
  for (const [key, entry] of Object.entries(object)) {
    if (key.normalize("NFC") !== key) {
      fail(context, "contains a non-NFC object key");
    }
    assertCanonicalJsonValue(entry, `${context}.${key}`);
  }
}

function parseJsonRecord(
  value: unknown,
  context: string
): Readonly<Record<string, IntlCheckCanonicalJsonV2>> {
  const object = record(value, context);
  assertCanonicalJsonValue(object, context);
  return object as Readonly<Record<string, IntlCheckCanonicalJsonV2>>;
}

function parseTsconfig(
  value: unknown,
  context: string,
  normalize = false
): IntlCheckTsconfigFileV2 {
  const object = exact(
    value,
    ["extends", "hash", "path", "references"],
    context
  );
  const parsePaths = (
    input: unknown,
    field: "extends" | "references"
  ): ReadonlyArray<string> => {
    if (!Array.isArray(input)) {
      return fail(`${context}.${field}`, "must be an array");
    }
    const entries = input.map((entry, index) =>
      path(entry, `${context}.${field}[${index}]`, normalize)
    );
    if (field === "extends") {
      if (new Set(entries).size !== entries.length) {
        fail(`${context}.${field}`, "contains duplicate identities");
      }
    } else {
      sortedUnique(entries, (entry) => entry, `${context}.${field}`);
    }
    return entries;
  };
  return {
    extends: parsePaths(object.extends, "extends"),
    hash: sha(object.hash, `${context}.hash`),
    path: path(object.path, `${context}.path`, normalize),
    references: parsePaths(object.references, "references"),
  };
}

function projectInputIdentity(
  project: Pick<IntlCheckProjectV2, "path">
): string {
  return project.path;
}

function parseProject(
  value: unknown,
  context: string,
  normalize = false
): IntlCheckProjectV2 {
  const object = exact(
    value,
    [
      "configManifest",
      "configManifestHash",
      "normalizedOptions",
      "normalizedOptionsHash",
      "path",
      "role",
      "rootFiles",
    ],
    context
  );
  if (
    !Array.isArray(object.configManifest) ||
    !Array.isArray(object.rootFiles)
  ) {
    return fail(context, "must contain array manifests");
  }
  const configManifest = object.configManifest.map((entry, index) =>
    parseTsconfig(entry, `${context}.configManifest[${index}]`, normalize)
  );
  sortedUnique(
    configManifest,
    (entry) => entry.path,
    `${context}.configManifest`
  );
  const rootFiles = object.rootFiles.map((entry, index) =>
    path(entry, `${context}.rootFiles[${index}]`, normalize)
  );
  sortedUnique(rootFiles, (entry) => entry, `${context}.rootFiles`);
  const normalizedOptions = parseJsonRecord(
    object.normalizedOptions,
    `${context}.normalizedOptions`
  );
  const configManifestHash = sha(
    object.configManifestHash,
    `${context}.configManifestHash`
  );
  const normalizedOptionsHash = sha(
    object.normalizedOptionsHash,
    `${context}.normalizedOptionsHash`
  );
  if (configManifestHash !== canonicalHash(configManifest)) {
    fail(`${context}.configManifestHash`, "does not bind the config manifest");
  }
  if (normalizedOptionsHash !== canonicalHash(normalizedOptions)) {
    fail(`${context}.normalizedOptionsHash`, "does not bind parsed options");
  }
  if (object.role !== "owner" && object.role !== "checker") {
    fail(`${context}.role`, "must be owner or checker");
  }
  return {
    configManifest,
    configManifestHash,
    normalizedOptions,
    normalizedOptionsHash,
    path: path(object.path, `${context}.path`, normalize),
    role: object.role,
    rootFiles,
  };
}

function providerIdentity(
  provider: Pick<IntlCheckProviderV2, "kind" | "root">
): string {
  return `${provider.root}\u0000${provider.kind}`;
}

function nullableText(value: unknown, context: string): string | null {
  return value === null ? null : text(value, context);
}

function parseProviderProbes(
  value: unknown,
  context: string,
  normalize: boolean
): IntlCheckProviderResolutionV2["probes"] {
  if (!Array.isArray(value)) {
    fail(context, "must be an array");
  }
  const probes = value.map((entry, index) => {
    const probe = exact(
      entry,
      ["kind", "path", "present"],
      `${context}[${index}]`
    );
    if (probe.kind !== "directory" && probe.kind !== "file") {
      fail(`${context}[${index}].kind`, "is unsupported");
    }
    if (typeof probe.present !== "boolean") {
      fail(`${context}[${index}].present`, "must be a boolean");
    }
    return {
      kind: probe.kind as "directory" | "file",
      path: path(probe.path, `${context}[${index}].path`, normalize),
      present: probe.present,
    };
  });
  sortedUnique(probes, (probe) => `${probe.path}\u0000${probe.kind}`, context);
  return probes;
}

function parseProviderRealpaths(
  value: unknown,
  context: string,
  normalize: boolean
): IntlCheckProviderResolutionV2["realpaths"] {
  if (!Array.isArray(value)) {
    fail(context, "must be an array");
  }
  const realpaths = value.map((entry, index) => {
    const realpath = exact(entry, ["path", "target"], `${context}[${index}]`);
    return {
      path: path(realpath.path, `${context}[${index}].path`, normalize),
      target: path(realpath.target, `${context}[${index}].target`, normalize),
    };
  });
  sortedUnique(realpaths, (entry) => entry.path, context);
  return realpaths;
}

function parseProviderResolution(
  value: unknown,
  context: string,
  normalize = false
): IntlCheckProviderResolutionV2 {
  const object = exact(
    value,
    [
      "controlFiles",
      "from",
      "optionsHash",
      "packageName",
      "packageVersion",
      "probes",
      "realpaths",
      "specifier",
    ],
    context
  );
  const controlFiles = parseFiles(
    object.controlFiles,
    `${context}.controlFiles`,
    normalize
  );
  const packageName = nullableText(
    object.packageName,
    `${context}.packageName`
  );
  const packageVersion = nullableText(
    object.packageVersion,
    `${context}.packageVersion`
  );
  if ((packageName === null) !== (packageVersion === null)) {
    fail(context, "must bind both package name and version or neither");
  }
  return {
    controlFiles,
    from: path(object.from, `${context}.from`, normalize),
    optionsHash: sha(object.optionsHash, `${context}.optionsHash`),
    packageName,
    packageVersion,
    probes: parseProviderProbes(object.probes, `${context}.probes`, normalize),
    realpaths: parseProviderRealpaths(
      object.realpaths,
      `${context}.realpaths`,
      normalize
    ),
    specifier: text(object.specifier, `${context}.specifier`),
  };
}

function parseProvider(
  value: unknown,
  context: string,
  normalize = false
): IntlCheckProviderV2 {
  const object = exact(
    value,
    ["declarationHash", "declarations", "hash", "kind", "resolutions", "root"],
    context
  );
  const declarations = parseFiles(
    object.declarations,
    `${context}.declarations`,
    normalize
  );
  if (
    typeof object.kind !== "string" ||
    !PROVIDER_KINDS.includes(object.kind as IntlCheckProviderKindV2)
  ) {
    fail(`${context}.kind`, "is unsupported");
  }
  if (!Array.isArray(object.resolutions)) {
    fail(`${context}.resolutions`, "must be an array");
  }
  const resolutions = object.resolutions.map((resolution, index) =>
    parseProviderResolution(
      resolution,
      `${context}.resolutions[${index}]`,
      normalize
    )
  );
  sortedUnique(
    resolutions,
    (resolution) => `${resolution.from}\u0000${resolution.specifier}`,
    `${context}.resolutions`
  );
  const base = {
    declarationHash: sha(object.declarationHash, `${context}.declarationHash`),
    declarations,
    kind: object.kind as IntlCheckProviderKindV2,
    resolutions,
    root: path(object.root, `${context}.root`, normalize),
  };
  if (base.declarationHash !== canonicalHash(declarations)) {
    fail(`${context}.declarationHash`, "does not bind declarations");
  }
  const hash = sha(object.hash, `${context}.hash`);
  if (hash !== canonicalHash(base)) {
    fail(`${context}.hash`, "does not bind provider identity");
  }
  return { ...base, hash };
}

function parseClosure(
  value: unknown,
  context: string,
  normalize = false
): IntlCheckProviderClosureV2 {
  const object = exact(
    value,
    [
      "ambientTypeFileLimit",
      "closureHash",
      "declarationHash",
      "declarations",
      "libHash",
      "libs",
      "providerBudgetExceeded",
      "providerRootLimit",
      "providers",
      "source",
    ],
    context
  );
  const declarations = parseFiles(
    object.declarations,
    `${context}.declarations`,
    normalize
  );
  const libs = parseFiles(object.libs, `${context}.libs`, normalize);
  if (!Array.isArray(object.providers)) {
    return fail(`${context}.providers`, "must be an array");
  }
  const providers = object.providers.map((provider, index) =>
    parseProvider(provider, `${context}.providers[${index}]`, normalize)
  );
  sortedUnique(providers, providerIdentity, `${context}.providers`);
  if (object.providerBudgetExceeded !== false) {
    fail(`${context}.providerBudgetExceeded`, "must be false");
  }
  const base = {
    ambientTypeFileLimit: count(
      object.ambientTypeFileLimit,
      `${context}.ambientTypeFileLimit`
    ),
    declarationHash: sha(object.declarationHash, `${context}.declarationHash`),
    declarations,
    libHash: sha(object.libHash, `${context}.libHash`),
    libs,
    providerBudgetExceeded: false as const,
    providerRootLimit: count(
      object.providerRootLimit,
      `${context}.providerRootLimit`
    ),
    providers,
    source: path(object.source, `${context}.source`, normalize),
  };
  if (base.declarationHash !== canonicalHash(declarations)) {
    fail(`${context}.declarationHash`, "does not bind declarations");
  }
  if (base.libHash !== canonicalHash(libs)) {
    fail(`${context}.libHash`, "does not bind loaded libs");
  }
  if (providers.length > base.providerRootLimit) {
    fail(context, "exceeds providerRootLimit");
  }
  const ambientFiles = providers
    .filter((provider) => provider.kind === "ambient")
    .reduce((total, provider) => total + provider.declarations.length, 0);
  if (ambientFiles > base.ambientTypeFileLimit) {
    fail(context, "exceeds ambientTypeFileLimit");
  }
  const closureHash = sha(object.closureHash, `${context}.closureHash`);
  if (closureHash !== canonicalHash(base)) {
    fail(`${context}.closureHash`, "does not bind provider closure");
  }
  return { ...base, closureHash };
}

function parseSource(
  value: unknown,
  context: string,
  normalize = false
): IntlSourceLedgerEntryV2 {
  const object = exact(
    value,
    ["file", "hash", "owner", "providerClosureHash", "verdict"],
    context
  );
  if (object.verdict !== "accepted" && object.verdict !== "exception") {
    fail(`${context}.verdict`, "must be accepted or exception");
  }
  return {
    file: path(object.file, `${context}.file`, normalize),
    hash: sha(object.hash, `${context}.hash`),
    owner: path(object.owner, `${context}.owner`, normalize),
    providerClosureHash: sha(
      object.providerClosureHash,
      `${context}.providerClosureHash`
    ),
    verdict: object.verdict,
  };
}

function exceptionIdentity(exception: IntlCheckExceptionV1): string {
  return `${exception.file}\u0000${exception.rule}\u0000${exception.nodeHash}\u0000${exception.reason}`;
}

function parseException(
  value: unknown,
  context: string,
  normalize = false
): IntlCheckExceptionV1 {
  const object = exact(value, ["file", "nodeHash", "reason", "rule"], context);
  return {
    file: path(object.file, `${context}.file`, normalize),
    nodeHash: sha(object.nodeHash, `${context}.nodeHash`),
    reason: text(object.reason, `${context}.reason`),
    rule: text(object.rule, `${context}.rule`),
  };
}

function parseCounters(
  value: unknown,
  context: string
): IntlCheckReceiptCountersV2 {
  const object = exact(
    value,
    [
      "checkerProjects",
      "declarationFiles",
      "exceptions",
      "loadedLibFiles",
      "ownerProjects",
      "providerClosures",
      "providerRoots",
      "semanticAuthorizationRuns",
      "semanticFilesAnalyzed",
      "sourceFiles",
      "typescriptLibFiles",
    ],
    context
  );
  if (object.semanticAuthorizationRuns !== 1) {
    fail(`${context}.semanticAuthorizationRuns`, "must equal 1");
  }
  return {
    checkerProjects: count(
      object.checkerProjects,
      `${context}.checkerProjects`
    ),
    declarationFiles: count(
      object.declarationFiles,
      `${context}.declarationFiles`
    ),
    exceptions: count(object.exceptions, `${context}.exceptions`),
    loadedLibFiles: count(object.loadedLibFiles, `${context}.loadedLibFiles`),
    ownerProjects: count(object.ownerProjects, `${context}.ownerProjects`),
    providerClosures: count(
      object.providerClosures,
      `${context}.providerClosures`
    ),
    providerRoots: count(object.providerRoots, `${context}.providerRoots`),
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: count(
      object.semanticFilesAnalyzed,
      `${context}.semanticFilesAnalyzed`
    ),
    sourceFiles: count(object.sourceFiles, `${context}.sourceFiles`),
    typescriptLibFiles: count(
      object.typescriptLibFiles,
      `${context}.typescriptLibFiles`
    ),
  };
}

function expectedCounters(
  projects: ReadonlyArray<IntlCheckProjectV2>,
  closures: ReadonlyArray<IntlCheckProviderClosureV2>,
  sources: ReadonlyArray<IntlSourceLedgerEntryV2>,
  exceptions: ReadonlyArray<IntlCheckExceptionV1>,
  typescript: IntlCheckTypeScriptIdentityV2
): IntlCheckReceiptCountersV2 {
  return {
    checkerProjects: projects.filter((project) => project.role === "checker")
      .length,
    declarationFiles: closures.reduce(
      (total, closure) => total + closure.declarations.length,
      0
    ),
    exceptions: exceptions.length,
    loadedLibFiles: closures.reduce(
      (total, closure) => total + closure.libs.length,
      0
    ),
    ownerProjects: projects.filter((project) => project.role === "owner")
      .length,
    providerClosures: closures.length,
    providerRoots: closures.reduce(
      (total, closure) => total + closure.providers.length,
      0
    ),
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: sources.length,
    sourceFiles: sources.length,
    typescriptLibFiles: typescript.libs.length,
  };
}

function validateRelationships(snapshot: SourceAuthorizationSnapshot): void {
  const projects = new Map(
    snapshot.projects.map((project) => [project.path, project])
  );
  const owners = new Set(
    snapshot.projects
      .filter((project) => project.role === "owner")
      .map((project) => project.path)
  );
  const closures = new Map(
    snapshot.providerClosures.map((closure) => [closure.source, closure])
  );

  for (const source of snapshot.sources) {
    const project = projects.get(source.owner);
    if (!project || !owners.has(source.owner)) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "must be owned by exactly one owner project"
      );
    }
    const closure = closures.get(source.file);
    if (!closure || closure.closureHash !== source.providerClosureHash) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "must have exactly one matching provider closure"
      );
    }
    for (const resolution of closure.providers.flatMap(
      (provider) => provider.resolutions
    )) {
      if (resolution.optionsHash !== project.normalizedOptionsHash) {
        fail(
          `Provider resolution ${JSON.stringify(resolution.specifier)}`,
          "must bind its owning check-project resolver options"
        );
      }
    }
  }
  for (const closure of snapshot.providerClosures) {
    if (!snapshot.sources.some((source) => source.file === closure.source)) {
      fail(
        `Provider closure ${JSON.stringify(closure.source)}`,
        "does not correspond to an authorized source"
      );
    }
  }

  const exceptionFiles = new Set(
    snapshot.exceptions.map((entry) => entry.file)
  );
  for (const source of snapshot.sources) {
    if ((source.verdict === "exception") !== exceptionFiles.has(source.file)) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "has an exception verdict mismatch"
      );
    }
  }
  for (const exception of snapshot.exceptions) {
    if (!snapshot.sources.some((source) => source.file === exception.file)) {
      fail(
        `Exception ${JSON.stringify(exception.file)}`,
        "does not correspond to an authorized source"
      );
    }
  }

  const expected = expectedCounters(
    snapshot.projects,
    snapshot.providerClosures,
    snapshot.sources,
    snapshot.exceptions,
    snapshot.typescript
  );
  if (canonicalJson(snapshot.counters) !== canonicalJson(expected)) {
    fail("Source authorization counters", "do not match canonical manifests");
  }
}

function parseSnapshotFields(
  value: unknown,
  schemaVersion: 1 | 2,
  hasAuthorizationHash: boolean
): SourceAuthorizationSnapshot {
  const keys = [
    "application",
    "artifactAbi",
    "compilerManifest",
    "compilerManifestHash",
    "counters",
    "exceptions",
    "exceptionsHash",
    "generationReceiptHash",
    "icu",
    "projects",
    "providerClosures",
    "runtimeAbi",
    "schemaVersion",
    ...(hasAuthorizationHash ? ["sourceAuthorizationHash"] : []),
    "sources",
    "typescript",
  ];
  const object = exact(value, keys, "Source authorization snapshot");
  if (object.schemaVersion !== schemaVersion) {
    fail(
      "Source authorization snapshot.schemaVersion",
      `must equal ${schemaVersion}`
    );
  }

  const compilerManifest = parseFiles(
    object.compilerManifest,
    "Source authorization snapshot.compilerManifest"
  );
  const compilerManifestHash = sha(
    object.compilerManifestHash,
    "Source authorization snapshot.compilerManifestHash"
  );
  if (compilerManifestHash !== canonicalHash(compilerManifest)) {
    fail(
      "Source authorization snapshot.compilerManifestHash",
      "does not bind compiler modules"
    );
  }

  if (
    !Array.isArray(object.projects) ||
    !Array.isArray(object.providerClosures) ||
    !Array.isArray(object.sources) ||
    !Array.isArray(object.exceptions)
  ) {
    fail("Source authorization snapshot", "must contain array manifests");
  }
  const projects = object.projects.map((project, index) =>
    parseProject(project, `Source authorization snapshot.projects[${index}]`)
  );
  sortedUnique(projects, projectInputIdentity, "Source authorization projects");
  const providerClosures = object.providerClosures.map((closure, index) =>
    parseClosure(
      closure,
      `Source authorization snapshot.providerClosures[${index}]`
    )
  );
  sortedUnique(
    providerClosures,
    (closure) => closure.source,
    "Source authorization provider closures"
  );
  const sources = object.sources.map((source, index) =>
    parseSource(source, `Source authorization snapshot.sources[${index}]`)
  );
  sortedUnique(
    sources,
    (source) => source.file,
    "Source authorization sources"
  );
  const exceptions = object.exceptions.map((exception, index) =>
    parseException(
      exception,
      `Source authorization snapshot.exceptions[${index}]`
    )
  );
  sortedUnique(
    exceptions,
    exceptionIdentity,
    "Source authorization exceptions"
  );
  const exceptionsHash = sha(
    object.exceptionsHash,
    "Source authorization snapshot.exceptionsHash"
  );
  if (exceptionsHash !== canonicalHash(exceptions)) {
    fail(
      "Source authorization snapshot.exceptionsHash",
      "does not bind exceptions"
    );
  }

  const typescriptObject = exact(
    object.typescript,
    ["libHash", "libs", "package"],
    "Source authorization snapshot.typescript"
  );
  const typescript: IntlCheckTypeScriptIdentityV2 = {
    libHash: sha(
      typescriptObject.libHash,
      "Source authorization snapshot.typescript.libHash"
    ),
    libs: parseFiles(
      typescriptObject.libs,
      "Source authorization snapshot.typescript.libs"
    ),
    package: parsePackage(
      typescriptObject.package,
      "Source authorization snapshot.typescript.package"
    ),
  };
  if (typescript.libHash !== canonicalHash(typescript.libs)) {
    fail(
      "Source authorization snapshot.typescript.libHash",
      "does not bind TypeScript libs"
    );
  }

  const snapshot: SourceAuthorizationSnapshot = {
    application: parseApplication(
      object.application,
      "Source authorization snapshot.application"
    ),
    artifactAbi: text(
      object.artifactAbi,
      "Source authorization snapshot.artifactAbi"
    ),
    compilerManifest,
    compilerManifestHash,
    counters: parseCounters(
      object.counters,
      "Source authorization snapshot.counters"
    ),
    exceptions,
    exceptionsHash,
    generationReceiptHash: sha(
      object.generationReceiptHash,
      "Source authorization snapshot.generationReceiptHash"
    ),
    icu: parsePackage(object.icu, "Source authorization snapshot.icu"),
    projects,
    providerClosures,
    runtimeAbi: text(
      object.runtimeAbi,
      "Source authorization snapshot.runtimeAbi"
    ) as RuntimeAbi,
    schemaVersion: 1,
    sources,
    typescript,
  };
  validateRelationships(snapshot);
  return snapshot;
}

function canonicalProject(
  input: ProjectInput,
  index: number,
  canonicalizer: CanonicalizationContext
): IntlCheckProjectV2 {
  const context = `Project ${index}`;
  const configManifest = sortBy(
    input.configManifest.map((entry, entryIndex) => {
      const entryContext = `${context}.configManifest[${entryIndex}]`;
      const config = exact(
        entry,
        ["extends", "hash", "path", "references"],
        entryContext
      );
      const canonicalPaths = (
        value: unknown,
        field: "extends" | "references"
      ): ReadonlyArray<string> => {
        if (!Array.isArray(value)) {
          return fail(`${entryContext}.${field}`, "must be an array");
        }
        const entries = value.map((item, itemIndex) =>
          canonicalPath(
            item,
            `${entryContext}.${field}[${itemIndex}]`,
            canonicalizer
          )
        );
        if (field === "extends") {
          if (new Set(entries).size !== entries.length) {
            fail(`${entryContext}.${field}`, "contains duplicate identities");
          }
          return entries;
        }
        sortedUnique(entries, (item) => item, `${entryContext}.${field}`);
        return entries;
      };
      return {
        extends: canonicalPaths(config.extends, "extends"),
        hash: sha(config.hash, `${entryContext}.hash`),
        path: canonicalPath(config.path, `${entryContext}.path`, canonicalizer),
        references: canonicalPaths(config.references, "references"),
      };
    }),
    (entry) => entry.path
  );
  sortedUnique(
    configManifest,
    (entry) => entry.path,
    `${context}.configManifest`
  );
  const rootFiles = sortBy(
    input.rootFiles.map((entry, entryIndex) =>
      canonicalPath(entry, `${context}.rootFiles[${entryIndex}]`, canonicalizer)
    ),
    (entry) => entry
  );
  sortedUnique(rootFiles, (entry) => entry, `${context}.rootFiles`);
  const parsedOptions = parseJsonRecord(
    input.normalizedOptions,
    `${context}.normalizedOptions`
  );
  const normalizedOptions = JSON.parse(
    canonicalJson(parsedOptions)
  ) as Readonly<Record<string, IntlCheckCanonicalJsonV2>>;
  if (input.role !== "owner" && input.role !== "checker") {
    fail(`${context}.role`, "must be owner or checker");
  }
  return {
    configManifest,
    configManifestHash: canonicalHashMemo(configManifest, canonicalizer),
    normalizedOptions,
    normalizedOptionsHash: canonicalHashMemo(normalizedOptions, canonicalizer),
    path: canonicalPath(input.path, `${context}.path`, canonicalizer),
    role: input.role,
    rootFiles,
  };
}

function canonicalProvider(
  input: ProviderInput,
  context: string,
  canonicalizer: CanonicalizationContext
): IntlCheckProviderV2 {
  const declarations = canonicalFiles(
    input.declarations,
    `${context}.declarations`,
    canonicalizer
  );
  const resolutions = sortBy(
    input.resolutions.map((resolution, resolutionIndex) => {
      const resolutionContext = `${context}.resolutions[${resolutionIndex}]`;
      const object = exact(
        resolution,
        [
          "controlFiles",
          "from",
          "optionsHash",
          "packageName",
          "packageVersion",
          "probes",
          "realpaths",
          "specifier",
        ],
        resolutionContext
      );
      if (
        !Array.isArray(object.controlFiles) ||
        !Array.isArray(object.probes) ||
        !Array.isArray(object.realpaths)
      ) {
        fail(resolutionContext, "must contain array resolution evidence");
      }
      const packageName = nullableText(
        object.packageName,
        `${resolutionContext}.packageName`
      );
      const packageVersion = nullableText(
        object.packageVersion,
        `${resolutionContext}.packageVersion`
      );
      if ((packageName === null) !== (packageVersion === null)) {
        fail(
          resolutionContext,
          "must bind both package name and version or neither"
        );
      }
      const probes = sortBy(
        object.probes.map((entry, probeIndex) => {
          const probeContext = `${resolutionContext}.probes[${probeIndex}]`;
          const probe = exact(entry, ["kind", "path", "present"], probeContext);
          if (probe.kind !== "directory" && probe.kind !== "file") {
            fail(`${probeContext}.kind`, "is unsupported");
          }
          if (typeof probe.present !== "boolean") {
            fail(`${probeContext}.present`, "must be a boolean");
          }
          return {
            kind: probe.kind as "directory" | "file",
            path: canonicalPath(
              probe.path,
              `${probeContext}.path`,
              canonicalizer
            ),
            present: probe.present,
          };
        }),
        (probe) => `${probe.path}\u0000${probe.kind}`
      );
      sortedUnique(
        probes,
        (probe) => `${probe.path}\u0000${probe.kind}`,
        `${resolutionContext}.probes`
      );
      const realpaths = sortBy(
        object.realpaths.map((entry, realpathIndex) => {
          const realpathContext = `${resolutionContext}.realpaths[${realpathIndex}]`;
          const realpath = exact(entry, ["path", "target"], realpathContext);
          return {
            path: canonicalPath(
              realpath.path,
              `${realpathContext}.path`,
              canonicalizer
            ),
            target: canonicalPath(
              realpath.target,
              `${realpathContext}.target`,
              canonicalizer
            ),
          };
        }),
        (entry) => entry.path
      );
      sortedUnique(
        realpaths,
        (entry) => entry.path,
        `${resolutionContext}.realpaths`
      );
      return {
        controlFiles: canonicalFiles(
          object.controlFiles,
          `${resolutionContext}.controlFiles`,
          canonicalizer
        ),
        from: canonicalPath(
          object.from,
          `${resolutionContext}.from`,
          canonicalizer
        ),
        optionsHash: sha(
          object.optionsHash,
          `${resolutionContext}.optionsHash`
        ),
        packageName,
        packageVersion,
        probes,
        realpaths,
        specifier: text(object.specifier, `${resolutionContext}.specifier`),
      };
    }),
    (resolution) => `${resolution.from}\u0000${resolution.specifier}`
  );
  sortedUnique(
    resolutions,
    (resolution) => `${resolution.from}\u0000${resolution.specifier}`,
    `${context}.resolutions`
  );
  if (typeof input.kind !== "string" || !PROVIDER_KINDS.includes(input.kind)) {
    fail(`${context}.kind`, "is unsupported");
  }
  const base = {
    declarationHash: canonicalHashMemo(declarations, canonicalizer),
    declarations,
    kind: input.kind,
    resolutions,
    root: canonicalPath(input.root, `${context}.root`, canonicalizer),
  };
  return { ...base, hash: canonicalHashMemo(base, canonicalizer) };
}

function canonicalClosure(
  input: ProviderClosureInput,
  index: number,
  canonicalizer: CanonicalizationContext
): IntlCheckProviderClosureV2 {
  const context = `Provider closure ${index}`;
  const declarations = canonicalFiles(
    input.declarations,
    `${context}.declarations`,
    canonicalizer
  );
  const libs = canonicalFiles(input.libs, `${context}.libs`, canonicalizer);
  const providers = sortBy(
    input.providers.map((provider, providerIndex) =>
      canonicalProvider(
        provider,
        `${context}.providers[${providerIndex}]`,
        canonicalizer
      )
    ),
    providerIdentity
  );
  sortedUnique(providers, providerIdentity, `${context}.providers`);
  const ambientTypeFileLimit = count(
    input.ambientTypeFileLimit,
    `${context}.ambientTypeFileLimit`
  );
  const providerRootLimit = count(
    input.providerRootLimit,
    `${context}.providerRootLimit`
  );
  if (input.providerBudgetExceeded !== false) {
    fail(`${context}.providerBudgetExceeded`, "must be false");
  }
  if (providers.length > providerRootLimit) {
    fail(context, "exceeds providerRootLimit");
  }
  const ambientFiles = providers
    .filter((provider) => provider.kind === "ambient")
    .reduce((total, provider) => total + provider.declarations.length, 0);
  if (ambientFiles > ambientTypeFileLimit) {
    fail(context, "exceeds ambientTypeFileLimit");
  }
  const base = {
    ambientTypeFileLimit,
    declarationHash: canonicalHashMemo(declarations, canonicalizer),
    declarations,
    libHash: canonicalHashMemo(libs, canonicalizer),
    libs,
    providerBudgetExceeded: false as const,
    providerRootLimit,
    providers,
    source: canonicalPath(input.source, `${context}.source`, canonicalizer),
  };
  return { ...base, closureHash: canonicalHashMemo(base, canonicalizer) };
}

export function buildSourceAuthorizationSnapshot(
  input: SourceAuthorizationSnapshotInput,
  metrics = createAuthorizationSnapshotCanonicalizationMetrics()
): SourceAuthorizationSnapshot {
  const canonicalizer = canonicalizationContext(metrics);
  const compilerManifest = canonicalFiles(
    input.compilerManifest,
    "Compiler manifest",
    canonicalizer
  );
  const projects = sortBy(
    input.projects.map((project, index) =>
      canonicalProject(project, index, canonicalizer)
    ),
    projectInputIdentity
  );
  sortedUnique(projects, projectInputIdentity, "Source authorization projects");
  const providerClosures = sortBy(
    input.providerClosures.map((closure, index) =>
      canonicalClosure(closure, index, canonicalizer)
    ),
    (closure) => closure.source
  );
  sortedUnique(
    providerClosures,
    (closure) => closure.source,
    "Source authorization provider closures"
  );
  const closureBySource = new Map(
    providerClosures.map((closure) => [closure.source, closure])
  );
  const sources = sortBy(
    input.sources.map((source, index) => {
      const sourceObject = exact(
        source,
        ["file", "hash", "owner", "verdict"],
        `Source ${index}`
      );
      const file = canonicalPath(
        sourceObject.file,
        `Source ${index}.file`,
        canonicalizer
      );
      const closure = closureBySource.get(file);
      if (!closure) {
        fail(`Source ${JSON.stringify(file)}`, "has no provider closure");
      }
      if (
        sourceObject.verdict !== "accepted" &&
        sourceObject.verdict !== "exception"
      ) {
        fail(`Source ${index}.verdict`, "must be accepted or exception");
      }
      return {
        file,
        hash: sha(sourceObject.hash, `Source ${index}.hash`),
        owner: canonicalPath(
          sourceObject.owner,
          `Source ${index}.owner`,
          canonicalizer
        ),
        providerClosureHash: closure.closureHash,
        verdict: sourceObject.verdict as "accepted" | "exception",
      };
    }),
    (source) => source.file
  );
  sortedUnique(
    sources,
    (source) => source.file,
    "Source authorization sources"
  );
  const exceptions = sortBy(
    input.exceptions.map((entry, index) => {
      const context = `Exception ${index}`;
      const object = exact(
        entry,
        ["file", "nodeHash", "reason", "rule"],
        context
      );
      return {
        file: canonicalPath(object.file, `${context}.file`, canonicalizer),
        nodeHash: sha(object.nodeHash, `${context}.nodeHash`),
        reason: text(object.reason, `${context}.reason`),
        rule: text(object.rule, `${context}.rule`),
      };
    }),
    exceptionIdentity
  );
  sortedUnique(
    exceptions,
    exceptionIdentity,
    "Source authorization exceptions"
  );
  const typescriptLibs = canonicalFiles(
    input.typescript.libs,
    "TypeScript lib",
    canonicalizer
  );
  const typescript: IntlCheckTypeScriptIdentityV2 = {
    libs: typescriptLibs,
    package: parsePackage(input.typescript.package, "TypeScript package"),
    libHash: canonicalHashMemo(typescriptLibs, canonicalizer),
  };
  if (input.observedCounters.semanticAuthorizationRuns !== 1) {
    fail(
      "Observed source authorization counters.semanticAuthorizationRuns",
      "must equal 1"
    );
  }
  if (input.observedCounters.semanticFilesAnalyzed !== sources.length) {
    fail(
      "Observed source authorization counters.semanticFilesAnalyzed",
      `must equal source ledger length ${sources.length}`
    );
  }
  const snapshot: SourceAuthorizationSnapshot = {
    application: parseApplication(input.application, "Application identity"),
    artifactAbi: text(input.artifactAbi, "Artifact ABI"),
    compilerManifest,
    compilerManifestHash: canonicalHashMemo(compilerManifest, canonicalizer),
    counters: {
      ...expectedCounters(
        projects,
        providerClosures,
        sources,
        exceptions,
        typescript
      ),
      semanticAuthorizationRuns:
        input.observedCounters.semanticAuthorizationRuns,
      semanticFilesAnalyzed: input.observedCounters.semanticFilesAnalyzed,
    },
    exceptions,
    exceptionsHash: canonicalHashMemo(exceptions, canonicalizer),
    generationReceiptHash: sha(
      input.generationReceiptHash,
      "Generation receipt hash"
    ),
    icu: parsePackage(input.icu, "ICU package"),
    projects,
    providerClosures,
    runtimeAbi: text(input.runtimeAbi, "Runtime ABI") as RuntimeAbi,
    schemaVersion: 1,
    sources,
    typescript,
  };
  validateRelationships(snapshot);
  const immutableSnapshot = deepFreeze(snapshot);
  trustedSnapshots.add(immutableSnapshot);
  return immutableSnapshot;
}

export function parseSourceAuthorizationSnapshot(
  value: unknown
): SourceAuthorizationSnapshot {
  return parseSnapshotFields(value, 1, false);
}

function receiptBase(
  snapshot: SourceAuthorizationSnapshot
): Omit<IntlCheckReceiptV2, "sourceAuthorizationHash"> {
  const { schemaVersion: _snapshotSchemaVersion, ...fields } = snapshot;
  return { ...fields, schemaVersion: 2 };
}

export function buildIntlCheckReceiptV2(
  snapshotValue: SourceAuthorizationSnapshot,
  metrics = createAuthorizationSnapshotCanonicalizationMetrics()
): IntlCheckReceiptV2 {
  const snapshot = trustedSnapshots.has(snapshotValue)
    ? snapshotValue
    : parseSourceAuthorizationSnapshot(snapshotValue);
  if (trustedSnapshots.has(snapshotValue)) {
    metrics.trustedSnapshotReuses += 1;
  }
  const base = receiptBase(snapshot);
  const receipt = deepFreeze({
    ...base,
    // Deliberately excluded from its own preimage.
    sourceAuthorizationHash: canonicalHash(base),
  });
  trustedReceipts.add(receipt);
  return receipt;
}

export function parseIntlCheckReceiptV2(value: unknown): IntlCheckReceiptV2 {
  const candidate = record(value, "Intl check receipt");
  const schemaVersion = Reflect.get(candidate, "schemaVersion");
  if (schemaVersion === 1) {
    fail(
      "Intl check receipt schemaVersion 1",
      "is unsupported; run fresh authorization to create a V2 receipt"
    );
  }
  if (schemaVersion !== 2) {
    fail(
      "Intl check receipt schemaVersion",
      `${JSON.stringify(schemaVersion)} is unsupported; expected 2 and run fresh authorization`
    );
  }
  const snapshot = parseSnapshotFields(value, 2, true);
  const object = record(value, "Intl check receipt V2");
  const sourceAuthorizationHash = sha(
    object.sourceAuthorizationHash,
    "Intl check receipt V2.sourceAuthorizationHash"
  );
  const base = receiptBase(snapshot);
  if (sourceAuthorizationHash !== canonicalHash(base)) {
    fail(
      "Intl check receipt V2.sourceAuthorizationHash",
      "does not bind every other receipt field"
    );
  }
  return { ...base, sourceAuthorizationHash };
}

export function parseIntlBuildVerificationCountersV2(
  value: unknown
): IntlBuildVerificationCountersV2 {
  const object = exact(
    value,
    ["buildReceiptVerifications", "buildSemanticAnalysisRuns"],
    "Intl build verification counters"
  );
  const buildReceiptVerifications = count(
    object.buildReceiptVerifications,
    "Intl build verification counters.buildReceiptVerifications"
  );
  if (buildReceiptVerifications < 1) {
    fail(
      "Intl build verification counters.buildReceiptVerifications",
      "must be at least 1"
    );
  }
  if (object.buildSemanticAnalysisRuns !== 0) {
    fail(
      "Intl build verification counters.buildSemanticAnalysisRuns",
      "must equal 0"
    );
  }
  return { buildReceiptVerifications, buildSemanticAnalysisRuns: 0 };
}

export function canonicalIntlCheckReceiptV2Bytes(
  value: IntlCheckReceiptV2,
  metrics = createAuthorizationSnapshotCanonicalizationMetrics()
): string {
  const receipt = trustedReceipts.has(value)
    ? value
    : parseIntlCheckReceiptV2(value);
  if (trustedReceipts.has(value)) {
    metrics.trustedReceiptReuses += 1;
  }
  return `${canonicalJson(receipt)}\n`;
}

export function parseCanonicalSourceAuthorizationSnapshot(
  source: string
): SourceAuthorizationSnapshot {
  const parsed = parseSourceAuthorizationSnapshot(
    JSON.parse(source) as unknown
  );
  if (source !== canonicalJson(parsed)) {
    fail("Source authorization snapshot", "must use canonical JSON bytes");
  }
  return parsed;
}

export function parseCanonicalIntlCheckReceiptV2(
  source: string
): IntlCheckReceiptV2 {
  const parsed = parseIntlCheckReceiptV2(JSON.parse(source) as unknown);
  if (source !== canonicalIntlCheckReceiptV2Bytes(parsed)) {
    fail("Intl check receipt V2", "must use canonical JSON bytes");
  }
  return parsed;
}

const BOUNDARY_KINDS = [
  "dynamic-import",
  "export",
  "import",
  "import-equals",
  "import-type",
  "module-declaration",
  "require",
] as const satisfies ReadonlyArray<IntlCheckModuleBoundaryV3["kind"]>;
const RESOLUTION_MODES = [
  "default",
  "import",
  "require",
] as const satisfies ReadonlyArray<IntlCheckResolutionModeV3>;
const CANDIDATE_REASONS = [
  "custom-conditions-ambiguous",
  "package-exports-ambiguous",
  "package-imports-ambiguous",
  "path-projection-ambiguous",
  "preserve-symlinks",
  "resolution-mode-ambiguous",
  "root-dirs-ambiguous",
  "symlink-boundary-ambiguous",
  "unsupported-module-resolution",
] as const satisfies ReadonlyArray<
  GeneratedFacadeCandidateIndexV3["reasons"][number]
>;
const UNKNOWN_BOUNDARY_REASONS = [
  "nonliteral-specifier",
  "unknown-resolution-mode",
  "unsupported-boundary-shape",
] as const satisfies ReadonlyArray<IntlCheckUnknownModuleBoundaryV3["reason"]>;
const V3_COUNTER_KEYS = [
  "boundaryIdentities",
  "checkerProjects",
  "classifierBoundaries",
  "classifierCandidateRequests",
  "classifierFacadeImports",
  "classifierFilteredRequests",
  "classifierFullResolverRequests",
  "classifierOwnerFallbacks",
  "classifierSourcesBound",
  "controlSets",
  "declarationFiles",
  "exceptions",
  "fileIdentities",
  "loadedLibFiles",
  "lexicalFilesClassified",
  "lstatIdentities",
  "ownerProjects",
  "packageScopeIdentities",
  "physicalFrontiers",
  "probeIdentities",
  "providerClosures",
  "providerRoots",
  "realpathIdentities",
  "resolutionBindings",
  "semanticAuthorizationRuns",
  "semanticFilesAnalyzed",
  "sourceFiles",
  "typescriptLibFiles",
  "unknownActiveSources",
  "unknownBoundaryIdentities",
] as const;

export interface IntlCheckReceiptV3HashMetrics {
  canonicalHashComputations: number;
  expansionSerializations: Readonly<Record<string, number>>;
  memoizedHashReuses: number;
}

interface MutableV3HashMetrics {
  canonicalHashComputations: number;
  expansionSerializations: Record<string, number>;
  memoizedHashReuses: number;
}

interface V3ExpansionContext {
  controls: Map<
    Ref,
    Readonly<{ files: ReadonlyArray<IntlCheckFileIdentityV2> }>
  >;
  frontiers: Map<Ref, Readonly<Record<string, unknown>>>;
  hashes: Map<string, Sha256>;
  indexes: WeakMap<
    GeneratedFacadeCandidateIndexV3,
    Readonly<Record<string, unknown>>
  >;
  metrics: MutableV3HashMetrics;
  packageScopes: Map<Ref, Readonly<Record<string, unknown>>>;
  providers: WeakMap<IntlCheckProviderV3, Readonly<Record<string, unknown>>>;
  closures: WeakMap<
    IntlCheckProviderClosureV3,
    Readonly<Record<string, unknown>>
  >;
  serializations: WeakMap<object, string>;
}

export function createIntlCheckReceiptV3HashMetrics(): IntlCheckReceiptV3HashMetrics {
  return {
    canonicalHashComputations: 0,
    expansionSerializations: {},
    memoizedHashReuses: 0,
  };
}

function mutableV3Metrics(
  metrics?: IntlCheckReceiptV3HashMetrics
): MutableV3HashMetrics {
  return (metrics ??
    createIntlCheckReceiptV3HashMetrics()) as MutableV3HashMetrics;
}

function v3ExpansionContext(
  metrics?: IntlCheckReceiptV3HashMetrics
): V3ExpansionContext {
  return {
    controls: new Map(),
    frontiers: new Map(),
    hashes: new Map(),
    indexes: new WeakMap(),
    metrics: mutableV3Metrics(metrics),
    packageScopes: new Map(),
    providers: new WeakMap(),
    closures: new WeakMap(),
    serializations: new WeakMap(),
  };
}

export function hashIntlCheckReceiptV3(
  domain: string,
  payload: unknown,
  metrics?: IntlCheckReceiptV3HashMetrics
): Sha256 {
  const mutable = mutableV3Metrics(metrics);
  mutable.canonicalHashComputations += 1;
  mutable.expansionSerializations[domain] =
    (mutable.expansionSerializations[domain] ?? 0) + 1;
  return sha256(canonicalJson(["mirai-intl", domain, 3, payload]));
}

function hashV3Memo(
  domain: string,
  payload: unknown,
  context: V3ExpansionContext,
  stableIdentity?: string
): Sha256 {
  const stableKey =
    stableIdentity === undefined
      ? undefined
      : `${framed(domain)}stable:${framed(stableIdentity)}`;
  if (stableKey !== undefined) {
    const cached = context.hashes.get(stableKey);
    if (cached !== undefined) {
      context.metrics.memoizedHashReuses += 1;
      return cached;
    }
  }
  const canonicalPayload = canonicalJsonV3Memo(payload, context);
  const key =
    stableKey ?? `${framed(domain)}canonical:${framed(canonicalPayload)}`;
  const cached = context.hashes.get(key);
  if (cached !== undefined) {
    context.metrics.memoizedHashReuses += 1;
    return cached;
  }
  context.metrics.canonicalHashComputations += 1;
  context.metrics.expansionSerializations[domain] =
    (context.metrics.expansionSerializations[domain] ?? 0) + 1;
  const result = sha256(
    canonicalJsonV3Memo(["mirai-intl", domain, 3, payload], context)
  );
  context.hashes.set(key, result);
  return result;
}

function canonicalJsonV3Memo(
  value: unknown,
  context: V3ExpansionContext
): string {
  if (value === null || typeof value !== "object") {
    return canonicalJson(value);
  }
  const cached = context.serializations.get(value);
  if (cached !== undefined) {
    return cached;
  }
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value
      .map((entry) => canonicalJsonV3Memo(entry, context))
      .join(",")}]`;
  } else {
    const entries = Object.entries(value).toSorted(([left], [right]) =>
      compareCanonicalStrings(left, right)
    );
    result = `{${entries
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${canonicalJsonV3Memo(entry, context)}`
      )
      .join(",")}}`;
  }
  context.serializations.set(value, result);
  return result;
}

function array(value: unknown, context: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value)) {
    return fail(context, "must be an array");
  }
  return value;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    return fail(context, "must be a boolean");
  }
  return value;
}

function ref(value: unknown, length: number, context: string): Ref {
  const result = count(value, context);
  if (result >= length) {
    fail(context, `must reference an entry in a table of length ${length}`);
  }
  return result;
}

function nullableRef(
  value: unknown,
  length: number,
  context: string
): Ref | null {
  return value === null ? null : ref(value, length, context);
}

function enumValue<T extends string>(
  value: unknown,
  values: ReadonlyArray<T>,
  context: string
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    return fail(context, "is unsupported");
  }
  return value as T;
}

function parseResolutionMode(
  value: unknown,
  context: string
): IntlCheckResolutionModeV3 {
  return enumValue(value, RESOLUTION_MODES, context);
}

function parseCanonicalStringArray(
  value: unknown,
  context: string,
  parseEntry: (entry: unknown, context: string) => string = text
): ReadonlyArray<string> {
  const entries = array(value, context).map((entry, index) =>
    parseEntry(entry, `${context}[${index}]`)
  );
  sortedUnique(entries, (entry) => entry, context);
  return entries;
}

function parseRefArray<T>(
  value: unknown,
  table: ReadonlyArray<T>,
  context: string,
  _identity?: (entry: T) => string
): ReadonlyArray<Ref> {
  const references = array(value, context).map((entry, index) =>
    ref(entry, table.length, `${context}[${index}]`)
  );
  sortedUnique(
    references,
    (entry) => entry.toString().padStart(16, "0"),
    context
  );
  return references;
}

function parseV3Lstat(value: unknown, context: string): IntlCheckLstatV3 {
  const object = exact(
    value,
    ["kind", "linkTargetBase64", "linkTargetHash", "path"],
    context
  );
  const kind = enumValue(
    object.kind,
    ["absent", "directory", "file", "other", "symlink"],
    `${context}.kind`
  );
  const lstatPath = path(object.path, `${context}.path`, false);
  if (kind !== "symlink") {
    if (object.linkTargetBase64 !== null || object.linkTargetHash !== null) {
      fail(context, "must omit raw link identity for a non-symlink");
    }
    return {
      kind,
      linkTargetBase64: null,
      linkTargetHash: null,
      path: lstatPath,
    };
  }
  const linkTargetBase64 = text(
    object.linkTargetBase64,
    `${context}.linkTargetBase64`
  );
  const decoded = Buffer.from(linkTargetBase64, "base64");
  if (decoded.toString("base64") !== linkTargetBase64) {
    fail(`${context}.linkTargetBase64`, "must be canonical base64");
  }
  const linkTargetHash = sha(
    object.linkTargetHash,
    `${context}.linkTargetHash`
  );
  if (linkTargetHash !== sha256(decoded)) {
    fail(`${context}.linkTargetHash`, "does not bind raw symlink target bytes");
  }
  return { kind, linkTargetBase64, linkTargetHash, path: lstatPath };
}

function expandControl(
  reference: Ref,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<{ files: ReadonlyArray<IntlCheckFileIdentityV2> }> {
  const cached = context.controls.get(reference);
  if (cached !== undefined) {
    return cached;
  }
  const control = tables.controls[reference];
  if (control === undefined) {
    return fail("V3 control reference", "is out of range");
  }
  const expanded = {
    files: control.files.map(
      (file) => tables.files[file] as IntlCheckFileIdentityV2
    ),
  };
  context.controls.set(reference, expanded);
  return expanded;
}

function expandPackageScope(
  reference: Ref,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  const cached = context.packageScopes.get(reference);
  if (cached !== undefined) {
    return cached;
  }
  const scope = tables.packageScopes[reference];
  if (scope === undefined) {
    return fail("V3 package-scope reference", "is out of range");
  }
  const expanded = {
    canonicalRoot: scope.canonicalRoot,
    control: expandControl(scope.control, tables, context),
    lexicalRoot: scope.lexicalRoot,
    manifest:
      scope.manifest === null ? null : (tables.files[scope.manifest] ?? null),
    manifestLstat: tables.lstats[scope.manifestLstat],
    manifestProbe: tables.probes[scope.manifestProbe],
    realpath: tables.realpaths[scope.realpath],
    rootLstat: tables.lstats[scope.rootLstat],
  };
  context.packageScopes.set(reference, expanded);
  return expanded;
}

function expandFrontier(
  reference: Ref,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  const cached = context.frontiers.get(reference);
  if (cached !== undefined) {
    return cached;
  }
  const frontier = tables.frontiers[reference];
  if (frontier === undefined) {
    return fail("V3 frontier reference", "is out of range");
  }
  const expanded = {
    control: expandControl(frontier.control, tables, context),
    lstats: frontier.lstats.map((entry) => tables.lstats[entry]),
    optionsHash: frontier.optionsHash,
    packageName: frontier.packageName,
    packageVersion: frontier.packageVersion,
    probes: frontier.probes.map((entry) => tables.probes[entry]),
    realpaths: frontier.realpaths.map((entry) => tables.realpaths[entry]),
    resolutionMode: frontier.resolutionMode,
    resolvedFile:
      frontier.resolvedFile === null
        ? null
        : tables.files[frontier.resolvedFile],
  };
  context.frontiers.set(reference, expanded);
  return expanded;
}

function expandResolutionBinding(
  binding: IntlCheckResolutionBindingV3,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  return {
    boundary: tables.boundaries[binding.boundary],
    frontier: expandFrontier(binding.frontier, tables, context),
    from: binding.from,
    resolutionMode: binding.resolutionMode,
    specifier: binding.specifier,
  };
}

function expandProviderResolution(
  binding: IntlCheckProviderResolutionV3,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  return {
    frontier: expandFrontier(binding.frontier, tables, context),
    from: binding.from,
    specifier: binding.specifier,
  };
}

function expandProjection(
  projection: GeneratedFacadeProjectedRootV3,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  return {
    boundary: tables.boundaries[projection.boundary],
    canonicalRoot: projection.canonicalRoot,
    control: expandControl(projection.control, tables, context),
    lexicalRoot: projection.lexicalRoot,
    lstats: projection.lstats.map((entry) => tables.lstats[entry]),
    packageScopes: projection.packageScopes.map((entry) =>
      expandPackageScope(entry, tables, context)
    ),
    probes: projection.probes.map((entry) => tables.probes[entry]),
    proofKind: projection.proofKind,
    realpaths: projection.realpaths.map((entry) => tables.realpaths[entry]),
    status: projection.status,
  };
}

function expandFacade(
  facade: GeneratedFacadeRootEvidenceV3,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  return {
    canonicalRoot: facade.canonicalRoot,
    control: expandControl(facade.control, tables, context),
    file: tables.files[facade.file],
    lexicalRoot: facade.lexicalRoot,
    lstats: facade.lstats.map((entry) => tables.lstats[entry]),
    packageScopes: facade.packageScopes.map((entry) =>
      expandPackageScope(entry, tables, context)
    ),
    probes: facade.probes.map((entry) => tables.probes[entry]),
    realpaths: facade.realpaths.map((entry) => tables.realpaths[entry]),
  };
}

function expandIndex(
  index: GeneratedFacadeCandidateIndexV3,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  const cached = context.indexes.get(index);
  if (cached !== undefined) {
    return cached;
  }
  const expanded = {
    analyzerAbi: index.analyzerAbi,
    control: expandControl(index.control, tables, context),
    facade: expandFacade(index.facade, tables, context),
    lstats: index.lstats.map((entry) => tables.lstats[entry]),
    mode: index.mode,
    optionsHash: index.optionsHash,
    owner: index.owner,
    packageScopes: index.packageScopes.map((entry) =>
      expandPackageScope(entry, tables, context)
    ),
    probes: index.probes.map((entry) => tables.probes[entry]),
    projections: index.projections.map((entry) =>
      expandProjection(entry, tables, context)
    ),
    realpaths: index.realpaths.map((entry) => tables.realpaths[entry]),
    reasons: index.reasons,
  };
  context.indexes.set(index, expanded);
  return expanded;
}

function parseV3Tables(value: unknown): IntlCheckTablesV3 {
  const object = exact(
    value,
    [
      "boundaries",
      "controls",
      "files",
      "frontiers",
      "lstats",
      "packageScopes",
      "probes",
      "realpaths",
      "unknownBoundaries",
    ],
    "Intl check receipt V3.tables"
  );
  const files = array(object.files, "Intl check receipt V3.tables.files").map(
    (entry, index) =>
      parseFile(entry, `Intl check receipt V3.tables.files[${index}]`)
  );
  sortedUnique(
    files,
    (entry) => `${entry.path}\0${entry.hash}`,
    "Intl check receipt V3.tables.files"
  );

  const probes = array(
    object.probes,
    "Intl check receipt V3.tables.probes"
  ).map((entry, index): IntlCheckProbeV3 => {
    const context = `Intl check receipt V3.tables.probes[${index}]`;
    const probe = exact(entry, ["kind", "path", "present"], context);
    return {
      kind: enumValue(probe.kind, ["directory", "file"], `${context}.kind`),
      path: path(probe.path, `${context}.path`, false),
      present: boolean(probe.present, `${context}.present`),
    };
  });
  sortedUnique(
    probes,
    (entry) => `${entry.path}\u0000${entry.kind}`,
    "Intl check receipt V3.tables.probes"
  );

  const lstats = array(
    object.lstats,
    "Intl check receipt V3.tables.lstats"
  ).map((entry, index) =>
    parseV3Lstat(entry, `Intl check receipt V3.tables.lstats[${index}]`)
  );
  sortedUnique(
    lstats,
    (entry) => entry.path,
    "Intl check receipt V3.tables.lstats"
  );

  const realpaths = array(
    object.realpaths,
    "Intl check receipt V3.tables.realpaths"
  ).map((entry, index): IntlCheckRealpathV3 => {
    const context = `Intl check receipt V3.tables.realpaths[${index}]`;
    const realpath = exact(entry, ["path", "target"], context);
    return {
      path: path(realpath.path, `${context}.path`, false),
      target: path(realpath.target, `${context}.target`, false),
    };
  });
  sortedUnique(
    realpaths,
    (entry) => entry.path,
    "Intl check receipt V3.tables.realpaths"
  );

  const controls = array(
    object.controls,
    "Intl check receipt V3.tables.controls"
  ).map((entry, index): IntlCheckControlSetV3 => {
    const context = `Intl check receipt V3.tables.controls[${index}]`;
    const control = exact(entry, ["files"], context);
    return {
      files: parseRefArray(control.files, files, `${context}.files`),
    };
  });
  sortedUnique(
    controls,
    (entry) => canonicalJson(entry.files.map((reference) => files[reference])),
    "Intl check receipt V3.tables.controls"
  );

  const packageScopes = array(
    object.packageScopes,
    "Intl check receipt V3.tables.packageScopes"
  ).map((entry, index): IntlCheckPackageScopeV3 => {
    const context = `Intl check receipt V3.tables.packageScopes[${index}]`;
    const scope = exact(
      entry,
      [
        "canonicalRoot",
        "control",
        "lexicalRoot",
        "manifest",
        "manifestLstat",
        "manifestProbe",
        "realpath",
        "rootLstat",
      ],
      context
    );
    return {
      canonicalRoot: path(
        scope.canonicalRoot,
        `${context}.canonicalRoot`,
        false
      ),
      control: ref(scope.control, controls.length, `${context}.control`),
      lexicalRoot: path(scope.lexicalRoot, `${context}.lexicalRoot`, false),
      manifest: nullableRef(
        scope.manifest,
        files.length,
        `${context}.manifest`
      ),
      manifestLstat: ref(
        scope.manifestLstat,
        lstats.length,
        `${context}.manifestLstat`
      ),
      manifestProbe: ref(
        scope.manifestProbe,
        probes.length,
        `${context}.manifestProbe`
      ),
      realpath: ref(scope.realpath, realpaths.length, `${context}.realpath`),
      rootLstat: ref(scope.rootLstat, lstats.length, `${context}.rootLstat`),
    };
  });
  sortedUnique(
    packageScopes,
    (entry) => `${entry.lexicalRoot}\u0000${entry.canonicalRoot}`,
    "Intl check receipt V3.tables.packageScopes"
  );

  const boundaries = array(
    object.boundaries,
    "Intl check receipt V3.tables.boundaries"
  ).map((entry, index): IntlCheckModuleBoundaryV3 => {
    const context = `Intl check receipt V3.tables.boundaries[${index}]`;
    const boundary = exact(
      entry,
      [
        "kind",
        "observationOrdinal",
        "ordinal",
        "resolutionMode",
        "source",
        "specifier",
      ],
      context
    );
    return {
      kind: enumValue(boundary.kind, BOUNDARY_KINDS, `${context}.kind`),
      observationOrdinal: count(
        boundary.observationOrdinal,
        `${context}.observationOrdinal`
      ),
      ordinal: count(boundary.ordinal, `${context}.ordinal`),
      resolutionMode: parseResolutionMode(
        boundary.resolutionMode,
        `${context}.resolutionMode`
      ),
      source: path(boundary.source, `${context}.source`, false),
      specifier: text(boundary.specifier, `${context}.specifier`),
    };
  });
  sortedUnique(
    boundaries,
    boundaryIdentityV3,
    "Intl check receipt V3.tables.boundaries"
  );
  const nextOrdinal = new Map<string, number>();
  for (const boundary of boundaries) {
    const expected = nextOrdinal.get(boundary.source) ?? 0;
    if (boundary.ordinal !== expected) {
      fail(
        `Boundary ledger ${JSON.stringify(boundary.source)}`,
        `must contain contiguous ordinals starting at 0; expected ${expected}`
      );
    }
    nextOrdinal.set(boundary.source, expected + 1);
  }

  const unknownBoundaries = array(
    object.unknownBoundaries,
    "Intl check receipt V3.tables.unknownBoundaries"
  ).map((entry, index): IntlCheckUnknownModuleBoundaryV3 => {
    const context = `Intl check receipt V3.tables.unknownBoundaries[${index}]`;
    const unknown = exact(
      entry,
      [
        "byteEnd",
        "byteStart",
        "kind",
        "nodeHash",
        "nodeKind",
        "observationOrdinal",
        "reason",
        "source",
        "sourceSliceHash",
      ],
      context
    );
    const byteStart = count(unknown.byteStart, `${context}.byteStart`);
    const byteEnd = count(unknown.byteEnd, `${context}.byteEnd`);
    if (byteStart >= byteEnd) {
      fail(context, "must have byteStart strictly before byteEnd");
    }
    return {
      byteEnd,
      byteStart,
      kind: enumValue(unknown.kind, BOUNDARY_KINDS, `${context}.kind`),
      nodeHash: sha(unknown.nodeHash, `${context}.nodeHash`),
      nodeKind: text(unknown.nodeKind, `${context}.nodeKind`),
      observationOrdinal: count(
        unknown.observationOrdinal,
        `${context}.observationOrdinal`
      ),
      reason: enumValue(
        unknown.reason,
        UNKNOWN_BOUNDARY_REASONS,
        `${context}.reason`
      ),
      source: path(unknown.source, `${context}.source`, false),
      sourceSliceHash: sha(
        unknown.sourceSliceHash,
        `${context}.sourceSliceHash`
      ),
    };
  });
  sortedUnique(
    unknownBoundaries,
    unknownBoundaryIdentityV3,
    "Intl check receipt V3.tables.unknownBoundaries"
  );
  const observationOrdinals = new Map<string, Array<number>>();
  for (const boundary of boundaries) {
    const ordinals = observationOrdinals.get(boundary.source) ?? [];
    ordinals.push(boundary.observationOrdinal);
    observationOrdinals.set(boundary.source, ordinals);
  }
  for (const boundary of unknownBoundaries) {
    const ordinals = observationOrdinals.get(boundary.source) ?? [];
    ordinals.push(boundary.observationOrdinal);
    observationOrdinals.set(boundary.source, ordinals);
  }
  for (const [source, ordinals] of observationOrdinals) {
    ordinals
      .toSorted((left, right) => left - right)
      .forEach((ordinal, expected) => {
        if (ordinal !== expected) {
          fail(
            `Observation ledger ${JSON.stringify(source)}`,
            `must contain unique contiguous ordinals from 0; expected ${expected}`
          );
        }
      });
  }

  const frontierInputs = array(
    object.frontiers,
    "Intl check receipt V3.tables.frontiers"
  ).map((entry, index): IntlCheckPhysicalFrontierV3 => {
    const context = `Intl check receipt V3.tables.frontiers[${index}]`;
    const frontier = exact(
      entry,
      [
        "control",
        "frontierHash",
        "lstats",
        "optionsHash",
        "packageName",
        "packageVersion",
        "probes",
        "realpaths",
        "resolutionMode",
        "resolvedFile",
      ],
      context
    );
    const packageName = nullableText(
      frontier.packageName,
      `${context}.packageName`
    );
    const packageVersion = nullableText(
      frontier.packageVersion,
      `${context}.packageVersion`
    );
    if ((packageName === null) !== (packageVersion === null)) {
      fail(context, "must bind both package name and version or neither");
    }
    return {
      control: ref(frontier.control, controls.length, `${context}.control`),
      frontierHash: sha(frontier.frontierHash, `${context}.frontierHash`),
      lstats: parseRefArray(frontier.lstats, lstats, `${context}.lstats`),
      optionsHash: sha(frontier.optionsHash, `${context}.optionsHash`),
      packageName,
      packageVersion,
      probes: parseRefArray(frontier.probes, probes, `${context}.probes`),
      realpaths: parseRefArray(
        frontier.realpaths,
        realpaths,
        `${context}.realpaths`
      ),
      resolutionMode: parseResolutionMode(
        frontier.resolutionMode,
        `${context}.resolutionMode`
      ),
      resolvedFile: nullableRef(
        frontier.resolvedFile,
        files.length,
        `${context}.resolvedFile`
      ),
    };
  });
  sortedUnique(
    frontierInputs,
    (entry) => entry.frontierHash,
    "Intl check receipt V3.tables.frontiers"
  );
  return {
    boundaries,
    controls,
    files,
    frontiers: frontierInputs,
    lstats,
    packageScopes,
    probes,
    realpaths,
    unknownBoundaries,
  };
}

function boundaryIdentityV3(entry: IntlCheckModuleBoundaryV3): string {
  return `${canonicalSortText(entry.source)}${entry.ordinal
    .toString()
    .padStart(16, "0")}/${entry.observationOrdinal
    .toString()
    .padStart(16, "0")}/${canonicalSortText(entry.kind)}${canonicalSortText(
    entry.specifier
  )}${canonicalSortText(entry.resolutionMode)}`;
}

function unknownBoundaryIdentityV3(
  entry: IntlCheckUnknownModuleBoundaryV3
): string {
  return `${canonicalSortText(entry.source)}${entry.observationOrdinal
    .toString()
    .padStart(16, "0")}/${entry.byteStart
    .toString()
    .padStart(16, "0")}/${entry.byteEnd
    .toString()
    .padStart(16, "0")}/${canonicalSortText(entry.kind)}${canonicalSortText(
    entry.nodeKind
  )}${canonicalSortText(entry.reason)}${canonicalSortText(
    entry.sourceSliceHash
  )}${canonicalSortText(entry.nodeHash)}`;
}

function canonicalSortText(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    result += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return `${result}/`;
}

function parseResolutionBindingV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  context: string,
  expansion: V3ExpansionContext
): IntlCheckResolutionBindingV3 {
  const object = exact(
    value,
    ["boundary", "frontier", "from", "resolutionMode", "specifier"],
    context
  );
  const binding = {
    boundary: ref(
      object.boundary,
      tables.boundaries.length,
      `${context}.boundary`
    ),
    frontier: ref(
      object.frontier,
      tables.frontiers.length,
      `${context}.frontier`
    ),
    from: path(object.from, `${context}.from`, false),
    resolutionMode: parseResolutionMode(
      object.resolutionMode,
      `${context}.resolutionMode`
    ),
    specifier: text(object.specifier, `${context}.specifier`),
  };
  const boundary = tables.boundaries[
    binding.boundary
  ] as IntlCheckModuleBoundaryV3;
  const frontier = tables.frontiers[
    binding.frontier
  ] as IntlCheckPhysicalFrontierV3;
  if (
    binding.resolutionMode !== boundary.resolutionMode ||
    binding.resolutionMode !== frontier.resolutionMode
  ) {
    fail(context, "must agree with boundary and frontier resolution modes");
  }
  if (
    binding.from !== boundary.source ||
    binding.specifier !== boundary.specifier
  ) {
    fail(context, "must agree with the referenced boundary");
  }
  void expandFrontier(binding.frontier, tables, expansion);
  return binding;
}

function resolutionBindingIdentity(
  binding: IntlCheckResolutionBindingV3,
  tables: IntlCheckTablesV3
): string {
  const frontier = tables.frontiers[binding.frontier];
  return canonicalJson([
    binding.boundary,
    binding.from,
    binding.specifier,
    binding.resolutionMode,
    frontier?.frontierHash,
  ]);
}

function providerResolutionIdentity(
  binding: IntlCheckProviderResolutionV3,
  tables: IntlCheckTablesV3
): string {
  return canonicalJson([
    binding.from,
    binding.specifier,
    tables.frontiers[binding.frontier]?.frontierHash,
  ]);
}

function parseProviderResolutionV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  context: string,
  expansion: V3ExpansionContext
): IntlCheckProviderResolutionV3 {
  const object = exact(value, ["frontier", "from", "specifier"], context);
  const binding = {
    frontier: ref(
      object.frontier,
      tables.frontiers.length,
      `${context}.frontier`
    ),
    from: path(object.from, `${context}.from`, false),
    specifier: text(object.specifier, `${context}.specifier`),
  };
  void expandFrontier(binding.frontier, tables, expansion);
  return binding;
}

function parseFacadeV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  context: string
): GeneratedFacadeRootEvidenceV3 {
  const object = exact(
    value,
    [
      "canonicalRoot",
      "control",
      "file",
      "lexicalRoot",
      "lstats",
      "packageScopes",
      "probes",
      "realpaths",
    ],
    context
  );
  return {
    canonicalRoot: path(
      object.canonicalRoot,
      `${context}.canonicalRoot`,
      false
    ),
    control: ref(object.control, tables.controls.length, `${context}.control`),
    file: ref(object.file, tables.files.length, `${context}.file`),
    lexicalRoot: path(object.lexicalRoot, `${context}.lexicalRoot`, false),
    lstats: parseRefArray(object.lstats, tables.lstats, `${context}.lstats`),
    packageScopes: parseRefArray(
      object.packageScopes,
      tables.packageScopes,
      `${context}.packageScopes`,
      (entry) => canonicalJson([entry.lexicalRoot, entry.canonicalRoot])
    ),
    probes: parseRefArray(object.probes, tables.probes, `${context}.probes`),
    realpaths: parseRefArray(
      object.realpaths,
      tables.realpaths,
      `${context}.realpaths`
    ),
  };
}

function parseProjectionV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  context: string
): GeneratedFacadeProjectedRootV3 {
  const object = exact(
    value,
    [
      "boundary",
      "canonicalRoot",
      "control",
      "lexicalRoot",
      "lstats",
      "packageScopes",
      "probes",
      "proofKind",
      "realpaths",
      "status",
    ],
    context
  );
  return {
    boundary: ref(
      object.boundary,
      tables.boundaries.length,
      `${context}.boundary`
    ),
    canonicalRoot: path(
      object.canonicalRoot,
      `${context}.canonicalRoot`,
      false
    ),
    control: ref(object.control, tables.controls.length, `${context}.control`),
    lexicalRoot: path(object.lexicalRoot, `${context}.lexicalRoot`, false),
    lstats: parseRefArray(object.lstats, tables.lstats, `${context}.lstats`),
    packageScopes: parseRefArray(
      object.packageScopes,
      tables.packageScopes,
      `${context}.packageScopes`,
      (entry) => canonicalJson([entry.lexicalRoot, entry.canonicalRoot])
    ),
    probes: parseRefArray(object.probes, tables.probes, `${context}.probes`),
    proofKind: projectionProofKind(object.proofKind, `${context}.proofKind`),
    realpaths: parseRefArray(
      object.realpaths,
      tables.realpaths,
      `${context}.realpaths`
    ),
    status: enumValue(
      object.status,
      ["candidate", "disjoint"],
      `${context}.status`
    ),
  };
}

function sortedUnion(
  arrays: ReadonlyArray<ReadonlyArray<Ref>>,
  _table: ReadonlyArray<unknown>
): ReadonlyArray<Ref> {
  return [...new Set(arrays.flat())].toSorted((left, right) => left - right);
}

function assertSameRefs(
  actual: ReadonlyArray<Ref>,
  expected: ReadonlyArray<Ref>,
  context: string
): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(context, "must equal the exact sorted aggregate evidence union");
  }
}

function parseCandidateIndexesV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  expansion: V3ExpansionContext
): ReadonlyArray<GeneratedFacadeCandidateIndexV3> {
  const indexes = array(value, "Intl check receipt V3.candidateIndexes").map(
    (entry, index): GeneratedFacadeCandidateIndexV3 => {
      const context = `Intl check receipt V3.candidateIndexes[${index}]`;
      const object = exact(
        entry,
        [
          "analyzerAbi",
          "control",
          "facade",
          "indexHash",
          "lstats",
          "mode",
          "optionsHash",
          "owner",
          "packageScopes",
          "probes",
          "projections",
          "realpaths",
          "reasons",
        ],
        context
      );
      const facade = parseFacadeV3(object.facade, tables, `${context}.facade`);
      const projections = array(
        object.projections,
        `${context}.projections`
      ).map((projection, projectionIndex) =>
        parseProjectionV3(
          projection,
          tables,
          `${context}.projections[${projectionIndex}]`
        )
      );
      sortedUnique(
        projections,
        (projection) =>
          `${boundaryIdentityV3(
            tables.boundaries[projection.boundary] as IntlCheckModuleBoundaryV3
          )}${canonicalSortText(projection.lexicalRoot)}${canonicalSortText(
            projection.canonicalRoot
          )}${canonicalSortText(projection.status)}${canonicalSortText(
            projection.proofKind
          )}`,
        `${context}.projections`
      );
      const reasons = parseCanonicalStringArray(
        object.reasons,
        `${context}.reasons`,
        (reason, reasonContext) =>
          enumValue(reason, CANDIDATE_REASONS, reasonContext)
      ) as GeneratedFacadeCandidateIndexV3["reasons"];
      const result: GeneratedFacadeCandidateIndexV3 = {
        analyzerAbi: text(object.analyzerAbi, `${context}.analyzerAbi`),
        control: ref(
          object.control,
          tables.controls.length,
          `${context}.control`
        ),
        facade,
        indexHash: sha(object.indexHash, `${context}.indexHash`),
        lstats: parseRefArray(
          object.lstats,
          tables.lstats,
          `${context}.lstats`
        ),
        mode: enumValue(
          object.mode,
          ["filtered", "owner-fallback"],
          `${context}.mode`
        ),
        optionsHash: sha(object.optionsHash, `${context}.optionsHash`),
        owner: path(object.owner, `${context}.owner`, false),
        packageScopes: parseRefArray(
          object.packageScopes,
          tables.packageScopes,
          `${context}.packageScopes`,
          (scope) => canonicalJson([scope.lexicalRoot, scope.canonicalRoot])
        ),
        probes: parseRefArray(
          object.probes,
          tables.probes,
          `${context}.probes`
        ),
        projections,
        realpaths: parseRefArray(
          object.realpaths,
          tables.realpaths,
          `${context}.realpaths`
        ),
        reasons,
      };
      assertSameRefs(
        result.lstats,
        sortedUnion(
          [
            facade.lstats,
            ...projections.map((projection) => projection.lstats),
          ],
          tables.lstats
        ),
        `${context}.lstats`
      );
      assertSameRefs(
        result.packageScopes,
        sortedUnion(
          [
            facade.packageScopes,
            ...projections.map((projection) => projection.packageScopes),
          ],
          tables.packageScopes
        ),
        `${context}.packageScopes`
      );
      assertSameRefs(
        result.probes,
        sortedUnion(
          [
            facade.probes,
            ...projections.map((projection) => projection.probes),
          ],
          tables.probes
        ),
        `${context}.probes`
      );
      assertSameRefs(
        result.realpaths,
        sortedUnion(
          [
            facade.realpaths,
            ...projections.map((projection) => projection.realpaths),
          ],
          tables.realpaths
        ),
        `${context}.realpaths`
      );
      return result;
    }
  );
  sortedUnique(
    indexes,
    (index) =>
      canonicalJson([
        index.owner,
        index.optionsHash,
        tables.files[index.facade.file],
        index.facade.lexicalRoot,
        index.facade.canonicalRoot,
      ]),
    "Intl check receipt V3.candidateIndexes"
  );
  for (const index of indexes) {
    void expandIndex(index, tables, expansion);
  }
  return indexes;
}

function parseProjectV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  context: string
): IntlCheckProjectV3 {
  const object = exact(
    value,
    [
      "configManifest",
      "configManifestHash",
      "normalizedOptions",
      "normalizedOptionsHash",
      "path",
      "resolverOptionsHash",
      "role",
      "rootFiles",
    ],
    context
  );
  const projectPath = path(object.path, `${context}.path`, false);
  const configManifest = array(
    object.configManifest,
    `${context}.configManifest`
  ).map((entry, index): IntlCheckTsconfigFileV3 => {
    const entryContext = `${context}.configManifest[${index}]`;
    const config = exact(
      entry,
      ["extends", "file", "path", "references"],
      entryContext
    );
    const extended = array(config.extends, `${entryContext}.extends`).map(
      (item, itemIndex) =>
        path(item, `${entryContext}.extends[${itemIndex}]`, false)
    );
    if (new Set(extended).size !== extended.length) {
      fail(`${entryContext}.extends`, "contains duplicate identities");
    }
    return {
      extends: extended,
      file: ref(config.file, tables.files.length, `${entryContext}.file`),
      path: path(config.path, `${entryContext}.path`, false),
      references: parseCanonicalStringArray(
        config.references,
        `${entryContext}.references`,
        (item, itemContext) => path(item, itemContext, false)
      ),
    };
  });
  sortedUnique(
    configManifest,
    (entry) => entry.path,
    `${context}.configManifest`
  );
  const rootFiles = parseCanonicalStringArray(
    object.rootFiles,
    `${context}.rootFiles`,
    (entry, entryContext) => path(entry, entryContext, false)
  );
  const normalizedOptions = parseJsonRecord(
    object.normalizedOptions,
    `${context}.normalizedOptions`
  );
  return {
    configManifest,
    configManifestHash: sha(
      object.configManifestHash,
      `${context}.configManifestHash`
    ),
    normalizedOptions,
    normalizedOptionsHash: sha(
      object.normalizedOptionsHash,
      `${context}.normalizedOptionsHash`
    ),
    path: projectPath,
    resolverOptionsHash: sha(
      object.resolverOptionsHash,
      `${context}.resolverOptionsHash`
    ),
    role: enumValue(object.role, ["checker", "owner"], `${context}.role`),
    rootFiles,
  };
}

function expandProvider(
  provider: IntlCheckProviderV3,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  const cached = context.providers.get(provider);
  if (cached !== undefined) {
    return cached;
  }
  const expanded = {
    declarationHash: provider.declarationHash,
    declarations: provider.declarations.map((entry) => tables.files[entry]),
    kind: provider.kind,
    resolutions: provider.resolutions.map((entry) =>
      expandProviderResolution(entry, tables, context)
    ),
    root: provider.root,
  };
  context.providers.set(provider, expanded);
  return expanded;
}

function expandClosure(
  closure: IntlCheckProviderClosureV3,
  tables: IntlCheckTablesV3,
  context: V3ExpansionContext
): Readonly<Record<string, unknown>> {
  const cached = context.closures.get(closure);
  if (cached !== undefined) {
    return cached;
  }
  const expanded = {
    ambientTypeFileLimit: closure.ambientTypeFileLimit,
    declarationHash: closure.declarationHash,
    declarations: closure.declarations.map((entry) => tables.files[entry]),
    libHash: closure.libHash,
    libs: closure.libs.map((entry) => tables.files[entry]),
    providerBudgetExceeded: closure.providerBudgetExceeded,
    providerRootLimit: closure.providerRootLimit,
    providers: closure.providers.map((provider) =>
      expandProvider(provider, tables, context)
    ),
    source: closure.source,
  };
  context.closures.set(closure, expanded);
  return expanded;
}

function parseProviderV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  context: string,
  expansion: V3ExpansionContext
): IntlCheckProviderV3 {
  const object = exact(
    value,
    ["declarationHash", "declarations", "hash", "kind", "resolutions", "root"],
    context
  );
  const resolutions = array(object.resolutions, `${context}.resolutions`).map(
    (entry, index) =>
      parseProviderResolutionV3(
        entry,
        tables,
        `${context}.resolutions[${index}]`,
        expansion
      )
  );
  sortedUnique(
    resolutions,
    (entry) => providerResolutionIdentity(entry, tables),
    `${context}.resolutions`
  );
  return {
    declarationHash: sha(object.declarationHash, `${context}.declarationHash`),
    declarations: parseRefArray(
      object.declarations,
      tables.files,
      `${context}.declarations`
    ),
    hash: sha(object.hash, `${context}.hash`),
    kind: enumValue(object.kind, PROVIDER_KINDS, `${context}.kind`),
    resolutions,
    root: path(object.root, `${context}.root`, false),
  };
}

function parseProviderClosuresV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  expansion: V3ExpansionContext
): ReadonlyArray<IntlCheckProviderClosureV3> {
  const closures = array(value, "Intl check receipt V3.providerClosures").map(
    (entry, index): IntlCheckProviderClosureV3 => {
      const context = `Intl check receipt V3.providerClosures[${index}]`;
      const object = exact(
        entry,
        [
          "ambientTypeFileLimit",
          "closureHash",
          "declarationHash",
          "declarations",
          "libHash",
          "libs",
          "providerBudgetExceeded",
          "providerRootLimit",
          "providers",
          "source",
        ],
        context
      );
      const providers = array(object.providers, `${context}.providers`).map(
        (provider, providerIndex) =>
          parseProviderV3(
            provider,
            tables,
            `${context}.providers[${providerIndex}]`,
            expansion
          )
      );
      sortedUnique(providers, providerIdentity, `${context}.providers`);
      if (object.providerBudgetExceeded !== false) {
        fail(`${context}.providerBudgetExceeded`, "must be false");
      }
      const declarations = parseRefArray(
        object.declarations,
        tables.files,
        `${context}.declarations`
      );
      const expectedDeclarations = sortedUnion(
        providers.map((provider) => provider.declarations),
        tables.files
      );
      assertSameRefs(
        declarations,
        expectedDeclarations,
        `${context}.declarations`
      );
      const providerRootLimit = count(
        object.providerRootLimit,
        `${context}.providerRootLimit`
      );
      if (providers.length > providerRootLimit) {
        fail(context, "exceeds providerRootLimit");
      }
      const ambientTypeFileLimit = count(
        object.ambientTypeFileLimit,
        `${context}.ambientTypeFileLimit`
      );
      const ambientFiles = providers
        .filter((provider) => provider.kind === "ambient")
        .reduce((total, provider) => total + provider.declarations.length, 0);
      if (ambientFiles > ambientTypeFileLimit) {
        fail(context, "exceeds ambientTypeFileLimit");
      }
      return {
        ambientTypeFileLimit,
        closureHash: sha(object.closureHash, `${context}.closureHash`),
        declarationHash: sha(
          object.declarationHash,
          `${context}.declarationHash`
        ),
        declarations,
        libHash: sha(object.libHash, `${context}.libHash`),
        libs: parseRefArray(object.libs, tables.files, `${context}.libs`),
        providerBudgetExceeded: false,
        providerRootLimit,
        providers,
        source: path(object.source, `${context}.source`, false),
      };
    }
  );
  sortedUnique(
    closures,
    (entry) => entry.source,
    "Intl check receipt V3.providerClosures"
  );
  return closures;
}

function parseClassifierBindingsV3(
  value: unknown,
  tables: IntlCheckTablesV3,
  indexes: ReadonlyArray<GeneratedFacadeCandidateIndexV3>,
  expansion: V3ExpansionContext
): ReadonlyArray<IntlSourceClassifierBindingV3> {
  const boundariesBySource = new Map<string, Array<Ref>>();
  tables.boundaries.forEach((boundary, boundaryReference) => {
    const references = boundariesBySource.get(boundary.source);
    if (references === undefined) {
      boundariesBySource.set(boundary.source, [boundaryReference]);
    } else {
      references.push(boundaryReference);
    }
  });
  const unknownBoundariesBySource = new Map<string, Array<Ref>>();
  tables.unknownBoundaries.forEach((boundary, boundaryReference) => {
    const references = unknownBoundariesBySource.get(boundary.source);
    if (references === undefined) {
      unknownBoundariesBySource.set(boundary.source, [boundaryReference]);
    } else {
      references.push(boundaryReference);
    }
  });
  const bindings = array(value, "Intl check receipt V3.classifierBindings").map(
    (entry, index): IntlSourceClassifierBindingV3 => {
      const context = `Intl check receipt V3.classifierBindings[${index}]`;
      const object = exact(
        entry,
        [
          "bindingHash",
          "boundaries",
          "boundaryHash",
          "candidateIndex",
          "candidateIndexHash",
          "decision",
          "mode",
          "requests",
          "source",
          "sourceHash",
          "unknownBoundaries",
        ],
        context
      );
      const source = path(object.source, `${context}.source`, false);
      const boundaries = parseRefArray(
        object.boundaries,
        tables.boundaries,
        `${context}.boundaries`,
        boundaryIdentityV3
      );
      const unknownBoundaries = parseRefArray(
        object.unknownBoundaries,
        tables.unknownBoundaries,
        `${context}.unknownBoundaries`,
        unknownBoundaryIdentityV3
      );
      const requests = array(object.requests, `${context}.requests`).map(
        (request, requestIndex) =>
          parseResolutionBindingV3(
            request,
            tables,
            `${context}.requests[${requestIndex}]`,
            expansion
          )
      );
      sortedUnique(
        requests,
        (request) => resolutionBindingIdentity(request, tables),
        `${context}.requests`
      );
      const candidateIndex = ref(
        object.candidateIndex,
        indexes.length,
        `${context}.candidateIndex`
      );
      const selectedIndex = indexes[
        candidateIndex
      ] as GeneratedFacadeCandidateIndexV3;
      const mode = enumValue(
        object.mode,
        ["filtered", "owner-fallback"],
        `${context}.mode`
      );
      if (mode !== selectedIndex.mode) {
        fail(`${context}.mode`, "must equal the selected candidate-index mode");
      }
      const expectedBoundaries = boundariesBySource.get(source) ?? [];
      if (canonicalJson(boundaries) !== canonicalJson(expectedBoundaries)) {
        fail(
          `${context}.boundaries`,
          "must equal the complete ordered source boundary ledger"
        );
      }
      const expectedUnknownBoundaries =
        unknownBoundariesBySource.get(source) ?? [];
      if (
        canonicalJson(unknownBoundaries) !==
        canonicalJson(expectedUnknownBoundaries)
      ) {
        fail(
          `${context}.unknownBoundaries`,
          "must equal the complete ordered source unknown-boundary ledger"
        );
      }
      if (requests.some((request) => !boundaries.includes(request.boundary))) {
        fail(
          `${context}.requests`,
          "must reference this source boundary ledger"
        );
      }
      const projectionsByBoundary = new Map<
        Ref,
        Array<GeneratedFacadeProjectedRootV3>
      >();
      for (const projection of selectedIndex.projections) {
        const entries = projectionsByBoundary.get(projection.boundary);
        if (entries === undefined) {
          projectionsByBoundary.set(projection.boundary, [projection]);
        } else {
          entries.push(projection);
        }
      }
      for (const boundary of boundaries) {
        const projections = projectionsByBoundary.get(boundary) ?? [];
        if (projections.length === 0) {
          fail(
            `${context}.candidateIndex`,
            "must provide projection evidence for every source boundary"
          );
        }
        if (
          new Set(projections.map(({ proofKind }) => proofKind)).size !== 1 ||
          new Set(projections.map(({ status }) => status)).size !== 1
        ) {
          fail(
            `${context}.candidateIndex`,
            "must provide one unambiguous proof group per source boundary"
          );
        }
      }
      const expectedRequestBoundaries = boundaries.filter((boundary) =>
        projectionsByBoundary
          .get(boundary)
          ?.some(({ status }) => status === "candidate")
      );
      const actualRequestBoundaries = requests
        .map((request) => request.boundary)
        .toSorted((left, right) => left - right);
      if (
        canonicalJson(actualRequestBoundaries) !==
        canonicalJson(expectedRequestBoundaries)
      ) {
        fail(
          `${context}.requests`,
          "must cover exactly the mode-selected boundary set"
        );
      }
      return {
        bindingHash: sha(object.bindingHash, `${context}.bindingHash`),
        boundaries,
        boundaryHash: sha(object.boundaryHash, `${context}.boundaryHash`),
        candidateIndex,
        candidateIndexHash: sha(
          object.candidateIndexHash,
          `${context}.candidateIndexHash`
        ),
        decision: enumValue(
          object.decision,
          ["facade-absent", "facade-present", "facade-unknown-active"],
          `${context}.decision`
        ),
        mode,
        requests,
        source,
        sourceHash: sha(object.sourceHash, `${context}.sourceHash`),
        unknownBoundaries,
      };
    }
  );
  sortedUnique(
    bindings,
    (entry) => entry.source,
    "Intl check receipt V3.classifierBindings"
  );
  return bindings;
}

function parseCountersV3(
  value: unknown,
  context: string
): IntlCheckReceiptCountersV3 {
  const object = exact(value, V3_COUNTER_KEYS, context);
  if (object.semanticAuthorizationRuns !== 1) {
    fail(`${context}.semanticAuthorizationRuns`, "must equal 1");
  }
  const counters = Object.fromEntries(
    V3_COUNTER_KEYS.map((key) => [
      key,
      key === "semanticAuthorizationRuns"
        ? 1
        : count(object[key], `${context}.${key}`),
    ])
  );
  return counters as IntlCheckReceiptCountersV3;
}

function parseSourceV3(
  value: unknown,
  context: string
): IntlSourceLedgerEntryV3 {
  const object = exact(
    value,
    [
      "classifierBindingHash",
      "file",
      "hash",
      "owner",
      "providerClosureHash",
      "verdict",
    ],
    context
  );
  return {
    classifierBindingHash: sha(
      object.classifierBindingHash,
      `${context}.classifierBindingHash`
    ),
    file: path(object.file, `${context}.file`, false),
    hash: sha(object.hash, `${context}.hash`),
    owner: path(object.owner, `${context}.owner`, false),
    providerClosureHash:
      object.providerClosureHash === null
        ? null
        : sha(object.providerClosureHash, `${context}.providerClosureHash`),
    verdict: enumValue(
      object.verdict,
      ["accepted", "exception"],
      `${context}.verdict`
    ),
  };
}

function parseV3Structure(value: unknown): IntlCheckReceiptV3 {
  const object = exact(
    value,
    [
      "application",
      "artifactAbi",
      "candidateIndexes",
      "classifierBindings",
      "compilerManifest",
      "compilerManifestHash",
      "counters",
      "exceptions",
      "exceptionsHash",
      "generationReceiptHash",
      "icu",
      "projects",
      "providerClosures",
      "runtimeAbi",
      "schemaVersion",
      "sourceAuthorizationHash",
      "sources",
      "tables",
      "typescript",
    ],
    "Intl check receipt V3"
  );
  if (object.schemaVersion !== 3) {
    fail("Intl check receipt V3.schemaVersion", "must equal 3");
  }
  const tables = parseV3Tables(object.tables);
  const expansion = v3ExpansionContext();
  const applicationObject = exact(
    object.application,
    ["packageManifest", "workspaceLockfile"],
    "Intl check receipt V3.application"
  );
  const application: IntlCheckApplicationIdentityV3 = {
    packageManifest: ref(
      applicationObject.packageManifest,
      tables.files.length,
      "Intl check receipt V3.application.packageManifest"
    ),
    workspaceLockfile: ref(
      applicationObject.workspaceLockfile,
      tables.files.length,
      "Intl check receipt V3.application.workspaceLockfile"
    ),
  };
  const compilerManifest = parseRefArray(
    object.compilerManifest,
    tables.files,
    "Intl check receipt V3.compilerManifest"
  );
  const projects = array(object.projects, "Intl check receipt V3.projects").map(
    (entry, index) =>
      parseProjectV3(entry, tables, `Intl check receipt V3.projects[${index}]`)
  );
  sortedUnique(
    projects,
    (entry) => entry.path,
    "Intl check receipt V3.projects"
  );
  const exceptions = array(
    object.exceptions,
    "Intl check receipt V3.exceptions"
  ).map((entry, index) =>
    parseException(entry, `Intl check receipt V3.exceptions[${index}]`)
  );
  sortedUnique(
    exceptions,
    exceptionIdentity,
    "Intl check receipt V3.exceptions"
  );
  const candidateIndexes = parseCandidateIndexesV3(
    object.candidateIndexes,
    tables,
    expansion
  );
  const classifierBindings = parseClassifierBindingsV3(
    object.classifierBindings,
    tables,
    candidateIndexes,
    expansion
  );
  const providerClosures = parseProviderClosuresV3(
    object.providerClosures,
    tables,
    expansion
  );
  const sources = array(object.sources, "Intl check receipt V3.sources").map(
    (entry, index) =>
      parseSourceV3(entry, `Intl check receipt V3.sources[${index}]`)
  );
  sortedUnique(sources, (entry) => entry.file, "Intl check receipt V3.sources");
  const typescriptObject = exact(
    object.typescript,
    ["libHash", "libs", "package"],
    "Intl check receipt V3.typescript"
  );
  const typescript: IntlCheckTypeScriptIdentityV3 = {
    libHash: sha(
      typescriptObject.libHash,
      "Intl check receipt V3.typescript.libHash"
    ),
    libs: parseRefArray(
      typescriptObject.libs,
      tables.files,
      "Intl check receipt V3.typescript.libs"
    ),
    package: parsePackage(
      typescriptObject.package,
      "Intl check receipt V3.typescript.package"
    ),
  };
  return {
    application,
    artifactAbi: text(object.artifactAbi, "Intl check receipt V3.artifactAbi"),
    candidateIndexes,
    classifierBindings,
    compilerManifest,
    compilerManifestHash: sha(
      object.compilerManifestHash,
      "Intl check receipt V3.compilerManifestHash"
    ),
    counters: parseCountersV3(
      object.counters,
      "Intl check receipt V3.counters"
    ),
    exceptions,
    exceptionsHash: sha(
      object.exceptionsHash,
      "Intl check receipt V3.exceptionsHash"
    ),
    generationReceiptHash: sha(
      object.generationReceiptHash,
      "Intl check receipt V3.generationReceiptHash"
    ),
    icu: parsePackage(object.icu, "Intl check receipt V3.icu"),
    projects,
    providerClosures,
    runtimeAbi: text(
      object.runtimeAbi,
      "Intl check receipt V3.runtimeAbi"
    ) as RuntimeAbi,
    schemaVersion: 3,
    sourceAuthorizationHash: sha(
      object.sourceAuthorizationHash,
      "Intl check receipt V3.sourceAuthorizationHash"
    ),
    sources,
    tables,
    typescript,
  };
}

function replaceFrontierReferences(
  receipt: IntlCheckReceiptV3,
  remap: ReadonlyMap<Ref, Ref>,
  frontiers: ReadonlyArray<IntlCheckPhysicalFrontierV3>
): IntlCheckReceiptV3 {
  const replaceBinding = (
    binding: IntlCheckResolutionBindingV3
  ): IntlCheckResolutionBindingV3 => ({
    ...binding,
    frontier: remap.get(binding.frontier) as Ref,
  });
  const replaceProviderBinding = (
    binding: IntlCheckProviderResolutionV3
  ): IntlCheckProviderResolutionV3 => ({
    ...binding,
    frontier: remap.get(binding.frontier) as Ref,
  });
  return {
    ...receipt,
    classifierBindings: receipt.classifierBindings.map((binding) => ({
      ...binding,
      requests: binding.requests
        .map(replaceBinding)
        .toSorted((left, right) =>
          compareCanonicalStrings(
            resolutionBindingIdentity(left, { ...receipt.tables, frontiers }),
            resolutionBindingIdentity(right, { ...receipt.tables, frontiers })
          )
        ),
    })),
    providerClosures: receipt.providerClosures.map((closure) => ({
      ...closure,
      providers: closure.providers.map((provider) => ({
        ...provider,
        resolutions: provider.resolutions
          .map(replaceProviderBinding)
          .toSorted((left, right) =>
            compareCanonicalStrings(
              providerResolutionIdentity(left, {
                ...receipt.tables,
                frontiers,
              }),
              providerResolutionIdentity(right, {
                ...receipt.tables,
                frontiers,
              })
            )
          ),
      })),
    })),
    tables: { ...receipt.tables, frontiers },
  };
}

function expandedObservationLedger(
  binding: IntlSourceClassifierBindingV3,
  tables: IntlCheckTablesV3
): ReadonlyArray<IntlCheckModuleBoundaryV3 | IntlCheckUnknownModuleBoundaryV3> {
  return [
    ...binding.boundaries.map(
      (reference) => tables.boundaries[reference] as IntlCheckModuleBoundaryV3
    ),
    ...binding.unknownBoundaries.map(
      (reference) =>
        tables.unknownBoundaries[reference] as IntlCheckUnknownModuleBoundaryV3
    ),
  ].toSorted(
    (left, right) => left.observationOrdinal - right.observationOrdinal
  );
}

function computedV3Hashes(
  original: IntlCheckReceiptV3,
  metrics?: IntlCheckReceiptV3HashMetrics
): IntlCheckReceiptV3 {
  let receipt = original;
  let context = v3ExpansionContext(metrics);
  const hashedFrontiers = receipt.tables.frontiers.map(
    (frontier, reference) => ({
      oldReference: reference,
      value: {
        ...frontier,
        frontierHash: hashV3Memo(
          "physical-frontier",
          expandFrontier(reference, receipt.tables, context),
          context
        ),
      },
    })
  );
  const sortedFrontiers = hashedFrontiers.toSorted((left, right) =>
    compareCanonicalStrings(left.value.frontierHash, right.value.frontierHash)
  );
  sortedUnique(
    sortedFrontiers,
    (entry) => entry.value.frontierHash,
    "Intl check receipt V3.tables.frontiers"
  );
  const frontierRemap = new Map<Ref, Ref>();
  for (const [newReference, frontier] of sortedFrontiers.entries()) {
    frontierRemap.set(frontier.oldReference, newReference);
  }
  const canonicalFrontiers = sortedFrontiers.map((entry) => entry.value);
  receipt = replaceFrontierReferences(
    receipt,
    frontierRemap,
    canonicalFrontiers
  );
  context = v3ExpansionContext(metrics);

  const projects = receipt.projects.map((project) => ({
    ...project,
    configManifestHash: hashV3Memo(
      "project-config-manifest",
      [
        project.path,
        project.configManifest.map((entry) => ({
          extends: entry.extends,
          file: receipt.tables.files[entry.file],
          path: entry.path,
          references: entry.references,
        })),
      ],
      context
    ),
    normalizedOptionsHash: hashV3Memo(
      "project-normalized-options",
      [project.path, project.normalizedOptions],
      context
    ),
  }));
  const candidateIndexes = receipt.candidateIndexes.map((index) => ({
    ...index,
    indexHash: hashV3Memo(
      "candidate-index",
      expandIndex(index, receipt.tables, context),
      context
    ),
  }));
  const providerClosures = receipt.providerClosures.map((closure) => {
    const providers = closure.providers.map((provider) => {
      const declarationHash = hashV3Memo(
        "provider-declarations",
        provider.declarations.map((entry) => receipt.tables.files[entry]),
        context,
        canonicalJson(provider.declarations)
      );
      const withDeclarationHash = { ...provider, declarationHash };
      return {
        ...withDeclarationHash,
        hash: hashV3Memo(
          "provider",
          expandProvider(withDeclarationHash, receipt.tables, context),
          context,
          canonicalJson([
            provider.kind,
            provider.root,
            provider.declarations,
            provider.resolutions,
          ])
        ),
      };
    });
    const declarationHash = hashV3Memo(
      "closure-declarations",
      closure.declarations.map((entry) => receipt.tables.files[entry]),
      context,
      canonicalJson(closure.declarations)
    );
    const libHash = hashV3Memo(
      "typescript-libs",
      closure.libs.map((entry) => receipt.tables.files[entry]),
      context,
      canonicalJson(closure.libs)
    );
    const base = { ...closure, declarationHash, libHash, providers };
    return {
      ...base,
      closureHash: hashV3Memo(
        "provider-closure",
        expandClosure(base, receipt.tables, context),
        context
      ),
    };
  });
  const classifierBindings = receipt.classifierBindings.map((binding) => {
    const selectedIndex = candidateIndexes[
      binding.candidateIndex
    ] as GeneratedFacadeCandidateIndexV3;
    const expandedBoundaries = binding.boundaries.map(
      (entry) => receipt.tables.boundaries[entry]
    );
    const expandedUnknownBoundaries = binding.unknownBoundaries.map(
      (entry) => receipt.tables.unknownBoundaries[entry]
    );
    const observationLedger = expandedObservationLedger(
      binding,
      receipt.tables
    );
    const boundaryHash = hashV3Memo(
      "boundary-ledger",
      observationLedger,
      context
    );
    const base = {
      ...binding,
      boundaryHash,
      candidateIndexHash: selectedIndex.indexHash,
    };
    return {
      ...base,
      bindingHash: hashV3Memo(
        "classifier-binding",
        {
          boundaries: expandedBoundaries,
          boundaryHash,
          // `candidateIndexHash` already commits the complete expanded index.
          // Re-expanding that owner-wide index into every source binding made
          // hashing O(source count * index evidence) without adding authority.
          candidateIndexHash: selectedIndex.indexHash,
          decision: binding.decision,
          mode: binding.mode,
          requests: binding.requests.map((request) =>
            expandResolutionBinding(request, receipt.tables, context)
          ),
          source: binding.source,
          sourceHash: binding.sourceHash,
          unknownBoundaries: expandedUnknownBoundaries,
        },
        context
      ),
    };
  });
  const closureBySource = new Map(
    providerClosures.map((closure) => [closure.source, closure])
  );
  const bindingBySource = new Map(
    classifierBindings.map((binding) => [binding.source, binding])
  );
  const sources = receipt.sources.map((source) => {
    const closure = closureBySource.get(source.file);
    return {
      ...source,
      classifierBindingHash: (
        bindingBySource.get(source.file) as IntlSourceClassifierBindingV3
      ).bindingHash,
      providerClosureHash: closure?.closureHash ?? null,
    };
  });
  const typescript = {
    ...receipt.typescript,
    libHash: hashV3Memo(
      "typescript-libs",
      receipt.typescript.libs.map((entry) => receipt.tables.files[entry]),
      context,
      canonicalJson(receipt.typescript.libs)
    ),
  };
  const base = {
    ...receipt,
    candidateIndexes,
    classifierBindings,
    compilerManifestHash: hashV3Memo(
      "compiler-manifest",
      receipt.compilerManifest.map((entry) => receipt.tables.files[entry]),
      context
    ),
    exceptionsHash: hashV3Memo("exceptions", receipt.exceptions, context),
    projects,
    providerClosures,
    sources,
    typescript,
  };
  const {
    sourceAuthorizationHash: _sourceAuthorizationHash,
    ...receiptWithoutSourceAuthorizationHash
  } = base;
  return {
    ...base,
    sourceAuthorizationHash: hashV3Memo(
      "check-receipt",
      receiptWithoutSourceAuthorizationHash,
      context
    ),
  };
}

function allResolutionBindings(receipt: IntlCheckReceiptV3): ReadonlyArray<
  Readonly<{
    frontier: Ref;
    from: string;
    resolutionMode: IntlCheckResolutionModeV3;
    specifier: string;
  }>
> {
  return [
    ...receipt.classifierBindings.flatMap((binding) => binding.requests),
    ...receipt.providerClosures.flatMap((closure) =>
      closure.providers.flatMap((provider) =>
        provider.resolutions.map((resolution) => ({
          ...resolution,
          resolutionMode:
            receipt.tables.frontiers[resolution.frontier]?.resolutionMode ??
            "default",
        }))
      )
    ),
  ];
}

function expectedCountersV3(
  receipt: IntlCheckReceiptV3
): IntlCheckReceiptCountersV3 {
  const resolutionIdentities = new Set([
    ...receipt.classifierBindings.flatMap((binding) =>
      binding.requests.map((request) =>
        canonicalJson([
          "classifier",
          request.boundary,
          request.frontier,
          request.from,
          request.resolutionMode,
          request.specifier,
        ])
      )
    ),
    ...receipt.providerClosures.flatMap((closure) =>
      closure.providers.flatMap((provider) =>
        provider.resolutions.map((resolution) =>
          canonicalJson([
            "provider",
            resolution.frontier,
            resolution.from,
            resolution.specifier,
          ])
        )
      )
    ),
  ]);
  const classifierCandidateRequests = receipt.classifierBindings.reduce(
    (total, binding) => total + binding.requests.length,
    0
  );
  const classifierBoundaries = receipt.classifierBindings.reduce(
    (total, binding) => total + binding.boundaries.length,
    0
  );
  const classifierFacadeImports = receipt.classifierBindings.reduce(
    (total, binding) => {
      const facadeFile =
        receipt.candidateIndexes[binding.candidateIndex]?.facade.file;
      return (
        total +
        binding.requests.filter(
          (request) =>
            receipt.tables.frontiers[request.frontier]?.resolvedFile ===
            facadeFile
        ).length
      );
    },
    0
  );
  return {
    boundaryIdentities: receipt.tables.boundaries.length,
    checkerProjects: receipt.projects.filter(
      (project) => project.role === "checker"
    ).length,
    classifierBoundaries,
    classifierCandidateRequests,
    classifierFacadeImports,
    classifierFilteredRequests:
      classifierBoundaries - classifierCandidateRequests,
    classifierFullResolverRequests: classifierCandidateRequests,
    classifierOwnerFallbacks: receipt.candidateIndexes.filter(
      (index) => index.mode === "owner-fallback"
    ).length,
    classifierSourcesBound: receipt.classifierBindings.length,
    controlSets: receipt.tables.controls.length,
    declarationFiles: receipt.providerClosures.reduce(
      (total, closure) => total + closure.declarations.length,
      0
    ),
    exceptions: receipt.exceptions.length,
    fileIdentities: receipt.tables.files.length,
    loadedLibFiles: receipt.providerClosures.reduce(
      (total, closure) => total + closure.libs.length,
      0
    ),
    lstatIdentities: receipt.tables.lstats.length,
    lexicalFilesClassified: receipt.classifierBindings.length,
    ownerProjects: receipt.projects.filter(
      (project) => project.role === "owner"
    ).length,
    packageScopeIdentities: receipt.tables.packageScopes.length,
    physicalFrontiers: receipt.tables.frontiers.length,
    probeIdentities: receipt.tables.probes.length,
    providerClosures: receipt.providerClosures.length,
    providerRoots: receipt.providerClosures.reduce(
      (total, closure) => total + closure.providers.length,
      0
    ),
    realpathIdentities: receipt.tables.realpaths.length,
    resolutionBindings: resolutionIdentities.size,
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: receipt.providerClosures.length,
    sourceFiles: receipt.sources.length,
    typescriptLibFiles: receipt.typescript.libs.length,
    unknownActiveSources: receipt.classifierBindings.filter(
      (binding) => binding.decision === "facade-unknown-active"
    ).length,
    unknownBoundaryIdentities: receipt.tables.unknownBoundaries.length,
  };
}

function validatePackageScopeRelationships(receipt: IntlCheckReceiptV3): void {
  receipt.tables.packageScopes.forEach((scope, scopeReference) => {
    const context = `Intl check receipt V3.tables.packageScopes[${scopeReference}]`;
    const manifestPath =
      scope.lexicalRoot === WORKSPACE_ROOT_EVIDENCE_PATH
        ? "package.json"
        : `${scope.lexicalRoot}/package.json`;
    const manifest =
      scope.manifest === null ? null : receipt.tables.files[scope.manifest];
    const manifestProbe = receipt.tables.probes[scope.manifestProbe];
    const manifestLstat = receipt.tables.lstats[scope.manifestLstat];
    const rootLstat = receipt.tables.lstats[scope.rootLstat];
    const realpath = receipt.tables.realpaths[scope.realpath];
    const control = receipt.tables.controls[scope.control];
    if (manifestProbe?.kind !== "file" || manifestProbe.path !== manifestPath) {
      fail(
        `${context}.manifestProbe`,
        "must be the exact package.json file probe"
      );
    }
    if (manifestLstat?.path !== manifestPath) {
      fail(
        `${context}.manifestLstat`,
        "must be the exact package.json no-follow lstat"
      );
    }
    if (
      rootLstat?.path !== scope.lexicalRoot ||
      (rootLstat.kind !== "directory" && rootLstat.kind !== "symlink")
    ) {
      fail(
        `${context}.rootLstat`,
        "must prove the lexical package root as a directory or symlink"
      );
    }
    if (
      realpath?.path !== scope.lexicalRoot ||
      realpath.target !== scope.canonicalRoot
    ) {
      fail(
        `${context}.realpath`,
        "must prove lexicalRoot to canonicalRoot exactly"
      );
    }
    if (manifest === undefined) {
      fail(
        `${context}.manifest`,
        "must reference an existing file-table entry"
      );
    }
    if (manifest === null) {
      if (manifestProbe.present || manifestLstat.kind !== "absent") {
        fail(
          context,
          "an absent manifest requires an absent probe and absent lstat"
        );
      }
      return;
    }
    if (
      manifest.path !== manifestPath ||
      !manifestProbe.present ||
      (manifestLstat.kind !== "file" && manifestLstat.kind !== "symlink")
    ) {
      fail(
        context,
        "a present manifest requires matching file, probe, and lstat evidence"
      );
    }
    if (!control?.files.includes(scope.manifest as Ref)) {
      fail(
        `${context}.control`,
        "must contain the present package manifest file reference"
      );
    }
  });
}

export interface IntlCheckReceiptV3VerificationOptions {
  readSourceBytes?: (source: string) => Uint8Array;
}

function validateUnknownBoundaryEvidence(
  receipt: IntlCheckReceiptV3,
  expansion: V3ExpansionContext,
  readSourceBytes: (source: string) => Uint8Array
): void {
  const bytesBySource = new Map<string, Uint8Array>();
  for (const [
    reference,
    boundary,
  ] of receipt.tables.unknownBoundaries.entries()) {
    let sourceBytes = bytesBySource.get(boundary.source);
    if (sourceBytes === undefined) {
      sourceBytes = readSourceBytes(boundary.source);
      decodeUtf8Fatal(
        sourceBytes,
        `Unknown boundary source ${JSON.stringify(boundary.source)}`
      );
      bytesBySource.set(boundary.source, sourceBytes);
    }
    if (boundary.byteEnd > sourceBytes.length) {
      fail(
        `Intl check receipt V3.tables.unknownBoundaries[${reference}]`,
        "byte range exceeds the receipt-bound source bytes"
      );
    }
    const sourceSlice = sourceBytes.subarray(
      boundary.byteStart,
      boundary.byteEnd
    );
    decodeUtf8Fatal(
      sourceSlice,
      `Intl check receipt V3.tables.unknownBoundaries[${reference}] source slice`
    );
    if (sha256(sourceSlice) !== boundary.sourceSliceHash) {
      fail(
        `Intl check receipt V3.tables.unknownBoundaries[${reference}].sourceSliceHash`,
        "does not bind the exact UTF-8 byte slice"
      );
    }
    const nodeHash = hashV3Memo(
      "unknown-boundary-node",
      [
        boundary.kind,
        boundary.nodeKind,
        boundary.observationOrdinal,
        boundary.reason,
        boundary.source,
        boundary.byteStart,
        boundary.byteEnd,
        boundary.sourceSliceHash,
      ],
      expansion
    );
    if (nodeHash !== boundary.nodeHash) {
      fail(
        `Intl check receipt V3.tables.unknownBoundaries[${reference}].nodeHash`,
        "does not bind the canonical unknown-boundary node"
      );
    }
  }
}

function validateV3Relationships(
  receipt: IntlCheckReceiptV3,
  expansion = v3ExpansionContext(),
  options: IntlCheckReceiptV3VerificationOptions = {}
): void {
  validatePackageScopeRelationships(receipt);
  validateUnknownBoundaryEvidence(
    receipt,
    expansion,
    options.readSourceBytes ?? ((source) => readFileSync(source))
  );
  const projects = new Map(
    receipt.projects.map((project) => [project.path, project])
  );
  for (const project of receipt.projects) {
    if (
      project.resolverOptionsHash !== canonicalHash(project.normalizedOptions)
    ) {
      fail(
        `Project ${JSON.stringify(project.path)}.resolverOptionsHash`,
        "does not bind its canonical semantic resolver options"
      );
    }
  }
  const owners = new Set(
    receipt.projects
      .filter((project) => project.role === "owner")
      .map((project) => project.path)
  );
  const indexes = new Map(
    receipt.candidateIndexes.map((index, reference) => [reference, index])
  );
  const bindings = new Map(
    receipt.classifierBindings.map((binding) => [binding.source, binding])
  );
  const closures = new Map(
    receipt.providerClosures.map((closure) => [closure.source, closure])
  );
  if (
    bindings.size !== receipt.classifierBindings.length ||
    closures.size !== receipt.providerClosures.length
  ) {
    fail("Intl check receipt V3", "contains duplicate source relationships");
  }
  const ownerModes = new Map<string, GeneratedFacadeCandidateIndexV3["mode"]>();
  for (const index of receipt.candidateIndexes) {
    const existingMode = ownerModes.get(index.owner);
    if (existingMode !== undefined && existingMode !== index.mode) {
      fail(
        `Candidate indexes for owner ${JSON.stringify(index.owner)}`,
        "must freeze one owner-wide classifier mode"
      );
    }
    ownerModes.set(index.owner, index.mode);
  }
  for (const source of receipt.sources) {
    const project = projects.get(source.owner);
    const binding = bindings.get(source.file);
    const closure = closures.get(source.file);
    if (!project || !owners.has(source.owner)) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "must be owned by exactly one owner project"
      );
    }
    if (
      !binding ||
      binding.sourceHash !== source.hash ||
      binding.bindingHash !== source.classifierBindingHash
    ) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "must have exactly one matching classifier binding"
      );
    }
    const selectedIndex = indexes.get(binding.candidateIndex);
    if (
      !selectedIndex ||
      selectedIndex.owner !== source.owner ||
      selectedIndex.optionsHash !== project.normalizedOptionsHash
    ) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "must select its owning project's candidate index and options"
      );
    }
    if (binding.mode !== ownerModes.get(source.owner)) {
      fail(
        `Classifier binding ${JSON.stringify(binding.source)}`,
        "must use the frozen owner-wide classifier mode"
      );
    }
    for (const request of binding.requests) {
      const frontier = receipt.tables.frontiers[request.frontier];
      if (
        frontier?.optionsHash !== selectedIndex.optionsHash ||
        frontier.optionsHash !== project.normalizedOptionsHash
      ) {
        fail(
          `Classifier resolution ${JSON.stringify(request.specifier)}`,
          "must bind candidate-index and owner-project resolver options"
        );
      }
    }
    const facadeFile = selectedIndex.facade.file;
    const facadeResolutions = binding.requests.filter(
      (request) =>
        receipt.tables.frontiers[request.frontier]?.resolvedFile === facadeFile
    );
    let expectedDecision: IntlSourceClassifierBindingV3["decision"] =
      "facade-absent";
    if (facadeResolutions.length > 0) {
      expectedDecision = "facade-present";
    } else if (binding.unknownBoundaries.length > 0) {
      expectedDecision = "facade-unknown-active";
    }
    if (binding.decision !== expectedDecision) {
      fail(
        `Classifier binding ${JSON.stringify(binding.source)}`,
        "decision disagrees with literal and unknown boundary evidence"
      );
    }
    const requiresProgram =
      binding.mode === "owner-fallback" || binding.decision !== "facade-absent";
    if (requiresProgram) {
      if (!closure || closure.closureHash !== source.providerClosureHash) {
        fail(
          `Source ${JSON.stringify(source.file)}`,
          "requires exactly one matching provider closure"
        );
      }
    } else if (closure !== undefined || source.providerClosureHash !== null) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "must omit semantic provider closure evidence when the filtered classifier proves facade absence"
      );
    }
    if (closure === undefined) {
      continue;
    }
    for (const request of closure.providers.flatMap(
      (provider) => provider.resolutions
    )) {
      const frontier = receipt.tables.frontiers[request.frontier];
      if (frontier?.optionsHash !== project.resolverOptionsHash) {
        fail(
          `Provider resolution ${JSON.stringify(request.specifier)}`,
          "must bind its owning check-project resolver options"
        );
      }
    }
  }
  const sourceSet = new Set(receipt.sources.map((source) => source.file));
  const sourceOwner = new Map(
    receipt.sources.map((source) => [source.file, source.owner])
  );
  for (const source of [...bindings.keys(), ...closures.keys()]) {
    if (!sourceSet.has(source)) {
      fail(
        `V3 source relationship ${JSON.stringify(source)}`,
        "does not correspond to an authorized source"
      );
    }
  }
  for (const index of receipt.candidateIndexes) {
    const project = projects.get(index.owner);
    if (
      !project ||
      project.role !== "owner" ||
      project.normalizedOptionsHash !== index.optionsHash
    ) {
      fail(
        `Candidate index ${JSON.stringify(index.owner)}`,
        "must match an owner project and its normalized options"
      );
    }
    const controlFiles = new Set(receipt.tables.controls[index.control]?.files);
    if (
      project.configManifest.some((config) => !controlFiles.has(config.file))
    ) {
      fail(
        `Candidate index ${JSON.stringify(index.owner)}`,
        "control set must bind every owner-project config identity"
      );
    }
    if (index.mode === "filtered" && index.reasons.length > 0) {
      fail(
        `Candidate index ${JSON.stringify(index.owner)}`,
        "filtered mode cannot retain fallback reasons"
      );
    }
    if (index.mode === "owner-fallback" && index.reasons.length === 0) {
      fail(
        `Candidate index ${JSON.stringify(index.owner)}`,
        "owner-fallback mode requires at least one canonical reason"
      );
    }
    for (const projection of index.projections) {
      const boundary = receipt.tables.boundaries[projection.boundary];
      if (boundary === undefined) {
        fail("Candidate projection", "has an out-of-range boundary");
      }
      if (sourceOwner.get(boundary.source) !== index.owner) {
        fail(
          `Candidate projection ${JSON.stringify(boundary.specifier)}`,
          "must belong to the candidate-index owner"
        );
      }
      if (
        projection.status === "disjoint" &&
        (projection.lexicalRoot === index.facade.lexicalRoot ||
          projection.canonicalRoot === index.facade.canonicalRoot)
      ) {
        fail(
          `Candidate projection ${JSON.stringify(boundary.specifier)}`,
          "cannot claim disjointness from an equal facade root"
        );
      }
    }
  }
  const exceptions = new Set(receipt.exceptions.map((entry) => entry.file));
  for (const source of receipt.sources) {
    if ((source.verdict === "exception") !== exceptions.has(source.file)) {
      fail(
        `Source ${JSON.stringify(source.file)}`,
        "has an exception verdict mismatch"
      );
    }
  }
  for (const exception of receipt.exceptions) {
    if (!sourceSet.has(exception.file)) {
      fail(
        `Exception ${JSON.stringify(exception.file)}`,
        "does not correspond to an authorized source"
      );
    }
  }
  const observations = new Map<string, Sha256>();
  const resolutionBindings = allResolutionBindings(receipt);
  const referencedFrontiers = new Set<Ref>();
  for (const request of resolutionBindings) {
    const frontier = receipt.tables.frontiers[request.frontier];
    if (frontier === undefined) {
      fail("Resolution binding", "has an out-of-range frontier");
    }
    const key = canonicalJson([
      request.from,
      request.specifier,
      request.resolutionMode,
      frontier.optionsHash,
    ]);
    const previous = observations.get(key);
    if (previous !== undefined && previous !== frontier.frontierHash) {
      fail(
        "Resolution bindings",
        "contain conflicting pooled evidence for one request identity"
      );
    }
    observations.set(key, frontier.frontierHash);
    referencedFrontiers.add(request.frontier);
  }
  if (referencedFrontiers.size !== receipt.tables.frontiers.length) {
    fail(
      "Intl check receipt V3.tables.frontiers",
      "must contain exactly the physical frontiers referenced by resolution bindings"
    );
  }
  if (receipt.tables.frontiers.length > resolutionBindings.length) {
    fail(
      "Intl check receipt V3.tables.frontiers",
      "cannot exceed the resolution binding count"
    );
  }
  const expectedV3Counters = expectedCountersV3(receipt);
  if (canonicalJson(receipt.counters) !== canonicalJson(expectedV3Counters)) {
    fail("Intl check receipt V3.counters", "do not match canonical manifests");
  }
}

function assertV3NamedHashes(
  actual: IntlCheckReceiptV3,
  expected: IntlCheckReceiptV3
): void {
  const assertHash = (
    actualHash: Sha256,
    expectedHash: Sha256,
    context: string
  ): void => {
    if (actualHash !== expectedHash) {
      fail(context, "does not bind its canonical expanded preimage");
    }
  };
  actual.tables.frontiers.forEach((frontier, index) =>
    assertHash(
      frontier.frontierHash,
      (expected.tables.frontiers[index] as IntlCheckPhysicalFrontierV3)
        .frontierHash,
      `Intl check receipt V3.tables.frontiers[${index}].frontierHash`
    )
  );
  actual.projects.forEach((project, index) => {
    const expectedProject = expected.projects[index] as IntlCheckProjectV3;
    assertHash(
      project.configManifestHash,
      expectedProject.configManifestHash,
      `Intl check receipt V3.projects[${index}].configManifestHash`
    );
    assertHash(
      project.normalizedOptionsHash,
      expectedProject.normalizedOptionsHash,
      `Intl check receipt V3.projects[${index}].normalizedOptionsHash`
    );
  });
  actual.candidateIndexes.forEach((index, position) =>
    assertHash(
      index.indexHash,
      (expected.candidateIndexes[position] as GeneratedFacadeCandidateIndexV3)
        .indexHash,
      `Intl check receipt V3.candidateIndexes[${position}].indexHash`
    )
  );
  actual.providerClosures.forEach((closure, closureIndex) => {
    const expectedClosure = expected.providerClosures[
      closureIndex
    ] as IntlCheckProviderClosureV3;
    closure.providers.forEach((provider, providerIndex) => {
      const expectedProvider = expectedClosure.providers[
        providerIndex
      ] as IntlCheckProviderV3;
      assertHash(
        provider.declarationHash,
        expectedProvider.declarationHash,
        `Intl check receipt V3.providerClosures[${closureIndex}].providers[${providerIndex}].declarationHash`
      );
      assertHash(
        provider.hash,
        expectedProvider.hash,
        `Intl check receipt V3.providerClosures[${closureIndex}].providers[${providerIndex}].hash`
      );
    });
    assertHash(
      closure.declarationHash,
      expectedClosure.declarationHash,
      `Intl check receipt V3.providerClosures[${closureIndex}].declarationHash`
    );
    assertHash(
      closure.libHash,
      expectedClosure.libHash,
      `Intl check receipt V3.providerClosures[${closureIndex}].libHash`
    );
    assertHash(
      closure.closureHash,
      expectedClosure.closureHash,
      `Intl check receipt V3.providerClosures[${closureIndex}].closureHash`
    );
  });
  actual.classifierBindings.forEach((binding, index) => {
    const expectedBinding = expected.classifierBindings[
      index
    ] as IntlSourceClassifierBindingV3;
    assertHash(
      binding.boundaryHash,
      expectedBinding.boundaryHash,
      `Intl check receipt V3.classifierBindings[${index}].boundaryHash`
    );
    assertHash(
      binding.candidateIndexHash,
      expectedBinding.candidateIndexHash,
      `Intl check receipt V3.classifierBindings[${index}].candidateIndexHash`
    );
    assertHash(
      binding.bindingHash,
      expectedBinding.bindingHash,
      `Intl check receipt V3.classifierBindings[${index}].bindingHash`
    );
  });
  assertHash(
    actual.compilerManifestHash,
    expected.compilerManifestHash,
    "Intl check receipt V3.compilerManifestHash"
  );
  assertHash(
    actual.exceptionsHash,
    expected.exceptionsHash,
    "Intl check receipt V3.exceptionsHash"
  );
  assertHash(
    actual.typescript.libHash,
    expected.typescript.libHash,
    "Intl check receipt V3.typescript.libHash"
  );
  assertHash(
    actual.sourceAuthorizationHash,
    expected.sourceAuthorizationHash,
    "Intl check receipt V3.sourceAuthorizationHash"
  );
}

const trustedReceiptsV3 = new WeakSet<object>();

const WORKSPACE_ROOT_EVIDENCE_PATH = ".mirai-intl/workspace-root";
const WORKSPACE_ANCESTOR_EVIDENCE_PREFIX = ".mirai-intl/ancestor";

export type IntlCheckReceiptV3ClassifierAuthorityBinding = Readonly<{
  authorityBytes: string;
  authorityHash: Sha256;
  authorityHashes: ReadonlyArray<
    Readonly<{
      artifactHash: Sha256;
      checkpointAHash: Sha256;
      indexHash: Sha256;
      optimizedRequiresProgramVectorHash: Sha256;
      referenceRequiresProgramVectorHash: Sha256;
    }>
  >;
  inputIdentityHash: Sha256;
  receipt: IntlCheckReceiptV3;
  receiptBytes: string;
  receiptHash: Sha256;
}>;

const trustedClassifierAuthorityBindingsV3 = new WeakSet<object>();

function trustClassifierAuthorityBindingV3(
  binding: IntlCheckReceiptV3ClassifierAuthorityBinding
): IntlCheckReceiptV3ClassifierAuthorityBinding {
  trustedClassifierAuthorityBindingsV3.add(binding);
  return binding;
}

export function assertTrustedIntlCheckReceiptV3ClassifierAuthorityBinding(
  binding: IntlCheckReceiptV3ClassifierAuthorityBinding
): void {
  if (!trustedClassifierAuthorityBindingsV3.has(binding)) {
    throw new TypeError(
      "Untrusted Intl check receipt V3 classifier authority binding"
    );
  }
}

export type IntlCheckReceiptV3ClassifierProjectionEvidence = Readonly<{
  authority: MiraiIntlClassifierAuthorityV3;
  projection: MiraiIntlClassifierReceiptProjectionV3;
}>;

/**
 * Native V3 assembly input. It intentionally reuses the canonical V2 input
 * shapes while allowing semantic provider closures to cover only sources for
 * which the classifier requires a TypeScript Program.
 */
export type IntlCheckReceiptV3NativeInput = SourceAuthorizationSnapshotInput;

function classifierAuthorityPortablePath(
  authority: MiraiIntlClassifierAuthorityV3,
  value: string,
  context: string
): string {
  return portableWorkspaceEvidencePath(authority.workspaceRoot, value, context);
}

function portableWorkspaceEvidencePath(
  workspaceRoot: string,
  value: string,
  context: string
): string {
  const portable = (isAbsolute(value) ? relative(workspaceRoot, value) : value)
    .split(sep)
    .join("/");
  if (portable === "" || portable === ".") {
    return WORKSPACE_ROOT_EVIDENCE_PATH;
  }
  const segments = portable.split("/");
  let ancestorDepth = 0;
  while (segments[ancestorDepth] === "..") {
    ancestorDepth += 1;
  }
  if (ancestorDepth > 0) {
    const suffix = segments.slice(ancestorDepth).join("/");
    return `${WORKSPACE_ANCESTOR_EVIDENCE_PREFIX}/${ancestorDepth}${suffix === "" ? "" : `/${suffix}`}`;
  }
  return path(portable, context, false);
}

function assertClassifierAuthorityHash(
  actual: Sha256,
  expected: Sha256,
  context: string
): void {
  if (actual !== expected) {
    fail(context, "does not bind the normalized V3 classifier authority");
  }
}

function portableClassifierAuthorityEvidence(
  authority: MiraiIntlClassifierAuthorityV3,
  value: unknown
): unknown {
  if (typeof value === "string") {
    if (!isAbsolute(value)) {
      return value;
    }
    return classifierAuthorityPortablePath(
      authority,
      value,
      "Classifier authority evidence path"
    );
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      portableClassifierAuthorityEvidence(authority, entry)
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        portableClassifierAuthorityEvidence(authority, entry),
      ])
    );
  }
  return value;
}

function expectedClassifierActiveConditions(
  project: IntlCheckProjectV3,
  context: string
): ReadonlyArray<string> {
  const customConditions = project.normalizedOptions.customConditions;
  const custom =
    customConditions === undefined
      ? []
      : array(customConditions, `${context}.customConditions`).map(
          (condition, index) =>
            text(condition, `${context}.customConditions[${index}]`)
        );
  const moduleResolution = project.normalizedOptions.moduleResolution;
  const bundler = moduleResolution === "Bundler" || moduleResolution === 100;
  return [
    ...new Set([
      "import",
      ...(bundler ? [] : ["node"]),
      "require",
      "types",
      ...custom,
    ]),
  ].toSorted(compareCanonicalStrings);
}

const CLASSIFIER_INDEX_SET_FAMILIES = new Set([
  "activeConditions",
  "controls",
  "lstats",
  "packageScopes",
  "probes",
  "projections",
  "realpaths",
  "reasons",
]);

function canonicalClassifierIndexFamilyEvidence(
  family: string,
  value: unknown,
  context: string
): string {
  if (CLASSIFIER_INDEX_SET_FAMILIES.has(family)) {
    return canonicalJson(
      projectionCanonicalValues(array(value, `${context}.${family}`))
    );
  }
  if (family === "resolverFrontier") {
    const frontier = record(value, `${context}.resolverFrontier`);
    return canonicalJson({
      ...frontier,
      controlFiles: projectionCanonicalValues(
        array(frontier.controlFiles, `${context}.resolverFrontier.controlFiles`)
      ),
      probes: projectionCanonicalValues(
        array(frontier.probes, `${context}.resolverFrontier.probes`)
      ),
      realpaths: projectionCanonicalValues(
        array(frontier.realpaths, `${context}.resolverFrontier.realpaths`)
      ),
    });
  }
  return canonicalJson(value);
}

function classifierEvidenceSubset(
  value: unknown,
  expected: ReadonlyArray<unknown>,
  context: string
): boolean {
  const entries = array(value, context);
  const identities = entries.map((entry) => canonicalJson(entry));
  const expectedIdentities = new Set(
    expected.map((entry) => canonicalJson(entry))
  );
  return (
    new Set(identities).size === identities.length &&
    identities.every((identity) => expectedIdentities.has(identity))
  );
}

function classifierEvidenceSetMatches(
  value: unknown,
  expected: ReadonlyArray<unknown>,
  context: string
): boolean {
  return (
    classifierEvidenceSubset(value, expected, context) &&
    array(value, context).length ===
      new Set(expected.map((entry) => canonicalJson(entry))).size
  );
}

function validateClassifierAuthorityIndexEvidence(
  receipt: IntlCheckReceiptV3,
  authority: MiraiIntlClassifierAuthorityV3,
  indexBinding: Readonly<Record<string, unknown>>,
  receiptIndex: GeneratedFacadeCandidateIndexV3,
  bindings: ReadonlyArray<IntlSourceClassifierBindingV3>,
  context: string
): void {
  const ownerBoundaryRefs = [
    ...new Set(bindings.flatMap((binding) => binding.boundaries)),
  ].toSorted((left, right) => left - right);
  const project = receipt.projects.find(
    (candidate) => candidate.path === receiptIndex.owner
  );
  if (project === undefined) {
    fail(context, "candidate index has no normalized owner project");
  }
  const controlFiles =
    receipt.tables.controls[receiptIndex.control]?.files.map(
      (reference) => receipt.tables.files[reference]
    ) ?? [];
  const packageScopes = receiptIndex.packageScopes.map((reference) => {
    const scope = receipt.tables.packageScopes[reference];
    if (scope === undefined || scope.manifest === null) {
      return fail(context, "candidate package scope must bind a manifest");
    }
    const manifest = receipt.tables.files[scope.manifest];
    if (manifest === undefined) {
      return fail(context, "candidate package scope manifest is missing");
    }
    return {
      canonicalRoot: scope.canonicalRoot,
      lexicalRoot: scope.lexicalRoot,
      manifestHash: manifest.hash,
      manifestPath: manifest.path,
    };
  });
  // The production authority records every traversed package-topology lstat,
  // including absent manifests. The normalized receipt currently projects only
  // discovered package scopes, so topology remains envelope-only evidence. It
  // is still cross-bound by authorityHash beside the receiptHash in the input
  // identity, but must not be falsely reconstructed from packageScopes.
  // The classifier transaction resolver frontier is likewise distinct from
  // the index-wide control/probe/realpath families projected into the receipt;
  // its own hash is checked above and it remains bound by indexHash.
  // Authority projections assign only boundary/root/status. The receipt's
  // per-projection control/lstat/scope/probe/realpath refs are complete,
  // validated receipt evidence, but the production authority has only global
  // proof families and cannot truthfully assign those entries per projection.
  // Their two representations are paired by indexHash in the adapter input
  // identity instead of inventing a false field-level equivalence here.
  const projections = receiptIndex.projections.map((projection) => ({
    boundary: ownerBoundaryRefs.indexOf(projection.boundary),
    canonicalRoot: projection.canonicalRoot,
    lexicalRoot: projection.lexicalRoot,
    proofKind: projection.proofKind,
    status: projection.status,
  }));
  const rawResolverFrontier = indexBinding.resolverFrontier;
  const resolverFrontierHash = sha(
    indexBinding.resolverFrontierHash,
    `${context}.indexBinding.resolverFrontierHash`
  );
  assertClassifierAuthorityHash(
    resolverFrontierHash,
    sha256(
      canonicalJson([
        "mirai-intl",
        "classifier-transaction-resolver-frontier",
        3,
        rawResolverFrontier,
      ])
    ),
    `${context}.indexBinding.resolverFrontierHash`
  );
  const portableResolverFrontier = record(
    portableClassifierAuthorityEvidence(authority, rawResolverFrontier),
    `${context}.indexBinding.resolverFrontier`
  );
  const requestFrontiers = bindings
    .flatMap((binding) => binding.requests)
    .map((request) => receipt.tables.frontiers[request.frontier])
    .filter(
      (frontier): frontier is IntlCheckPhysicalFrontierV3 =>
        frontier !== undefined
    );
  const resolverControlFiles = projectionCanonicalValues(
    requestFrontiers.flatMap(
      (frontier) =>
        receipt.tables.controls[frontier.control]?.files
          .map((reference) => receipt.tables.files[reference])
          .filter(
            (file): file is IntlCheckFileIdentityV2 => file !== undefined
          ) ?? []
    )
  );
  const receiptProbes = projectionCanonicalValues(
    requestFrontiers.flatMap((frontier) =>
      frontier.probes
        .map((reference) => receipt.tables.probes[reference])
        .filter((probe): probe is IntlCheckProbeV3 => probe !== undefined)
    )
  );
  const receiptRealpaths = projectionCanonicalValues(
    requestFrontiers.flatMap((frontier) =>
      frontier.realpaths
        .map((reference) => receipt.tables.realpaths[reference])
        .filter(
          (identity): identity is IntlCheckRealpathV3 => identity !== undefined
        )
    )
  );
  const indexProbes = receiptIndex.probes.map(
    (reference) => receipt.tables.probes[reference]
  );
  const indexRealpaths = receiptIndex.realpaths.map(
    (reference) => receipt.tables.realpaths[reference]
  );
  const matchesRequestFrontiers =
    classifierEvidenceSetMatches(
      portableResolverFrontier.controlFiles,
      resolverControlFiles,
      `${context}.indexBinding.resolverFrontier.controlFiles`
    ) &&
    classifierEvidenceSetMatches(
      portableResolverFrontier.probes,
      receiptProbes,
      `${context}.indexBinding.resolverFrontier.probes`
    ) &&
    classifierEvidenceSetMatches(
      portableResolverFrontier.realpaths,
      receiptRealpaths,
      `${context}.indexBinding.resolverFrontier.realpaths`
    );
  const isIndexEvidenceSubset =
    classifierEvidenceSubset(
      portableResolverFrontier.controlFiles,
      controlFiles,
      `${context}.indexBinding.resolverFrontier.controlFiles`
    ) &&
    classifierEvidenceSubset(
      portableResolverFrontier.probes,
      indexProbes,
      `${context}.indexBinding.resolverFrontier.probes`
    ) &&
    classifierEvidenceSubset(
      portableResolverFrontier.realpaths,
      indexRealpaths,
      `${context}.indexBinding.resolverFrontier.realpaths`
    );
  if (
    portableResolverFrontier.from !== WORKSPACE_ROOT_EVIDENCE_PATH ||
    portableResolverFrontier.packageName !== null ||
    portableResolverFrontier.packageVersion !== null ||
    portableResolverFrontier.specifier !== "*transaction-global*" ||
    (!matchesRequestFrontiers && !isIndexEvidenceSubset)
  ) {
    fail(
      context,
      "candidate index resolverFrontier evidence does not match receipt"
    );
  }
  const portableBareProofs = array(
    portableClassifierAuthorityEvidence(
      authority,
      indexBinding.barePackageProofs
    ),
    `${context}.indexBinding.barePackageProofs`
  );
  for (const [proofIndex, proofValue] of portableBareProofs.entries()) {
    const proof = record(
      proofValue,
      `${context}.indexBinding.barePackageProofs[${proofIndex}]`
    );
    const localBoundaryReference = count(
      proof.boundary,
      `${context}.indexBinding.barePackageProofs[${proofIndex}].boundary`
    );
    const boundaryReference =
      ownerBoundaryRefs[localBoundaryReference] ??
      fail(context, "bare-package proof references an unknown owner boundary");
    const projection = receiptIndex.projections.find(
      (entry) => entry.boundary === boundaryReference
    );
    if (
      projection === undefined ||
      proof.resolverFrontierHash !== resolverFrontierHash ||
      proof.status !==
        (projection.status === "candidate" ? "candidate" : "proven-disjoint")
    ) {
      fail(context, "bare-package proof does not match receipt projection");
    }
    const request = bindings
      .flatMap((binding) => binding.requests)
      .find((entry) => entry.boundary === boundaryReference);
    if (request !== undefined) {
      const frontier = receipt.tables.frontiers[request.frontier];
      const expectedControlFiles =
        frontier === undefined
          ? []
          : (receipt.tables.controls[frontier.control]?.files.map(
              (reference) => receipt.tables.files[reference]
            ) ?? []);
      if (
        !classifierEvidenceSetMatches(
          proof.controlFiles,
          expectedControlFiles,
          `${context}.indexBinding.barePackageProofs[${proofIndex}].controlFiles`
        ) ||
        proof.packageName !== frontier?.packageName ||
        proof.packageVersion !== frontier?.packageVersion ||
        proof.resolvedFileName !==
          (frontier?.resolvedFile === null ||
          frontier?.resolvedFile === undefined
            ? null
            : receipt.tables.files[frontier.resolvedFile]?.path)
      ) {
        fail(
          context,
          "bare-package resolution evidence does not match receipt"
        );
      }
    }
  }
  const expectedFamilies = {
    activeConditions: expectedClassifierActiveConditions(project, context),
    analyzerAbi: receiptIndex.analyzerAbi,
    canonicalRoot: receiptIndex.facade.canonicalRoot,
    controls: controlFiles,
    facade: receipt.tables.files[receiptIndex.facade.file]?.path,
    lexicalRoot: receiptIndex.facade.lexicalRoot,
    lstats: receiptIndex.lstats.map(
      (reference) => receipt.tables.lstats[reference]
    ),
    mode: receiptIndex.mode,
    optionsHash: receiptIndex.optionsHash,
    owner: receiptIndex.owner,
    packageScopes,
    probes: receiptIndex.probes.map(
      (reference) => receipt.tables.probes[reference]
    ),
    projections,
    realpaths: receiptIndex.realpaths.map(
      (reference) => receipt.tables.realpaths[reference]
    ),
    reasons: receiptIndex.reasons,
  };
  const portableIndex = portableClassifierAuthorityEvidence(
    authority,
    indexBinding
  ) as Readonly<Record<string, unknown>>;
  for (const [family, expected] of Object.entries(expectedFamilies)) {
    if (family === "probes") {
      const synthesizedManifestProbes = receiptIndex.packageScopes
        .map((reference) => {
          const scope = receipt.tables.packageScopes[reference];
          return scope === undefined
            ? undefined
            : receipt.tables.probes[scope.manifestProbe];
        })
        .filter((probe): probe is IntlCheckProbeV3 => probe !== undefined);
      const normalizedPortableProbes = projectionCanonicalValues([
        ...array(
          portableIndex.probes,
          `${context}.authority.indexBinding.probes`
        ),
        ...synthesizedManifestProbes,
      ]);
      if (
        classifierEvidenceSetMatches(
          normalizedPortableProbes,
          expected as ReadonlyArray<unknown>,
          `${context}.authority.indexBinding.probes`
        )
      ) {
        continue;
      }
    }
    if (
      canonicalClassifierIndexFamilyEvidence(
        family,
        portableIndex[family],
        `${context}.authority.indexBinding`
      ) !==
      canonicalClassifierIndexFamilyEvidence(
        family,
        expected,
        `${context}.receipt.candidateIndex`
      )
    ) {
      fail(
        context,
        `candidate index ${family} evidence does not match receipt`
      );
    }
  }
}

function validateClassifierAuthorityHashes(
  authority: MiraiIntlClassifierAuthorityV3,
  context: string
): void {
  validateMiraiIntlClassifierAuthorityV3(authority);
  assertClassifierAuthorityHash(
    authority.indexHash,
    sha256(
      canonicalJson([
        "mirai-intl",
        "generated-facade-candidate-index",
        3,
        authority.indexBinding,
      ])
    ),
    `${context}.indexHash`
  );
  const checkpointAHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-checkpoint-a",
      3,
      authority.checkpointAInput,
    ])
  );
  assertClassifierAuthorityHash(
    authority.checkpointAHash,
    checkpointAHash,
    `${context}.checkpointAHash`
  );
  const optimizedVectorBytes = canonicalJson(
    authority.optimizedRequiresProgramVector
  );
  const referenceVectorBytes = canonicalJson(
    authority.referenceRequiresProgramVector
  );
  if (
    optimizedVectorBytes !== referenceVectorBytes ||
    authority.optimizedRequiresProgramVectorHash !==
      authority.referenceRequiresProgramVectorHash
  ) {
    fail(
      `${context}.requiresProgramVector`,
      "optimized and reference vectors must be byte-identical and hash-identical"
    );
  }
  const vectorHash = sha256(
    canonicalJson([
      "mirai-intl",
      "requires-program-vector",
      3,
      authority.optimizedRequiresProgramVector,
    ])
  );
  assertClassifierAuthorityHash(
    authority.optimizedRequiresProgramVectorHash,
    vectorHash,
    `${context}.optimizedRequiresProgramVectorHash`
  );
  assertClassifierAuthorityHash(
    authority.referenceRequiresProgramVectorHash,
    vectorHash,
    `${context}.referenceRequiresProgramVectorHash`
  );
  assertClassifierAuthorityHash(
    authority.artifactHash,
    sha256(
      canonicalJson([
        "mirai-intl",
        "classifier-checkpoint-b",
        3,
        authority.artifactBinding,
      ])
    ),
    `${context}.artifactHash`
  );
}

function validateClassifierAuthorityReceiptBinding(
  receipt: IntlCheckReceiptV3,
  authority: MiraiIntlClassifierAuthorityV3,
  authorityIndex: number
): void {
  const context = `Intl check receipt V3 classifierAuthorities[${authorityIndex}]`;
  validateClassifierAuthorityHashes(authority, context);
  const indexBinding = record(
    authority.indexBinding,
    `${context}.indexBinding`
  );
  const owner = text(indexBinding.owner, `${context}.indexBinding.owner`);
  const receiptIndexReference = receipt.candidateIndexes.findIndex(
    (index) => index.owner === owner
  );
  const receiptIndex = receipt.candidateIndexes[receiptIndexReference];
  if (receiptIndex === undefined) {
    fail(context, "has no normalized candidate index for its owner");
  }
  const facadePath = classifierAuthorityPortablePath(
    authority,
    text(indexBinding.facade, `${context}.indexBinding.facade`),
    `${context}.indexBinding.facade`
  );
  const receiptFacade = receipt.tables.files[receiptIndex.facade.file];
  if (
    receiptIndex.analyzerAbi !==
      text(indexBinding.analyzerAbi, `${context}.indexBinding.analyzerAbi`) ||
    receiptIndex.mode !==
      text(indexBinding.mode, `${context}.indexBinding.mode`) ||
    receiptIndex.optionsHash !==
      sha(indexBinding.optionsHash, `${context}.indexBinding.optionsHash`) ||
    receiptIndex.owner !== owner ||
    canonicalJson(receiptIndex.reasons) !==
      canonicalJson(indexBinding.reasons) ||
    receiptFacade?.path !== facadePath
  ) {
    fail(context, "candidate index does not match normalized receipt evidence");
  }
  const ownerBoundaryRefs = [
    ...new Set(
      receipt.classifierBindings
        .filter((binding) => binding.candidateIndex === receiptIndexReference)
        .flatMap((binding) => binding.boundaries)
    ),
  ].toSorted((left, right) => left - right);
  const ownerLocalBoundaryReference = new Map(
    ownerBoundaryRefs.map((reference, index) => [reference, index])
  );
  const candidateBoundaryRefs = receiptIndex.projections
    .filter((projection) => projection.status === "candidate")
    .map(
      (projection) =>
        ownerLocalBoundaryReference.get(projection.boundary) ??
        fail(context, "candidate projection is outside its owner boundary set")
    );
  const uniqueCandidateBoundaryRefs = [
    ...new Set(candidateBoundaryRefs),
  ].toSorted((left, right) => left - right);
  const authorityCandidateBoundaryRefs = [
    ...new Set(
      array(
        indexBinding.candidateBoundaryRefs,
        `${context}.indexBinding.candidateBoundaryRefs`
      ).map((reference, index) =>
        count(
          reference,
          `${context}.indexBinding.candidateBoundaryRefs[${index}]`
        )
      )
    ),
  ].toSorted((left, right) => left - right);
  if (
    canonicalJson(uniqueCandidateBoundaryRefs) !==
    canonicalJson(authorityCandidateBoundaryRefs)
  ) {
    fail(
      context,
      "candidate boundary refs do not match normalized receipt evidence"
    );
  }
  const authoritySources = new Map(
    authority.sources.map((source) => [
      classifierAuthorityPortablePath(
        authority,
        source.source,
        `${context}.sources.source`
      ),
      source,
    ])
  );
  if (authoritySources.size !== authority.sources.length) {
    fail(context, "contains duplicate portable source identities");
  }
  const bindings = receipt.classifierBindings.filter(
    (binding) => binding.candidateIndex === receiptIndexReference
  );
  if (bindings.length !== authoritySources.size) {
    fail(context, "does not exactly cover normalized classifier bindings");
  }
  validateClassifierAuthorityIndexEvidence(
    receipt,
    authority,
    indexBinding,
    receiptIndex,
    bindings,
    context
  );
  const derivedVector: Array<readonly [string, boolean]> = [];
  for (const binding of bindings) {
    const authoritySource = authoritySources.get(binding.source);
    if (authoritySource === undefined) {
      fail(context, `is missing source ${JSON.stringify(binding.source)}`);
    }
    const authorityLedger = expandedObservationLedger(
      binding,
      receipt.tables
    ).map((entry) => {
      if (!("byteStart" in entry)) {
        return { ...entry, source: authoritySource.source };
      }
      return {
        ...entry,
        nodeHash: hashIntlCheckReceiptV3("unknown-boundary-node", [
          entry.kind,
          entry.nodeKind,
          entry.observationOrdinal,
          entry.reason,
          authoritySource.source,
          entry.byteStart,
          entry.byteEnd,
          entry.sourceSliceHash,
        ]),
        source: authoritySource.source,
      };
    });
    assertClassifierAuthorityHash(
      authoritySource.boundaryHash,
      hashIntlCheckReceiptV3("boundary-ledger", authorityLedger),
      `${context}.sources[${JSON.stringify(binding.source)}].boundaryHash`
    );
    const requiresProgram =
      binding.mode === "owner-fallback" || binding.decision !== "facade-absent";
    const ledgerSource = receipt.sources.find(
      (source) => source.file === binding.source
    );
    if (
      authoritySource.decision !== binding.decision ||
      authoritySource.requiresProgram !== requiresProgram ||
      authoritySource.sourceHash !== binding.sourceHash ||
      ledgerSource?.hash !== binding.sourceHash
    ) {
      fail(
        context,
        "source decisions do not match normalized classifier bindings"
      );
    }
    derivedVector.push([authoritySource.source, requiresProgram]);
  }
  derivedVector.sort(([left], [right]) => compareCanonicalStrings(left, right));
  if (
    canonicalJson(derivedVector) !==
    canonicalJson(authority.optimizedRequiresProgramVector)
  ) {
    fail(context, "requiresProgram vector does not match normalized bindings");
  }
  const boundaryRefs = bindings.flatMap((binding) => binding.boundaries);
  const unknownBoundaryRefs = bindings.flatMap(
    (binding) => binding.unknownBoundaries
  );
  const requests = bindings.flatMap((binding) => binding.requests);
  const facadeImports = requests.filter(
    (request) =>
      receipt.tables.frontiers[request.frontier]?.resolvedFile ===
      receiptIndex.facade.file
  ).length;
  const receiptFacadeSet = [
    ...new Set(
      requests
        .filter(
          (request) =>
            receipt.tables.frontiers[request.frontier]?.resolvedFile ===
            receiptIndex.facade.file
        )
        .map(
          (request) =>
            ownerLocalBoundaryReference.get(request.boundary) ??
            fail(context, "facade request is outside its owner boundary set")
        )
    ),
  ].toSorted((left, right) => left - right);
  const categoryCounts = Object.fromEntries(
    [
      ...new Set(
        boundaryRefs.map(
          (reference) => receipt.tables.boundaries[reference]?.kind
        )
      ),
    ]
      .filter(
        (kind): kind is IntlCheckModuleBoundaryV3["kind"] => kind !== undefined
      )
      .toSorted(compareCanonicalStrings)
      .map((kind) => [
        kind,
        boundaryRefs.filter(
          (reference) => receipt.tables.boundaries[reference]?.kind === kind
        ).length,
      ])
  );
  const artifactBinding = record(
    authority.artifactBinding,
    `${context}.artifactBinding`
  );
  const embeddedIndex = {
    ...indexBinding,
    indexHash: authority.indexHash,
  };
  const sourceIdentities = authority.sources.map(({ source, sourceHash }) => ({
    source,
    sourceHash,
  }));
  const fallbackReasonCounts = Object.fromEntries(
    receiptIndex.reasons.map((reason) => [reason, 1])
  );
  const resolverCounters = record(
    artifactBinding.resolverCounters,
    `${context}.artifactBinding.resolverCounters`
  );
  const optimizedFacadeSet = array(
    artifactBinding.optimizedFacadeSet,
    `${context}.artifactBinding.optimizedFacadeSet`
  );
  const referenceFacadeSet = array(
    artifactBinding.referenceFacadeSet,
    `${context}.artifactBinding.referenceFacadeSet`
  );
  if (
    artifactBinding.checkpointAHash !== authority.checkpointAHash ||
    canonicalJson(artifactBinding.index) !== canonicalJson(embeddedIndex) ||
    canonicalJson(artifactBinding.optimizedRequiresProgramVector) !==
      canonicalJson(authority.optimizedRequiresProgramVector) ||
    artifactBinding.optimizedRequiresProgramVectorHash !==
      authority.optimizedRequiresProgramVectorHash ||
    canonicalJson(artifactBinding.referenceRequiresProgramVector) !==
      canonicalJson(authority.referenceRequiresProgramVector) ||
    artifactBinding.referenceRequiresProgramVectorHash !==
      authority.referenceRequiresProgramVectorHash ||
    canonicalJson(artifactBinding.sourceIdentities) !==
      canonicalJson(sourceIdentities) ||
    canonicalJson(artifactBinding.candidateSet) !==
      canonicalJson(uniqueCandidateBoundaryRefs) ||
    canonicalJson(artifactBinding.fallbackReasonCounts) !==
      canonicalJson(fallbackReasonCounts) ||
    canonicalJson(optimizedFacadeSet) !== canonicalJson(receiptFacadeSet) ||
    canonicalJson(referenceFacadeSet) !== canonicalJson(receiptFacadeSet) ||
    resolverCounters.programs !== 0 ||
    resolverCounters.resolverCalls !== requests.length ||
    typeof resolverCounters.cacheHits !== "number" ||
    !Number.isSafeInteger(resolverCounters.cacheHits) ||
    resolverCounters.cacheHits < 0 ||
    resolverCounters.cacheHits > requests.length ||
    typeof resolverCounters.hostCalls !== "number" ||
    !Number.isSafeInteger(resolverCounters.hostCalls) ||
    resolverCounters.hostCalls < 0
  ) {
    fail(context, "artifact embedded authority evidence does not match");
  }
  if (
    artifactBinding.sourceCount !== bindings.length ||
    artifactBinding.referenceBoundaries !== boundaryRefs.length ||
    artifactBinding.candidateRequests !== uniqueCandidateBoundaryRefs.length ||
    artifactBinding.facadeImports !== facadeImports ||
    artifactBinding.unknownBoundaries !== unknownBoundaryRefs.length ||
    artifactBinding.ownerMode !== receiptIndex.mode ||
    artifactBinding.ownerFallbacks !==
      (receiptIndex.mode === "owner-fallback" ? 1 : 0) ||
    artifactBinding.falseNegatives !== 0 ||
    artifactBinding.falsePositives !==
      optimizedFacadeSet.filter(
        (reference) => !referenceFacadeSet.includes(reference)
      ).length ||
    canonicalJson(artifactBinding.boundaryCategoryCounts) !==
      canonicalJson(categoryCounts)
  ) {
    fail(context, "artifact counters do not match normalized receipt evidence");
  }
}

function persistedClassifierAuthority(
  receipt: IntlCheckReceiptV3,
  owner: string,
  metrics: IntlCheckReceiptV3HashMetrics
): MiraiIntlPersistedClassifierAuthorityV3 {
  const index =
    receipt.candidateIndexes.find((candidate) => candidate.owner === owner) ??
    fail(
      `Classifier authority ${JSON.stringify(owner)}`,
      "has no normalized persisted candidate index"
    );
  const bindings = receipt.classifierBindings
    .filter(
      (binding) =>
        receipt.candidateIndexes[binding.candidateIndex]?.owner === owner
    )
    .toSorted((left, right) =>
      compareCanonicalStrings(left.source, right.source)
    );
  const sources = bindings.map(
    (binding) =>
      [
        binding.source,
        binding.sourceHash,
        binding.boundaryHash,
        binding.decision,
        binding.mode === "owner-fallback" ||
          binding.decision !== "facade-absent",
      ] as const
  );
  const checkpointAHash = hashIntlCheckReceiptV3(
    "classifier-checkpoint-a",
    sources.map(
      ([source, sourceHash, boundaryHash, decision]) =>
        [source, boundaryHash, decision, sourceHash] as const
    ),
    metrics
  );
  const requiresProgramVector = sources.map(
    ([source, _sourceHash, _boundaryHash, _decision, requiresProgram]) =>
      [source, requiresProgram] as const
  );
  const optimizedRequiresProgramVectorHash = hashIntlCheckReceiptV3(
    "requires-program-vector",
    requiresProgramVector,
    metrics
  );
  const bindingHashes = bindings
    .map(({ bindingHash }) => bindingHash)
    .toSorted(compareCanonicalStrings);
  const facade = receipt.tables.files[index.facade.file];
  if (facade === undefined) {
    fail(
      `Classifier authority ${JSON.stringify(owner)}`,
      "has no persisted facade identity"
    );
  }
  const inputHash = hashIntlCheckReceiptV3(
    "classifier-persisted-input",
    {
      facade,
      optionsHash: index.optionsHash,
      owner,
      sources: sources.map(([source, sourceHash]) => ({ source, sourceHash })),
    },
    metrics
  );
  const receiptProjectionHash = hashIntlCheckReceiptV3(
    "classifier-persisted-projection",
    { bindingHashes, indexHash: index.indexHash },
    metrics
  );
  const artifactHash = hashIntlCheckReceiptV3(
    "classifier-persisted-artifact",
    {
      bindingHashes,
      checkpointAHash,
      indexHash: index.indexHash,
      optimizedRequiresProgramVectorHash,
      referenceRequiresProgramVectorHash: optimizedRequiresProgramVectorHash,
    },
    metrics
  );
  return buildMiraiIntlPersistedClassifierAuthorityV3({
    artifactHash,
    checkpointAHash,
    indexHash: index.indexHash,
    inputHash,
    optimizedRequiresProgramVectorHash,
    owner,
    receiptProjectionHash,
    referenceRequiresProgramVectorHash: optimizedRequiresProgramVectorHash,
    sources,
  });
}

type V3ProjectionSource =
  MiraiIntlClassifierReceiptProjectionV3["sources"][number];
type V3ProjectionIndex =
  MiraiIntlClassifierReceiptProjectionV3["checkpoint"]["index"];

type ExpandedControlV3 = Readonly<{
  files: ReadonlyArray<IntlCheckFileIdentityV2>;
}>;
type ExpandedPackageScopeV3 = Readonly<{
  canonicalRoot: string;
  control: ExpandedControlV3;
  lexicalRoot: string;
  manifest: IntlCheckFileIdentityV2;
  manifestLstat: IntlCheckLstatV3;
  manifestProbe: IntlCheckProbeV3;
  realpath: IntlCheckRealpathV3;
  rootLstat: IntlCheckLstatV3;
}>;
type ExpandedFrontierV3 = Readonly<{
  control: ExpandedControlV3;
  lstats: ReadonlyArray<IntlCheckLstatV3>;
  optionsHash: Sha256;
  packageName: string | null;
  packageVersion: string | null;
  probes: ReadonlyArray<IntlCheckProbeV3>;
  realpaths: ReadonlyArray<IntlCheckRealpathV3>;
  resolutionMode: IntlCheckResolutionModeV3;
  resolvedFile: IntlCheckFileIdentityV2 | null;
}>;
type ProjectionRequestBindingV3 = Readonly<{
  boundary: IntlCheckModuleBoundaryV3;
  frontier: ExpandedFrontierV3;
  from: string;
  resolutionMode: IntlCheckResolutionModeV3;
  specifier: string;
}>;
type ProjectionOwnerV3 = Readonly<{
  boundaryByReference: ReadonlyMap<number, IntlCheckModuleBoundaryV3>;
  candidateBoundaries: ReadonlySet<IntlCheckModuleBoundaryV3>;
  control: ExpandedControlV3;
  index: V3ProjectionIndex;
  lstats: ReadonlyArray<IntlCheckLstatV3>;
  packageScopes: ReadonlyArray<ExpandedPackageScopeV3>;
  probes: ReadonlyArray<IntlCheckProbeV3>;
  projection: MiraiIntlClassifierReceiptProjectionV3;
  realpaths: ReadonlyArray<IntlCheckRealpathV3>;
  requestsBySource: ReadonlyMap<
    string,
    ReadonlyArray<ProjectionRequestBindingV3>
  >;
  sourceByPath: ReadonlyMap<string, V3ProjectionSource>;
}>;

const projectionPortablePathCache = new WeakMap<
  MiraiIntlClassifierReceiptProjectionV3,
  Map<string, string>
>();

function projectionPortablePath(
  projection: MiraiIntlClassifierReceiptProjectionV3,
  value: string,
  context: string
): string {
  let cache = projectionPortablePathCache.get(projection);
  if (!cache) {
    cache = new Map();
    projectionPortablePathCache.set(projection, cache);
  }
  const cached = cache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const result = portableWorkspaceEvidencePath(
    projection.workspaceRoot,
    value,
    context
  );
  cache.set(value, result);
  return result;
}

type ProjectionCanonicalValueIndex = Readonly<{
  byObject: WeakMap<object, string>;
  identities: ReadonlyArray<string>;
}>;

const projectionCanonicalValueIndexes = new WeakMap<
  ReadonlyArray<unknown>,
  ProjectionCanonicalValueIndex
>();

function projectionCanonicalValues<T>(
  values: Iterable<T>,
  compareValues?: (left: T, right: T) => number
): ReadonlyArray<T> {
  const entries = new Map<string, T>();
  for (const value of values) {
    entries.set(canonicalJson(value), value);
  }
  const sortedEntries = [...entries].toSorted(
    compareValues === undefined
      ? ([left], [right]) => compareCanonicalStrings(left, right)
      : ([leftIdentity, left], [rightIdentity, right]) =>
          compareValues(left, right) ||
          compareCanonicalStrings(leftIdentity, rightIdentity)
  );
  const canonicalValues = sortedEntries.map(([, value]) => value);
  const byObject = new WeakMap<object, string>();
  sortedEntries.forEach(([identity, value]) => {
    if (value !== null && typeof value === "object") {
      byObject.set(value, identity);
    }
  });
  projectionCanonicalValueIndexes.set(canonicalValues, {
    byObject,
    identities: sortedEntries.map(([identity]) => identity),
  });
  return canonicalValues;
}

type ProjectionReferenceIndex = Readonly<{
  byIdentity: Map<string, Ref>;
  byObject: WeakMap<object, Ref>;
}>;

type ProjectionReferenceContext = Readonly<{
  identitiesByObject: WeakMap<object, string>;
  indexes: WeakMap<ReadonlyArray<unknown>, ProjectionReferenceIndex>;
}>;

function createProjectionReferenceContext(): ProjectionReferenceContext {
  return {
    identitiesByObject: new WeakMap(),
    indexes: new WeakMap(),
  };
}

function projectionCanonicalValueIdentity<T>(
  values: ReadonlyArray<T>,
  value: T
): string {
  if (value !== null && typeof value === "object") {
    const identity = projectionCanonicalValueIndexes
      .get(values)
      ?.byObject.get(value);
    if (identity !== undefined) {
      return identity;
    }
  }
  return canonicalJson(value);
}

function projectionReferenceInContext<T>(
  referenceContext: ProjectionReferenceContext,
  table: ReadonlyArray<T>,
  value: T,
  context: string
): Ref {
  let references = referenceContext.indexes.get(table);
  if (!references) {
    const byIdentity = new Map<string, Ref>();
    const byObject = new WeakMap<object, Ref>();
    const canonicalIndex = projectionCanonicalValueIndexes.get(table);
    table.forEach((candidate, reference) => {
      if (candidate !== null && typeof candidate === "object") {
        byObject.set(candidate, reference);
      }
      const identity = canonicalIndex?.identities[reference];
      if (identity !== undefined) {
        byIdentity.set(identity, reference);
        if (candidate !== null && typeof candidate === "object") {
          referenceContext.identitiesByObject.set(candidate, identity);
        }
      }
    });
    references = { byIdentity, byObject };
    referenceContext.indexes.set(table, references);
  }
  const directReference =
    value !== null && typeof value === "object"
      ? references.byObject.get(value)
      : undefined;
  if (directReference !== undefined) {
    return directReference;
  }
  if (references.byIdentity.size === 0) {
    table.forEach((candidate, reference) => {
      const identity = canonicalJson(candidate);
      references.byIdentity.set(identity, reference);
      if (candidate !== null && typeof candidate === "object") {
        referenceContext.identitiesByObject.set(candidate, identity);
      }
    });
  }
  const cachedIdentity =
    value !== null && typeof value === "object"
      ? referenceContext.identitiesByObject.get(value)
      : undefined;
  const identity = cachedIdentity ?? canonicalJson(value);
  if (
    cachedIdentity === undefined &&
    value !== null &&
    typeof value === "object"
  ) {
    referenceContext.identitiesByObject.set(value, identity);
  }
  const reference = references.byIdentity.get(identity);
  return reference === undefined
    ? fail(context, "is missing from its normalized V3 table")
    : reference;
}

function projectionReferencesInContext<T>(
  referenceContext: ProjectionReferenceContext,
  table: ReadonlyArray<T>,
  values: ReadonlyArray<T>,
  context: string
): ReadonlyArray<Ref> {
  return [
    ...new Set(
      values.map((value) =>
        projectionReferenceInContext(referenceContext, table, value, context)
      )
    ),
  ].toSorted((left, right) => left - right);
}

function projectionHash(
  projection: MiraiIntlClassifierReceiptProjectionV3
): Sha256 {
  return hashMiraiIntlClassifierReceiptProjectionV3(projection);
}

function projectionControl(
  projection: MiraiIntlClassifierReceiptProjectionV3,
  files: ReadonlyArray<IntlCheckFileIdentityV2>,
  context: string
): ExpandedControlV3 {
  return {
    files: projectionCanonicalValues(
      files.map((file, index) => ({
        hash: sha(file.hash, `${context}.files[${index}].hash`),
        path: projectionPortablePath(
          projection,
          file.path,
          `${context}.files[${index}].path`
        ),
      })),
      (left, right) => compareCanonicalStrings(left.path, right.path)
    ),
  };
}

function mergeProjectionPackageScopes(
  scopes: ReadonlyArray<ExpandedPackageScopeV3>
): ReadonlyArray<ExpandedPackageScopeV3> {
  const byRoot = new Map<string, ExpandedPackageScopeV3>();
  for (const scope of scopes) {
    const identity = `${scope.lexicalRoot}\0${scope.canonicalRoot}`;
    const existing = byRoot.get(identity);
    if (existing === undefined) {
      byRoot.set(identity, scope);
      continue;
    }
    const physicalScope = ({
      control: _control,
      ...value
    }: ExpandedPackageScopeV3) => value;
    if (
      canonicalJson(physicalScope(existing)) !==
      canonicalJson(physicalScope(scope))
    ) {
      fail(
        `V3 package scope ${JSON.stringify(scope.lexicalRoot)}`,
        "has conflicting physical evidence across classifier owners"
      );
    }
    byRoot.set(identity, {
      ...existing,
      control: {
        files: projectionCanonicalValues(
          [...existing.control.files, ...scope.control.files],
          (left, right) => compareCanonicalStrings(left.path, right.path)
        ),
      },
    });
  }
  return [...byRoot.values()].toSorted((left, right) =>
    compareCanonicalStrings(
      `${left.lexicalRoot}\0${left.canonicalRoot}`,
      `${right.lexicalRoot}\0${right.canonicalRoot}`
    )
  );
}

function projectionProbe(
  projection: MiraiIntlClassifierReceiptProjectionV3,
  value: IntlCheckProbeV3,
  context: string
): IntlCheckProbeV3 {
  return {
    kind: value.kind,
    path: projectionPortablePath(projection, value.path, `${context}.path`),
    present: value.present,
  };
}

function projectionRealpath(
  projection: MiraiIntlClassifierReceiptProjectionV3,
  value: IntlCheckRealpathV3,
  context: string
): IntlCheckRealpathV3 {
  return {
    path: projectionPortablePath(projection, value.path, `${context}.path`),
    target: projectionPortablePath(
      projection,
      value.target,
      `${context}.target`
    ),
  };
}

function projectionLstat(
  projection: MiraiIntlClassifierReceiptProjectionV3,
  value: IntlCheckLstatV3,
  context: string
): IntlCheckLstatV3 {
  return {
    kind: value.kind,
    linkTargetBase64: value.linkTargetBase64,
    linkTargetHash: value.linkTargetHash,
    path: projectionPortablePath(projection, value.path, `${context}.path`),
  };
}

function projectionUnknownBoundary(
  projection: MiraiIntlClassifierReceiptProjectionV3,
  value: IntlCheckUnknownModuleBoundaryV3,
  context: string
): IntlCheckUnknownModuleBoundaryV3 {
  const source = projectionPortablePath(
    projection,
    value.source,
    `${context}.source`
  );
  return {
    ...value,
    nodeHash: hashIntlCheckReceiptV3("unknown-boundary-node", [
      value.kind,
      value.nodeKind,
      value.observationOrdinal,
      value.reason,
      source,
      value.byteStart,
      value.byteEnd,
      value.sourceSliceHash,
    ]),
    source,
  };
}

function collectV2Files(
  receipt: IntlCheckReceiptV2
): ReadonlyArray<IntlCheckFileIdentityV2> {
  return [
    receipt.application.packageManifest,
    receipt.application.workspaceLockfile,
    ...receipt.projects.flatMap((project) =>
      project.configManifest.map(({ hash, path: configPath }) => ({
        hash,
        path: configPath,
      }))
    ),
    ...receipt.providerClosures.flatMap((closure) => [
      ...closure.declarations,
      ...closure.libs,
      ...closure.providers.flatMap((provider) => [
        ...provider.declarations,
        ...provider.resolutions.flatMap(
          (resolution) => resolution.controlFiles
        ),
      ]),
    ]),
    ...receipt.sources.map((source) => ({
      hash: source.hash,
      path: source.file,
    })),
    ...receipt.typescript.libs,
  ];
}

function projectionCompilerFile(
  files: ReadonlyArray<IntlCheckFileIdentityV2>,
  file: IntlCheckFileIdentityV2
): IntlCheckFileIdentityV2 {
  return (
    files.find(
      (candidate) =>
        candidate.path === file.path && candidate.hash === file.hash
    ) ?? { hash: file.hash, path: `.mirai-intl/compiler/${file.path}` }
  );
}

function projectionFileTable(
  receipt: IntlCheckReceiptV2,
  evidence: ReadonlyArray<IntlCheckReceiptV3ClassifierProjectionEvidence>
): ReadonlyArray<IntlCheckFileIdentityV2> {
  const files = new Map<string, IntlCheckFileIdentityV2>();
  const add = (file: IntlCheckFileIdentityV2, context: string): void => {
    const normalizedFile = {
      hash: sha(file.hash, `${context}.hash`),
      path: path(file.path, `${context}.path`, false),
    };
    files.set(`${normalizedFile.path}\0${normalizedFile.hash}`, normalizedFile);
  };
  collectV2Files(receipt).forEach((file, index) =>
    add(file, `Intl check receipt V2 shared file[${index}]`)
  );
  receipt.compilerManifest.forEach((file, index) => {
    const prior = files.get(file.path);
    add(
      prior === undefined || prior.hash === file.hash
        ? file
        : { hash: file.hash, path: `.mirai-intl/compiler/${file.path}` },
      `Intl check receipt V2 compiler file[${index}]`
    );
  });
  for (const [evidenceIndex, { projection }] of evidence.entries()) {
    add(
      {
        hash: projection.generatedFacadeHash,
        path: projectionPortablePath(
          projection,
          projection.generatedFacadePath,
          `Classifier projection ${evidenceIndex}.generatedFacadePath`
        ),
      },
      `Classifier projection ${evidenceIndex}.generatedFacade`
    );
    projection.checkpoint.index.controls.forEach((file, fileIndex) =>
      add(
        {
          hash: file.hash,
          path: projectionPortablePath(
            projection,
            file.path,
            `Classifier projection ${evidenceIndex}.controls[${fileIndex}].path`
          ),
        },
        `Classifier projection ${evidenceIndex}.controls[${fileIndex}]`
      )
    );
    projection.checkpoint.index.packageScopes.forEach((scope, scopeIndex) =>
      add(
        {
          hash: scope.manifestHash,
          path: projectionPortablePath(
            projection,
            scope.manifestPath,
            `Classifier projection ${evidenceIndex}.packageScopes[${scopeIndex}].manifestPath`
          ),
        },
        `Classifier projection ${evidenceIndex}.packageScopes[${scopeIndex}].manifest`
      )
    );
  }
  return [...files.values()].toSorted((left, right) =>
    compareCanonicalStrings(
      `${left.path}\0${left.hash}`,
      `${right.path}\0${right.hash}`
    )
  );
}

function projectionKnownFile(
  files: ReadonlyArray<IntlCheckFileIdentityV2>,
  projection: MiraiIntlClassifierReceiptProjectionV3,
  value: string,
  context: string,
  expectedHash?: Sha256
): IntlCheckFileIdentityV2 {
  const filePath = projectionPortablePath(projection, value, context);
  const file = files.find(
    (candidate) =>
      candidate.path === filePath &&
      (expectedHash === undefined || candidate.hash === expectedHash)
  );
  return file ?? fail(context, "has no hash-bound shared proof file identity");
}

function projectionOwner(
  receipt: IntlCheckReceiptV2,
  files: ReadonlyArray<IntlCheckFileIdentityV2>,
  evidence: IntlCheckReceiptV3ClassifierProjectionEvidence,
  evidenceIndex: number
): ProjectionOwnerV3 {
  const { authority, projection } = evidence;
  const context = `Classifier projection ${evidenceIndex}`;
  if (
    projectionHash(projection) !== authority.receiptProjectionHash ||
    projection.inputHash !== authority.inputHash ||
    projection.workspaceRoot !== authority.workspaceRoot
  ) {
    fail(context, "does not match its hash-bound classifier authority");
  }
  const { artifactHash, ...projectedArtifactBinding } = projection.checkpoint;
  if (
    artifactHash !== authority.artifactHash ||
    projection.checkpoint.checkpointAHash !== authority.checkpointAHash ||
    projection.checkpoint.index.indexHash !== authority.indexHash ||
    projection.checkpoint.optimizedRequiresProgramVectorHash !==
      authority.optimizedRequiresProgramVectorHash ||
    projection.checkpoint.referenceRequiresProgramVectorHash !==
      authority.referenceRequiresProgramVectorHash ||
    canonicalJson(projectedArtifactBinding) !==
      canonicalJson(authority.artifactBinding)
  ) {
    fail(
      context,
      "checkpoint evidence disagrees with its classifier authority"
    );
  }
  const authorityOwner = text(
    record(authority.indexBinding, `${context}.authority.indexBinding`).owner,
    `${context}.authority.owner`
  );
  const owner = projectionPortablePath(
    projection,
    projection.owner,
    `${context}.owner`
  );
  const index = projection.checkpoint.index;
  if (owner !== authorityOwner || owner !== index.owner) {
    fail(context, "owner identity disagrees across projection and authority");
  }
  const project = receipt.projects.find(
    (candidate) => candidate.path === owner && candidate.role === "owner"
  );
  const normalizedOptionsHash =
    project === undefined
      ? undefined
      : hashIntlCheckReceiptV3("project-normalized-options", [
          project.path,
          project.normalizedOptions,
        ]);
  if (project === undefined || normalizedOptionsHash !== index.optionsHash) {
    fail(context, "does not bind an exact V2 owner project and options hash");
  }

  const control = projectionControl(
    projection,
    index.controls,
    `${context}.control`
  );
  const lstats = projectionCanonicalValues(
    index.lstats.map((entry, entryIndex) =>
      projectionLstat(projection, entry, `${context}.lstats[${entryIndex}]`)
    ),
    (left, right) => compareCanonicalStrings(left.path, right.path)
  );
  const probes = projectionCanonicalValues(
    index.probes.map((entry, entryIndex) =>
      projectionProbe(projection, entry, `${context}.probes[${entryIndex}]`)
    ),
    (left, right) =>
      compareCanonicalStrings(
        `${left.path}\0${left.kind}`,
        `${right.path}\0${right.kind}`
      )
  );
  const realpaths = projectionCanonicalValues(
    index.realpaths.map((entry, entryIndex) =>
      projectionRealpath(
        projection,
        entry,
        `${context}.realpaths[${entryIndex}]`
      )
    ),
    (left, right) => compareCanonicalStrings(left.path, right.path)
  );

  const packageScopes = index.packageScopes.map((scope, scopeIndex) => {
    const scopeContext = `${context}.packageScopes[${scopeIndex}]`;
    const canonicalRoot = projectionPortablePath(
      projection,
      scope.canonicalRoot,
      `${scopeContext}.canonicalRoot`
    );
    const lexicalRoot = projectionPortablePath(
      projection,
      scope.lexicalRoot,
      `${scopeContext}.lexicalRoot`
    );
    const manifest = projectionKnownFile(
      files,
      projection,
      scope.manifestPath,
      `${scopeContext}.manifestPath`,
      scope.manifestHash
    );
    if (manifest.hash !== scope.manifestHash) {
      fail(scopeContext, "manifest hash disagrees with shared proof identity");
    }
    const topology = index.packageTopology.find(
      (entry) =>
        projectionPortablePath(
          projection,
          entry.canonicalRoot,
          `${scopeContext}.topology.canonicalRoot`
        ) === canonicalRoot &&
        projectionPortablePath(
          projection,
          entry.manifest.path,
          `${scopeContext}.topology.manifest.path`
        ) === manifest.path
    );
    if (topology === undefined) {
      fail(scopeContext, "has no exact package-topology root evidence");
    }
    const rootLstat = projectionLstat(
      projection,
      topology.root,
      `${scopeContext}.topology.root`
    );
    const manifestLstat = projectionLstat(
      projection,
      topology.manifest,
      `${scopeContext}.topology.manifest`
    );
    if (
      topology.manifestHash !== manifest.hash ||
      (manifestLstat.kind !== "file" && manifestLstat.kind !== "symlink")
    ) {
      fail(
        scopeContext,
        "package-topology manifest evidence does not bind the package scope"
      );
    }
    const manifestProbe = probes.find(
      (entry) => entry.kind === "file" && entry.path === manifest.path
    ) ?? { kind: "file" as const, path: manifest.path, present: true };
    const scopeRealpath = realpaths.find(
      (entry) => entry.path === lexicalRoot && entry.target === canonicalRoot
    );
    if (scopeRealpath === undefined) {
      fail(scopeContext, "has incomplete package realpath evidence");
    }
    return {
      canonicalRoot,
      control,
      lexicalRoot,
      manifest,
      manifestLstat,
      manifestProbe,
      realpath: scopeRealpath,
      rootLstat,
    };
  });
  const packageProbes = projectionCanonicalValues(
    [...probes, ...packageScopes.map((scope) => scope.manifestProbe)],
    (left, right) =>
      compareCanonicalStrings(
        `${left.path}\0${left.kind}`,
        `${right.path}\0${right.kind}`
      )
  );

  const sourceByPath = new Map<string, V3ProjectionSource>();
  const boundaryByReference = new Map<number, IntlCheckModuleBoundaryV3>();
  const requestsBySource = new Map<
    string,
    ReadonlyArray<ProjectionRequestBindingV3>
  >();
  let boundaryOffset = 0;
  for (const [sourceIndex, sourceEvidence] of projection.sources.entries()) {
    const sourceContext = `${context}.sources[${sourceIndex}]`;
    const source = projectionPortablePath(
      projection,
      sourceEvidence.source,
      `${sourceContext}.source`
    );
    if (sourceByPath.has(source)) {
      fail(sourceContext, "duplicates a normalized source identity");
    }
    const sourceLedger = receipt.sources.find((entry) => entry.file === source);
    if (
      sourceLedger === undefined ||
      sourceLedger.owner !== owner ||
      sourceLedger.hash !== sourceEvidence.sourceHash
    ) {
      fail(sourceContext, "does not exactly match its V2 source ledger entry");
    }
    sourceByPath.set(source, sourceEvidence);
    const boundaryByOrdinal = new Map<number, IntlCheckModuleBoundaryV3>();
    sourceEvidence.boundaries.forEach((boundary, boundaryIndex) => {
      if (boundary.ordinal !== boundaryIndex) {
        fail(
          sourceContext,
          "contains a non-contiguous literal boundary ordinal"
        );
      }
      const normalized: IntlCheckModuleBoundaryV3 = {
        kind: boundary.kind,
        observationOrdinal: boundary.observationOrdinal,
        ordinal: boundary.ordinal,
        resolutionMode: boundary.resolutionMode,
        source,
        specifier: boundary.specifier,
      };
      boundaryByOrdinal.set(boundary.ordinal, normalized);
      boundaryByReference.set(boundaryOffset + boundary.ordinal, normalized);
    });
    const normalizedUnknown = sourceEvidence.unknownBoundaries.map(
      (boundary, boundaryIndex) =>
        projectionUnknownBoundary(
          projection,
          boundary,
          `${sourceContext}.unknownBoundaries[${boundaryIndex}]`
        )
    );
    const normalizedLedger = [
      ...boundaryByOrdinal.values(),
      ...normalizedUnknown,
    ].toSorted(
      (left, right) => left.observationOrdinal - right.observationOrdinal
    );
    const normalizedProjectionLedger = sourceEvidence.ledger
      .map((entry, entryIndex) =>
        "byteStart" in entry
          ? projectionUnknownBoundary(
              projection,
              entry,
              `${sourceContext}.ledger[${entryIndex}]`
            )
          : {
              ...entry,
              source: projectionPortablePath(
                projection,
                entry.source,
                `${sourceContext}.ledger[${entryIndex}].source`
              ),
            }
      )
      .toSorted(
        (left, right) => left.observationOrdinal - right.observationOrdinal
      );
    if (
      normalizedLedger.some((entry) => entry.source !== source) ||
      canonicalJson(normalizedProjectionLedger) !==
        canonicalJson(normalizedLedger) ||
      hashIntlCheckReceiptV3("boundary-ledger", sourceEvidence.ledger) !==
        sourceEvidence.boundaryHash
    ) {
      fail(sourceContext, "boundary ledger does not match its source or hash");
    }
    const requests = sourceEvidence.requests.map((request, requestIndex) => {
      const requestContext = `${sourceContext}.requests[${requestIndex}]`;
      const boundary = boundaryByOrdinal.get(request.boundary.ordinal);
      if (
        boundary === undefined ||
        boundary.specifier !== request.boundary.specifier ||
        boundary.resolutionMode !== request.resolutionMode
      ) {
        return fail(requestContext, "does not select an exact source boundary");
      }
      const requestControl = projectionControl(
        projection,
        request.frontier.controlFiles,
        `${requestContext}.frontier.control`
      );
      const requestProbes = projectionCanonicalValues(
        request.frontier.probes.map((entry, entryIndex) =>
          projectionProbe(
            projection,
            entry,
            `${requestContext}.frontier.probes[${entryIndex}]`
          )
        ),
        (left, right) =>
          compareCanonicalStrings(
            `${left.path}\0${left.kind}`,
            `${right.path}\0${right.kind}`
          )
      );
      const requestRealpaths = projectionCanonicalValues(
        request.frontier.realpaths.map((entry, entryIndex) =>
          projectionRealpath(
            projection,
            entry,
            `${requestContext}.frontier.realpaths[${entryIndex}]`
          )
        ),
        (left, right) => compareCanonicalStrings(left.path, right.path)
      );
      const resolvedFile =
        request.resolvedFileName === null
          ? null
          : projectionKnownFile(
              files,
              projection,
              request.resolvedFileName,
              `${requestContext}.resolvedFileName`
            );
      return {
        boundary,
        frontier: {
          control: requestControl,
          lstats,
          optionsHash: normalizedOptionsHash,
          packageName: request.frontier.packageName,
          packageVersion: request.frontier.packageVersion,
          probes: requestProbes,
          realpaths: requestRealpaths,
          resolutionMode: request.resolutionMode,
          resolvedFile,
        },
        from: source,
        resolutionMode: request.resolutionMode,
        specifier: request.boundary.specifier,
      };
    });
    requestsBySource.set(source, requests);
    boundaryOffset += sourceEvidence.boundaries.length;
  }
  const expectedSources = receipt.sources
    .filter((source) => source.owner === owner)
    .map((source) => source.file)
    .toSorted(compareCanonicalStrings);
  if (
    canonicalJson(
      [...sourceByPath.keys()].toSorted(compareCanonicalStrings)
    ) !== canonicalJson(expectedSources)
  ) {
    fail(context, "does not exactly cover the V2 owner source universe");
  }
  for (const candidateProjection of index.projections) {
    if (!boundaryByReference.has(candidateProjection.boundary)) {
      fail(context, "candidate index references an unknown source boundary");
    }
  }
  return {
    boundaryByReference,
    candidateBoundaries: new Set(
      index.projections
        .filter(({ status }) => status === "candidate")
        .map(
          ({ boundary }) =>
            boundaryByReference.get(boundary) as IntlCheckModuleBoundaryV3
        )
    ),
    control,
    index,
    lstats,
    packageScopes,
    probes: packageProbes,
    projection,
    realpaths,
    requestsBySource,
    sourceByPath,
  };
}

function selectedProjectionRequests(
  owner: ProjectionOwnerV3,
  source: string
): ReadonlyArray<ProjectionRequestBindingV3> {
  const requests = owner.requestsBySource.get(source) ?? [];
  return requests.filter((request) =>
    owner.candidateBoundaries.has(request.boundary)
  );
}

function buildNativeV3ProjectionLedger(
  input: IntlCheckReceiptV3NativeInput,
  metrics = createAuthorizationSnapshotCanonicalizationMetrics()
): IntlCheckReceiptV2 {
  const canonicalizer = canonicalizationContext(metrics);
  const compilerManifest = canonicalFiles(
    input.compilerManifest,
    "Native V3 compiler manifest",
    canonicalizer
  );
  const projects = sortBy(
    input.projects.map((project, index) =>
      canonicalProject(project, index, canonicalizer)
    ),
    projectInputIdentity
  );
  sortedUnique(projects, projectInputIdentity, "Native V3 projects");
  const providerClosures = sortBy(
    input.providerClosures.map((closure, index) =>
      canonicalClosure(closure, index, canonicalizer)
    ),
    (closure) => closure.source
  );
  sortedUnique(
    providerClosures,
    (closure) => closure.source,
    "Native V3 provider closures"
  );
  const closureBySource = new Map(
    providerClosures.map((closure) => [closure.source, closure])
  );
  const sources = sortBy(
    input.sources.map((source, index) => {
      const context = `Native V3 source ${index}`;
      const object = exact(
        source,
        ["file", "hash", "owner", "verdict"],
        context
      );
      const file = canonicalPath(object.file, `${context}.file`, canonicalizer);
      if (object.verdict !== "accepted" && object.verdict !== "exception") {
        fail(`${context}.verdict`, "must be accepted or exception");
      }
      return {
        file,
        hash: sha(object.hash, `${context}.hash`),
        owner: canonicalPath(object.owner, `${context}.owner`, canonicalizer),
        // Projection assembly never trusts this compatibility field. Native
        // V3 derives the nullable hash from the classifier/closure relation.
        providerClosureHash:
          closureBySource.get(file)?.closureHash ?? sha256("V3 no closure"),
        verdict: object.verdict as "accepted" | "exception",
      };
    }),
    (source) => source.file
  );
  sortedUnique(sources, (source) => source.file, "Native V3 sources");
  if (
    input.observedCounters.semanticAuthorizationRuns !== 1 ||
    input.observedCounters.semanticFilesAnalyzed !== providerClosures.length
  ) {
    fail(
      "Native V3 observed counters",
      "must report one authorization run and exactly the Program-analyzed provider-closure count"
    );
  }
  const sourceSet = new Set(sources.map((source) => source.file));
  const owners = new Set(
    projects
      .filter((project) => project.role === "owner")
      .map((project) => project.path)
  );
  for (const source of sources) {
    if (!owners.has(source.owner)) {
      fail(
        `Native V3 source ${JSON.stringify(source.file)}`,
        "must select an owner project"
      );
    }
  }
  for (const closure of providerClosures) {
    if (!sourceSet.has(closure.source)) {
      fail(
        `Native V3 provider closure ${JSON.stringify(closure.source)}`,
        "does not correspond to a source"
      );
    }
  }
  const exceptions = sortBy(
    input.exceptions.map((entry, index) => {
      const context = `Native V3 exception ${index}`;
      const object = exact(
        entry,
        ["file", "nodeHash", "reason", "rule"],
        context
      );
      return {
        file: canonicalPath(object.file, `${context}.file`, canonicalizer),
        nodeHash: sha(object.nodeHash, `${context}.nodeHash`),
        reason: text(object.reason, `${context}.reason`),
        rule: text(object.rule, `${context}.rule`),
      };
    }),
    exceptionIdentity
  );
  sortedUnique(exceptions, exceptionIdentity, "Native V3 exceptions");
  const typescriptLibs = canonicalFiles(
    input.typescript.libs,
    "Native V3 TypeScript lib",
    canonicalizer
  );
  const typescript: IntlCheckTypeScriptIdentityV2 = {
    libHash: canonicalHashMemo(typescriptLibs, canonicalizer),
    libs: typescriptLibs,
    package: parsePackage(
      input.typescript.package,
      "Native V3 TypeScript package"
    ),
  };
  return {
    application: parseApplication(input.application, "Native V3 application"),
    artifactAbi: text(input.artifactAbi, "Native V3 artifact ABI"),
    compilerManifest,
    compilerManifestHash: canonicalHashMemo(compilerManifest, canonicalizer),
    counters: {
      ...expectedCounters(
        projects,
        providerClosures,
        sources,
        exceptions,
        typescript
      ),
      semanticAuthorizationRuns: 1,
      semanticFilesAnalyzed: input.observedCounters.semanticFilesAnalyzed,
    },
    exceptions,
    exceptionsHash: canonicalHashMemo(exceptions, canonicalizer),
    generationReceiptHash: sha(
      input.generationReceiptHash,
      "Native V3 generation receipt hash"
    ),
    icu: parsePackage(input.icu, "Native V3 ICU package"),
    projects,
    providerClosures,
    runtimeAbi: text(input.runtimeAbi, "Native V3 runtime ABI") as RuntimeAbi,
    schemaVersion: 2,
    sourceAuthorizationHash: sha256("Native V3 projection ledger"),
    sources,
    typescript,
  };
}

/**
 * Projects a sealed V2 semantic receipt plus exact classifier transaction
 * evidence into normalized V3 without loading TypeScript or reclassifying.
 */
export function buildIntlCheckReceiptV3FromClassifierProjections(
  receiptValue: unknown,
  evidenceValue: ReadonlyArray<IntlCheckReceiptV3ClassifierProjectionEvidence>,
  metrics = createIntlCheckReceiptV3HashMetrics(),
  options: IntlCheckReceiptV3VerificationOptions = {}
): IntlCheckReceiptV3ClassifierAuthorityBinding {
  const receiptV2 = parseIntlCheckReceiptV2(receiptValue);
  return buildIntlCheckReceiptV3FromProjectionLedger(
    receiptV2,
    evidenceValue,
    metrics,
    options
  );
}

/**
 * Native production V3 assembly from a complete lexical source ledger,
 * filtered semantic provider evidence, and finalized classifier projections.
 */
export function buildIntlCheckReceiptV3FromNativeInputs(
  input: IntlCheckReceiptV3NativeInput,
  evidenceValue: ReadonlyArray<IntlCheckReceiptV3ClassifierProjectionEvidence>,
  metrics = createIntlCheckReceiptV3HashMetrics(),
  options: IntlCheckReceiptV3VerificationOptions = {}
): IntlCheckReceiptV3ClassifierAuthorityBinding {
  return buildIntlCheckReceiptV3FromProjectionLedger(
    buildNativeV3ProjectionLedger(input),
    evidenceValue,
    metrics,
    options
  );
}

function buildIntlCheckReceiptV3FromProjectionLedger(
  receiptV2: IntlCheckReceiptV2,
  evidenceValue: ReadonlyArray<IntlCheckReceiptV3ClassifierProjectionEvidence>,
  metrics: IntlCheckReceiptV3HashMetrics,
  options: IntlCheckReceiptV3VerificationOptions
): IntlCheckReceiptV3ClassifierAuthorityBinding {
  const referenceContext = createProjectionReferenceContext();
  const projectionReference = <T>(
    table: ReadonlyArray<T>,
    value: T,
    context: string
  ): Ref =>
    projectionReferenceInContext(referenceContext, table, value, context);
  const projectionReferences = <T>(
    table: ReadonlyArray<T>,
    values: ReadonlyArray<T>,
    context: string
  ): ReadonlyArray<Ref> =>
    projectionReferencesInContext(referenceContext, table, values, context);
  const profileStarted = performance.now();
  let profilePrior = profileStarted;
  const profilePhases: Array<
    Readonly<{ milliseconds: number; phase: string }>
  > = [];
  const markProfilePhase = (phase: string): void => {
    if (process.env.MIRAI_INTL_INTERNAL_V3_PROFILE !== "1") {
      return;
    }
    const now = performance.now();
    profilePhases.push({ milliseconds: now - profilePrior, phase });
    profilePrior = now;
  };
  if (
    evidenceValue.length === 0 &&
    (receiptV2.sources.length > 0 || receiptV2.providerClosures.length > 0)
  ) {
    fail("Intl check receipt V3 classifier projections", "must not be empty");
  }
  const evidence = [...evidenceValue].toSorted((left, right) =>
    compareCanonicalStrings(left.projection.owner, right.projection.owner)
  );
  sortedUnique(
    evidence,
    ({ projection }) => projection.owner,
    "Intl check receipt V3 classifier projections"
  );
  const files = projectionFileTable(receiptV2, evidence);
  const owners = evidence.map((entry, index) =>
    projectionOwner(receiptV2, files, entry, index)
  );
  markProfilePhase("projection-owners");
  sortedUnique(
    owners,
    (owner) => owner.index.owner,
    "Intl check receipt V3 normalized projection owners"
  );
  const ownerByProject = new Map(
    owners.map((owner) => [owner.index.owner, owner])
  );
  const projectOwnerBySource = new Map(
    receiptV2.sources.map((source) => [source.file, source.owner])
  );
  const semanticResolutionCache = new WeakMap<
    IntlCheckProviderResolutionV2,
    Readonly<{
      frontier: ExpandedFrontierV3;
      from: string;
      specifier: string;
    }>
  >();
  const projectSemanticResolution = (
    closureSource: string,
    resolution: IntlCheckProviderResolutionV2,
    context: string
  ): Readonly<{
    frontier: ExpandedFrontierV3;
    from: string;
    specifier: string;
  }> => {
    const cached = semanticResolutionCache.get(resolution);
    if (cached) {
      return cached;
    }
    const ownerPath = projectOwnerBySource.get(closureSource);
    const owner =
      ownerPath === undefined ? undefined : ownerByProject.get(ownerPath);
    if (owner === undefined) {
      return fail(context, "has no classifier owner projection");
    }
    const project = receiptV2.projects.find(
      (candidate) => candidate.path === owner.index.owner
    );
    if (
      project === undefined ||
      resolution.optionsHash !== project.normalizedOptionsHash
    ) {
      return fail(context, "does not bind its owner classifier options");
    }
    const projected: Readonly<{
      frontier: ExpandedFrontierV3;
      from: string;
      specifier: string;
    }> = {
      frontier: {
        control: projectionControl(
          owner.projection,
          resolution.controlFiles,
          `${context}.control`
        ),
        lstats: [],
        optionsHash: resolution.optionsHash,
        packageName: resolution.packageName,
        packageVersion: resolution.packageVersion,
        probes: resolution.probes.map((probe, index) =>
          projectionProbe(
            owner.projection,
            probe,
            `${context}.probes[${index}]`
          )
        ),
        realpaths: resolution.realpaths.map((identity, index) =>
          projectionRealpath(
            owner.projection,
            identity,
            `${context}.realpaths[${index}]`
          )
        ),
        resolutionMode: "default",
        resolvedFile: null,
      },
      from: projectionPortablePath(
        owner.projection,
        resolution.from,
        `${context}.from`
      ),
      specifier: resolution.specifier,
    };
    semanticResolutionCache.set(resolution, projected);
    return projected;
  };
  const semanticRequests = receiptV2.providerClosures.flatMap((closure) =>
    closure.providers.flatMap((provider, providerIndex) =>
      provider.resolutions.map((resolution, resolutionIndex) =>
        projectSemanticResolution(
          closure.source,
          resolution,
          `V3 provider ${providerIndex}.resolutions[${resolutionIndex}]`
        )
      )
    )
  );
  markProfilePhase("semantic-requests");

  const boundaries = projectionCanonicalValues(
    owners.flatMap((owner) => [...owner.boundaryByReference.values()]),
    (left, right) =>
      compareCanonicalStrings(
        `${left.source}\0${left.ordinal.toString().padStart(16, "0")}`,
        `${right.source}\0${right.ordinal.toString().padStart(16, "0")}`
      )
  );
  const unknownBoundaries = projectionCanonicalValues(
    owners.flatMap((owner) =>
      [...owner.sourceByPath.entries()].flatMap(([source, result]) =>
        result.unknownBoundaries.map((boundary, boundaryIndex) =>
          projectionUnknownBoundary(
            owner.projection,
            boundary,
            `V3 unknown boundary ${source}[${boundaryIndex}]`
          )
        )
      )
    ),
    (left, right) =>
      compareCanonicalStrings(
        `${left.source}\0${left.observationOrdinal.toString().padStart(16, "0")}`,
        `${right.source}\0${right.observationOrdinal.toString().padStart(16, "0")}`
      )
  );
  const expandedScopes = mergeProjectionPackageScopes(
    owners.flatMap((owner) => owner.packageScopes)
  );
  const expandedControls = projectionCanonicalValues([
    ...owners.map((owner) => owner.control),
    ...owners.flatMap((owner) =>
      [...owner.requestsBySource.values()].flatMap((requests) =>
        requests.map((request) => request.frontier.control)
      )
    ),
    ...semanticRequests.map((request) => request.frontier.control),
    ...expandedScopes.map((scope) => scope.control),
  ]);
  const controls: ReadonlyArray<IntlCheckControlSetV3> = expandedControls
    .map((control) => ({
      files: projectionReferences(files, control.files, "V3 control file"),
    }))
    .toSorted((left, right) =>
      compareCanonicalStrings(
        canonicalJson(left.files.map((reference) => files[reference])),
        canonicalJson(right.files.map((reference) => files[reference]))
      )
    );
  const lstats = projectionCanonicalValues(
    owners.flatMap((owner) => owner.lstats),
    (left, right) => compareCanonicalStrings(left.path, right.path)
  );
  const probes = projectionCanonicalValues(
    [
      ...owners.flatMap((owner) => owner.probes),
      ...owners.flatMap((owner) =>
        [...owner.requestsBySource.values()].flatMap((requests) =>
          requests.flatMap((request) => request.frontier.probes)
        )
      ),
      ...semanticRequests.flatMap((request) => request.frontier.probes),
    ],
    (left, right) =>
      compareCanonicalStrings(
        `${left.path}\0${left.kind}`,
        `${right.path}\0${right.kind}`
      )
  );
  const realpaths = projectionCanonicalValues(
    [
      ...owners.flatMap((owner) => owner.realpaths),
      ...owners.flatMap((owner) =>
        [...owner.requestsBySource.values()].flatMap((requests) =>
          requests.flatMap((request) => request.frontier.realpaths)
        )
      ),
      ...semanticRequests.flatMap((request) => request.frontier.realpaths),
    ],
    (left, right) => compareCanonicalStrings(left.path, right.path)
  );
  const packageScopes: ReadonlyArray<IntlCheckPackageScopeV3> = expandedScopes
    .map((scope) => ({
      canonicalRoot: scope.canonicalRoot,
      control: projectionReference(
        expandedControls,
        scope.control,
        "V3 package scope control"
      ),
      lexicalRoot: scope.lexicalRoot,
      manifest: projectionReference(
        files,
        scope.manifest,
        "V3 package scope manifest"
      ),
      manifestLstat: projectionReference(
        lstats,
        scope.manifestLstat,
        "V3 package scope manifest lstat"
      ),
      manifestProbe: projectionReference(
        probes,
        scope.manifestProbe,
        "V3 package scope manifest probe"
      ),
      realpath: projectionReference(
        realpaths,
        scope.realpath,
        "V3 package scope realpath"
      ),
      rootLstat: projectionReference(
        lstats,
        scope.rootLstat,
        "V3 package scope root lstat"
      ),
    }))
    .toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.lexicalRoot}\0${left.canonicalRoot}`,
        `${right.lexicalRoot}\0${right.canonicalRoot}`
      )
    );
  markProfilePhase("identity-tables");

  const allRequests = owners.flatMap((owner) =>
    [...owner.requestsBySource.values()].flatMap((requests) => requests)
  );
  const expandedFrontiers = projectionCanonicalValues([
    ...allRequests.map((request) => request.frontier),
    ...semanticRequests.map((request) => request.frontier),
  ]);
  const projectedFrontierCache = new Map<string, IntlCheckPhysicalFrontierV3>();
  const projectedFrontierObjectCache = new WeakMap<
    ExpandedFrontierV3,
    IntlCheckPhysicalFrontierV3
  >();
  const projectFrontier = (
    frontier: ExpandedFrontierV3
  ): IntlCheckPhysicalFrontierV3 => {
    const objectCached = projectedFrontierObjectCache.get(frontier);
    if (objectCached) {
      return objectCached;
    }
    const identity = projectionCanonicalValueIdentity(
      expandedFrontiers,
      frontier
    );
    const cached = projectedFrontierCache.get(identity);
    if (cached) {
      projectedFrontierObjectCache.set(frontier, cached);
      return cached;
    }
    const binding = {
      control: projectionReference(
        expandedControls,
        frontier.control,
        "V3 frontier control"
      ),
      lstats: projectionReferences(
        lstats,
        frontier.lstats,
        "V3 frontier lstat"
      ),
      optionsHash: frontier.optionsHash,
      packageName: frontier.packageName,
      packageVersion: frontier.packageVersion,
      probes: projectionReferences(
        probes,
        frontier.probes,
        "V3 frontier probe"
      ),
      realpaths: projectionReferences(
        realpaths,
        frontier.realpaths,
        "V3 frontier realpath"
      ),
      resolutionMode: frontier.resolutionMode,
      resolvedFile:
        frontier.resolvedFile === null
          ? null
          : projectionReference(
              files,
              frontier.resolvedFile,
              "V3 frontier resolved file"
            ),
    };
    const result = {
      ...binding,
      frontierHash: sha256(
        canonicalJson([
          "mirai-intl",
          "projection-frontier-placeholder",
          3,
          binding,
        ])
      ),
    };
    projectedFrontierCache.set(identity, result);
    projectedFrontierObjectCache.set(frontier, result);
    return result;
  };
  const frontiers: ReadonlyArray<IntlCheckPhysicalFrontierV3> =
    projectionCanonicalValues(
      expandedFrontiers.map(projectFrontier),
      (left, right) =>
        compareCanonicalStrings(left.frontierHash, right.frontierHash)
    );
  markProfilePhase("physical-frontiers");
  const requestBinding = (
    request: ProjectionRequestBindingV3
  ): IntlCheckResolutionBindingV3 => ({
    boundary: projectionReference(
      boundaries,
      request.boundary,
      "V3 request boundary"
    ),
    frontier: projectionReference(
      frontiers,
      projectFrontier(request.frontier),
      "V3 request frontier"
    ),
    from: request.from,
    resolutionMode: request.resolutionMode,
    specifier: request.specifier,
  });
  const providerRequestBinding = (
    request: Readonly<{
      frontier: ExpandedFrontierV3;
      from: string;
      specifier: string;
    }>
  ): IntlCheckProviderResolutionV3 => ({
    frontier: projectionReference(
      frontiers,
      projectFrontier(request.frontier),
      "V3 provider request frontier"
    ),
    from: request.from,
    specifier: request.specifier,
  });

  const candidateIndexes = owners.map((owner) => {
    const facadeFile = projectionKnownFile(
      files,
      owner.projection,
      owner.projection.generatedFacadePath,
      `Classifier projection ${owner.index.owner}.generatedFacadePath`,
      owner.projection.generatedFacadeHash
    );
    const controlReference = projectionReference(
      expandedControls,
      owner.control,
      "V3 index control"
    );
    const lstatReferences = projectionReferences(
      lstats,
      owner.lstats,
      "V3 index lstat"
    );
    const probeReferences = projectionReferences(
      probes,
      owner.probes,
      "V3 index probe"
    );
    const realpathReferences = projectionReferences(
      realpaths,
      owner.realpaths,
      "V3 index realpath"
    );
    const scopeReferences = owner.packageScopes
      .map((scope) => {
        const reference = expandedScopes.findIndex(
          (candidate) =>
            candidate.lexicalRoot === scope.lexicalRoot &&
            candidate.canonicalRoot === scope.canonicalRoot
        );
        return reference < 0
          ? fail(
              "V3 index package scope",
              "is missing from its normalized V3 table"
            )
          : reference;
      })
      .toSorted((left, right) => left - right);
    return {
      analyzerAbi: owner.index.analyzerAbi,
      control: controlReference,
      facade: {
        canonicalRoot: projectionPortablePath(
          owner.projection,
          owner.index.canonicalRoot,
          "V3 facade canonicalRoot"
        ),
        control: controlReference,
        file: projectionReference(files, facadeFile, "V3 facade file"),
        lexicalRoot: projectionPortablePath(
          owner.projection,
          owner.index.lexicalRoot,
          "V3 facade lexicalRoot"
        ),
        lstats: lstatReferences,
        packageScopes: scopeReferences,
        probes: probeReferences,
        realpaths: realpathReferences,
      },
      indexHash: sha256("V3 candidate index placeholder"),
      lstats: lstatReferences,
      mode: owner.index.mode,
      optionsHash: owner.index.optionsHash,
      owner: projectionPortablePath(
        owner.projection,
        owner.projection.owner,
        "V3 index owner"
      ),
      packageScopes: scopeReferences,
      probes: probeReferences,
      projections: owner.index.projections.map((entry) => ({
        boundary: projectionReference(
          boundaries,
          owner.boundaryByReference.get(entry.boundary) ??
            fail("V3 candidate projection", "references an unknown boundary"),
          "V3 candidate projection boundary"
        ),
        canonicalRoot: projectionPortablePath(
          owner.projection,
          entry.canonicalRoot,
          "V3 candidate projection canonicalRoot"
        ),
        control: controlReference,
        lexicalRoot: projectionPortablePath(
          owner.projection,
          entry.lexicalRoot,
          "V3 candidate projection lexicalRoot"
        ),
        // Classifier V3 proves these families for the sealed owner index, not
        // for individual boundaries. Keep the exact union on the index/facade
        // and avoid copying the same large reference vectors into every
        // projection. Empty per-boundary vectors are the truthful projection.
        lstats: [],
        packageScopes: [],
        probes: [],
        proofKind: entry.proofKind,
        realpaths: [],
        status: entry.status,
      })),
      realpaths: realpathReferences,
      reasons: owner.index.reasons,
    } satisfies GeneratedFacadeCandidateIndexV3;
  });
  markProfilePhase("candidate-indexes");
  const ownerIndex = new Map(
    candidateIndexes.map((index, reference) => [index.owner, reference])
  );

  const classifierBindings: ReadonlyArray<IntlSourceClassifierBindingV3> =
    owners
      .flatMap((owner) =>
        [...owner.sourceByPath.entries()].map(([source, sourceEvidence]) => ({
          bindingHash: sha256("V3 classifier binding placeholder"),
          boundaries: projectionReferences(
            boundaries,
            sourceEvidence.boundaries.map((boundary) => ({
              kind: boundary.kind,
              observationOrdinal: boundary.observationOrdinal,
              ordinal: boundary.ordinal,
              resolutionMode: boundary.resolutionMode,
              source,
              specifier: boundary.specifier,
            })),
            "V3 classifier boundary"
          ),
          boundaryHash: sourceEvidence.boundaryHash,
          candidateIndex:
            ownerIndex.get(owner.index.owner) ??
            fail("V3 classifier binding", "has no candidate index"),
          candidateIndexHash: sha256("V3 classifier index placeholder"),
          decision: sourceEvidence.decision,
          mode: owner.index.mode,
          requests: selectedProjectionRequests(owner, source).map(
            requestBinding
          ),
          source,
          sourceHash: sourceEvidence.sourceHash,
          unknownBoundaries: projectionReferences(
            unknownBoundaries,
            sourceEvidence.unknownBoundaries.map((boundary, boundaryIndex) =>
              projectionUnknownBoundary(
                owner.projection,
                boundary,
                `V3 classifier unknown boundary ${source}[${boundaryIndex}]`
              )
            ),
            "V3 classifier unknown boundary"
          ),
        }))
      )
      .toSorted((left, right) =>
        compareCanonicalStrings(left.source, right.source)
      );
  markProfilePhase("classifier-bindings");

  const projectOwner = new Map(
    owners.map((owner) => [owner.index.owner, owner])
  );
  const projects: ReadonlyArray<IntlCheckProjectV3> = receiptV2.projects.map(
    (project) => ({
      configManifest: project.configManifest.map(
        ({ extends: extended, hash, path: configPath, references }) => ({
          // TypeScript applies array-valued `extends` left-to-right. Preserve
          // that semantic order; only references are set-like.
          extends: extended,
          file: projectionReference(
            files,
            { hash, path: configPath },
            "V3 project config"
          ),
          path: configPath,
          references: [...references].toSorted(compareCanonicalStrings),
        })
      ),
      configManifestHash: sha256("V3 project config placeholder"),
      normalizedOptions: project.normalizedOptions,
      normalizedOptionsHash: project.normalizedOptionsHash,
      path: project.path,
      resolverOptionsHash: project.normalizedOptionsHash,
      role: project.role,
      rootFiles: project.rootFiles,
    })
  );

  const providerClosures: ReadonlyArray<IntlCheckProviderClosureV3> =
    receiptV2.providerClosures.map((closure) => {
      const sourceLedger = receiptV2.sources.find(
        (source) => source.file === closure.source
      );
      const owner =
        sourceLedger === undefined
          ? undefined
          : projectOwner.get(sourceLedger.owner);
      if (sourceLedger === undefined || owner === undefined) {
        return fail(
          `V3 provider closure ${JSON.stringify(closure.source)}`,
          "has no exact owner projection"
        );
      }
      return {
        ambientTypeFileLimit: closure.ambientTypeFileLimit,
        closureHash: sha256("V3 closure placeholder"),
        declarationHash: closure.declarationHash,
        declarations: projectionReferences(
          files,
          closure.declarations,
          "V3 closure declaration"
        ),
        libHash: closure.libHash,
        libs: projectionReferences(files, closure.libs, "V3 closure lib"),
        providerBudgetExceeded: false,
        providerRootLimit: closure.providerRootLimit,
        providers: closure.providers.map((provider, providerIndex) => ({
          declarationHash: provider.declarationHash,
          declarations: projectionReferences(
            files,
            provider.declarations,
            "V3 provider declaration"
          ),
          hash: sha256("V3 provider placeholder"),
          kind: provider.kind,
          resolutions: provider.resolutions.map((resolution, resolutionIndex) =>
            providerRequestBinding(
              projectSemanticResolution(
                closure.source,
                resolution,
                `V3 provider ${providerIndex}.resolutions[${resolutionIndex}]`
              )
            )
          ),
          root: provider.root,
        })),
        source: closure.source,
      };
    });
  const sources: ReadonlyArray<IntlSourceLedgerEntryV3> = receiptV2.sources.map(
    (source) => ({
      classifierBindingHash: sha256("V3 source classifier placeholder"),
      file: source.file,
      hash: source.hash,
      owner: source.owner,
      providerClosureHash: sha256("V3 source provider placeholder"),
      verdict: source.verdict,
    })
  );
  markProfilePhase("receipt-projections");
  const raw: IntlCheckReceiptV3 = {
    application: {
      packageManifest: projectionReference(
        files,
        files.find(
          (file) =>
            file.path === receiptV2.application.packageManifest.path &&
            file.hash === receiptV2.application.packageManifest.hash
        ) ??
          fail(
            "V3 application package manifest",
            "has no normalized raw file identity"
          ),
        "V3 application package manifest"
      ),
      workspaceLockfile: projectionReference(
        files,
        files.find(
          (file) =>
            file.path === receiptV2.application.workspaceLockfile.path &&
            file.hash === receiptV2.application.workspaceLockfile.hash
        ) ??
          fail(
            "V3 application workspace lockfile",
            "has no normalized raw file identity"
          ),
        "V3 application lockfile"
      ),
    },
    artifactAbi: receiptV2.artifactAbi,
    candidateIndexes,
    classifierBindings,
    compilerManifest: projectionReferences(
      files,
      receiptV2.compilerManifest.map((file) =>
        projectionCompilerFile(files, file)
      ),
      "V3 compiler manifest"
    ),
    compilerManifestHash: receiptV2.compilerManifestHash,
    counters: {
      ...receiptV2.counters,
      boundaryIdentities: boundaries.length,
      classifierBoundaries: 0,
      classifierCandidateRequests: 0,
      classifierFacadeImports: 0,
      classifierFilteredRequests: 0,
      classifierFullResolverRequests: 0,
      classifierOwnerFallbacks: 0,
      classifierSourcesBound: 0,
      controlSets: controls.length,
      fileIdentities: files.length,
      lstatIdentities: lstats.length,
      lexicalFilesClassified: 0,
      packageScopeIdentities: packageScopes.length,
      physicalFrontiers: frontiers.length,
      probeIdentities: probes.length,
      realpathIdentities: realpaths.length,
      resolutionBindings: 0,
      unknownActiveSources: 0,
      unknownBoundaryIdentities: unknownBoundaries.length,
    },
    exceptions: receiptV2.exceptions,
    exceptionsHash: receiptV2.exceptionsHash,
    generationReceiptHash: receiptV2.generationReceiptHash,
    icu: receiptV2.icu,
    projects,
    providerClosures,
    runtimeAbi: receiptV2.runtimeAbi,
    schemaVersion: 3,
    sourceAuthorizationHash: sha256("V3 source authorization placeholder"),
    sources,
    tables: {
      boundaries,
      controls,
      files,
      frontiers,
      lstats,
      packageScopes,
      probes,
      realpaths,
      unknownBoundaries,
    },
    typescript: {
      libHash: receiptV2.typescript.libHash,
      libs: projectionReferences(
        files,
        receiptV2.typescript.libs,
        "V3 TypeScript lib"
      ),
      package: receiptV2.typescript.package,
    },
  };
  const result = buildIntlCheckReceiptV3ClassifierAuthorityBinding(
    raw,
    evidence.map(({ authority }) => authority),
    metrics,
    options,
    true
  );
  markProfilePhase("binding");
  if (process.env.MIRAI_INTL_INTERNAL_V3_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_V3_ASSEMBLY_PROFILE=${JSON.stringify({ phases: profilePhases, totalMilliseconds: performance.now() - profileStarted })}\n`
    );
  }
  return result;
}

/**
 * Validates the dormant M3-to-receipt handoff without selecting or publishing
 * V3 authority. Invalid classifier evidence is terminal and never downgraded.
 */
export function buildIntlCheckReceiptV3ClassifierAuthorityBinding(
  value: unknown,
  authorities: ReadonlyArray<MiraiIntlClassifierAuthorityV3>,
  metrics = createIntlCheckReceiptV3HashMetrics(),
  options: IntlCheckReceiptV3VerificationOptions = {},
  /** @internal Projection-ledger assembly already validated this exact pair. */
  projectionLedgerValidated = false
): IntlCheckReceiptV3ClassifierAuthorityBinding {
  const profileStarted = performance.now();
  let profilePrior = profileStarted;
  const profilePhases: Array<
    Readonly<{ milliseconds: number; phase: string }>
  > = [];
  const markProfilePhase = (phase: string): void => {
    if (process.env.MIRAI_INTL_INTERNAL_V3_PROFILE !== "1") {
      return;
    }
    const now = performance.now();
    profilePhases.push({ milliseconds: now - profilePrior, phase });
    profilePrior = now;
  };
  const receipt = projectionLedgerValidated
    ? buildNormalizedIntlCheckReceiptV3(
        value as IntlCheckReceiptV3,
        metrics,
        options,
        true
      )
    : buildIntlCheckReceiptV3(value, metrics, options);
  markProfilePhase("receipt-validation");
  if (authorities.length !== receipt.candidateIndexes.length) {
    fail(
      "Intl check receipt V3 classifierAuthorities",
      "must exactly cover normalized candidate indexes"
    );
  }
  const orderedAuthorities = [...authorities].toSorted((left, right) =>
    compareCanonicalStrings(
      text(record(left.indexBinding, "classifier authority").owner, "owner"),
      text(record(right.indexBinding, "classifier authority").owner, "owner")
    )
  );
  sortedUnique(
    orderedAuthorities,
    (authority) =>
      text(
        record(authority.indexBinding, "classifier authority").owner,
        "owner"
      ),
    "Intl check receipt V3 classifierAuthorities"
  );
  if (!projectionLedgerValidated) {
    orderedAuthorities.forEach((authority, index) =>
      validateClassifierAuthorityReceiptBinding(receipt, authority, index)
    );
  }
  markProfilePhase("live-authority-validation");
  const receiptBytes = canonicalIntlCheckReceiptV3Bytes(receipt, metrics);
  const receiptHash = sha256(receiptBytes);
  markProfilePhase("receipt-bytes");
  const persistedAuthorities = orderedAuthorities.map((authority) => {
    const owner = text(
      record(authority.indexBinding, "classifier authority indexBinding").owner,
      "classifier authority owner"
    );
    return persistedClassifierAuthority(receipt, owner, metrics);
  });
  const authorityHashes = persistedAuthorities.map(
    ({
      artifactHash,
      checkpointAHash,
      indexHash,
      optimizedRequiresProgramVectorHash,
      referenceRequiresProgramVectorHash,
    }) => ({
      artifactHash,
      checkpointAHash,
      indexHash,
      optimizedRequiresProgramVectorHash,
      referenceRequiresProgramVectorHash,
    })
  );
  const authorityEnvelope = buildMiraiIntlClassifierAuthorityEnvelopeV3({
    authorities: persistedAuthorities,
    receiptHash,
    sourceAuthorizationHash: receipt.sourceAuthorizationHash,
  });
  const authorityBytes =
    canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(authorityEnvelope);
  const authorityHash =
    hashMiraiIntlClassifierAuthorityEnvelopeV3(authorityEnvelope);
  markProfilePhase("persisted-authority-envelope");
  const projectionEvidenceBindings = persistedAuthorities.map((authority) => {
    const { owner } = authority;
    const receiptIndex = receipt.candidateIndexes.find(
      (index) => index.owner === owner
    );
    if (receiptIndex === undefined) {
      return fail(
        "Intl check receipt V3 classifierAuthorities",
        "cannot bind projection evidence without its normalized index"
      );
    }
    return {
      authorityIndexHash: authority.indexHash,
      owner,
      receiptIndexHash: receiptIndex.indexHash,
    };
  });
  const result = trustClassifierAuthorityBindingV3(
    deepFreeze({
      authorityBytes,
      authorityHash,
      authorityHashes,
      inputIdentityHash: hashIntlCheckReceiptV3(
        "classifier-authority-receipt-input",
        {
          authorityHash,
          authorityResultHashes: authorityEnvelope.authorities.map(
            (authority) => authority.resultHash
          ),
          projectionEvidenceBindings,
          receiptHash,
          sourceAuthorizationHash: receipt.sourceAuthorizationHash,
        },
        metrics
      ),
      receipt,
      receiptBytes,
      receiptHash,
    })
  );
  markProfilePhase("binding-hash-and-freeze");
  if (process.env.MIRAI_INTL_INTERNAL_V3_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_V3_PROFILE=${JSON.stringify({ phases: profilePhases, totalMilliseconds: performance.now() - profileStarted })}\n`
    );
  }
  return result;
}

/**
 * Revalidates a persisted, path-portable classifier envelope exclusively from
 * its normalized V3 receipt. Raw live authority bindings are never required or
 * reconstructed on the read path.
 */
export function buildIntlCheckReceiptV3PersistedAuthorityBinding(
  value: unknown,
  envelopeValue: MiraiIntlClassifierAuthorityEnvelopeV3,
  metrics = createIntlCheckReceiptV3HashMetrics(),
  options: IntlCheckReceiptV3VerificationOptions = {}
): IntlCheckReceiptV3ClassifierAuthorityBinding {
  const receipt = buildIntlCheckReceiptV3(value, metrics, options);
  const receiptBytes = canonicalIntlCheckReceiptV3Bytes(receipt, metrics);
  const receiptHash = sha256(receiptBytes);
  const expectedAuthorities = receipt.candidateIndexes
    .map(({ owner }) => persistedClassifierAuthority(receipt, owner, metrics))
    .toSorted((left, right) =>
      compareCanonicalStrings(left.owner, right.owner)
    );
  const expectedEnvelope = buildMiraiIntlClassifierAuthorityEnvelopeV3({
    authorities: expectedAuthorities,
    receiptHash,
    sourceAuthorizationHash: receipt.sourceAuthorizationHash,
  });
  const authorityBytes =
    canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(envelopeValue);
  const expectedBytes =
    canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(expectedEnvelope);
  if (authorityBytes !== expectedBytes) {
    fail(
      "Intl check receipt V3 persisted classifier authority",
      "does not exactly bind the normalized receipt"
    );
  }
  const authorityHash =
    hashMiraiIntlClassifierAuthorityEnvelopeV3(expectedEnvelope);
  const authorityHashes = expectedAuthorities.map(
    ({
      artifactHash,
      checkpointAHash,
      indexHash,
      optimizedRequiresProgramVectorHash,
      referenceRequiresProgramVectorHash,
    }) => ({
      artifactHash,
      checkpointAHash,
      indexHash,
      optimizedRequiresProgramVectorHash,
      referenceRequiresProgramVectorHash,
    })
  );
  const projectionEvidenceBindings = expectedAuthorities.map((authority) => ({
    authorityIndexHash: authority.indexHash,
    owner: authority.owner,
    receiptIndexHash:
      receipt.candidateIndexes.find((index) => index.owner === authority.owner)
        ?.indexHash ??
      fail(
        "Intl check receipt V3 persisted classifier authority",
        "has no normalized candidate index"
      ),
  }));
  return trustClassifierAuthorityBindingV3(
    deepFreeze({
      authorityBytes,
      authorityHash,
      authorityHashes,
      inputIdentityHash: hashIntlCheckReceiptV3(
        "classifier-authority-receipt-input",
        {
          authorityHash,
          authorityResultHashes: expectedAuthorities.map(
            ({ resultHash }) => resultHash
          ),
          projectionEvidenceBindings,
          receiptHash,
          sourceAuthorizationHash: receipt.sourceAuthorizationHash,
        },
        metrics
      ),
      receipt,
      receiptBytes,
      receiptHash,
    })
  );
}

/**
 * Completes every V3 named hash for an already normalized structural receipt.
 * This is intentionally additive and does not select or publish a V3 receipt.
 */
export function buildIntlCheckReceiptV3(
  value: unknown,
  metrics = createIntlCheckReceiptV3HashMetrics(),
  options: IntlCheckReceiptV3VerificationOptions = {}
): IntlCheckReceiptV3 {
  const parsed = parseV3Structure(value);
  return buildNormalizedIntlCheckReceiptV3(parsed, metrics, options);
}

function buildNormalizedIntlCheckReceiptV3(
  parsed: IntlCheckReceiptV3,
  metrics: IntlCheckReceiptV3HashMetrics,
  options: IntlCheckReceiptV3VerificationOptions,
  projectionLedgerValidated = false
): IntlCheckReceiptV3 {
  const profile = process.env.MIRAI_INTL_INTERNAL_V3_PROFILE === "1";
  const started = performance.now();
  let prior = started;
  const phases: Array<Readonly<{ milliseconds: number; phase: string }>> = [];
  const mark = (phase: string): void => {
    if (!profile) {
      return;
    }
    const now = performance.now();
    phases.push({ milliseconds: now - prior, phase });
    prior = now;
  };
  const withCounters = {
    ...parsed,
    counters: expectedCountersV3(parsed),
  };
  mark("counters");
  const receipt = deepFreeze(computedV3Hashes(withCounters, metrics));
  mark("hashes-and-freeze");
  if (!projectionLedgerValidated) {
    validateV3Relationships(receipt, v3ExpansionContext(metrics), options);
  }
  mark("relationships");
  trustedReceiptsV3.add(receipt);
  if (profile) {
    process.stderr.write(
      `MIRAI_INTL_V3_NORMALIZE_PROFILE=${JSON.stringify({ phases, totalMilliseconds: performance.now() - started })}\n`
    );
  }
  return receipt;
}

export function parseIntlCheckReceiptV3(
  value: unknown,
  metrics = createIntlCheckReceiptV3HashMetrics(),
  options: IntlCheckReceiptV3VerificationOptions = {}
): IntlCheckReceiptV3 {
  const receipt = parseV3Structure(value);
  const recomputed = computedV3Hashes(receipt, metrics);
  assertV3NamedHashes(receipt, recomputed);
  validateV3Relationships(receipt, v3ExpansionContext(metrics), options);
  const immutable = deepFreeze(receipt);
  trustedReceiptsV3.add(immutable);
  return immutable;
}

export function parseIntlCheckReceipt(value: unknown): IntlCheckReceipt {
  const candidate = record(value, "Intl check receipt");
  const schemaVersion = Reflect.get(candidate, "schemaVersion");
  if (schemaVersion === 2) {
    return parseIntlCheckReceiptV2(value);
  }
  if (schemaVersion === 3) {
    return parseIntlCheckReceiptV3(value);
  }
  if (schemaVersion === 1) {
    fail(
      "Intl check receipt schemaVersion 1",
      "is unsupported; run fresh authorization to create a current receipt"
    );
  }
  return fail(
    "Intl check receipt schemaVersion",
    `${JSON.stringify(schemaVersion)} is unsupported; expected 2 or 3`
  );
}

export function canonicalIntlCheckReceiptV3Bytes(
  value: IntlCheckReceiptV3,
  metrics = createIntlCheckReceiptV3HashMetrics()
): string {
  const receipt = trustedReceiptsV3.has(value)
    ? value
    : parseIntlCheckReceiptV3(value, metrics);
  return `${canonicalJson(receipt)}\n`;
}

export function parseCanonicalIntlCheckReceiptV3(
  source: string,
  metrics = createIntlCheckReceiptV3HashMetrics(),
  options: IntlCheckReceiptV3VerificationOptions = {}
): IntlCheckReceiptV3 {
  const parsed = parseIntlCheckReceiptV3(
    JSON.parse(source) as unknown,
    metrics,
    options
  );
  if (source !== canonicalIntlCheckReceiptV3Bytes(parsed, metrics)) {
    fail("Intl check receipt V3", "must use canonical JSON bytes");
  }
  return parsed;
}

export function parseCanonicalIntlCheckReceipt(
  source: string
): IntlCheckReceipt {
  const value = JSON.parse(source) as unknown;
  const candidate = record(value, "Intl check receipt");
  if (candidate.schemaVersion === 2) {
    return parseCanonicalIntlCheckReceiptV2(source);
  }
  if (candidate.schemaVersion === 3) {
    return parseCanonicalIntlCheckReceiptV3(source);
  }
  return parseIntlCheckReceipt(value);
}

/**
 * Fully expands normalized V3 references for size/complexity qualification.
 * It is diagnostic-only and is not a receipt or publication format.
 */
export function expandedIntlCheckReceiptV3(
  value: IntlCheckReceiptV3
): Readonly<Record<string, unknown>> {
  const receipt = trustedReceiptsV3.has(value)
    ? value
    : parseIntlCheckReceiptV3(value);
  const context = v3ExpansionContext();
  return {
    application: {
      packageManifest:
        receipt.tables.files[receipt.application.packageManifest],
      workspaceLockfile:
        receipt.tables.files[receipt.application.workspaceLockfile],
    },
    artifactAbi: receipt.artifactAbi,
    candidateIndexes: receipt.candidateIndexes.map((index) => ({
      ...expandIndex(index, receipt.tables, context),
      indexHash: index.indexHash,
    })),
    classifierBindings: receipt.classifierBindings.map((binding) => ({
      bindingHash: binding.bindingHash,
      boundaries: binding.boundaries.map(
        (entry) => receipt.tables.boundaries[entry]
      ),
      boundaryHash: binding.boundaryHash,
      candidateIndex: expandIndex(
        receipt.candidateIndexes[
          binding.candidateIndex
        ] as GeneratedFacadeCandidateIndexV3,
        receipt.tables,
        context
      ),
      candidateIndexHash: binding.candidateIndexHash,
      decision: binding.decision,
      mode: binding.mode,
      requests: binding.requests.map((request) =>
        expandResolutionBinding(request, receipt.tables, context)
      ),
      source: binding.source,
      sourceHash: binding.sourceHash,
      unknownBoundaries: binding.unknownBoundaries.map(
        (entry) => receipt.tables.unknownBoundaries[entry]
      ),
    })),
    compilerManifest: receipt.compilerManifest.map(
      (entry) => receipt.tables.files[entry]
    ),
    compilerManifestHash: receipt.compilerManifestHash,
    counters: receipt.counters,
    exceptions: receipt.exceptions,
    exceptionsHash: receipt.exceptionsHash,
    generationReceiptHash: receipt.generationReceiptHash,
    icu: receipt.icu,
    projects: receipt.projects.map((project) => ({
      ...project,
      configManifest: project.configManifest.map((entry) => ({
        ...entry,
        file: receipt.tables.files[entry.file],
      })),
    })),
    providerClosures: receipt.providerClosures.map((closure) => ({
      ...expandClosure(closure, receipt.tables, context),
      closureHash: closure.closureHash,
    })),
    runtimeAbi: receipt.runtimeAbi,
    schemaVersion: receipt.schemaVersion,
    sourceAuthorizationHash: receipt.sourceAuthorizationHash,
    sources: receipt.sources,
    typescript: {
      ...receipt.typescript,
      libs: receipt.typescript.libs.map((entry) => receipt.tables.files[entry]),
    },
  };
}

export function canonicalExpandedIntlCheckReceiptV3Bytes(
  value: IntlCheckReceiptV3
): string {
  return `${canonicalJson(expandedIntlCheckReceiptV3(value))}\n`;
}
