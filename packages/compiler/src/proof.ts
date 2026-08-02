import { lstatSync, readFileSync } from "node:fs";
import {
  lstat,
  link,
  realpath,
  readdir,
  readFile,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { performance } from "node:perf_hooks";

import { RUNTIME_ABI } from "@openmirai/intl-abi";
import type {
  IntlBuildProofTargetV1,
  IntlBuildProofV1,
  IntlCheckPackageIdentityV2,
  IntlCheckReceipt,
  IntlCheckReceiptSelectorV2,
  IntlCheckReceiptV2,
  IntlSemanticAuthorizationObservationV2,
  PackageAuthoritySetV1,
} from "@openmirai/intl-abi";

import {
  canonicalHash,
  canonicalJson,
  compareCanonicalStrings,
  decodeUtf8Fatal,
  sha256,
} from "./canonical";
import type * as AnalyzeSourcesModule from "./analyze-sources";
import {
  loadFreshConventionCatalogGenerationInput,
  loadConventionCatalog,
  validateConventionEnvironment,
  verifyLoadedConventionCatalog,
} from "./catalog";
import type { ConventionOptions, LoadedConventionCatalog } from "./catalog";
import {
  assertTrustedIntlCheckReceiptV3ClassifierAuthorityBinding,
  buildIntlCheckReceiptV3FromClassifierProjections,
  buildIntlCheckReceiptV3FromNativeInputs,
  buildIntlCheckReceiptV2,
  buildSourceAuthorizationSnapshot,
  canonicalIntlCheckReceiptV2Bytes,
  parseCanonicalIntlCheckReceiptV2,
} from "./authorization-snapshot";
import type { IntlCheckReceiptV3ClassifierAuthorityBinding } from "./authorization-snapshot";
import { parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3 } from "./classifier-authority";
import {
  createMiraiIntlClassifierWorkspaceTransactionV3,
  revalidateMiraiIntlClassifierFinalizedTransactionAfterInputVerificationV3,
} from "./classifier-candidate";
import type { MiraiIntlClassifierFinalizedTransactionV3 } from "./classifier-candidate";
import {
  canonicalPackageAuthoritySetV1Bytes,
  conventionCheckReceiptSelectorPath,
  conventionPackageAuthorityReceiptPath,
  conventionPackageAuthoritySetPath,
  conventionPackageClassifierAuthorityPath,
  verifyConventionBuildReceipt,
} from "./check-receipt";
import {
  computeApplicationPackageIdentity,
  computeImmutableIntegrityIdentity,
} from "./integrity-identity";
import type { ResolvedPackageIdentity } from "./integrity-identity";
import { ensureMiraiIntlCatalog } from "./lifecycle";
import {
  captureProviderResolutionFrontier,
  verifyProviderResolutionFrontier,
} from "./provider-resolution-identity";
import type { ProviderResolutionFrontierInput } from "./provider-resolution-identity";
import { collectConventionSourceFiles } from "./source-discovery";
import type * as OwnershipModule from "./ownership";
import { verifyCommittedArtifactSnapshot } from "./writer";

type AuthorizationOptions = ConventionOptions &
  Readonly<{
    /** @internal Deterministic mutation-barrier tests only. */
    beforePublicationBarrier?: () => Promise<void> | void;
    /** @internal Deterministic dormant-V3 interruption tests only. */
    dormantV3PublicationBoundary?: (
      boundary:
        | "before-selector-rename"
        | "selector-renamed"
        | "v2-receipt-installed"
        | "v2-set-installed"
        | "v3-authority-installed"
        | "v3-receipt-installed"
        | "v3-set-installed"
    ) => Promise<void> | void;
    /** @internal Materialize the dormant V3 DAG while retaining V2 authority. */
    dormantV3?: boolean;
    /** @internal Recheck every non-classifier publication fingerprint. */
    dormantV3PublicationFingerprintVerification?: () => Promise<void>;
    /** @internal Absolute monotonic publication deadline from performance.now(). */
    dormantV3PublicationDeadlineMs?: number;
    /** @internal Deterministic monotonic clock for publication cutoff tests. */
    dormantV3PublicationNow?: () => number;
    validateEnvironment?: boolean;
  }>;

type SemanticModules = Readonly<{
  analyze: typeof AnalyzeSourcesModule;
  ownership: typeof OwnershipModule;
}>;

export class IntlSourceAuthorizationError extends Error {
  override readonly name = "IntlSourceAuthorizationError";

  constructor(
    readonly diagnostics: ReadonlyArray<
      Readonly<{ file: string; message: string }>
    >,
    readonly observation: IntlSemanticAuthorizationObservationV2 &
      Readonly<{ checkerProjects: number; ownerProjects: number }>
  ) {
    super(
      `Mirai Intl source analysis failed with ${diagnostics.length} diagnostic(s): ${diagnostics
        .map(({ file, message }) => `${file}: ${message}`)
        .join("; ")}`
    );
  }
}

const artifactAbi = "mirai-intl-artifact-v2";
const proofDirectory = "build-proofs";

export type IntlEmittedModuleV1 = Readonly<{
  /** JavaScript asset path, relative to the deployed artifact root. */
  path: string;
  /** Required emitted source-map path, relative to the deployed artifact root. */
  mapPath?: string;
}>;

export type IntlBuildProofFinalizationTarget = Readonly<{
  artifactRoot: string;
  mapRoot?: string;
  target: IntlBuildProofTargetV1;
}>;

/** Enumerate the actual mapped JavaScript files for an independent postbuild audit. */
export async function discoverEmittedModules(
  artifactRoot: string,
  mapRoot: string = artifactRoot
): Promise<ReadonlyArray<IntlEmittedModuleV1>> {
  const root = resolve(artifactRoot);
  const maps = resolve(mapRoot);
  const modules: Array<IntlEmittedModuleV1> = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
        continue;
      }
      if (
        !entry.isFile() ||
        !/\.(?:[cm]?js)$/u.test(entry.name) ||
        entry.name.endsWith(".map")
      ) {
        continue;
      }
      const path = relativeArtifactPath(root, file);
      const mapPath = `${path}.map`;
      const mapEntry = await lstat(resolve(maps, mapPath)).catch(
        () => undefined
      );
      modules.push(
        mapEntry && !mapEntry.isSymbolicLink() && mapEntry.isFile()
          ? { mapPath, path }
          : { path }
      );
    }
  };
  await visit(root);
  if (modules.length === 0) {
    throw new Error(
      "Build proof requires at least one emitted JavaScript module"
    );
  }
  return modules.toSorted((left, right) =>
    compareCanonicalStrings(left.path, right.path)
  );
}

type BuildProofReceipts = Readonly<{
  authorityHash: `sha256:${string}`;
  deploymentReceiptHash: `sha256:${string}`;
}>;

/**
 * Mounted catalogs retain their own source authority. Compose dependency
 * receipts into the application artifact proof without transferring semantic
 * verification authority to the consumer.
 */
async function buildProofReceipts(
  root: string,
  receipt: IntlCheckReceipt
): Promise<BuildProofReceipts> {
  const loaded = await loadConventionCatalog(root);
  const dependencies = new Map<string, string>();
  for (const source of loaded.config.sources) {
    if (!source.dependency) {
      continue;
    }
    const existing = dependencies.get(source.dependency);
    if (existing && existing !== source.withinRoot) {
      throw new Error(
        `Mirai Intl dependency ${source.dependency} resolved to multiple package roots`
      );
    }
    dependencies.set(source.dependency, source.withinRoot);
  }
  const receipts = await Promise.all(
    [...dependencies]
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .map(async ([dependency, dependencyRoot]) => ({
        dependency,
        receipt: (await verifyConventionBuildReceipt(dependencyRoot)).receipt,
      }))
  );
  return {
    authorityHash: canonicalHash({
      dependencies: receipts.map(
        ({ dependency, receipt: dependencyReceipt }) => ({
          dependency,
          receipt: dependencyReceipt.sourceAuthorizationHash,
        })
      ),
      receipt: receipt.sourceAuthorizationHash,
    }),
    deploymentReceiptHash: canonicalHash({
      dependencies: receipts.map(
        ({ dependency, receipt: dependencyReceipt }) => ({
          dependency,
          receipt: dependencyReceipt,
        })
      ),
      receipt,
    }),
  };
}

function proofPath(
  root: string,
  target: IntlBuildProofTargetV1,
  state: IntlBuildProofV1["state"]
): string {
  return join(
    root,
    ".mirai-intl",
    proofDirectory,
    `${target}.${state}.v1.json`
  );
}

function relativeArtifactPath(root: string, file: string): string {
  const candidate = resolve(root, file);
  const path = relative(root, candidate).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error(
      "Build-proof artifact path must remain inside its artifact root"
    );
  }
  return path;
}

async function regularArtifact(root: string, file: string): Promise<string> {
  const path = relativeArtifactPath(root, file);
  const absolute = resolve(root, path);
  const entry = await lstat(absolute).catch(() => undefined);
  if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(
      `Build-proof artifact ${path} must be a readable regular file`
    );
  }
  return path;
}

