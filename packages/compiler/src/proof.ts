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
import { fileURLToPath } from "node:url";

import { RUNTIME_ABI } from "@openmirai/intl-abi";
import type {
  IntlBuildProofTargetV1,
  IntlBuildProofV1,
  IntlCheckReceiptV1,
} from "@openmirai/intl-abi";
import ts from "typescript";

import {
  analyzeConventionSourceFiles,
  collectConventionSourceFiles,
} from "./analyze-sources";
import { canonicalHash, canonicalJson, sha256 } from "./canonical";
import { loadConventionCatalog, verifyConventionCatalog } from "./catalog";
import { ensureMiraiIntlCatalog } from "./lifecycle";
import { resolveConventionSourceUniverse } from "./ownership";

const receiptDirectory = ".mirai-intl";
const receiptName = "check-receipt.v1.json";
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
  return modules.toSorted((left, right) => left.path.localeCompare(right.path));
}

function receiptPath(root: string): string {
  return join(root, receiptDirectory, receiptName);
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
  receipt: IntlCheckReceiptV1
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
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(async ([dependency, dependencyRoot]) => ({
        dependency,
        receipt: await verifyConventionCheckReceipt(dependencyRoot),
      }))
  );
  return {
    authorityHash: canonicalHash({
      dependencies: receipts.map(
        ({ dependency, receipt: dependencyReceipt }) => ({
          dependency,
          receipt: dependencyReceipt.authorityHash,
        })
      ),
      receipt: receipt.authorityHash,
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
    receiptDirectory,
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
    left.path.localeCompare(right.path)
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

async function compilerHash(): Promise<`sha256:${string}`> {
  return sha256(await readFile(fileURLToPath(import.meta.url), "utf8"));
}

async function writeReceipt(
  path: string,
  receipt: IntlCheckReceiptV1
): Promise<void> {
  const content = `${canonicalJson(receipt)}\n`;
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

type ConventionReceiptInputs = Readonly<{
  receipt: IntlCheckReceiptV1;
  root: string;
  sourceFiles: ReadonlyArray<string>;
  snapshot: ReadonlyArray<readonly [string, `sha256:${string}`]>;
}>;

/**
 * Reconstruct the immutable inputs represented by a receipt without running
 * TypeScript semantic analysis. This is deliberately the build-time path:
 * builds may reject stale authority, but only `prove` is allowed to issue
 * authority by running the full source checker.
 */
async function conventionReceiptInputs(
  packageRoot: string
): Promise<ConventionReceiptInputs> {
  const loaded = await loadConventionCatalog(packageRoot);
  const root = resolve(loaded.repositoryRoot);
  const verification = await verifyConventionCatalog(root, {
    collectEnvironment: false,
  });
  const discoveredFiles = await collectConventionSourceFiles(
    root,
    loaded.discovery.output
  );
  const sourceUniverse = await resolveConventionSourceUniverse(
    root,
    loaded.checkProjects,
    loaded.discovery.output,
    discoveredFiles
  );
  const sourceFiles = sourceUniverse.files.map(({ absolute }) => absolute);
  const snapshot = await Promise.all(
    sourceFiles.map(
      async (file) => [file, sha256(await readFile(file, "utf8"))] as const
    )
  );
  const sourceHashes = new Map(snapshot);
  const sources = sourceUniverse.files.map((entry) => {
    const hash = sourceHashes.get(entry.absolute);
    if (!hash) {
      throw new Error(`Missing source snapshot for ${entry.file}`);
    }
    return {
      file: entry.file,
      hash,
      owner: entry.owner,
      verdict: "accepted" as const,
    };
  });
  const exceptions = loaded.checkExceptions;
  const implementationHash = await compilerHash();
  const receipt = {
    artifactAbi,
    authorityHash: canonicalHash({
      artifactAbi,
      catalogHash: verification.write.contentHash,
      compilerHash: implementationHash,
      exceptions,
      projects: loaded.checkProjects,
      runtimeAbi: RUNTIME_ABI,
      sources,
      typescriptHash: sha256(ts.version),
    }),
    catalogHash: verification.write.contentHash,
    compilerHash: implementationHash,
    exceptions,
    exceptionsHash: canonicalHash(exceptions),
    projects: loaded.checkProjects,
    runtimeAbi: RUNTIME_ABI,
    schemaVersion: 1 as const,
    sources,
    typescriptHash: sha256(ts.version),
  } satisfies IntlCheckReceiptV1;
  return { receipt, root, snapshot, sourceFiles };
}

async function createConventionCheckReceipt(
  packageRoot: string
): Promise<IntlCheckReceiptV1> {
  const before = await conventionReceiptInputs(packageRoot);
  const analysis = await analyzeConventionSourceFiles(
    before.root,
    before.sourceFiles
  );
  if (analysis.diagnostics.length > 0) {
    throw new Error(
      `Mirai Intl source analysis failed with ${analysis.diagnostics.length} diagnostic(s)`
    );
  }
  const after = await conventionReceiptInputs(packageRoot);
  if (canonicalJson(before.snapshot) !== canonicalJson(after.snapshot)) {
    throw new Error(
      "Mirai Intl source inputs changed while source analysis ran"
    );
  }
  if (canonicalJson(before.receipt) !== canonicalJson(after.receipt)) {
    throw new Error("Mirai Intl inputs changed before receipt authorization");
  }
  return after.receipt;
}

/** Materialize, verify and atomically persist deterministic source authority. */
export async function proveConventionCatalog(
  packageRoot: string
): Promise<IntlCheckReceiptV1> {
  const root = resolve(packageRoot);
  const destination = receiptPath(root);
  try {
    // Proof is the production authority entrypoint. It must be able to
    // materialize the immutable content-addressed payload after a clean clone,
    // while a matching catalog remains a writer no-op.
    await ensureMiraiIntlCatalog({ root });
    const receipt = await createConventionCheckReceipt(root);
    await writeReceipt(destination, receipt);
    return receipt;
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

/** Reject a missing, stale, malformed, or non-canonical source receipt. */
export async function verifyConventionCheckReceipt(
  packageRoot: string
): Promise<IntlCheckReceiptV1> {
  const root = resolve(packageRoot);
  const path = receiptPath(root);
  const source = await readFile(path, "utf8").catch(() => {
    throw new Error(
      "Mirai Intl production build requires an intl:prove receipt"
    );
  });
  let receipt: IntlCheckReceiptV1;
  try {
    receipt = JSON.parse(source) as IntlCheckReceiptV1;
  } catch {
    throw new Error("Mirai Intl check receipt must contain valid JSON");
  }
  if (`${canonicalJson(receipt)}\n` !== source) {
    throw new Error("Mirai Intl check receipt must use canonical JSON");
  }
  const expected = await conventionReceiptInputs(root);
  if (canonicalJson(receipt) !== canonicalJson(expected.receipt)) {
    throw new Error(
      "Mirai Intl production build rejected a stale check receipt"
    );
  }
  return receipt;
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

export function conventionCheckReceiptPath(packageRoot: string): string {
  return receiptPath(resolve(packageRoot));
}
