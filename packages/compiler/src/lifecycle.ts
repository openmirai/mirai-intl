import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical";
import {
  generateConventionCatalogWithSnapshot,
  loadConventionCatalogGenerationInput,
} from "./catalog";
import type { LoadedConventionCatalog } from "./catalog";
import {
  NON_AUTHORITATIVE_ARTIFACT_ABI,
  parseCanonicalCatalogCurrentPointer,
  parseCanonicalCatalogGenerationReceipt,
  parseCanonicalCatalogPublicationJournal,
} from "./generation-snapshot";
import type { MiraiIntlTransformOptions } from "./transform";

export type GeneratedCatalogState = Readonly<{
  changed: boolean;
  loaded: LoadedConventionCatalog;
}>;

const generations = new Map<string, Promise<GeneratedCatalogState>>();
const activeEnsures = new Map<string, Promise<GeneratedCatalogState>>();
const processEnsures = new Map<string, Promise<GeneratedCatalogState>>();
const publishedGenerations = new Map<
  string,
  Readonly<{
    fingerprint: `sha256:${string}`;
    generationInput: object;
    generationInputHash: `sha256:${string}`;
  }>
>();

function errorCode(error: unknown): unknown {
  return error && typeof error === "object"
    ? Reflect.get(error, "code")
    : undefined;
}

