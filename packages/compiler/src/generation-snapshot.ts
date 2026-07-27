import type {
  IntlCheckCanonicalJsonV2,
  RuntimeAbi,
  Sha256,
} from "@openmirai/intl-abi";

import {
  canonicalHash,
  canonicalJson,
  compareCanonicalStrings,
  sha256,
} from "./canonical";
import type {
  ApplicationPackageIdentity,
  CompilerImplementationIdentity,
  IntegrityManifest,
  ResolvedPackageIdentity,
} from "./integrity-identity";

const SHA256_PATTERN = /^sha256:[\da-f]{64}$/u;
const WINDOWS_ROOT_PATTERN = /^[A-Za-z]:\//u;
const RECEIPT_PATH = "catalog-generation-receipt.v1.json";

export const CATALOG_PUBLICATION_STATES = [
  "PREPARED",
  "STAGED_DURABLE",
  "PAYLOAD_INSTALLED",
  "SELECTORS_INSTALLED",
  "RECEIPT_INSTALLED",
  "POINTER_COMMITTED",
  "VALIDATED",
] as const;

export type CatalogPublicationState =
  (typeof CATALOG_PUBLICATION_STATES)[number];

export type CatalogPayloadManifestEntryV1 = Readonly<{
  hash: Sha256;
  mode: number | null;
  path: string;
  size: number;
}>;

export type CatalogPayloadManifestV1 = Readonly<{
  entries: ReadonlyArray<CatalogPayloadManifestEntryV1>;
  hash: Sha256;
  schemaVersion: 1;
}>;

export type CatalogGenerationInputIdentityV1 = Readonly<{
  application: ApplicationPackageIdentity;
  artifactAbi: string;
  compiler: CompilerImplementationIdentity;
  config: IntegrityManifest;
  environment: Readonly<Record<string, IntlCheckCanonicalJsonV2>>;
  environmentHash: Sha256;
  generationOptions: Readonly<Record<string, IntlCheckCanonicalJsonV2>>;
  generationOptionsHash: Sha256;
  icu: ResolvedPackageIdentity;
  locales: IntegrityManifest;
  runtimeAbi: RuntimeAbi;
  schemaVersion: 1;
}>;

export type CatalogCurrentPointerBaseV2 = Readonly<{
  contentHash: Sha256;
  directory: string;
  schemaVersion: 2;
}>;

export type CatalogCurrentPointerV2 = CatalogCurrentPointerBaseV2 &
  Readonly<{
    generationReceiptHash: Sha256;
  }>;

export type CatalogGenerationReceiptV1 = Readonly<{
  abi: Readonly<{
    artifactAbi: string;
    runtimeAbi: RuntimeAbi;
  }>;
  catalogLockHash: Sha256;
  compilerHash: Sha256;
  generationInputHash: Sha256;
  icuHash: Sha256;
  payload: Readonly<{
    contentHash: Sha256;
    directory: string;
    manifest: CatalogPayloadManifestV1;
    manifestHash: Sha256;
  }>;
  pointerBase: CatalogCurrentPointerBaseV2;
  schemaVersion: 1;
  selectorBase: CatalogCurrentPointerBaseV2;
  selectorBaseHash: Sha256;
  stableFacadeHash: Sha256;
}>;

export type CatalogGenerationSnapshot = Readonly<{
  catalogLockHash: Sha256;
  generationInput: CatalogGenerationInputIdentityV1;
  generationInputHash: Sha256;
  generationReceipt: CatalogGenerationReceiptV1;
  generationReceiptHash: Sha256;
  payload: Readonly<{
    contentHash: Sha256;
    directory: string;
    manifest: CatalogPayloadManifestV1;
  }>;
  pointer: CatalogCurrentPointerV2;
  schemaVersion: 1;
  selectorBase: CatalogCurrentPointerBaseV2;
  stableFacadeHash: Sha256;
}>;

export type CatalogGenerationSnapshotInput = Readonly<{
  catalogLockHash: Sha256;
  generationInput: CatalogGenerationInputIdentityV1;
  payloadContentHash: Sha256;
  payloadDirectory: string;
  payloadEntries: ReadonlyArray<CatalogPayloadManifestEntryV1>;
  stableFacadeHash: Sha256;
}>;

