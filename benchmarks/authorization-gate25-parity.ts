import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

type JsonObject = Readonly<Record<string, unknown>>;

export const GATE_25_SEMANTIC_PROJECTION_EXCLUSIONS = Object.freeze([
  "compilerManifest",
  "compilerManifestHash",
  "generationReceiptHash",
  "sourceAuthorizationHash",
] as const);

const semanticProjectionExclusions = new Set<string>(
  GATE_25_SEMANTIC_PROJECTION_EXCLUSIONS
);
const executableModulePattern =
  /(?:^|\/)(?![^/]+\.(?:test|spec)\.)[^/]+\.(?:[cm]?[jt]sx?)$/u;
const nonExecutableModulePattern = /\.(?:d\.[cm]?ts|map)$/u;
const sha256Pattern = /^sha256:[\da-f]{64}$/u;

export type Gate25CompilerIdentity = Readonly<{
  compilerHash: string;
  manifest: ReadonlyArray<
    Readonly<{ hash: string; path: string; size: number }>
  >;
  manifestHash: string;
  receiptManifest: ReadonlyArray<Readonly<{ hash: string; path: string }>>;
  receiptManifestHash: string;
}>;

export type Gate25SemanticEvidence = Readonly<{
  diagnosticsHash: string;
  inputHash: string;
  projectionHash: string;
  providerClosuresHash: string;
  sourceUniverseHash: string;
}>;

export type Gate25ReceiptIdentityEvidence = Readonly<{
  compilerHash: string;
  compilerManifestHash: string;
  generationReceiptHash: string;
  sourceAuthorizationHash: string;
}>;

function asObject(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value as JsonObject;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function compareCanonicalStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    );
  }
  return value;
}

export function gate25CanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function gate25CanonicalHash(value: unknown): string {
  return sha256(gate25CanonicalJson(value));
}

export function gate25SemanticProjection(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(gate25SemanticProjection);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !semanticProjectionExclusions.has(key))
        .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
        .map(([key, entry]) => [key, gate25SemanticProjection(entry)])
    );
  }
  return value;
}

function requiredArray(
  object: JsonObject,
  property: string,
  context: string
): ReadonlyArray<unknown> {
  const value = object[property];
  if (!Array.isArray(value)) {
    throw new Error(`${context}.${property} must be an array`);
  }
  return value;
}

function requiredSha256(
  object: JsonObject,
  property: string,
  context: string
): string {
  const value = object[property];
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new Error(`${context}.${property} must be a sha256 identity`);
  }
  return value;
}

function receiptInputs(receipt: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(receipt).filter(
      ([key]) =>
        key !== "compilerManifest" &&
        key !== "compilerManifestHash" &&
        key !== "generationReceiptHash" &&
        key !== "providerClosures" &&
        key !== "sourceAuthorizationHash" &&
        key !== "sources"
    )
  );
}

export function gate25SemanticEvidence(
  receiptValue: unknown,
  diagnostics: unknown
): Gate25SemanticEvidence {
  const receipt = asObject(receiptValue, "Gate 2.5 receipt");
  if (!Array.isArray(diagnostics)) {
    throw new Error("Gate 2.5 diagnostics must be an array");
  }
  const closures = requiredArray(
    receipt,
    "providerClosures",
    "Gate 2.5 receipt"
  );
  const sources = requiredArray(receipt, "sources", "Gate 2.5 receipt");
  if (sources.length === 0) {
    throw new Error("Gate 2.5 source universe must not be empty");
  }
  const closureBySource = new Map(
    closures.map((entry, index) => {
      const closure = asObject(
        entry,
        `Gate 2.5 receipt.providerClosures[${String(index)}]`
      );
      const source = closure.source;
      if (typeof source !== "string") {
        throw new Error(
          `Gate 2.5 receipt.providerClosures[${String(index)}].source must be a string`
        );
      }
      return [
        source,
        requiredSha256(
          closure,
          "closureHash",
          `Gate 2.5 receipt.providerClosures[${String(index)}]`
        ),
      ] as const;
    })
  );
  if (closureBySource.size !== closures.length) {
    throw new Error("Gate 2.5 provider closure sources must be unique");
  }
  const sourceFiles = new Set<string>();
  for (const [index, entry] of sources.entries()) {
    const source = asObject(
      entry,
      `Gate 2.5 receipt.sources[${String(index)}]`
    );
    const file = source.file;
    if (typeof file !== "string" || sourceFiles.has(file)) {
      throw new Error(
        `Gate 2.5 receipt.sources[${String(index)}].file must be unique`
      );
    }
    sourceFiles.add(file);
    requiredSha256(
      source,
      "hash",
      `Gate 2.5 receipt.sources[${String(index)}]`
    );
    const providerClosureHash = requiredSha256(
      source,
      "providerClosureHash",
      `Gate 2.5 receipt.sources[${String(index)}]`
    );
    if (closureBySource.get(file) !== providerClosureHash) {
      throw new Error(
        `Gate 2.5 receipt.sources[${String(index)}] does not bind its provider closure`
      );
    }
  }
  if (
    closures.length !== sources.length ||
    [...closureBySource.keys()].some((source) => !sourceFiles.has(source))
  ) {
    throw new Error(
      "Gate 2.5 provider closures must cover the exact source universe"
    );
  }
  const projection = {
    diagnostics,
    receipt: gate25SemanticProjection(receipt),
  };
  return {
    diagnosticsHash: gate25CanonicalHash(diagnostics),
    inputHash: gate25CanonicalHash(receiptInputs(receipt)),
    projectionHash: gate25CanonicalHash(projection),
    providerClosuresHash: gate25CanonicalHash(closures),
    sourceUniverseHash: gate25CanonicalHash(sources),
  };
}