async function emittedEvidence(
  artifactRoot: string,
  modules: ReadonlyArray<IntlEmittedModuleV1>,
  mapRoot: string = artifactRoot
): Promise<IntlBuildProofV1["emitted"]> {
  if (modules.length === 0) {
    throw new Error(
      "Build proof requires at least one emitted JavaScript module"
    );
  }
  const emitted = await Promise.all(
    modules.map(async (module) => {
      const path = await regularArtifact(artifactRoot, module.path);
      if (!/\.(?:[cm]?js)$/u.test(path)) {
        throw new Error("Build proofs require JavaScript assets");
      }
      const javascript = await readFile(resolve(artifactRoot, path), "utf8");
      if (!module.mapPath) {
        assertAuditableModule(path, javascript);
        return { hash: sha256(javascript), path };
      }
      const mapPath = await regularArtifact(mapRoot, module.mapPath);
      const mapSource = await readFile(resolve(mapRoot, mapPath), "utf8");
      assertAuditableModule(path, javascript, mapPath, mapSource);
      return {
        hash: sha256(javascript),
        mapHash: sha256(mapSource),
        mapPath,
        path,
      };
    })
  );
  const sorted = emitted.toSorted((left, right) =>
    compareCanonicalStrings(left.path, right.path)
  );
  if (new Set(sorted.map((entry) => entry.path)).size !== sorted.length) {
    throw new Error("Build proof emitted module paths must be unique");
  }
  const mappedPaths = sorted.flatMap((entry) =>
    entry.mapPath === undefined ? [] : [entry.mapPath]
  );
  if (new Set(mappedPaths).size !== mappedPaths.length) {
    throw new Error("Build proof emitted source-map paths must be unique");
  }
  return sorted;
}

/**
 * A proof is only useful when its maps can be independently inspected. Keep
 * this deliberately narrow: package/runtime code may legitimately contain
 * strict fallback strings, but retired generated runtime blobs must never
 * reach a deployed JavaScript artifact.
 */
function assertAuditableModule(
  path: string,
  javascript: string,
  mapPath?: string,
  mapSource?: string
): void {
  if (javascript.includes("catalog.runtime.gen.json")) {
    throw new Error(
      `Build-proof artifact ${path} contains the retired catalog.runtime.gen.json marker`
    );
  }
  if (!mapPath || mapSource === undefined) {
    return;
  }
  let map: unknown;
  try {
    map = JSON.parse(mapSource) as unknown;
  } catch {
    throw new Error(`Build-proof source map ${mapPath} is not valid JSON`);
  }
  if (
    !map ||
    typeof map !== "object" ||
    Array.isArray(map) ||
    Reflect.get(map, "version") !== 3 ||
    !Array.isArray(Reflect.get(map, "sources")) ||
    !Array.isArray(Reflect.get(map, "sourcesContent")) ||
    Reflect.get(map, "sources").length !==
      Reflect.get(map, "sourcesContent").length
  ) {
    throw new Error(
      `Build-proof source map ${mapPath} must contain matching v3 sources and sourcesContent arrays`
    );
  }
}

async function writeProof(
  path: string,
  proof: IntlBuildProofV1
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, `${canonicalJson(proof)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readProof(path: string): Promise<IntlBuildProofV1> {
  const source = await readFile(path, "utf8").catch(() => {
    throw new Error(`Missing Mirai Intl build proof ${path}`);
  });
  let proof: IntlBuildProofV1;
  try {
    proof = JSON.parse(source) as IntlBuildProofV1;
  } catch {
    throw new Error(`Build proof ${path} must contain valid JSON`);
  }
  if (`${canonicalJson(proof)}\n` !== source) {
    throw new Error(`Build proof ${path} must use canonical JSON`);
  }
  return proof;
}

function isMissingArtifactPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    Reflect.get(error, "code") === "ENOENT"
  );
}

function packageArtifactDirectorySegments(
  packageRoot: string,
  directory: string
): Readonly<{ root: string; segments: ReadonlyArray<string> }> {
  const root = resolve(packageRoot);
  const target = resolve(directory);
  const withinRoot = relative(root, target);
  if (
    isAbsolute(withinRoot) ||
    withinRoot === ".." ||
    withinRoot.startsWith(`..${sep}`)
  ) {
    throw new Error("Mirai Intl artifact directory escapes the package root");
  }
  return {
    root,
    segments: withinRoot === "" ? [] : withinRoot.split(sep),
  };
}

function assertPackageArtifactDirectoryEntry(
  entry: Awaited<ReturnType<typeof lstat>>,
  path: string
): void {
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(
      `Mirai Intl artifact parent must be a non-symlink directory: ${path}`
    );
  }
}

async function ensurePackageArtifactDirectory(
  packageRoot: string,
  directory: string
): Promise<void> {
  const { root, segments } = packageArtifactDirectorySegments(
    packageRoot,
    directory
  );
  let current = root;
  const rootEntry = await lstat(root);
  assertPackageArtifactDirectoryEntry(rootEntry, root);
  for (const segment of segments) {
    current = join(current, segment);
    let entry = await lstat(current).catch((error: unknown) => {
      if (isMissingArtifactPath(error)) {
        return undefined;
      }
      throw error;
    });
    if (!entry) {
      await mkdir(current).catch((error: unknown) => {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          Reflect.get(error, "code") !== "EEXIST"
        ) {
          throw error;
        }
      });
      entry = await lstat(current);
    }
    assertPackageArtifactDirectoryEntry(entry, current);
  }
}

function assertPackageArtifactDirectorySync(
  packageRoot: string,
  directory: string
): void {
  const { root, segments } = packageArtifactDirectorySegments(
    packageRoot,
    directory
  );
  let current = root;
  assertPackageArtifactDirectoryEntry(lstatSync(root), root);
  for (const segment of segments) {
    current = join(current, segment);
    assertPackageArtifactDirectoryEntry(lstatSync(current), current);
  }
}

type DormantV3PublicationBoundary = Parameters<
  NonNullable<AuthorizationOptions["dormantV3PublicationBoundary"]>
>[0];

type ImmutableAuthorizationObject = Readonly<{
  afterInstall: DormantV3PublicationBoundary;
  bytes: string;
  name: string;
  path: string;
  verify: (bytes: string) => void;
}>;

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function assertRegularArtifact(
  path: string,
  name: string
): Promise<void> {
  const entry = await lstat(path).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (entry && (entry.isSymbolicLink() || !entry.isFile())) {
    throw new Error(`${name} must be a non-symlink regular file`);
  }
}

async function installImmutableAuthorizationObject(
  packageRoot: string,
  artifact: ImmutableAuthorizationObject,
  observe?: AuthorizationOptions["dormantV3PublicationBoundary"]
): Promise<void> {
  artifact.verify(artifact.bytes);
  await ensurePackageArtifactDirectory(packageRoot, dirname(artifact.path));
  await assertRegularArtifact(artifact.path, artifact.name);
  const verifyInstalled = async (): Promise<void> => {
    await assertRegularArtifact(artifact.path, artifact.name);
    const existing = await readFile(artifact.path, "utf8");
    if (existing !== artifact.bytes) {
      throw new Error(`${artifact.name} immutable object is corrupt`);
    }
    artifact.verify(existing);
  };
  const existing = await readFile(artifact.path, "utf8").catch(
    (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  );
  if (existing !== undefined) {
    await verifyInstalled();
    await observe?.(artifact.afterInstall);
    return;
  }
  const temporary = `${artifact.path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await ensurePackageArtifactDirectory(packageRoot, dirname(temporary));
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(artifact.bytes, "utf8");
      await handle.datasync();
    } finally {
      await handle.close();
    }
    const staged = await readFile(temporary, "utf8");
    if (staged !== artifact.bytes) {
      throw new Error(`${artifact.name} changed while staged`);
    }
    artifact.verify(staged);
    await ensurePackageArtifactDirectory(packageRoot, dirname(artifact.path));
    await link(temporary, artifact.path).catch(async (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        await verifyInstalled();
        return;
      }
      throw error;
    });
    await verifyInstalled();
    await syncDirectory(dirname(artifact.path));
    await observe?.(artifact.afterInstall);
  } finally {
    await rm(temporary, { force: true });
  }
}

function dormantV2SelectorBytes(authoritySetHash: `sha256:${string}`): string {
  const selector = {
    authoritySetHash,
    schemaVersion: 2,
  } as const satisfies IntlCheckReceiptSelectorV2;
  return `${canonicalJson(selector)}\n`;
}

function verifyDormantV2SelectorBytes(
  source: string,
  authoritySetHash: `sha256:${string}`
): void {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    throw new Error("Mirai Intl dormant V2 selector must contain valid JSON");
  }
  const expected = {
    authoritySetHash,
    schemaVersion: 2,
  } as const satisfies IntlCheckReceiptSelectorV2;
  if (
    source !== `${canonicalJson(expected)}\n` ||
    canonicalJson(value) !== canonicalJson(expected)
  ) {
    throw new Error("Mirai Intl dormant V2 selector is invalid");
  }
}

