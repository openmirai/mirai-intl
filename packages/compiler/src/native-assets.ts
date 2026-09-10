import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import compilerPackage from "../package.json" with { type: "json" };

export const NATIVE_ENGINE_ABI = "mirai-intl-native-v1";
export type NativeTarget = Readonly<{
  file: string;
  hash: string;
  bytes: number;
}>;
export type NativeAssets = Readonly<{
  directory: string;
  manifestHash: `sha256:${string}`;
  manifestBytes: number;
  sourceHash: string;
  targets: Readonly<Record<string, NativeTarget>>;
  selected?: NativeTarget & Readonly<{ verifiedBytes: Buffer }>;
}>;
const targetNames = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-x64-gnu",
  "linux-arm64-musl",
  "linux-x64-musl",
  "win32-arm64",
  "win32-x64",
]);
const hashPattern = /^sha256:[a-f0-9]{64}$/u;
const hash = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function nativePlatformKey(): string {
  const base = `${process.platform}-${process.arch}`;
  if (process.platform !== "linux") {
    return base;
  }
  const report = process.report.getReport();
  const header =
    record(report) && record(report.header) ? report.header : undefined;
  return `${base}-${typeof header?.glibcVersionRuntime === "string" ? "gnu" : "musl"}`;
}

async function regularBytes(path: string, maxBytes: number): Promise<Buffer> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error(
      "Native compiler asset must be a bounded non-symlink regular file"
    );
  }
  const unchanged = (after: typeof before): boolean =>
    after.isFile() &&
    !after.isSymbolicLink() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs;
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    if (!unchanged(await file.stat())) {
      throw new Error("Native compiler asset changed before reading");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        null
      );
      if (bytesRead === 0) {
        break;
      }
      length += bytesRead;
    }
    if (
      length !== before.size ||
      !unchanged(await file.stat()) ||
      !unchanged(await lstat(path))
    ) {
      throw new Error("Native compiler asset changed while reading");
    }
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}

/** Manifest identity is portable; the selected executable is independently checked. */
export async function readNativeAssets(
  ...args: Parameters<typeof inspectNativeAssets>
): Promise<NativeAssets | undefined> {
  try {
    return await inspectNativeAssets(...args);
  } catch (cause) {
    throw Object.assign(
      new Error(
        `Native compiler assets could not be verified: ${cause instanceof Error ? cause.message : "unknown failure"}`,
        { cause }
      ),
      { code: "ERR_INTL_NATIVE_ASSET" }
    );
  }
}

async function inspectNativeAssets(
  moduleRoot = dirname(fileURLToPath(import.meta.url)),
  platform = nativePlatformKey()
): Promise<NativeAssets | undefined> {
  const directory = join(moduleRoot, "..", "native");
  const entry = await lstat(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!entry) {
    return undefined;
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("Native compiler asset directory must not be a symlink");
  }
  const bytes = await regularBytes(
    join(directory, "engine-manifest.json"),
    65536
  );
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  );
  if (
    !record(value) ||
    Object.keys(value).toSorted().join(",") !==
      "compilerVersion,engineAbi,schemaVersion,sourceHash,targets" ||
    value.schemaVersion !== 1 ||
    value.engineAbi !== NATIVE_ENGINE_ABI ||
    value.compilerVersion !== compilerPackage.version ||
    typeof value.sourceHash !== "string" ||
    !hashPattern.test(value.sourceHash) ||
    !record(value.targets)
  ) {
    throw new Error("Invalid native compiler engine manifest");
  }
  const targets: Record<string, NativeTarget> = {};
  for (const [name, target] of Object.entries(value.targets)) {
    if (
      !targetNames.has(name) ||
      !record(target) ||
      Object.keys(target).toSorted().join(",") !== "bytes,file,hash" ||
      target.file !== `mirai-intl-${name}.node` ||
      typeof target.hash !== "string" ||
      !hashPattern.test(target.hash) ||
      typeof target.bytes !== "number" ||
      !Number.isSafeInteger(target.bytes) ||
      target.bytes < 1 ||
      target.bytes > 64 * 1024 * 1024
    ) {
      throw new Error("Invalid native compiler target entry");
    }
    targets[name] = {
      file: target.file,
      hash: target.hash,
      bytes: target.bytes,
    };
  }
  if (Object.keys(targets).length === 0) {
    throw new Error("Native compiler manifest has no prebuilt targets");
  }
  const expected = [
    "engine-manifest.json",
    ...Object.values(targets).map((target) => target.file),
  ].toSorted();
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.some((item) => !item.isFile() || item.isSymbolicLink()) ||
    JSON.stringify(entries.map((item) => item.name).toSorted()) !==
      JSON.stringify(expected)
  ) {
    throw new Error(
      "Native compiler asset inventory is incomplete or unexplained"
    );
  }
  const selected = targets[platform];
  let verifiedBytes: Buffer | undefined;
  if (selected) {
    const binary = await regularBytes(
      join(directory, selected.file),
      selected.bytes
    );
    if (binary.length !== selected.bytes || hash(binary) !== selected.hash) {
      throw new Error("Native compiler binary is stale or tampered");
    }
    verifiedBytes = binary;
  }
  return {
    directory,
    manifestHash: hash(bytes),
    manifestBytes: bytes.length,
    sourceHash: value.sourceHash,
    targets,
    ...(selected && verifiedBytes
      ? { selected: { ...selected, verifiedBytes } }
      : {}),
  };
}