async function compilerModulePaths(
  root: string,
  directory = root
): Promise<ReadonlyArray<string>> {
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(
      "Gate 2.5 compiler module root must be a regular directory"
    );
  }
  const paths: Array<string> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    const entryStat = await lstat(path);
    if (entryStat.isSymbolicLink()) {
      throw new Error("Gate 2.5 compiler module tree contains a symlink");
    }
    if (entryStat.isDirectory()) {
      paths.push(...(await compilerModulePaths(root, path)));
      continue;
    }
    if (!entryStat.isFile()) {
      throw new Error("Gate 2.5 compiler module tree contains a non-file");
    }
    const modulePath = relative(root, path).split("\\").join("/");
    if (
      nonExecutableModulePattern.test(modulePath) ||
      modulePath.endsWith(".test.ts") ||
      modulePath.endsWith(".test.js") ||
      modulePath.endsWith(".spec.ts") ||
      modulePath.endsWith(".spec.js")
    ) {
      continue;
    }
    if (!executableModulePattern.test(modulePath)) {
      throw new Error(
        `Gate 2.5 compiler module path is unexpected: ${modulePath}`
      );
    }
    paths.push(path);
  }
  return paths;
}

export async function gate25CompilerIdentity(
  cliPath: string
): Promise<Gate25CompilerIdentity> {
  const root = dirname(resolve(cliPath));
  const manifest = (
    await Promise.all(
      (
        await compilerModulePaths(root)
      ).map(async (path) => {
        const before = await lstat(path);
        const bytes = await readFile(path);
        const after = await lstat(path);
        if (
          before.isSymbolicLink() ||
          !before.isFile() ||
          after.isSymbolicLink() ||
          !after.isFile() ||
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs
        ) {
          throw new Error(
            "Gate 2.5 compiler identity changed while it was read"
          );
        }
        return {
          hash: sha256(bytes),
          path: relative(root, path).split("\\").join("/"),
          size: bytes.byteLength,
        };
      })
    )
  ).toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
  const manifestHash = gate25CanonicalHash(manifest);
  const receiptManifest = manifest.map(({ hash, path }) => ({ hash, path }));
  return {
    compilerHash: gate25CanonicalHash({ modulesHash: manifestHash }),
    manifest,
    manifestHash,
    receiptManifest,
    receiptManifestHash: gate25CanonicalHash(receiptManifest),
  };
}

export function verifyGate25ReceiptIdentity(
  receiptValue: unknown,
  generationReceiptSource: string | Buffer,
  compiler: Gate25CompilerIdentity
): Gate25ReceiptIdentityEvidence {
  const receipt = asObject(receiptValue, "Gate 2.5 receipt");
  const compilerManifest = requiredArray(
    receipt,
    "compilerManifest",
    "Gate 2.5 receipt"
  );
  const compilerManifestHash = requiredSha256(
    receipt,
    "compilerManifestHash",
    "Gate 2.5 receipt"
  );
  if (
    gate25CanonicalJson(compilerManifest) !==
      gate25CanonicalJson(compiler.receiptManifest) ||
    compilerManifestHash !== compiler.receiptManifestHash
  ) {
    throw new Error(
      "Gate 2.5 receipt compiler manifest does not bind the executed compiler"
    );
  }
  const generationReceiptHash = requiredSha256(
    receipt,
    "generationReceiptHash",
    "Gate 2.5 receipt"
  );
  if (generationReceiptHash !== sha256(generationReceiptSource)) {
    throw new Error(
      "Gate 2.5 receipt generation identity does not bind the exact generation receipt"
    );
  }
  const generationReceipt = asObject(
    JSON.parse(generationReceiptSource.toString()),
    "Gate 2.5 generation receipt"
  );
  if (generationReceipt.compilerHash !== compiler.compilerHash) {
    throw new Error(
      "Gate 2.5 generation receipt does not bind the executed compiler"
    );
  }
  const sourceAuthorizationHash = requiredSha256(
    receipt,
    "sourceAuthorizationHash",
    "Gate 2.5 receipt"
  );
  const receiptBase = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== "sourceAuthorizationHash")
  );
  if (sourceAuthorizationHash !== gate25CanonicalHash(receiptBase)) {
    throw new Error(
      "Gate 2.5 source authorization identity does not bind the receipt"
    );
  }
  return {
    compilerHash: compiler.compilerHash,
    compilerManifestHash,
    generationReceiptHash,
    sourceAuthorizationHash,
  };
}