function packageAuthorityRoot(manifestPath: string): string {
  if (manifestPath === "package.json") {
    return ".";
  }
  const suffix = "/package.json";
  if (!manifestPath.endsWith(suffix)) {
    throw new Error(
      "Mirai Intl package authority manifest path must end in package.json"
    );
  }
  return manifestPath.slice(0, -suffix.length);
}

async function packageAuthorityIdentity(
  packageRoot: string,
  workspaceRoot: string,
  receipt: IntlCheckReceipt
): Promise<PackageAuthoritySetV1["package"]> {
  const manifest =
    receipt.schemaVersion === 2
      ? receipt.application.packageManifest
      : receipt.tables.files[receipt.application.packageManifest];
  if (!manifest) {
    throw new Error(
      "Mirai Intl package authority receipt has no package manifest identity"
    );
  }
  const root = packageAuthorityRoot(manifest.path);
  if (
    (await realpath(resolve(workspaceRoot, root))) !==
    (await realpath(packageRoot))
  ) {
    throw new Error(
      "Mirai Intl package authority root does not match its sealed receipt"
    );
  }
  const bytes = await readFile(resolve(workspaceRoot, manifest.path));
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8Fatal(bytes, "Mirai Intl package manifest"));
  } catch {
    throw new Error("Mirai Intl package authority manifest is invalid");
  }
  const manifestHash =
    receipt.schemaVersion === 2
      ? sha256(Buffer.from(canonicalJson(value), "utf8"))
      : sha256(bytes);
  if (manifestHash !== manifest.hash) {
    throw new Error("Mirai Intl package authority manifest is stale");
  }
  const name =
    value && typeof value === "object" && !Array.isArray(value)
      ? Reflect.get(value, "name")
      : undefined;
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Mirai Intl package authority manifest has no name");
  }
  return { manifestHash: manifest.hash, name, root };
}

