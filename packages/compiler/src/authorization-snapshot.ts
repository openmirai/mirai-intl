import type {
  IntlCheckApplicationIdentityV2,
  IntlBuildVerificationCountersV2,
  IntlCheckCanonicalJsonV2,
  IntlCheckExceptionV1,
  IntlCheckFileIdentityV2,
  IntlCheckPackageIdentityV2,
  IntlCheckProjectV2,
  IntlCheckProviderClosureV2,
  IntlCheckProviderKindV2,
  IntlCheckProviderResolutionV2,
  IntlCheckProviderV2,
  IntlCheckReceiptCountersV2,
  IntlCheckReceiptV2,
  IntlCheckTsconfigFileV2,
  IntlCheckTypeScriptIdentityV2,
  IntlSourceLedgerEntryV2,
  IntlSemanticAuthorizationObservationV2,
  RuntimeAbi,
  Sha256,
} from "@openmirai/intl-abi";

import {
  canonicalHash,
  canonicalJson,
  compareCanonicalStrings,
} from "./canonical";

const SHA256_PATTERN = /^sha256:[\da-f]{64}$/u;
const WINDOWS_ROOT_PATTERN = /^[A-Za-z]:\//u;
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
  const actual = Object.keys(object).toSorted(compareCanonicalStrings);
  const expected = [...keys].toSorted(compareCanonicalStrings);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
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
  index: number
): IntlCheckProjectV2 {
  const configManifest = sortBy(
    input.configManifest.map((entry, entryIndex) =>
      parseTsconfig(
        {
          ...entry,
        },
        `Project ${index}.configManifest[${entryIndex}]`,
        true
      )
    ),
    (entry) => entry.path
  );
  const rootFiles = sortBy(
    input.rootFiles.map((entry, entryIndex) =>
      path(entry, `Project ${index}.rootFiles[${entryIndex}]`, true)
    ),
    (entry) => entry
  );
  const normalizedOptions = parseJsonRecord(
    input.normalizedOptions,
    `Project ${index}.normalizedOptions`
  );
  return parseProject(
    {
      configManifest,
      configManifestHash: canonicalHash(configManifest),
      normalizedOptions,
      normalizedOptionsHash: canonicalHash(normalizedOptions),
      path: path(input.path, `Project ${index}.path`, true),
      role: input.role,
      rootFiles,
    },
    `Project ${index}`
  );
}

function canonicalProvider(
  input: ProviderInput,
  context: string
): IntlCheckProviderV2 {
  const declarations = sortBy(
    input.declarations.map((entry, index) =>
      parseFile(entry, `${context}.declarations[${index}]`, true)
    ),
    (entry) => entry.path
  );
  const resolutions = sortBy(
    input.resolutions.map((resolution, resolutionIndex) =>
      parseProviderResolution(
        {
          ...resolution,
          controlFiles: sortBy(
            resolution.controlFiles.map((entry, controlIndex) =>
              parseFile(
                entry,
                `${context}.resolutions[${resolutionIndex}].controlFiles[${controlIndex}]`,
                true
              )
            ),
            (entry) => entry.path
          ),
          probes: sortBy(
            resolution.probes,
            (probe) => `${probe.path}\u0000${probe.kind}`
          ),
          realpaths: sortBy(resolution.realpaths, (entry) => entry.path),
        },
        `${context}.resolutions[${resolutionIndex}]`,
        true
      )
    ),
    (resolution) => `${resolution.from}\u0000${resolution.specifier}`
  );
  const base = {
    declarationHash: canonicalHash(declarations),
    declarations,
    kind: input.kind,
    resolutions,
    root: path(input.root, `${context}.root`, true),
  };
  return parseProvider({ ...base, hash: canonicalHash(base) }, context);
}

function canonicalClosure(
  input: ProviderClosureInput,
  index: number
): IntlCheckProviderClosureV2 {
  const context = `Provider closure ${index}`;
  const declarations = sortBy(
    input.declarations.map((entry, entryIndex) =>
      parseFile(entry, `${context}.declarations[${entryIndex}]`, true)
    ),
    (entry) => entry.path
  );
  const libs = sortBy(
    input.libs.map((entry, entryIndex) =>
      parseFile(entry, `${context}.libs[${entryIndex}]`, true)
    ),
    (entry) => entry.path
  );
  const providers = sortBy(
    input.providers.map((provider, providerIndex) =>
      canonicalProvider(provider, `${context}.providers[${providerIndex}]`)
    ),
    providerIdentity
  );
  const base = {
    ambientTypeFileLimit: input.ambientTypeFileLimit,
    declarationHash: canonicalHash(declarations),
    declarations,
    libHash: canonicalHash(libs),
    libs,
    providerBudgetExceeded: input.providerBudgetExceeded,
    providerRootLimit: input.providerRootLimit,
    providers,
    source: path(input.source, `${context}.source`, true),
  };
  return parseClosure({ ...base, closureHash: canonicalHash(base) }, context);
}

export function buildSourceAuthorizationSnapshot(
  input: SourceAuthorizationSnapshotInput
): SourceAuthorizationSnapshot {
  const compilerManifest = sortBy(
    input.compilerManifest.map((entry, index) =>
      parseFile(entry, `Compiler manifest ${index}`, true)
    ),
    (entry) => entry.path
  );
  const projects = sortBy(
    input.projects.map(canonicalProject),
    projectInputIdentity
  );
  const providerClosures = sortBy(
    input.providerClosures.map(canonicalClosure),
    (closure) => closure.source
  );
  const closureBySource = new Map(
    providerClosures.map((closure) => [closure.source, closure])
  );
  const sources = sortBy(
    input.sources.map((source, index) => {
      const file = path(source.file, `Source ${index}.file`, true);
      const closure = closureBySource.get(file);
      if (!closure) {
        fail(`Source ${JSON.stringify(file)}`, "has no provider closure");
      }
      return parseSource(
        {
          ...source,
          file,
          owner: path(source.owner, `Source ${index}.owner`, true),
          providerClosureHash: closure.closureHash,
        },
        `Source ${index}`
      );
    }),
    (source) => source.file
  );
  const exceptions = sortBy(
    input.exceptions.map((entry, index) =>
      parseException(entry, `Exception ${index}`, true)
    ),
    exceptionIdentity
  );
  const typescript: IntlCheckTypeScriptIdentityV2 = {
    libs: sortBy(
      input.typescript.libs.map((entry, index) =>
        parseFile(entry, `TypeScript lib ${index}`, true)
      ),
      (entry) => entry.path
    ),
    package: parsePackage(input.typescript.package, "TypeScript package"),
    libHash: canonicalHash(
      sortBy(
        input.typescript.libs.map((entry, index) =>
          parseFile(entry, `TypeScript lib ${index}`, true)
        ),
        (entry) => entry.path
      )
    ),
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
    compilerManifestHash: canonicalHash(compilerManifest),
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
    exceptionsHash: canonicalHash(exceptions),
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
  return parseSourceAuthorizationSnapshot(snapshot);
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
  snapshotValue: SourceAuthorizationSnapshot
): IntlCheckReceiptV2 {
  const snapshot = parseSourceAuthorizationSnapshot(snapshotValue);
  const base = receiptBase(snapshot);
  return {
    ...base,
    // Deliberately excluded from its own preimage.
    sourceAuthorizationHash: canonicalHash(base),
  };
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
  value: IntlCheckReceiptV2
): string {
  return `${canonicalJson(parseIntlCheckReceiptV2(value))}\n`;
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
