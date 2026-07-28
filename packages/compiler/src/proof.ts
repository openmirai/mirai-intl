import {
  lstat,
  readdir,
  readFile,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { RUNTIME_ABI } from "@openmirai/intl-abi";
import type {
  IntlBuildProofTargetV1,
  IntlBuildProofV1,
  IntlCheckPackageIdentityV2,
  IntlCheckReceiptV2,
  IntlSemanticAuthorizationObservationV2,
} from "@openmirai/intl-abi";

import {
  canonicalHash,
  canonicalJson,
  compareCanonicalStrings,
  sha256,
} from "./canonical";
import type * as AnalyzeSourcesModule from "./analyze-sources";
import {
  loadConventionCatalog,
  validateConventionEnvironment,
  verifyLoadedConventionCatalog,
} from "./catalog";
import type { ConventionOptions, LoadedConventionCatalog } from "./catalog";
import {
  buildIntlCheckReceiptV2,
  buildSourceAuthorizationSnapshot,
  canonicalIntlCheckReceiptV2Bytes,
} from "./authorization-snapshot";
import {
  conventionCheckReceiptPath,
  verifyConventionBuildReceipt,
} from "./check-receipt";
import {
  computeApplicationPackageIdentity,
  computeImmutableIntegrityIdentity,
} from "./integrity-identity";
import type { ResolvedPackageIdentity } from "./integrity-identity";
import { ensureMiraiIntlCatalog } from "./lifecycle";
import { captureProviderResolutionFrontier } from "./provider-resolution-identity";
import { collectConventionSourceFiles } from "./source-discovery";
import type * as OwnershipModule from "./ownership";

type AuthorizationOptions = ConventionOptions &
  Readonly<{ validateEnvironment?: boolean }>;

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
  receipt: IntlCheckReceiptV2
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

async function writeReceipt(
  path: string,
  receipt: IntlCheckReceiptV2
): Promise<void> {
  const content = canonicalIntlCheckReceiptV2Bytes(receipt);
  const existing = await readFile(path, "utf8").catch(() => undefined);
  // A matching proof is a verified no-op: downstream cache keys can retain
  // inode/mtime stability while callers still receive fresh input validation.
  if (existing === content) {
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
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

async function createConventionCheckReceipt(
  packageRoot: string,
  loaded: LoadedConventionCatalog,
  finalVerificationOptions: AuthorizationOptions,
  semanticModules: Promise<SemanticModules>
): Promise<
  Readonly<{
    receipt: IntlCheckReceiptV2;
    verification: Awaited<ReturnType<typeof verifyLoadedConventionCatalog>>;
  }>
> {
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
  const sourceFiles = universe.files.map(({ absolute }) => absolute);
  const generationReceiptPath = join(
    root,
    loaded.discovery.output,
    "catalog-generation-receipt.v1.json"
  );
  const [
    beforeSources,
    generationReceiptBefore,
    applicationBefore,
    immutableBefore,
  ] = await Promise.all([
    Promise.all(
      sourceFiles.map(
        async (file) => [file, sha256(await readFile(file, "utf8"))] as const
      )
    ),
    readFile(generationReceiptPath, "utf8").then(sha256),
    computeApplicationPackageIdentity(root),
    computeImmutableIntegrityIdentity(),
  ]);
  const analysis = await analyze.analyzeLoadedConventionSourceFiles(
    loaded,
    root,
    loaded.discovery.output,
    universe.files,
    universe.workspaceRoot
  );
  if (analysis.diagnostics.length > 0) {
    throw new IntlSourceAuthorizationError(
      analysis.diagnostics.map((diagnostic) => ({
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
        semanticFilesAnalyzed: analysis.filesAnalyzed,
      }
    );
  }
  // Reload after semantic analysis so catalog/source mutations cannot inherit
  // authority from the pre-analysis snapshot. Workspace authorization keeps
  // the default environment-aware report; receipt-only prove skips that
  // evidence exactly as it did before this combined API existed.
  if (analysis.evidence.some((entry) => entry.providerBudgetExceeded)) {
    throw new Error("Mirai Intl finite semantic provider budget was exceeded");
  }
  const afterLoaded = await loadConventionCatalog(packageRoot);
  let verificationOptions: ConventionOptions = {};
  if (finalVerificationOptions.validateEnvironment) {
    verificationOptions = { collectEnvironment: false };
  } else if (finalVerificationOptions.collectEnvironment !== undefined) {
    verificationOptions = {
      collectEnvironment: finalVerificationOptions.collectEnvironment,
    };
  }
  const [verification, afterDiscoveredFiles] = await Promise.all([
    Promise.all([
      finalVerificationOptions.validateEnvironment
        ? validateConventionEnvironment(afterLoaded)
        : Promise.resolve(),
      verifyLoadedConventionCatalog(afterLoaded, verificationOptions),
    ]).then(([, result]) => result),
    collectConventionSourceFiles(root, afterLoaded.discovery.output),
  ]);
  const afterUniverse = await resolveConventionSourceUniverse(
    root,
    afterLoaded.checkProjects,
    afterLoaded.discovery.output,
    afterDiscoveredFiles
  );
  const universeIdentity = (value: typeof universe): unknown => ({
    files: value.files.map(({ file, owner }) => ({ file, owner })),
    projects: value.projects,
    workspaceRoot: value.workspaceRoot,
  });
  if (
    canonicalJson(universeIdentity(universe)) !==
    canonicalJson(universeIdentity(afterUniverse))
  ) {
    throw new Error(
      "Mirai Intl source universe changed while source analysis ran"
    );
  }
  const providerInputs = [
    ...new Map(
      analysis.evidence
        .flatMap((evidence) => [...evidence.declarations, ...evidence.libs])
        .filter((entry) => !entry.path.startsWith("@typescript/lib/"))
        .map((entry) => [entry.path, entry] as const)
    ).values(),
  ];
  const [
    afterSources,
    projectManifestAfter,
    providerInputHashes,
    generationReceiptHash,
    application,
    immutable,
  ] = await Promise.all([
    Promise.all(
      afterUniverse.files.map(
        async ({ absolute }) =>
          [absolute, sha256(await readFile(absolute, "utf8"))] as const
      )
    ),
    Promise.all(
      universe.projects.flatMap((project) =>
        project.configManifest.map(async (entry) => ({
          hash: sha256(
            await readFile(resolve(universe.workspaceRoot, entry.path), "utf8")
          ),
          path: entry.path,
        }))
      )
    ),
    Promise.all(
      providerInputs.map(async (entry) => ({
        actual: sha256(
          await readFile(resolve(universe.workspaceRoot, entry.path), "utf8")
        ),
        expected: entry.hash,
      }))
    ),
    readFile(generationReceiptPath, "utf8").then(sha256),
    computeApplicationPackageIdentity(root),
    computeImmutableIntegrityIdentity(),
  ]);
  if (canonicalJson(beforeSources) !== canonicalJson(afterSources)) {
    throw new Error(
      "Mirai Intl source inputs changed while source analysis ran"
    );
  }
  const projectManifestBefore = universe.projects.flatMap((project) =>
    project.configManifest.map(({ hash, path }) => ({ hash, path }))
  );
  if (
    canonicalJson(projectManifestAfter) !== canonicalJson(projectManifestBefore)
  ) {
    throw new Error(
      "Mirai Intl TypeScript project configuration changed while source analysis ran"
    );
  }
  for (const { actual, expected } of providerInputHashes) {
    if (actual !== expected) {
      throw new Error(
        "Mirai Intl semantic provider inputs changed while source analysis ran"
      );
    }
  }
  if (
    generationReceiptHash !== generationReceiptBefore ||
    verification.write.contentHash !== verificationBefore.write.contentHash
  ) {
    throw new Error(
      "Mirai Intl generated catalog changed while source analysis ran"
    );
  }
  if (canonicalJson(application) !== canonicalJson(applicationBefore)) {
    throw new Error(
      "Mirai Intl application package inputs changed while source analysis ran"
    );
  }
  if (canonicalJson(immutable) !== canonicalJson(immutableBefore)) {
    throw new Error(
      "Mirai Intl compiler dependency inputs changed while source analysis ran"
    );
  }
  const workspacePackagePath = relative(
    universe.workspaceRoot,
    join(root, "package.json")
  )
    .split(sep)
    .join("/");
  const applicationIdentity = {
    packageManifest: {
      hash: application.packageJsonHash,
      path: workspacePackagePath,
    },
    workspaceLockfile: application.lock
      ? {
          hash: application.lock.hash,
          path: application.lock.name,
        }
      : {
          hash: application.packageJsonHash,
          path: workspacePackagePath,
        },
  };
  const sourceHashes = new Map(afterSources);
  const packagePrefix = relative(universe.workspaceRoot, root)
    .split(sep)
    .join("/");
  const exceptions = afterLoaded.checkExceptions.map((exception) => ({
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
      return {
        ambientTypeFileLimit: entry.ambientTypeFileLimit,
        declarations: entry.declarations,
        libs: entry.libs,
        providerBudgetExceeded: false as const,
        providerRootLimit: entry.providerRootLimit,
        providers: await Promise.all(
          entry.providers.map(async (provider) => ({
            declarations: provider.declarations,
            kind: provider.kind,
            resolutions: await Promise.all(
              provider.resolutions.map((resolution) =>
                captureProviderResolutionFrontier(
                  universe.workspaceRoot,
                  optionsHash,
                  resolution
                )
              )
            ),
            root: provider.root,
          }))
        ),
        source: entry.source,
      };
    })
  );
  const loadedLibs = new Map(
    analysis.evidence.flatMap((entry) =>
      entry.libs.map((file) => [file.path, file] as const)
    )
  );
  const snapshot = buildSourceAuthorizationSnapshot({
    application: applicationIdentity,
    artifactAbi,
    compilerManifest: immutable.compiler.modules.entries.map(
      ({ hash, path }) => ({ hash, path })
    ),
    exceptions,
    generationReceiptHash,
    icu: packageIdentity(immutable.icuParser),
    observedCounters: {
      semanticAuthorizationRuns: 1,
      semanticFilesAnalyzed: analysis.filesAnalyzed,
    },
    projects: universe.projects,
    providerClosures,
    runtimeAbi: RUNTIME_ABI,
    sources,
    typescript: {
      libs: [...loadedLibs.values()].toSorted((left, right) =>
        compareCanonicalStrings(left.path, right.path)
      ),
      package: packageIdentity(immutable.typescript),
    },
  });
  return {
    receipt: buildIntlCheckReceiptV2(snapshot),
    verification,
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
    receipt: IntlCheckReceiptV2;
    verification: Awaited<ReturnType<typeof verifyLoadedConventionCatalog>>;
  }>
> {
  const root = resolve(packageRoot);
  const destination = conventionCheckReceiptPath(root);
  try {
    const semanticModules = Promise.all([
      import("./analyze-sources"),
      import("./ownership"),
    ]).then(([analyze, ownership]) => ({ analyze, ownership }));
    // Proof is the production authority entrypoint. It must be able to
    // materialize the immutable content-addressed payload after a clean clone,
    // while a matching catalog remains a writer no-op.
    const ensured = await ensureMiraiIntlCatalog({ root });
    const authorization = await createConventionCheckReceipt(
      root,
      ensured.loaded,
      finalVerificationOptions,
      semanticModules
    );
    await writeReceipt(destination, authorization.receipt);
    await rm(join(root, ".mirai-intl", "check-receipt.v1.json"), {
      force: true,
    });
    return authorization;
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

/** Materialize, verify and atomically persist deterministic source authority. */
export async function proveConventionCatalog(
  packageRoot: string
): Promise<IntlCheckReceiptV2> {
  return (
    await authorizeConventionCatalog(packageRoot, {
      collectEnvironment: false,
    })
  ).receipt;
}

/** Reject a missing, stale, malformed, or non-canonical source receipt. */
export async function verifyConventionCheckReceipt(
  packageRoot: string
): Promise<IntlCheckReceiptV2> {
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