async function writePackageAuthoritySelector(
  root: string,
  bytes: string,
  authoritySetHash: `sha256:${string}`,
  finalized: MiraiIntlClassifierFinalizedTransactionV3,
  options: Pick<
    AuthorizationOptions,
    | "dormantV3PublicationBoundary"
    | "dormantV3PublicationDeadlineMs"
    | "dormantV3PublicationFingerprintVerification"
    | "dormantV3PublicationNow"
  >
): Promise<void> {
  const selectorPath = conventionCheckReceiptSelectorPath(root);
  const verify = (source: string): void =>
    verifyDormantV2SelectorBytes(source, authoritySetHash);
  const verifyLive = async (): Promise<void> => {
    if (!options.dormantV3PublicationFingerprintVerification) {
      throw new Error(
        "Mirai Intl dormant V3 publication requires fingerprint verification"
      );
    }
    await options.dormantV3PublicationFingerprintVerification();
    await revalidateMiraiIntlClassifierFinalizedTransactionAfterInputVerificationV3(
      finalized
    );
  };
  const verifyCommitBarrier = (stagedPath: string): void => {
    const now = options.dormantV3PublicationNow ?? (() => performance.now());
    if (
      options.dormantV3PublicationDeadlineMs === undefined ||
      now() >= options.dormantV3PublicationDeadlineMs
    ) {
      throw new Error("Mirai Intl dormant V3 publication deadline expired");
    }
    assertPackageArtifactDirectorySync(root, dirname(stagedPath));
    const staged = readFileSync(stagedPath, "utf8");
    if (staged !== bytes) {
      throw new Error(
        "Mirai Intl package authority selector changed at commit barrier"
      );
    }
    verify(staged);
  };
  verify(bytes);
  await ensurePackageArtifactDirectory(root, dirname(selectorPath));
  await assertRegularArtifact(
    selectorPath,
    "Mirai Intl package authority selector"
  );
  const existing = await readFile(selectorPath, "utf8").catch(
    (error: unknown) => {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return undefined;
      }
      throw error;
    }
  );
  if (existing === bytes) {
    verify(existing);
    await options.dormantV3PublicationBoundary?.("before-selector-rename");
    await verifyLive();
    verifyCommitBarrier(selectorPath);
    try {
      await options.dormantV3PublicationBoundary?.("selector-renamed");
    } catch {
      // An identical selector was already committed before this observer.
    }
    return;
  }
  const temporary = `${selectorPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await ensurePackageArtifactDirectory(root, dirname(temporary));
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(bytes, "utf8");
      await handle.datasync();
    } finally {
      await handle.close();
    }
    const reread = await readFile(temporary, "utf8");
    if (reread !== bytes) {
      throw new Error(
        "Mirai Intl package authority selector changed during publication"
      );
    }
    verify(reread);
    await options.dormantV3PublicationBoundary?.("before-selector-rename");
    await verifyLive();
    verifyCommitBarrier(temporary);
    await rename(temporary, selectorPath);
    await syncDirectory(dirname(selectorPath)).catch(() => {
      // The selector rename is already committed and cannot be rolled back.
    });
  } finally {
    await rm(temporary, { force: true });
  }
  try {
    await options.dormantV3PublicationBoundary?.("selector-renamed");
  } catch {
    // Selector rename is the commit point; post-commit observers cannot revoke it.
  }
}

/**
 * Persist a fully cross-bound dormant V3 DAG while activating only the
 * content-addressed V2 authority set. The schema-2 selector rename is the sole
 * package-local commit point; fixed receipt names are not mutated here.
 *
 * @internal Dormant V3 publication transaction.
 */
export async function publishDormantConventionAuthorityV3(
  packageRoot: string,
  workspaceRoot: string,
  v2Receipt: IntlCheckReceiptV2 | null,
  binding: IntlCheckReceiptV3ClassifierAuthorityBinding,
  finalized: MiraiIntlClassifierFinalizedTransactionV3,
  options: Pick<
    AuthorizationOptions,
    | "dormantV3PublicationBoundary"
    | "dormantV3PublicationDeadlineMs"
    | "dormantV3PublicationFingerprintVerification"
    | "dormantV3PublicationNow"
  > &
    Readonly<{ activateV3?: boolean }> = {}
): Promise<void> {
  const root = resolve(packageRoot);
  assertTrustedIntlCheckReceiptV3ClassifierAuthorityBinding(binding);
  const v2Bytes = v2Receipt
    ? canonicalIntlCheckReceiptV2Bytes(v2Receipt)
    : undefined;
  const authorityEnvelope =
    parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
      binding.authorityBytes
    );
  const receipt = binding.receipt;
  const packageAuthority = await packageAuthorityIdentity(
    root,
    workspaceRoot,
    v2Receipt ?? receipt
  );
  const v2ReceiptHash = v2Bytes ? sha256(Buffer.from(v2Bytes)) : undefined;
  const v2Set = v2ReceiptHash
    ? ({
        classifierAuthority: null,
        package: packageAuthority,
        receipt: { hash: v2ReceiptHash, schemaVersion: 2 },
        schemaVersion: 1,
      } as const satisfies PackageAuthoritySetV1)
    : undefined;
  const v2SetBytes = v2Set
    ? canonicalPackageAuthoritySetV1Bytes(v2Set)
    : undefined;
  const v2SetHash = v2SetBytes ? sha256(Buffer.from(v2SetBytes)) : undefined;
  const v3Set = {
    classifierAuthority: {
      hash: binding.authorityHash,
      schemaVersion: 3,
    },
    package: packageAuthority,
    receipt: { hash: binding.receiptHash, schemaVersion: 3 },
    schemaVersion: 1,
  } as const satisfies PackageAuthoritySetV1;
  const v3SetBytes = canonicalPackageAuthoritySetV1Bytes(v3Set);
  const v3SetHash = sha256(Buffer.from(v3SetBytes));
  if (!options.dormantV3PublicationFingerprintVerification) {
    throw new Error(
      "Mirai Intl dormant V3 publication requires fingerprint verification"
    );
  }
  // Immutable objects are content-addressed and inert until the selector
  // rename. Revalidate exactly at that commit point instead of repeating the
  // same full workspace scan before staging objects that cannot become live.
  if (
    v2Receipt &&
    v2Bytes &&
    v2ReceiptHash &&
    v2Set &&
    v2SetBytes &&
    v2SetHash
  ) {
    await installImmutableAuthorizationObject(
      root,
      {
        afterInstall: "v2-receipt-installed",
        bytes: v2Bytes,
        name: "Mirai Intl immutable check receipt V2",
        path: conventionPackageAuthorityReceiptPath(root, 2, v2ReceiptHash),
        verify(bytes) {
          if (
            canonicalIntlCheckReceiptV2Bytes(
              parseCanonicalIntlCheckReceiptV2(bytes)
            ) !== v2Bytes
          ) {
            throw new Error("Mirai Intl immutable check receipt V2 is invalid");
          }
        },
      },
      options.dormantV3PublicationBoundary
    );
    await installImmutableAuthorizationObject(
      root,
      {
        afterInstall: "v2-set-installed",
        bytes: v2SetBytes,
        name: "Mirai Intl immutable package authority set V2",
        path: conventionPackageAuthoritySetPath(root, v2SetHash),
        verify(bytes) {
          if (bytes !== canonicalPackageAuthoritySetV1Bytes(v2Set)) {
            throw new Error(
              "Mirai Intl immutable package authority set V2 is invalid"
            );
          }
        },
      },
      options.dormantV3PublicationBoundary
    );
  }
  await installImmutableAuthorizationObject(
    root,
    {
      afterInstall: "v3-authority-installed",
      bytes: binding.authorityBytes,
      name: "Mirai Intl immutable classifier authority V3",
      path: conventionPackageClassifierAuthorityPath(
        root,
        binding.authorityHash
      ),
      verify(bytes) {
        const parsed =
          parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(bytes);
        if (
          sha256(Buffer.from(bytes)) !== binding.authorityHash ||
          canonicalJson(parsed) !== canonicalJson(authorityEnvelope)
        ) {
          throw new Error(
            "Mirai Intl immutable classifier authority V3 is invalid"
          );
        }
      },
    },
    options.dormantV3PublicationBoundary
  );
  await installImmutableAuthorizationObject(
    root,
    {
      afterInstall: "v3-receipt-installed",
      bytes: binding.receiptBytes,
      name: "Mirai Intl immutable check receipt V3",
      path: conventionPackageAuthorityReceiptPath(root, 3, binding.receiptHash),
      verify(bytes) {
        if (sha256(Buffer.from(bytes)) !== binding.receiptHash) {
          throw new Error("Mirai Intl immutable check receipt V3 is invalid");
        }
      },
    },
    options.dormantV3PublicationBoundary
  );
  await installImmutableAuthorizationObject(
    root,
    {
      afterInstall: "v3-set-installed",
      bytes: v3SetBytes,
      name: "Mirai Intl immutable package authority set V3",
      path: conventionPackageAuthoritySetPath(root, v3SetHash),
      verify(bytes) {
        if (bytes !== canonicalPackageAuthoritySetV1Bytes(v3Set)) {
          throw new Error(
            "Mirai Intl immutable package authority set V3 is invalid"
          );
        }
      },
    },
    options.dormantV3PublicationBoundary
  );
  await writePackageAuthoritySelector(
    root,
    dormantV2SelectorBytes(
      options.activateV3
        ? v3SetHash
        : (v2SetHash ??
            (() => {
              throw new Error("Mirai Intl V2 activation requires a V2 set");
            })())
    ),
    options.activateV3
      ? v3SetHash
      : (v2SetHash ??
          (() => {
            throw new Error("Mirai Intl V2 activation requires a V2 set");
          })()),
    finalized,
    options
  );
}

function packageIdentity(
  identity: ResolvedPackageIdentity
): IntlCheckPackageIdentityV2 {
  return {
    name: identity.name,
    packageHash: identity.hash,
    packageManifestHash: identity.packageJsonHash,
    version: identity.version,
  };
}

type CapturedProviderResolution = Awaited<
  ReturnType<typeof captureProviderResolutionFrontier>
>;

function mergeProviderResolutionFrontiers(
  left: ProviderResolutionFrontierInput,
  right: ProviderResolutionFrontierInput
): ProviderResolutionFrontierInput {
  if (
    left.from !== right.from ||
    left.specifier !== right.specifier ||
    left.packageName !== right.packageName ||
    left.packageVersion !== right.packageVersion
  ) {
    throw new Error(
      `Conflicting semantic provider resolution identity: ${left.from} -> ${left.specifier}`
    );
  }
  const merge = <T>(
    leftEntries: ReadonlyArray<T>,
    rightEntries: ReadonlyArray<T>,
    identity: (entry: T) => string,
    value: (entry: T) => string
  ): ReadonlyArray<T> => {
    const entries = new Map<string, T>();
    for (const entry of [...leftEntries, ...rightEntries]) {
      const key = identity(entry);
      const existing = entries.get(key);
      if (existing && value(existing) !== value(entry)) {
        throw new Error(
          `Conflicting semantic provider resolution frontier: ${left.from} -> ${left.specifier}`
        );
      }
      entries.set(key, entry);
    }
    return [...entries.values()].toSorted((a, b) =>
      compareCanonicalStrings(identity(a), identity(b))
    );
  };
  return {
    controlFiles: merge(
      left.controlFiles,
      right.controlFiles,
      ({ path }) => path,
      ({ hash }) => hash
    ),
    from: left.from,
    packageName: left.packageName,
    packageVersion: left.packageVersion,
    probes: merge(
      left.probes,
      right.probes,
      ({ kind, path }) => `${path}\u0000${kind}`,
      ({ present }) => String(present)
    ),
    realpaths: merge(
      left.realpaths,
      right.realpaths,
      ({ path }) => path,
      ({ target }) => target
    ),
    specifier: left.specifier,
  };
}

type ProviderFrontierTransaction = Readonly<{
  capture: (
    optionsHash: CapturedProviderResolution["optionsHash"],
    input: ProviderResolutionFrontierInput
  ) => Promise<CapturedProviderResolution>;
  recheck: () => Promise<void>;
}>;

type TransactionPathLedger = Readonly<{
  directories: ReadonlyArray<
    Readonly<{
      entries: ReadonlyArray<
        Readonly<{
          kind: "directory" | "file" | "other";
          name: string;
          symbolicLink: boolean;
        }>
      >;
      path: string;
      present: boolean;
      target: string | null;
    }>
  >;
  files: ReadonlyArray<
    Readonly<{
      path: string;
      present: boolean;
      target: string | null;
    }>
  >;
}>;

function transactionWorkspacePath(workspaceRoot: string, file: string): string {
  const path = relative(workspaceRoot, resolve(file)).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error(
      `Provider resolution frontier escapes its workspace root: ${file}`
    );
  }
  return path.normalize("NFC");
}

async function captureTransactionPathLedger(
  workspaceRoot: string,
  files: ReadonlyArray<string>,
  directories: ReadonlyArray<string>
): Promise<TransactionPathLedger> {
  const root = resolve(workspaceRoot);
  const uniqueFiles = [
    ...new Set(
      files.map((path) => resolve(path)).filter((path) => path !== root)
    ),
  ].toSorted(compareCanonicalStrings);
  const uniqueDirectories = [
    ...new Set(
      directories.map((path) => resolve(path)).filter((path) => path !== root)
    ),
  ].toSorted(compareCanonicalStrings);
  const capturedDirectories = await Promise.all(
    uniqueDirectories.map(async (path) => {
      const entry = await lstat(path).catch((error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return undefined;
        }
        throw error;
      });
      if (!entry) {
        return {
          ledger: {
            entries: [],
            path: transactionWorkspacePath(root, path),
            present: false,
            target: null,
          },
          path,
          target: undefined,
        };
      }
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw new Error(
          `Mirai Intl transaction directory is not a regular directory: ${path}`
        );
      }
      const target = await realpath(path);
      return {
        ledger: {
          entries: (await readdir(path, { withFileTypes: true }))
            // `.mirai-intl` is the transaction's own package-local output.
            // Keep watching every sibling entry so a concurrent source or
            // config addition remains fatal, but do not make the commit
            // fingerprint self-invalidating when immutable authority objects
            // are installed before the selector rename.
            .filter((child) => child.name !== ".mirai-intl")
            .map((child) => {
              let kind: "directory" | "file" | "other" = "other";
              if (child.isDirectory()) {
                kind = "directory";
              } else if (child.isFile()) {
                kind = "file";
              }
              return {
                kind,
                name: child.name.normalize("NFC"),
                symbolicLink: child.isSymbolicLink(),
              };
            })
            .toSorted((left, right) =>
              compareCanonicalStrings(left.name, right.name)
            ),
          path: transactionWorkspacePath(root, path),
          present: true,
          target: transactionWorkspacePath(root, target),
        },
        path,
        target,
      };
    })
  );
  const directoryTargets = new Map(
    capturedDirectories.flatMap(({ path, target }) =>
      target === undefined ? [] : ([[path, target]] as const)
    )
  );
  return {
    directories: capturedDirectories.map(({ ledger }) => ledger),
    files: await Promise.all(
      uniqueFiles.map(async (path) => {
        const entry = await lstat(path).catch((error: unknown) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return undefined;
          }
          throw error;
        });
        if (!entry) {
          return {
            path: transactionWorkspacePath(root, path),
            present: false,
            target: null,
          };
        }
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new Error(
            `Mirai Intl transaction input is not a regular file: ${path}`
          );
        }
        const directoryTarget = directoryTargets.get(dirname(path));
        return {
          path: transactionWorkspacePath(root, path),
          present: true,
          // Every transaction file contributes its dirname to the directory
          // ledger. Once that directory's exact realpath is sealed, a regular
          // non-symlink child's target is that canonical parent plus basename.
          // This preserves ancestor-symlink identity while avoiding thousands
          // of redundant realpath syscalls on large source universes.
          target: transactionWorkspacePath(
            root,
            directoryTarget === undefined
              ? await realpath(path)
              : join(directoryTarget, basename(path))
          ),
        };
      })
    ),
  };
}

function transactionLedgerDifference(
  before: TransactionPathLedger,
  after: TransactionPathLedger
): string | undefined {
  type LedgerEntry =
    | TransactionPathLedger["directories"][number]
    | TransactionPathLedger["files"][number];
  const entries = (
    ledger: TransactionPathLedger
  ): ReadonlyMap<string, LedgerEntry> =>
    new Map([
      ...ledger.directories.map(
        (entry) => [`directory:${entry.path}`, entry] as const
      ),
      ...ledger.files.map((entry) => [`file:${entry.path}`, entry] as const),
    ]);
  const sameEntry = (
    left: LedgerEntry | undefined,
    right: LedgerEntry | undefined
  ) => {
    if (
      left === undefined ||
      right === undefined ||
      left.path !== right.path ||
      left.present !== right.present ||
      left.target !== right.target ||
      "entries" in left !== "entries" in right
    ) {
      return false;
    }
    if (!("entries" in left) || !("entries" in right)) {
      return true;
    }
    return (
      left.entries.length === right.entries.length &&
      left.entries.every((entry, index) => {
        const candidate = right.entries[index];
        return (
          candidate !== undefined &&
          entry.kind === candidate.kind &&
          entry.name === candidate.name &&
          entry.symbolicLink === candidate.symbolicLink
        );
      })
    );
  };
  const beforeEntries = entries(before);
  const afterEntries = entries(after);
  return [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])]
    .toSorted(compareCanonicalStrings)
    .find((key) => !sameEntry(beforeEntries.get(key), afterEntries.get(key)));
}

function sameHashPathEntries(
  left: ReadonlyArray<Readonly<{ hash: string; path: string }>>,
  right: ReadonlyArray<Readonly<{ hash: string; path: string }>>
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        entry.hash === candidate.hash &&
        entry.path === candidate.path
      );
    })
  );
}

function sameSourceSnapshotHashes(
  left: ReadonlyArray<readonly [string, string]>,
  right: ReadonlyArray<readonly [string, string]>
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        entry[0] === candidate[0] &&
        entry[1] === candidate[1]
      );
    })
  );
}

/**
 * Capture each exact provider-resolution identity once while assembling one
 * immutable authorization snapshot. The cache intentionally dies with the
 * transaction; a final uncached pass revalidates the live filesystem.
 */
function createProviderFrontierTransaction(
  workspaceRoot: string,
  snapshotIdentity: `sha256:${string}`
): ProviderFrontierTransaction {
  const root = resolve(workspaceRoot);
  const captures = new Map<
    string,
    Readonly<{
      input: ProviderResolutionFrontierInput;
      inputIdentity: string;
      optionsHash: CapturedProviderResolution["optionsHash"];
      result: Promise<CapturedProviderResolution>;
    }>
  >();
  const inputIdentities = new WeakMap<
    ProviderResolutionFrontierInput,
    Readonly<{ from: string; identity: string; specifier: string }>
  >();
  const inputIdentity = (
    input: ProviderResolutionFrontierInput
  ): Readonly<{ from: string; identity: string; specifier: string }> => {
    const existing = inputIdentities.get(input);
    if (existing) {
      return existing;
    }
    const canonicalInput = {
      controlFiles: input.controlFiles
        .map((entry) => ({
          hash: entry.hash,
          path: transactionWorkspacePath(root, entry.path),
        }))
        .toSorted((left, right) =>
          compareCanonicalStrings(left.path, right.path)
        ),
      from: transactionWorkspacePath(root, input.from),
      packageName: input.packageName,
      packageVersion: input.packageVersion,
      probes: input.probes
        .filter((probe) => resolve(probe.path) !== root)
        .map((probe) => ({
          kind: probe.kind,
          path: transactionWorkspacePath(root, probe.path),
          present: probe.present,
        }))
        .toSorted((left, right) =>
          compareCanonicalStrings(
            `${left.path}\u0000${left.kind}`,
            `${right.path}\u0000${right.kind}`
          )
        ),
      realpaths: input.realpaths
        .filter((entry) => resolve(entry.path) !== root)
        .map((entry) => ({
          path: transactionWorkspacePath(root, entry.path),
          target: transactionWorkspacePath(root, entry.target),
        }))
        .toSorted((left, right) =>
          compareCanonicalStrings(left.path, right.path)
        ),
      specifier: input.specifier,
    };
    const identity = {
      from: canonicalInput.from,
      identity: canonicalJson(canonicalInput),
      specifier: canonicalInput.specifier,
    };
    inputIdentities.set(input, identity);
    return identity;
  };
  return {
    capture(optionsHash, input) {
      const canonicalInput = inputIdentity(input);
      const transactionKey = canonicalJson({
        from: canonicalInput.from,
        optionsHash,
        snapshotIdentity,
        specifier: canonicalInput.specifier,
      });
      const existing = captures.get(transactionKey);
      if (existing) {
        if (existing.inputIdentity !== canonicalInput.identity) {
          throw new Error(
            `Conflicting semantic provider resolution identity: ${canonicalInput.from} -> ${canonicalInput.specifier}`
          );
        }
        return existing.result;
      }
      const result = captureProviderResolutionFrontier(
        root,
        optionsHash,
        input
      );
      captures.set(transactionKey, {
        input,
        inputIdentity: canonicalInput.identity,
        optionsHash,
        result,
      });
      return result;
    },
    async recheck() {
      await Promise.all(
        [...captures.values()].map(async ({ optionsHash, result }) => {
          const expected = await result;
          await verifyProviderResolutionFrontier(root, optionsHash, expected);
        })
      );
    },
  };
}

function internStructural<T extends object>(
  pool: Map<string, object>,
  value: T
): T {
  const identity = canonicalJson(value);
  const existing = pool.get(identity);
  if (existing) {
    return existing as T;
  }
  pool.set(identity, value);
  return value;
}

async function createConventionCheckReceipt(
  packageRoot: string,
  loaded: LoadedConventionCatalog,
  finalVerificationOptions: AuthorizationOptions,
  semanticModules: Promise<SemanticModules>
): Promise<
  Readonly<{
    receipt: IntlCheckReceipt;
    verification: Awaited<ReturnType<typeof verifyLoadedConventionCatalog>>;
  }>
> {
  const profileStarted = performance.now();
  let profilePrior = profileStarted;
  const profilePhases: Array<
    Readonly<{ milliseconds: number; phase: string }>
  > = [];
  const markProfilePhase = (phase: string): void => {
    if (process.env.MIRAI_INTL_INTERNAL_AUTHORIZATION_PROFILE !== "1") {
      return;
    }
    const now = performance.now();
    profilePhases.push({ milliseconds: now - profilePrior, phase });
    profilePrior = now;
  };
  const root = resolve(loaded.repositoryRoot);
  const verificationBefore = await verifyLoadedConventionCatalog(loaded, {
    collectEnvironment: false,
  });
  const discoveredFiles = await collectConventionSourceFiles(
    root,
    loaded.discovery.output
  );
  const { analyze, ownership } = await semanticModules;
  const { resolveConventionSourceUniverse } = ownership;
  const universe = await resolveConventionSourceUniverse(
    root,
    loaded.checkProjects,
    loaded.discovery.output,
    discoveredFiles
  );
  markProfilePhase("verify-and-resolve-universe");
  const generationReceiptPath = join(
    root,
    loaded.discovery.output,
    "catalog-generation-receipt.v1.json"
  );
  const [
    sourceSnapshots,
    generationReceiptBefore,
    generatedFacadeHashBefore,
    applicationBefore,
    immutableBefore,
  ] = await Promise.all([
    analyze.loadConventionSourceSnapshots(universe.files),
    readFile(generationReceiptPath).then(sha256),
    readFile(join(root, loaded.discovery.output, "index.ts")).then(sha256),
    computeApplicationPackageIdentity(root),
    computeImmutableIntegrityIdentity(),
  ]);
  const projectManifestBefore = universe.projects.flatMap((project) =>
    project.configManifest.map(({ hash, path }) => ({ hash, path }))
  );
  const transactionInputFiles = [
    ...sourceSnapshots.map(({ absolute }) => absolute),
    ...universe.projects.flatMap((project) =>
      project.configManifest.map((entry) =>
        resolve(universe.workspaceRoot, entry.path)
      )
    ),
    ...loaded.watch.files.map((path) => resolve(root, path)),
    generationReceiptPath,
    join(root, "package.json"),
    ...(applicationBefore.lock
      ? [join(universe.workspaceRoot, applicationBefore.lock.name)]
      : []),
  ];
  const transactionInputDirectories = [
    ...transactionInputFiles.map(dirname),
    ...loaded.watch.roots.map((path) => resolve(root, path)),
  ];
  const transactionLedgerBefore = await captureTransactionPathLedger(
    universe.workspaceRoot,
    transactionInputFiles,
    transactionInputDirectories
  );
  markProfilePhase("snapshot-and-input-ledger");
  const classifierTransaction =
    await createMiraiIntlClassifierWorkspaceTransactionV3(
      universe.workspaceRoot,
      {
        publicationBarrierGeneratedFacadeHash: generatedFacadeHashBefore,
      }
    );
  const classifierProjectControls = new Map(
    universe.projects
      .filter((project) => project.role === "owner")
      .map(
        (project) =>
          [
            project.path,
            project.configManifest.map(({ hash, path }) => ({
              hash,
              path: resolve(universe.workspaceRoot, path),
            })),
          ] as const
      )
  );
  const analyzeSources = (
    options: AnalyzeSourcesModule.AnalyzeConventionSourcesOptions
  ) =>
    analyze.analyzeLoadedConventionSourceFiles(
      loaded,
      root,
      loaded.discovery.output,
      universe.files,
      universe.workspaceRoot,
      options,
      sourceSnapshots,
      classifierProjectControls
    );
  const [classifierQualification, analysis] = finalVerificationOptions.dormantV3
    ? await Promise.all([
        analyzeSources({
          classifier: {
            mode: "approved",
            transaction: classifierTransaction,
          },
        }),
        // Dormant V3 must not weaken the selected V2 receipt. Preserve its
        // complete semantic closure while qualifying the classifier in
        // parallel over the exact same sealed source snapshots.
        analyzeSources({}),
      ])
    : await analyzeSources({
        classifier: {
          mode: "approved",
          transaction: classifierTransaction,
        },
      }).then((filtered) => [filtered, filtered] as const);
  const failedAnalysis =
    classifierQualification && classifierQualification.diagnostics.length > 0
      ? classifierQualification
      : analysis;
  markProfilePhase("classifier-and-semantic-analysis");
  if (failedAnalysis.diagnostics.length > 0) {
    throw new IntlSourceAuthorizationError(
      failedAnalysis.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        file: (isAbsolute(diagnostic.file)
          ? relative(root, diagnostic.file)
          : diagnostic.file
        )
          .split(sep)
          .join("/"),
      })),
      {
        checkerProjects: universe.projects.filter(
          (project) => project.role === "checker"
        ).length,
        ownerProjects: universe.projects.filter(
          (project) => project.role === "owner"
        ).length,
        semanticAuthorizationRuns: 1,
        semanticFilesAnalyzed: failedAnalysis.classifierProgramFiles.length,
      }
    );
  }
  // No more classifier observations are recorded after successful source
  // analysis. Finalize its immutable authority while the independent receipt
  // projection and provider frontier are assembled below.
  const classifierFinalized = classifierTransaction.finalize();
  void classifierFinalized.catch(() => {
    // The awaited promise below remains authoritative; this only prevents an
    // early rejection from becoming unhandled while provider work completes.
  });
  const universeIdentity = (value: typeof universe): unknown => ({
    files: value.files.map(({ file, owner }) => ({ file, owner })),
    projects: value.projects,
    workspaceRoot: value.workspaceRoot,
  });
  // The transform emits a diagnostic when a finite translation key actually
  // needs a provider beyond the bounded frontier. An overflow from unrelated
  // imports is not authorization evidence and must not reject an otherwise
  // complete source verdict.
  const providerInputs = [
    ...new Map(
      analysis.evidence
        .flatMap((evidence) => [...evidence.declarations, ...evidence.libs])
        .filter((entry) => !entry.path.startsWith("@typescript/lib/"))
        .map((entry) => [entry.path, entry] as const)
    ).values(),
  ];
  const sourceSnapshotHashes = sourceSnapshots.map(
    ({ absolute, sourceHash }) => [absolute, sourceHash] as const
  );
  const providerInputFiles = providerInputs.map((entry) =>
    resolve(universe.workspaceRoot, entry.path)
  );
  const providerLedgerBefore = captureTransactionPathLedger(
    universe.workspaceRoot,
    providerInputFiles,
    providerInputFiles.map(dirname)
  );
  void providerLedgerBefore.catch(() => {
    // Preserve the rejection for the publication barrier await below.
  });
  const snapshotIdentity = canonicalHash({
    application: applicationBefore,
    generationReceiptHash: generationReceiptBefore,
    immutable: immutableBefore,
    projectManifest: projectManifestBefore,
    providerInputs: providerInputs.map((entry) => ({
      hash: entry.hash,
      path: entry.path,
    })),
    sources: sourceSnapshotHashes.map(([file, hash]) => ({
      file: transactionWorkspacePath(universe.workspaceRoot, file),
      hash,
    })),
    universe: universeIdentity(universe),
    verificationContentHash: verificationBefore.write.contentHash,
  });
  const providerFrontiers = createProviderFrontierTransaction(
    universe.workspaceRoot,
    snapshotIdentity
  );
  const structuralFilePool = new Map<string, object>();
  const structuralProviderPool = new Map<string, object>();
  const workspacePackagePath = relative(
    universe.workspaceRoot,
    join(root, "package.json")
  )
    .split(sep)
    .join("/");
  const applicationIdentity = {
    packageManifest: {
      hash: finalVerificationOptions.dormantV3
        ? applicationBefore.packageJsonHash
        : sha256(await readFile(join(root, "package.json"))),
      path: workspacePackagePath,
    },
    workspaceLockfile: applicationBefore.lock
      ? {
          hash: applicationBefore.lock.hash,
          path: applicationBefore.lock.name,
        }
      : {
          hash: finalVerificationOptions.dormantV3
            ? applicationBefore.packageJsonHash
            : sha256(await readFile(join(root, "package.json"))),
          path: workspacePackagePath,
        },
  };
  const sourceHashes = new Map(sourceSnapshotHashes);
  const packagePrefix = relative(universe.workspaceRoot, root)
    .split(sep)
    .join("/");
  const exceptions = loaded.checkExceptions.map((exception) => ({
    ...exception,
    file:
      packagePrefix === ""
        ? exception.file
        : `${packagePrefix}/${exception.file}`,
  }));
  const exceptionFiles = new Set(exceptions.map((exception) => exception.file));
  const sources = universe.files.map((entry) => ({
    file: entry.file,
    hash:
      sourceHashes.get(entry.absolute) ??
      (() => {
        throw new Error(`Missing source snapshot for ${entry.file}`);
      })(),
    owner: entry.owner,
    verdict: exceptionFiles.has(entry.file)
      ? ("exception" as const)
      : ("accepted" as const),
  }));
  const ownerBySource = new Map(
    universe.files.map((entry) => [entry.file, entry.owner])
  );
  const projectByPath = new Map(
    universe.projects.map((project) => [project.path, project])
  );
  const mergedProviderFrontiers = new Map<
    string,
    ProviderResolutionFrontierInput
  >();
  for (const entry of analysis.evidence) {
    const owner = ownerBySource.get(entry.source);
    const project = owner ? projectByPath.get(owner) : undefined;
    if (!project) {
      throw new Error(
        `Semantic provider closure has no owning check project: ${entry.source}`
      );
    }
    const optionsHash = canonicalHash(project.normalizedOptions);
    for (const resolution of entry.providers.flatMap(
      (provider) => provider.resolutions
    )) {
      const key = canonicalJson([
        optionsHash,
        resolution.from,
        resolution.specifier,
      ]);
      const existing = mergedProviderFrontiers.get(key);
      mergedProviderFrontiers.set(
        key,
        existing
          ? mergeProviderResolutionFrontiers(existing, resolution)
          : resolution
      );
    }
  }
  const providerClosures = await Promise.all(
    analysis.evidence.map(async (entry) => {
      const owner = ownerBySource.get(entry.source);
      const project = owner ? projectByPath.get(owner) : undefined;
      if (!project) {
        throw new Error(
          `Semantic provider closure has no owning check project: ${entry.source}`
        );
      }
      if (entry.unsupportedProviderResolutionOptions.length > 0) {
        throw new Error(
          `Mirai Intl source authorization does not support TypeScript provider resolution option(s): ${entry.unsupportedProviderResolutionOptions.join(", ")}`
        );
      }
      const optionsHash = canonicalHash(project.normalizedOptions);
      const providers = entry.providerBudgetExceeded
        ? entry.providers.slice(0, entry.providerRootLimit)
        : entry.providers;
      return {
        ambientTypeFileLimit: entry.ambientTypeFileLimit,
        declarations: entry.declarations.map((declaration) =>
          internStructural(structuralFilePool, declaration)
        ),
        libs: entry.libs.map((lib) =>
          internStructural(structuralFilePool, lib)
        ),
        providerBudgetExceeded: false as const,
        providerRootLimit: entry.providerRootLimit,
        providers: await Promise.all(
          providers.map(async (provider) =>
            internStructural(structuralProviderPool, {
              declarations: provider.declarations.map((declaration) =>
                internStructural(structuralFilePool, declaration)
              ),
              kind: provider.kind,
              resolutions: await Promise.all(
                provider.resolutions.map((resolution) => {
                  const merged = mergedProviderFrontiers.get(
                    canonicalJson([
                      optionsHash,
                      resolution.from,
                      resolution.specifier,
                    ])
                  );
                  if (!merged) {
                    throw new Error(
                      `Missing semantic provider resolution frontier: ${resolution.from} -> ${resolution.specifier}`
                    );
                  }
                  return providerFrontiers.capture(optionsHash, merged);
                })
              ),
              root: provider.root,
            })
          )
        ),
        source: entry.source,
      };
    })
  );
  const loadedLibs = new Map(
    analysis.evidence.flatMap((entry) =>
      entry.libs.map(
        (file) =>
          [file.path, internStructural(structuralFilePool, file)] as const
      )
    )
  );
  const snapshotInput = {
    application: applicationIdentity,
    artifactAbi,
    compilerManifest: immutableBefore.compiler.modules.entries.map(
      ({ hash, path }) => ({ hash, path })
    ),
    exceptions,
    generationReceiptHash: generationReceiptBefore,
    icu: packageIdentity(immutableBefore.icuParser),
    observedCounters: {
      semanticAuthorizationRuns: 1,
      semanticFilesAnalyzed: providerClosures.length,
    },
    projects: universe.projects,
    providerClosures,
    runtimeAbi: RUNTIME_ABI,
    sources,
    typescript: {
      libs: [...loadedLibs.values()].toSorted((left, right) =>
        compareCanonicalStrings(left.path, right.path)
      ),
      package: packageIdentity(immutableBefore.typescript),
    },
  } as const;
  markProfilePhase("provider-frontiers-and-snapshot-input");
  const receiptV2 = finalVerificationOptions.dormantV3
    ? buildIntlCheckReceiptV2(buildSourceAuthorizationSnapshot(snapshotInput))
    : undefined;
  let finalVerification:
    | Awaited<ReturnType<typeof verifyLoadedConventionCatalog>>
    | undefined;
  const finalizedClassifier = await classifierFinalized;
  const v3Binding = receiptV2
    ? buildIntlCheckReceiptV3FromClassifierProjections(
        receiptV2,
        finalizedClassifier.authorities.map((authority, index) => {
          const projection = finalizedClassifier.receiptProjections[index];
          if (!projection) {
            throw new Error(
              "Mirai Intl classifier finalized projection coverage is incomplete"
            );
          }
          return { authority, projection };
        })
      )
    : buildIntlCheckReceiptV3FromNativeInputs(
        snapshotInput,
        finalizedClassifier.authorities.map((authority, index) => {
          const projection = finalizedClassifier.receiptProjections[index];
          if (!projection) {
            throw new Error(
              "Mirai Intl classifier finalized projection coverage is incomplete"
            );
          }
          return { authority, projection };
        })
      );
  markProfilePhase("v3-receipt-and-authority-binding");
  const receipt: IntlCheckReceipt = receiptV2 ?? v3Binding.receipt;
  await finalVerificationOptions.beforePublicationBarrier?.();
  // Perform one uncached receipt-bound workspace pass immediately before the
  // selector commit. Each byte family has one owner: source snapshots below,
  // project manifests in source-universe resolution, declaration/lib inputs in
  // providerInputs, and resolution controls/probes/realpaths in the provider
  // frontier transaction. Reading those families again would add I/O without
  // strengthening the commit barrier.
  const verifyPublicationFingerprint = async (): Promise<void> => {
    const initialProviderLedger = await providerLedgerBefore;
    const useCommittedSnapshotVerification =
      finalVerificationOptions.validateEnvironment === true ||
      finalVerificationOptions.collectEnvironment === false;
    const freshGeneration = useCommittedSnapshotVerification
      ? await loadFreshConventionCatalogGenerationInput(packageRoot)
      : undefined;
    const afterLoaded =
      freshGeneration?.loaded ?? (await loadConventionCatalog(packageRoot));
    let verificationOptions: ConventionOptions = {};
    if (finalVerificationOptions.validateEnvironment) {
      verificationOptions = { collectEnvironment: false };
    } else if (finalVerificationOptions.collectEnvironment !== undefined) {
      verificationOptions = {
        collectEnvironment: finalVerificationOptions.collectEnvironment,
      };
    }
    const [verification, afterDiscoveredFiles, committedSnapshot] =
      await Promise.all([
        Promise.all([
          finalVerificationOptions.validateEnvironment
            ? validateConventionEnvironment(afterLoaded)
            : Promise.resolve(),
          useCommittedSnapshotVerification
            ? Promise.resolve(verificationBefore)
            : verifyLoadedConventionCatalog(afterLoaded, verificationOptions),
        ]).then(([, result]) => result),
        collectConventionSourceFiles(root, afterLoaded.discovery.output),
        useCommittedSnapshotVerification
          ? verifyCommittedArtifactSnapshot(
              afterLoaded.outputRoot,
              verificationBefore.write,
              generationReceiptBefore
            )
          : Promise.resolve(undefined),
      ]);
    if (
      freshGeneration &&
      committedSnapshot &&
      canonicalJson(freshGeneration.integrity.application) !==
        canonicalJson(applicationBefore)
    ) {
      throw new Error(
        "Mirai Intl application package inputs changed while source analysis ran"
      );
    }
    if (
      freshGeneration &&
      canonicalJson(freshGeneration.integrity.immutable) !==
        canonicalJson(immutableBefore)
    ) {
      throw new Error(
        "Mirai Intl compiler dependency inputs changed while source analysis ran"
      );
    }
    if (
      freshGeneration &&
      committedSnapshot &&
      canonicalHash(freshGeneration.generationInput) !==
        committedSnapshot.generationInputHash
    ) {
      throw new Error(
        "Mirai Intl generated catalog changed while source analysis ran"
      );
    }
    const afterUniverse = await resolveConventionSourceUniverse(
      root,
      afterLoaded.checkProjects,
      afterLoaded.discovery.output,
      afterDiscoveredFiles
    );
    if (
      canonicalJson(universeIdentity(universe)) !==
      canonicalJson(universeIdentity(afterUniverse))
    ) {
      throw new Error(
        "Mirai Intl source universe changed while source analysis ran"
      );
    }
    const projectManifestAfter = afterUniverse.projects.flatMap((project) =>
      project.configManifest.map(({ hash, path }) => ({ hash, path }))
    );
    const [
      afterSources,
      finalProviderInputHashes,
      publicationLedger,
      publicationProviderLedger,
      publicationGenerationReceiptHash,
      publicationApplication,
      publicationImmutable,
    ] = await Promise.all([
      Promise.all(
        afterUniverse.files.map(async ({ absolute }) => {
          const bytes = await readFile(absolute).catch((error: unknown) => {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            ) {
              throw new Error(
                "Mirai Intl source universe changed while source analysis ran"
              );
            }
            throw error;
          });
          decodeUtf8Fatal(bytes, `Mirai Intl source ${absolute}`);
          return [absolute, sha256(bytes)] as const;
        })
      ),
      Promise.all(
        providerInputs.map(async (entry) => ({
          actual: sha256(
            await readFile(resolve(universe.workspaceRoot, entry.path))
          ),
          expected: entry.hash,
        }))
      ),
      captureTransactionPathLedger(
        universe.workspaceRoot,
        transactionInputFiles,
        transactionInputDirectories
      ),
      captureTransactionPathLedger(
        universe.workspaceRoot,
        providerInputFiles,
        providerInputFiles.map(dirname)
      ),
      useCommittedSnapshotVerification
        ? Promise.resolve(generationReceiptBefore)
        : readFile(generationReceiptPath).then(sha256),
      useCommittedSnapshotVerification
        ? Promise.resolve(applicationBefore)
        : computeApplicationPackageIdentity(root),
      useCommittedSnapshotVerification
        ? Promise.resolve(immutableBefore)
        : computeImmutableIntegrityIdentity(),
      providerFrontiers.recheck(),
    ]);
    if (!sameSourceSnapshotHashes(sourceSnapshotHashes, afterSources)) {
      throw new Error(
        "Mirai Intl source inputs changed while source analysis ran"
      );
    }
    if (!sameHashPathEntries(projectManifestAfter, projectManifestBefore)) {
      throw new Error(
        "Mirai Intl TypeScript project configuration changed while source analysis ran"
      );
    }
    for (const { actual, expected } of finalProviderInputHashes) {
      if (actual !== expected) {
        throw new Error(
          "Mirai Intl semantic provider inputs changed while source analysis ran"
        );
      }
    }
    if (
      verification.write.contentHash !== verificationBefore.write.contentHash
    ) {
      throw new Error(
        "Mirai Intl generated catalog changed while source analysis ran"
      );
    }
    const publicationLedgerMutation = transactionLedgerDifference(
      transactionLedgerBefore,
      publicationLedger
    );
    const publicationProviderLedgerMutation = transactionLedgerDifference(
      initialProviderLedger,
      publicationProviderLedger
    );
    const publicationLedgerDifference =
      publicationLedgerMutation ?? publicationProviderLedgerMutation;
    if (publicationLedgerDifference) {
      throw new Error(
        `Mirai Intl filesystem transaction ledger changed while source analysis ran: ${publicationLedgerDifference}`
      );
    }
    if (publicationGenerationReceiptHash !== generationReceiptBefore) {
      throw new Error(
        "Mirai Intl generated catalog changed while source analysis ran"
      );
    }
    if (
      canonicalJson(publicationApplication) !== canonicalJson(applicationBefore)
    ) {
      throw new Error(
        "Mirai Intl application package inputs changed while source analysis ran"
      );
    }
    if (
      canonicalJson(publicationImmutable) !== canonicalJson(immutableBefore)
    ) {
      throw new Error(
        "Mirai Intl compiler dependency inputs changed while source analysis ran"
      );
    }
    finalVerification = verification;
    markProfilePhase("publication-precommit-verification");
  };
  await publishDormantConventionAuthorityV3(
    resolve(packageRoot),
    universe.workspaceRoot,
    receiptV2 ?? null,
    v3Binding,
    finalizedClassifier,
    {
      activateV3: !finalVerificationOptions.dormantV3,
      ...(finalVerificationOptions.dormantV3PublicationBoundary
        ? {
            dormantV3PublicationBoundary:
              finalVerificationOptions.dormantV3PublicationBoundary,
          }
        : {}),
      dormantV3PublicationDeadlineMs:
        finalVerificationOptions.dormantV3PublicationDeadlineMs ??
        (finalVerificationOptions.dormantV3PublicationNow?.() ??
          performance.now()) + 20_000,
      dormantV3PublicationFingerprintVerification: verifyPublicationFingerprint,
      dormantV3PublicationNow:
        finalVerificationOptions.dormantV3PublicationNow ??
        (() => performance.now()),
    }
  );
  markProfilePhase("selector-commit");
  if (process.env.MIRAI_INTL_INTERNAL_AUTHORIZATION_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_AUTHORIZATION_PROFILE=${JSON.stringify({
        phases: profilePhases,
        totalMilliseconds: performance.now() - profileStarted,
      })}\n`
    );
  }
  if (!finalVerification) {
    throw new Error(
      "Mirai Intl publication completed without final live verification"
    );
  }
  return {
    receipt,
    verification: finalVerification,
  };
}