export type CatalogPublicationJournalV1 = Readonly<{
  expectedPublicationHash: Sha256;
  ownerToken: string;
  previousDirectory: string | null;
  schemaVersion: 1;
  stageDirectory: string;
  state: CatalogPublicationState;
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

function string(value: unknown, context: string): string {
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
  const result = string(value, context);
  if (!SHA256_PATTERN.test(result)) {
    return fail(context, "must be a canonical SHA-256 identity");
  }
  return result as Sha256;
}

function integer(value: unknown, context: string, minimum = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    return fail(context, `must be a safe integer >= ${minimum}`);
  }
  return value;
}

function canonicalPath(value: unknown, context: string): string {
  const path = string(value, context).replaceAll("\\", "/");
  if (
    path.startsWith("/") ||
    WINDOWS_ROOT_PATTERN.test(path) ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return fail(context, "must be a confined canonical relative path");
  }
  return path;
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

function parseIntegrityManifest(
  value: unknown,
  context: string
): IntegrityManifest {
  const object = exact(value, ["entries", "hash"], context);
  if (!Array.isArray(object.entries)) {
    return fail(`${context}.entries`, "must be an array");
  }
  const entries = object.entries.map((entry, index) => {
    const item = exact(
      entry,
      ["hash", "path", "size"],
      `${context}.entries[${index}]`
    );
    return {
      hash: sha(item.hash, `${context}.entries[${index}].hash`),
      path: canonicalPath(item.path, `${context}.entries[${index}].path`),
      size: integer(item.size, `${context}.entries[${index}].size`),
    };
  });
  sortedUnique(entries, (entry) => entry.path, `${context}.entries`);
  const hash = sha(object.hash, `${context}.hash`);
  if (hash !== canonicalHash(entries)) {
    fail(`${context}.hash`, "does not bind entries");
  }
  return { entries, hash };
}

function parseApplication(
  value: unknown,
  context: string
): ApplicationPackageIdentity {
  const candidate = record(value, context);
  const hasLock = Object.hasOwn(candidate, "lock");
  const object = exact(
    candidate,
    hasLock ? ["hash", "lock", "packageJsonHash"] : ["hash", "packageJsonHash"],
    context
  );
  const packageJsonHash = sha(
    object.packageJsonHash,
    `${context}.packageJsonHash`
  );
  let lock: ApplicationPackageIdentity["lock"];
  if (!hasLock) {
    lock = undefined;
  } else {
    const lockObject = exact(object.lock, ["hash", "name"], `${context}.lock`);
    lock = {
      hash: sha(lockObject.hash, `${context}.lock.hash`),
      name: canonicalPath(lockObject.name, `${context}.lock.name`),
    };
  }
  const hash = sha(object.hash, `${context}.hash`);
  const inputs =
    lock === undefined ? { packageJsonHash } : { lock, packageJsonHash };
  if (hash !== canonicalHash(inputs)) {
    fail(`${context}.hash`, "does not bind application inputs");
  }
  return { ...inputs, hash };
}

function parseCompiler(
  value: unknown,
  context: string
): CompilerImplementationIdentity {
  const object = exact(value, ["hash", "modules"], context);
  const modules = parseIntegrityManifest(object.modules, `${context}.modules`);
  const hash = sha(object.hash, `${context}.hash`);
  if (hash !== canonicalHash({ modulesHash: modules.hash })) {
    fail(`${context}.hash`, "does not bind compiler modules");
  }
  return { hash, modules };
}

function parsePackage(
  value: unknown,
  context: string
): ResolvedPackageIdentity {
  const object = exact(
    value,
    ["entry", "hash", "name", "packageFiles", "packageJsonHash", "version"],
    context
  );
  const entryObject = exact(
    object.entry,
    ["hash", "path", "size"],
    `${context}.entry`
  );
  const entry = {
    hash: sha(entryObject.hash, `${context}.entry.hash`),
    path: canonicalPath(entryObject.path, `${context}.entry.path`),
    size: integer(entryObject.size, `${context}.entry.size`),
  };
  const packageFiles = parseIntegrityManifest(
    object.packageFiles,
    `${context}.packageFiles`
  );
  const base = {
    entry,
    name: string(object.name, `${context}.name`),
    packageFiles,
    packageJsonHash: sha(object.packageJsonHash, `${context}.packageJsonHash`),
    version: string(object.version, `${context}.version`),
  };
  const hash = sha(object.hash, `${context}.hash`);
  if (hash !== canonicalHash(base)) {
    fail(`${context}.hash`, "does not bind package identity");
  }
  return { ...base, hash };
}

function canonicalJsonRecord(
  value: unknown,
  context: string
): Readonly<Record<string, IntlCheckCanonicalJsonV2>> {
  const object = record(value, context);
  canonicalJson(object);
  return object as Readonly<Record<string, IntlCheckCanonicalJsonV2>>;
}

export function parseCatalogGenerationInputIdentity(
  value: unknown
): CatalogGenerationInputIdentityV1 {
  const context = "Catalog generation input";
  const object = exact(
    value,
    [
      "application",
      "artifactAbi",
      "compiler",
      "config",
      "environment",
      "environmentHash",
      "generationOptions",
      "generationOptionsHash",
      "icu",
      "locales",
      "runtimeAbi",
      "schemaVersion",
    ],
    context
  );
  if (object.schemaVersion !== 1) {
    fail(`${context}.schemaVersion`, "must equal 1");
  }
  const environment = canonicalJsonRecord(
    object.environment,
    `${context}.environment`
  );
  const environmentHash = sha(
    object.environmentHash,
    `${context}.environmentHash`
  );
  if (environmentHash !== canonicalHash(environment)) {
    fail(`${context}.environmentHash`, "does not bind environment");
  }
  const generationOptions = canonicalJsonRecord(
    object.generationOptions,
    `${context}.generationOptions`
  );
  const generationOptionsHash = sha(
    object.generationOptionsHash,
    `${context}.generationOptionsHash`
  );
  if (generationOptionsHash !== canonicalHash(generationOptions)) {
    fail(
      `${context}.generationOptionsHash`,
      "does not bind generation options"
    );
  }
  return {
    application: parseApplication(object.application, `${context}.application`),
    artifactAbi: string(object.artifactAbi, `${context}.artifactAbi`),
    compiler: parseCompiler(object.compiler, `${context}.compiler`),
    config: parseIntegrityManifest(object.config, `${context}.config`),
    environment,
    environmentHash,
    generationOptions,
    generationOptionsHash,
    icu: parsePackage(object.icu, `${context}.icu`),
    locales: parseIntegrityManifest(object.locales, `${context}.locales`),
    runtimeAbi: string(
      object.runtimeAbi,
      `${context}.runtimeAbi`
    ) as RuntimeAbi,
    schemaVersion: 1,
  };
}

export function buildCatalogGenerationInputIdentity(
  input: Omit<
    CatalogGenerationInputIdentityV1,
    "environmentHash" | "generationOptionsHash" | "schemaVersion"
  >
): CatalogGenerationInputIdentityV1 {
  return parseCatalogGenerationInputIdentity({
    ...input,
    environmentHash: canonicalHash(input.environment),
    generationOptionsHash: canonicalHash(input.generationOptions),
    schemaVersion: 1,
  });
}

export function buildCatalogPayloadManifest(
  entries: ReadonlyArray<CatalogPayloadManifestEntryV1>
): CatalogPayloadManifestV1 {
  const normalized = entries
    .map((entry, index) => {
      const path = canonicalPath(
        entry.path.normalize("NFC"),
        `Payload entry ${index}.path`
      );
      if (path === RECEIPT_PATH) {
        fail("Payload manifest", "must exclude the generation receipt");
      }
      return {
        hash: sha(entry.hash, `Payload entry ${index}.hash`),
        mode:
          entry.mode === null
            ? null
            : integer(entry.mode, `Payload entry ${index}.mode`),
        path,
        size: integer(entry.size, `Payload entry ${index}.size`),
      };
    })
    .toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
  sortedUnique(normalized, (entry) => entry.path, "Payload manifest entries");
  return {
    entries: normalized,
    hash: canonicalHash(normalized),
    schemaVersion: 1,
  };
}

function parsePayloadManifest(value: unknown): CatalogPayloadManifestV1 {
  const object = exact(
    value,
    ["entries", "hash", "schemaVersion"],
    "Payload manifest"
  );
  if (object.schemaVersion !== 1 || !Array.isArray(object.entries)) {
    fail("Payload manifest", "has an invalid schema or entries");
  }
  const entries = object.entries.map((entry, index) => {
    const item = exact(
      entry,
      ["hash", "mode", "path", "size"],
      `Payload manifest entry ${index}`
    );
    const path = canonicalPath(
      item.path,
      `Payload manifest entry ${index}.path`
    );
    if (path === RECEIPT_PATH) {
      fail("Payload manifest", "must exclude the generation receipt");
    }
    return {
      hash: sha(item.hash, `Payload manifest entry ${index}.hash`),
      mode:
        item.mode === null
          ? null
          : integer(item.mode, `Payload manifest entry ${index}.mode`),
      path,
      size: integer(item.size, `Payload manifest entry ${index}.size`),
    };
  });
  sortedUnique(entries, (entry) => entry.path, "Payload manifest entries");
  const hash = sha(object.hash, "Payload manifest hash");
  if (hash !== canonicalHash(entries)) {
    fail("Payload manifest hash", "does not bind entries");
  }
  return { entries, hash, schemaVersion: 1 };
}

function parsePointerBase(
  value: unknown,
  context: string
): CatalogCurrentPointerBaseV2 {
  const object = exact(
    value,
    ["contentHash", "directory", "schemaVersion"],
    context
  );
  const contentHash = sha(object.contentHash, `${context}.contentHash`);
  const directory = canonicalPath(object.directory, `${context}.directory`);
  if (
    object.schemaVersion !== 2 ||
    directory !== `builds/${contentHash.slice("sha256:".length)}`
  ) {
    fail(context, "does not identify its content-addressed payload");
  }
  return { contentHash, directory, schemaVersion: 2 };
}

export function parseCatalogCurrentPointer(
  value: unknown
): CatalogCurrentPointerV2 {
  const object = exact(
    value,
    ["contentHash", "directory", "generationReceiptHash", "schemaVersion"],
    "Catalog current pointer"
  );
  const base = parsePointerBase(
    {
      contentHash: object.contentHash,
      directory: object.directory,
      schemaVersion: object.schemaVersion,
    },
    "Catalog current pointer"
  );
  return {
    ...base,
    generationReceiptHash: sha(
      object.generationReceiptHash,
      "Catalog current pointer.generationReceiptHash"
    ),
  };
}

export function parseCatalogGenerationReceipt(
  value: unknown
): CatalogGenerationReceiptV1 {
  const context = "Catalog generation receipt";
  const object = exact(
    value,
    [
      "abi",
      "catalogLockHash",
      "compilerHash",
      "generationInputHash",
      "icuHash",
      "payload",
      "pointerBase",
      "schemaVersion",
      "selectorBase",
      "selectorBaseHash",
      "stableFacadeHash",
    ],
    context
  );
  if (object.schemaVersion !== 1) {
    fail(`${context}.schemaVersion`, "must equal 1");
  }
  const abiObject = exact(
    object.abi,
    ["artifactAbi", "runtimeAbi"],
    `${context}.abi`
  );
  const payloadObject = exact(
    object.payload,
    ["contentHash", "directory", "manifest", "manifestHash"],
    `${context}.payload`
  );
  const manifest = parsePayloadManifest(payloadObject.manifest);
  const payload = {
    contentHash: sha(
      payloadObject.contentHash,
      `${context}.payload.contentHash`
    ),
    directory: canonicalPath(
      payloadObject.directory,
      `${context}.payload.directory`
    ),
    manifest,
    manifestHash: sha(
      payloadObject.manifestHash,
      `${context}.payload.manifestHash`
    ),
  };
  if (payload.manifestHash !== manifest.hash) {
    fail(`${context}.payload.manifestHash`, "does not bind the manifest");
  }
  const pointerBase = parsePointerBase(
    object.pointerBase,
    `${context}.pointerBase`
  );
  const selectorBase = parsePointerBase(
    object.selectorBase,
    `${context}.selectorBase`
  );
  if (
    canonicalJson(pointerBase) !== canonicalJson(selectorBase) ||
    payload.contentHash !== pointerBase.contentHash ||
    payload.directory !== pointerBase.directory
  ) {
    fail(
      context,
      "contains disagreeing payload, selector, or pointer identities"
    );
  }
  const selectorBaseHash = sha(
    object.selectorBaseHash,
    `${context}.selectorBaseHash`
  );
  if (selectorBaseHash !== canonicalHash(selectorBase)) {
    fail(`${context}.selectorBaseHash`, "does not bind selectorBase");
  }
  return {
    abi: {
      artifactAbi: string(abiObject.artifactAbi, `${context}.abi.artifactAbi`),
      runtimeAbi: string(
        abiObject.runtimeAbi,
        `${context}.abi.runtimeAbi`
      ) as RuntimeAbi,
    },
    catalogLockHash: sha(object.catalogLockHash, `${context}.catalogLockHash`),
    compilerHash: sha(object.compilerHash, `${context}.compilerHash`),
    generationInputHash: sha(
      object.generationInputHash,
      `${context}.generationInputHash`
    ),
    icuHash: sha(object.icuHash, `${context}.icuHash`),
    payload,
    pointerBase,
    schemaVersion: 1,
    selectorBase,
    selectorBaseHash,
    stableFacadeHash: sha(
      object.stableFacadeHash,
      `${context}.stableFacadeHash`
    ),
  };
}

export function buildCatalogGenerationSnapshot(
  input: CatalogGenerationSnapshotInput
): CatalogGenerationSnapshot {
  const generationInput = parseCatalogGenerationInputIdentity(
    input.generationInput
  );
  const generationInputHash = canonicalHash(generationInput);
  const manifest = buildCatalogPayloadManifest(input.payloadEntries);
  const contentHash = sha(input.payloadContentHash, "Payload content hash");
  const directory = canonicalPath(
    input.payloadDirectory.normalize("NFC"),
    "Payload directory"
  );
  const selectorBase = parsePointerBase(
    { contentHash, directory, schemaVersion: 2 },
    "Catalog selector base"
  );
  const catalogLockHash = sha(input.catalogLockHash, "Catalog lock hash");
  const stableFacadeHash = sha(input.stableFacadeHash, "Stable facade hash");
  const generationReceipt = parseCatalogGenerationReceipt({
    abi: {
      artifactAbi: generationInput.artifactAbi,
      runtimeAbi: generationInput.runtimeAbi,
    },
    catalogLockHash,
    compilerHash: generationInput.compiler.hash,
    generationInputHash,
    icuHash: generationInput.icu.hash,
    payload: {
      contentHash,
      directory,
      manifest,
      manifestHash: manifest.hash,
    },
    pointerBase: selectorBase,
    schemaVersion: 1,
    selectorBase,
    selectorBaseHash: canonicalHash(selectorBase),
    stableFacadeHash,
  });
  // The receipt hash is computed around, never inside, the receipt.
  const generationReceiptHash = sha256(`${canonicalJson(generationReceipt)}\n`);
  const pointer = parseCatalogCurrentPointer({
    ...selectorBase,
    generationReceiptHash,
  });
  return {
    catalogLockHash,
    generationInput,
    generationInputHash,
    generationReceipt,
    generationReceiptHash,
    payload: { contentHash, directory, manifest },
    pointer,
    schemaVersion: 1,
    selectorBase,
    stableFacadeHash,
  };
}

export function parseCatalogGenerationSnapshot(
  value: unknown
): CatalogGenerationSnapshot {
  const object = exact(
    value,
    [
      "catalogLockHash",
      "generationInput",
      "generationInputHash",
      "generationReceipt",
      "generationReceiptHash",
      "payload",
      "pointer",
      "schemaVersion",
      "selectorBase",
      "stableFacadeHash",
    ],
    "Catalog generation snapshot"
  );
  if (object.schemaVersion !== 1) {
    fail("Catalog generation snapshot.schemaVersion", "must equal 1");
  }
  const payload = exact(
    object.payload,
    ["contentHash", "directory", "manifest"],
    "Catalog generation snapshot.payload"
  );
  const rebuilt = buildCatalogGenerationSnapshot({
    catalogLockHash: sha(
      object.catalogLockHash,
      "Catalog generation snapshot.catalogLockHash"
    ),
    generationInput: parseCatalogGenerationInputIdentity(
      object.generationInput
    ),
    payloadContentHash: sha(
      payload.contentHash,
      "Catalog generation snapshot.payload.contentHash"
    ),
    payloadDirectory: canonicalPath(
      payload.directory,
      "Catalog generation snapshot.payload.directory"
    ),
    payloadEntries: parsePayloadManifest(payload.manifest).entries,
    stableFacadeHash: sha(
      object.stableFacadeHash,
      "Catalog generation snapshot.stableFacadeHash"
    ),
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail(
      "Catalog generation snapshot",
      "contains inconsistent derived identities"
    );
  }
  return rebuilt;
}

export function parseCatalogPublicationJournal(
  value: unknown
): CatalogPublicationJournalV1 {
  const object = exact(
    value,
    [
      "expectedPublicationHash",
      "ownerToken",
      "previousDirectory",
      "schemaVersion",
      "stageDirectory",
      "state",
    ],
    "Catalog publication journal"
  );
  const ownerToken = string(
    object.ownerToken,
    "Catalog publication journal.ownerToken"
  );
  const stageDirectory = canonicalPath(
    object.stageDirectory,
    "Catalog publication journal.stageDirectory"
  );
  if (
    object.schemaVersion !== 1 ||
    stageDirectory !== `stage-${ownerToken}` ||
    typeof object.state !== "string" ||
    !CATALOG_PUBLICATION_STATES.includes(
      object.state as CatalogPublicationState
    )
  ) {
    fail("Catalog publication journal", "has invalid ownership or state");
  }
  return {
    expectedPublicationHash: sha(
      object.expectedPublicationHash,
      "Catalog publication journal.expectedPublicationHash"
    ),
    ownerToken,
    previousDirectory:
      object.previousDirectory === null
        ? null
        : canonicalPath(
            object.previousDirectory,
            "Catalog publication journal.previousDirectory"
          ),
    schemaVersion: 1,
    stageDirectory,
    state: object.state as CatalogPublicationState,
  };
}

export function parseCanonicalCatalogGenerationSnapshot(
  source: string
): CatalogGenerationSnapshot {
  const parsed = parseCatalogGenerationSnapshot(JSON.parse(source) as unknown);
  if (source !== canonicalJson(parsed)) {
    fail("Catalog generation snapshot", "must use canonical JSON bytes");
  }
  return parsed;
}

export function parseCanonicalCatalogGenerationReceipt(
  source: string
): CatalogGenerationReceiptV1 {
  const parsed = parseCatalogGenerationReceipt(JSON.parse(source) as unknown);
  if (source !== `${canonicalJson(parsed)}\n`) {
    fail("Catalog generation receipt", "must use canonical JSON bytes");
  }
  return parsed;
}

export function parseCanonicalCatalogCurrentPointer(
  source: string
): CatalogCurrentPointerV2 {
  const parsed = parseCatalogCurrentPointer(JSON.parse(source) as unknown);
  if (source !== `${canonicalJson(parsed)}\n`) {
    fail("Catalog current pointer", "must use canonical JSON bytes");
  }
  return parsed;
}

export function parseCanonicalCatalogPublicationJournal(
  source: string
): CatalogPublicationJournalV1 {
  const parsed = parseCatalogPublicationJournal(JSON.parse(source) as unknown);
  if (source !== `${canonicalJson(parsed)}\n`) {
    fail("Catalog publication journal", "must use canonical JSON bytes");
  }
  return parsed;
}