async function pathKind(
  path: string
): Promise<"directory" | "file" | "missing"> {
  try {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) {
      throw new Error(`Generated catalog contains symbolic link ${path}`);
    }
    if (entry.isDirectory()) {
      return "directory";
    }
    if (entry.isFile()) {
      return "file";
    }
    throw new Error(`Generated catalog contains non-regular entry ${path}`);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

function readRegularFile(
  path: string,
  label: string
): Readonly<{ mode: number; source: string }> {
  let file;
  try {
    file = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new Error(`${label} is missing or is not a regular file`, {
      cause: error,
    });
  }
  try {
    const entry = fstatSync(file);
    if (!entry.isFile()) {
      throw new Error(`${label} is missing or is not a regular file`);
    }
    return { mode: entry.mode, source: readFileSync(file, "utf8") };
  } finally {
    closeSync(file);
  }
}

function readRegularText(path: string, label: string): string {
  return readRegularFile(path, label).source;
}

function isWithin(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation !== "" &&
    relation !== ".." &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

function generatedStateFingerprint(
  root: string,
  directory = root
): `sha256:${string}` {
  const entries: Array<readonly [string, string]> = [];
  const visit = (current: string): void => {
    const entry = lstatSync(current, { bigint: true });
    if (entry.isSymbolicLink()) {
      throw new Error(`Generated catalog contains symbolic link ${current}`);
    }
    const path = relative(root, current).split(sep).join("/") || ".";
    const identity = [
      entry.dev,
      entry.ino,
      entry.mode,
      entry.size,
      entry.mtimeNs,
      entry.ctimeNs,
    ].join(":");
    entries.push([entry.isDirectory() ? `${path}/` : path, identity]);
    if (entry.isDirectory()) {
      for (const child of readdirSync(current, {
        withFileTypes: true,
      }).toSorted((left, right) =>
        compareCanonicalStrings(left.name, right.name)
      )) {
        visit(join(current, child.name));
      }
    } else if (!entry.isFile()) {
      throw new Error(
        `Generated catalog contains non-regular entry ${current}`
      );
    }
  };
  visit(directory);
  return sha256(canonicalJson(entries));
}

async function assertGeneratedRootConfinement(
  root: string,
  generatedRoot: string
): Promise<string> {
  const [canonicalRoot, canonicalGeneratedRoot] = await Promise.all([
    realpath(root),
    realpath(generatedRoot),
  ]);
  if (!isWithin(canonicalRoot, canonicalGeneratedRoot)) {
    throw new Error(
      "Generated catalog root must be a real child of the catalog root"
    );
  }
  const relation = relative(resolve(root), resolve(generatedRoot));
  let current = canonicalRoot;
  for (const segment of relation.split(sep)) {
    current = join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(
        "Generated catalog root must not contain symbolic-link ancestors"
      );
    }
  }
  return canonicalGeneratedRoot;
}

async function hasRecoverablePublicationJournal(
  generatedRoot: string
): Promise<boolean> {
  const publicationRoot = join(generatedRoot, ".catalog-publication");
  const publicationKind = await pathKind(publicationRoot);
  if (publicationKind === "missing") {
    return false;
  }
  if (publicationKind !== "directory") {
    throw new Error(
      "Generated publication staging area is not a regular directory"
    );
  }
  const journalSource = readRegularText(
    join(publicationRoot, "journal.v1.json"),
    "Generated publication journal"
  );
  const journal = parseCanonicalCatalogPublicationJournal(journalSource);
  const entries = await readdir(publicationRoot, { withFileTypes: true });
  const allowed = new Set(["journal.v1.json", journal.stageDirectory]);
  for (const entry of entries) {
    if (
      !allowed.has(entry.name) ||
      entry.isSymbolicLink() ||
      (entry.name === "journal.v1.json" && !entry.isFile()) ||
      (entry.name === journal.stageDirectory && !entry.isDirectory())
    ) {
      throw new Error(
        `Generated publication staging area contains unexplained state ${entry.name}`
      );
    }
  }
  if (
    journal.state !== "PREPARED" &&
    !entries.some(
      (entry) =>
        entry.name === journal.stageDirectory &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
    )
  ) {
    throw new Error("Generated publication stage is missing");
  }
  return true;
}

async function reusePublishedGeneration(
  root: string,
  generatedRoot: string
): Promise<LoadedConventionCatalog | undefined> {
  const rootKind = await pathKind(generatedRoot);
  if (rootKind === "missing") {
    return undefined;
  }
  if (rootKind !== "directory") {
    throw new Error("Generated catalog root is not a regular directory");
  }
  const canonicalGeneratedRoot = await assertGeneratedRootConfinement(
    root,
    generatedRoot
  );

  const topLevel = (
    await readdir(generatedRoot, { withFileTypes: true })
  ).toSorted((left, right) => compareCanonicalStrings(left.name, right.name));
  if (topLevel.length === 0) {
    return undefined;
  }
  const allowedTopLevel = new Set([
    ".catalog-publication",
    "builds",
    "catalog-generation-receipt.v1.json",
    "catalog.lock.json",
    "current.json",
    "index.ts",
  ]);
  for (const entry of topLevel) {
    if (!allowedTopLevel.has(entry.name) || entry.isSymbolicLink()) {
      throw new Error(
        `Generated catalog contains unexplained state ${entry.name}`
      );
    }
  }
  if (await hasRecoverablePublicationJournal(generatedRoot)) {
    return undefined;
  }
  const generatedFingerprint = generatedStateFingerprint(generatedRoot);
  const published = publishedGenerations.get(canonicalGeneratedRoot);
  if (
    published !== undefined &&
    published.fingerprint === generatedFingerprint
  ) {
    const input = await loadConventionCatalogGenerationInput(root);
    const generationInputHashBefore = sha256(
      canonicalJson(input.generationInput)
    );
    const confirmedFingerprint = generatedStateFingerprint(generatedRoot);
    const generationInputHashAfter = sha256(
      canonicalJson(input.generationInput)
    );
    if (
      confirmedFingerprint === generatedFingerprint &&
      input.generationInput === published.generationInput &&
      generationInputHashBefore === generationInputHashAfter &&
      generationInputHashAfter === published.generationInputHash &&
      (await realpath(input.loaded.outputRoot)) === canonicalGeneratedRoot
    ) {
      return input.loaded;
    }
  } else {
    publishedGenerations.delete(canonicalGeneratedRoot);
  }

  const topLevelNames = new Set(topLevel.map((entry) => entry.name));
  if (!topLevelNames.has("current.json")) {
    if (
      [...topLevelNames].some((name) => name !== "builds") ||
      (topLevelNames.has("builds") &&
        (await readdir(join(generatedRoot, "builds"))).length > 0)
    ) {
      throw new Error("Generated catalog control state is incomplete");
    }
    return undefined;
  }
  if (
    !topLevelNames.has("index.ts") ||
    !topLevelNames.has("catalog.lock.json")
  ) {
    throw new Error("Generated catalog control state is incomplete");
  }

  if (!topLevelNames.has("catalog-generation-receipt.v1.json")) {
    return undefined;
  }
  const [currentSource, receiptSource] = [
    readRegularText(
      join(generatedRoot, "current.json"),
      "Generated current pointer"
    ),
    readRegularText(
      join(generatedRoot, "catalog-generation-receipt.v1.json"),
      "Catalog generation receipt"
    ),
  ];
  const current = parseCanonicalCatalogCurrentPointer(currentSource);
  let receipt: ReturnType<typeof parseCanonicalCatalogGenerationReceipt>;
  try {
    receipt = parseCanonicalCatalogGenerationReceipt(receiptSource);
  } catch (error) {
    if (
      errorCode(error) === "ENOENT" ||
      error instanceof SyntaxError ||
      error instanceof TypeError
    ) {
      return undefined;
    }
    throw error;
  }
  if (receipt.abi.artifactAbi === NON_AUTHORITATIVE_ARTIFACT_ABI) {
    throw new Error(
      "Non-authoritative test generation receipt cannot be reused in production"
    );
  }
  if (sha256(receiptSource) !== current.generationReceiptHash) {
    throw new Error(
      "Generated current pointer does not bind its generation receipt"
    );
  }
  const pointerBase = {
    contentHash: current.contentHash,
    directory: current.directory,
    schemaVersion: 2 as const,
  };
  if (
    canonicalJson(receipt.pointerBase) !== canonicalJson(pointerBase) ||
    canonicalJson(receipt.selectorBase) !== canonicalJson(pointerBase)
  ) {
    throw new Error(
      "Generated current pointer and generation receipt disagree"
    );
  }

  const [facadeSource, lockSource] = [
    readRegularText(join(generatedRoot, "index.ts"), "Generated stable facade"),
    readRegularText(
      join(generatedRoot, "catalog.lock.json"),
      "Generated catalog lock"
    ),
  ];
  if (sha256(facadeSource) !== receipt.stableFacadeHash) {
    throw new Error("Generated stable facade is corrupt");
  }
  if (
    lockSource !== `${canonicalJson(pointerBase)}\n` ||
    sha256(lockSource) !== receipt.catalogLockHash
  ) {
    throw new Error("Generated catalog lock is corrupt");
  }

  const buildsRoot = join(generatedRoot, "builds");
  const buildsKind = await pathKind(buildsRoot);
  if (buildsKind === "missing") {
    return undefined;
  }
  if (buildsKind !== "directory") {
    throw new Error("Generated catalog builds directory is not a directory");
  }
  const builds = await readdir(buildsRoot, { withFileTypes: true });
  if (builds.length === 0) {
    return undefined;
  }
  if (
    builds.length !== 1 ||
    builds[0]?.name !== basename(current.directory) ||
    !builds[0].isDirectory() ||
    builds[0].isSymbolicLink()
  ) {
    throw new Error(
      "Generated catalog builds contain duplicate or unexplained state"
    );
  }
  const payloadRoot = join(generatedRoot, current.directory);
  if ((await pathKind(payloadRoot)) !== "directory") {
    throw new Error("Selected generated catalog payload is missing");
  }
  const payloadEntries = (
    await readdir(payloadRoot, { withFileTypes: true })
  ).toSorted((left, right) => compareCanonicalStrings(left.name, right.name));
  if (payloadEntries.length !== receipt.payload.manifest.entries.length) {
    throw new Error("Generated catalog payload does not match its manifest");
  }
  for (const [index, expected] of receipt.payload.manifest.entries.entries()) {
    const actual = payloadEntries[index];
    if (
      actual?.name !== expected.path ||
      !actual.isFile() ||
      actual.isSymbolicLink()
    ) {
      throw new Error("Generated catalog payload does not match its manifest");
    }
  }
  const payload = receipt.payload.manifest.entries.map((expected) => {
    const path = join(payloadRoot, expected.path);
    let file: ReturnType<typeof readRegularFile>;
    try {
      file = readRegularFile(
        path,
        `Generated catalog payload ${expected.path}`
      );
    } catch (error) {
      throw new Error(`Generated catalog payload ${expected.path} is corrupt`, {
        cause: error,
      });
    }
    const { mode, source } = file;
    if (
      Buffer.byteLength(source) !== expected.size ||
      sha256(source) !== expected.hash ||
      (expected.mode !== null && (mode & 0o777) !== expected.mode)
    ) {
      throw new Error(`Generated catalog payload ${expected.path} is corrupt`);
    }
    return [expected.path, source] as const;
  });
  const artifacts = Object.fromEntries(payload);
  if (sha256(canonicalJson(artifacts)) !== current.contentHash) {
    throw new Error("Generated catalog payload content identity is corrupt");
  }

  const input = await loadConventionCatalogGenerationInput(root);
  if ((await realpath(input.loaded.outputRoot)) !== canonicalGeneratedRoot) {
    throw new Error(
      "Generated catalog root does not match the loaded catalog output root"
    );
  }
  const generationInputHash = sha256(canonicalJson(input.generationInput));
  if (generationInputHash !== receipt.generationInputHash) {
    return undefined;
  }
  if (
    receipt.abi.artifactAbi !== input.generationInput.artifactAbi ||
    receipt.abi.runtimeAbi !== input.generationInput.runtimeAbi ||
    receipt.compilerHash !== input.generationInput.compiler.hash ||
    receipt.icuHash !== input.generationInput.icu.hash
  ) {
    throw new Error(
      "Catalog generation receipt does not bind its generation identities"
    );
  }
  const confirmedGeneratedFingerprint =
    generatedStateFingerprint(generatedRoot);
  if (confirmedGeneratedFingerprint !== generatedFingerprint) {
    throw new Error("Generated catalog changed during validation");
  }
  publishedGenerations.set(canonicalGeneratedRoot, {
    fingerprint: confirmedGeneratedFingerprint,
    generationInput: input.generationInput,
    generationInputHash,
  });
  return input.loaded;
}

function resolvedOptions(options: MiraiIntlTransformOptions): Readonly<{
  generatedRoot: string;
  key: string;
  root: string;
}> {
  const root = resolve(options.root ?? process.cwd());
  if (
    options.generatedDirectory !== undefined &&
    isAbsolute(options.generatedDirectory)
  ) {
    throw new Error("Generated catalog directory must be relative");
  }
  const generatedRoot = resolve(
    root,
    options.generatedDirectory ?? "src/i18n/generated"
  );
  return {
    generatedRoot,
    key: JSON.stringify([root, generatedRoot]),
    root,
  };
}

function serializeGeneration(
  options: MiraiIntlTransformOptions
): Promise<GeneratedCatalogState> {
  const { generatedRoot, key, root } = resolvedOptions(options);
  const previous = generations.get(key);
  const run = (previous ?? Promise.resolve(undefined)).then(async () => {
    const loaded = await reusePublishedGeneration(root, generatedRoot);
    if (loaded !== undefined) {
      return { changed: false, loaded };
    }
    const generation = await generateConventionCatalogWithSnapshot(root, {
      collectEnvironment: false,
    });
    return {
      changed: generation.result.write.changed,
      loaded: generation.loaded,
    };
  });
  const tracked = run.finally(() => {
    if (generations.get(key) === tracked) {
      generations.delete(key);
    }
  });
  generations.set(key, tracked);
  return tracked;
}

function cacheActiveEnsure(
  key: string,
  run: Promise<GeneratedCatalogState>
): Promise<GeneratedCatalogState> {
  const cached = run.finally(() => {
    if (activeEnsures.get(key) === cached) {
      activeEnsures.delete(key);
    }
  });
  activeEnsures.set(key, cached);
  return cached;
}

export function ensureMiraiIntlCatalog(
  options: MiraiIntlTransformOptions = {}
): Promise<GeneratedCatalogState> {
  const { key } = resolvedOptions(options);
  return (
    activeEnsures.get(key) ??
    cacheActiveEnsure(key, serializeGeneration(options))
  );
}

export function ensureMiraiIntlCatalogOnce(
  options: MiraiIntlTransformOptions = {}
): Promise<GeneratedCatalogState> {
  const { key } = resolvedOptions(options);
  const existing = processEnsures.get(key);
  if (existing) {
    return existing;
  }
  const run = ensureMiraiIntlCatalog(options).catch((error: unknown) => {
    if (processEnsures.get(key) === run) {
      processEnsures.delete(key);
    }
    throw error;
  });
  processEnsures.set(key, run);
  return run;
}

export function regenerateMiraiIntlCatalog(
  options: MiraiIntlTransformOptions = {}
): Promise<GeneratedCatalogState> {
  const { key } = resolvedOptions(options);
  const run = serializeGeneration(options).catch((error: unknown) => {
    if (processEnsures.get(key) === run) {
      processEnsures.delete(key);
    }
    throw error;
  });
  processEnsures.set(key, run);
  return run;
}