/**
 * Materialize source authority and return the environment-aware catalog
 * verification produced by the fresh post-analysis snapshot.
 *
 * @internal Used by the workspace CLI to avoid a redundant third verification.
 */
export async function authorizeConventionCatalog(
  packageRoot: string,
  finalVerificationOptions: AuthorizationOptions = {}
): Promise<
  Readonly<{
    receipt: IntlCheckReceipt;
    verification: Awaited<ReturnType<typeof verifyLoadedConventionCatalog>>;
  }>
> {
  const profileStarted = performance.now();
  const root = resolve(packageRoot);
  const semanticModules = Promise.all([
    import("./analyze-sources"),
    import("./ownership"),
  ]).then(([analyze, ownership]) => ({ analyze, ownership }));
  // Proof is the production authority entrypoint. It must be able to
  // materialize the immutable content-addressed payload after a clean clone,
  // while a matching catalog remains a writer no-op.
  const ensured = await ensureMiraiIntlCatalog({ root });
  if (process.env.MIRAI_INTL_INTERNAL_AUTHORIZATION_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_ENSURE_PROFILE=${JSON.stringify({ milliseconds: performance.now() - profileStarted })}\n`
    );
  }
  const authorization = await createConventionCheckReceipt(
    root,
    ensured.loaded,
    finalVerificationOptions,
    semanticModules
  );
  await rm(join(root, ".mirai-intl", "check-receipt.v1.json"), {
    force: true,
  });
  return authorization;
}

/** Materialize, verify and atomically persist deterministic source authority. */
export async function proveConventionCatalog(
  packageRoot: string
): Promise<IntlCheckReceipt> {
  return (
    await authorizeConventionCatalog(packageRoot, {
      collectEnvironment: false,
      validateEnvironment: process.env.MIRAI_INTL_WORKSPACE_CHILD === "1",
    })
  ).receipt;
}

/** Reject a missing, stale, malformed, or non-canonical source receipt. */
export async function verifyConventionCheckReceipt(
  packageRoot: string
): Promise<IntlCheckReceipt> {
  return (await verifyConventionBuildReceipt(packageRoot)).receipt;
}

/** Records the bytes produced before a postbuild artifact audit. */
export async function writeProvisionalBuildProof(
  packageRoot: string,
  artifactRoot: string,
  target: IntlBuildProofTargetV1,
  modules: ReadonlyArray<IntlEmittedModuleV1>,
  mapRoot: string = artifactRoot
): Promise<IntlBuildProofV1> {
  const root = resolve(packageRoot);
  const receipt = await verifyConventionCheckReceipt(root);
  const receipts = await buildProofReceipts(root, receipt);
  const emitted = await emittedEvidence(
    resolve(artifactRoot),
    modules,
    resolve(mapRoot)
  );
  const proof = {
    authorityHash: receipts.authorityHash,
    deploymentReceiptHash: receipts.deploymentReceiptHash,
    emitted,
    graphHash: canonicalHash({ emitted, target }),
    schemaVersion: 1 as const,
    state: "provisional" as const,
    target,
  } satisfies IntlBuildProofV1;
  await writeProof(proofPath(root, target, "provisional"), proof);
  return proof;
}

/** Finalizes a proof only when the actual postbuild bytes match provision. */
export async function finalizeBuildProof(
  packageRoot: string,
  artifactRoot: string,
  target: IntlBuildProofTargetV1,
  modules: ReadonlyArray<IntlEmittedModuleV1>,
  mapRoot: string = artifactRoot
): Promise<IntlBuildProofV1> {
  const root = resolve(packageRoot);
  const provisional = await readProof(proofPath(root, target, "provisional"));
  if (provisional.state !== "provisional" || provisional.target !== target) {
    throw new Error(`Expected a provisional ${target} Mirai Intl build proof`);
  }
  const receipt = await verifyConventionCheckReceipt(root);
  const receipts = await buildProofReceipts(root, receipt);
  const emitted = await emittedEvidence(
    resolve(artifactRoot),
    modules,
    resolve(mapRoot)
  );
  if (
    provisional.authorityHash !== receipts.authorityHash ||
    provisional.deploymentReceiptHash !== receipts.deploymentReceiptHash ||
    provisional.graphHash !== canonicalHash({ emitted, target }) ||
    canonicalJson(provisional.emitted) !== canonicalJson(emitted)
  ) {
    throw new Error("Mirai Intl build outputs changed after provisional proof");
  }
  const finalized = {
    ...provisional,
    state: "finalized" as const,
  } satisfies IntlBuildProofV1;
  await writeProof(proofPath(root, target, "finalized"), finalized);
  return finalized;
}

/**
 * Finalizes multiple already-built deployment targets without provisional
 * proofs. Source authority is verified once, every target is discovered and
 * hashed once, and no proof is written until all target scans succeed.
 */
export async function finalizeBuildProofTargets(
  packageRoot: string,
  targets: ReadonlyArray<IntlBuildProofFinalizationTarget>
): Promise<ReadonlyArray<IntlBuildProofV1>> {
  if (targets.length === 0) {
    throw new Error("Build proof finalization requires at least one target");
  }
  const targetNames = targets.map(({ target }) => target);
  if (new Set(targetNames).size !== targetNames.length) {
    throw new Error("Build proof finalization targets must be unique");
  }

  const root = resolve(packageRoot);
  const receipt = await verifyConventionCheckReceipt(root);
  const receipts = await buildProofReceipts(root, receipt);
  const proofs = await Promise.all(
    targets.map(async ({ artifactRoot, mapRoot = artifactRoot, target }) => {
      const resolvedArtifactRoot = resolve(artifactRoot);
      const resolvedMapRoot = resolve(mapRoot);
      const modules = await discoverEmittedModules(
        resolvedArtifactRoot,
        resolvedMapRoot
      );
      const emitted = await emittedEvidence(
        resolvedArtifactRoot,
        modules,
        resolvedMapRoot
      );
      return {
        authorityHash: receipts.authorityHash,
        deploymentReceiptHash: receipts.deploymentReceiptHash,
        emitted,
        graphHash: canonicalHash({ emitted, target }),
        schemaVersion: 1 as const,
        state: "finalized" as const,
        target,
      } satisfies IntlBuildProofV1;
    })
  );

  await Promise.all(
    proofs.map((proof) =>
      writeProof(proofPath(root, proof.target, "finalized"), proof)
    )
  );
  return proofs;
}

/** Independently validates finalized proof files against deployed bytes. */
export async function verifyFinalizedBuildProof(
  packageRoot: string,
  artifactRoot: string,
  target: IntlBuildProofTargetV1,
  modules: ReadonlyArray<IntlEmittedModuleV1>,
  mapRoot: string = artifactRoot
): Promise<IntlBuildProofV1> {
  const root = resolve(packageRoot);
  const proof = await readProof(proofPath(root, target, "finalized"));
  if (proof.state !== "finalized" || proof.target !== target) {
    throw new Error(`Mirai Intl ${target} proof must be finalized`);
  }
  const receipt = await verifyConventionCheckReceipt(root);
  const receipts = await buildProofReceipts(root, receipt);
  const emitted = await emittedEvidence(
    resolve(artifactRoot),
    modules,
    resolve(mapRoot)
  );
  if (
    proof.authorityHash !== receipts.authorityHash ||
    proof.deploymentReceiptHash !== receipts.deploymentReceiptHash ||
    proof.graphHash !== canonicalHash({ emitted, target }) ||
    canonicalJson(proof.emitted) !== canonicalJson(emitted)
  ) {
    throw new Error(
      "Mirai Intl finalized build proof does not match deployed bytes"
    );
  }
  return proof;
}

export { conventionCheckReceiptPath } from "./check-receipt";
