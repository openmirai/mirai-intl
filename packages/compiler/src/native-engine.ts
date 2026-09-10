import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { rmSync, writeSync } from "node:fs";
import { chmod, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { NATIVE_ENGINE_ABI, readNativeAssets } from "./native-assets";

interface NativeInstance {
  execute(source: string): Promise<string>;
  close(): void;
}
interface NativeBinding {
  NativeEngine: new (workers: number) => NativeInstance;
  engineAbi(): string;
  unicodeVersion(): string;
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function nativeError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "ERR_INTL_NATIVE_ENGINE" });
}
const storage = new AsyncLocalStorage<NativeOperation>();
const maxRequestBytes = 64 * 1024 * 1024;
let loaded:
  | Readonly<{ hash: string; path: string; binding: NativeBinding }>
  | undefined;

// Serialize initialization and subsequent fresh package checks. A rejected load is
// terminal: require/dlopen may already have populated process-global caches.
let loadTail: Promise<unknown> = Promise.resolve();
let loadFailure: Error | undefined;
async function loadBinding(): Promise<NativeBinding | undefined> {
  const result = loadTail.then(async () => {
    if (loadFailure) {
      throw loadFailure;
    }
    try {
      return await inspectBinding();
    } catch (cause) {
      loadFailure = Object.assign(
        nativeError(
          "Native compiler binding could not be loaded; start a fresh process"
        ),
        { cause }
      );
      throw loadFailure;
    }
  });
  loadTail = result.catch(() => undefined);
  return result;
}

async function removeSnapshot(
  directory: string,
  dlopenCompleted: boolean
): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    // Windows can keep a successfully loaded DLL locked until process exit.
    // Retain at most one private snapshot per process, never one per operation.
    if (
      process.platform !== "win32" ||
      !dlopenCompleted ||
      !(error instanceof Error) ||
      !("code" in error) ||
      !["EBUSY", "EPERM", "EACCES"].includes(String(error.code))
    ) {
      throw error;
    }
    process.once("exit", () => {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        writeSync(
          2,
          `Native compiler snapshot remains locked; remove after process exit: ${directory}\n`
        );
      }
    });
  }
}

async function inspectBinding(): Promise<NativeBinding | undefined> {
  const assets = await readNativeAssets();
  if (!assets?.selected) {
    if (loaded) {
      throw nativeError("Native compiler disappeared after loading");
    }
    return undefined;
  }
  const path = join(assets.directory, assets.selected.file);
  if (loaded) {
    if (loaded.path !== path || loaded.hash !== assets.selected.hash) {
      throw nativeError(
        "Native compiler changed after loading; start a fresh process"
      );
    }
    return loaded.binding;
  }
  const directory = await mkdtemp(join(tmpdir(), "mirai-intl-native-"));
  let dlopenCompleted = false;
  let value: unknown;
  try {
    await chmod(directory, 0o700);
    const snapshot = join(directory, assets.selected.file);
    const file = await open(snapshot, "wx", 0o600);
    try {
      await file.writeFile(assets.selected.verifiedBytes);
      await file.chmod(0o400);
    } finally {
      await file.close();
    }
    const bytes = await readFile(snapshot);
    if (
      bytes.length !== assets.selected.bytes ||
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !==
        assets.selected.hash
    ) {
      throw nativeError(
        "Native compiler snapshot does not match verified bytes"
      );
    }
    // Only this owned snapshot is executable. Package replacements cannot change
    // it; arbitrary same-user writes inside the private directory are out of scope.
    value = createRequire(import.meta.url)(snapshot);
    dlopenCompleted = true;
    if (
      !record(value) ||
      typeof value.NativeEngine !== "function" ||
      typeof value.engineAbi !== "function" ||
      typeof value.unicodeVersion !== "function" ||
      typeof value.unicodeVersion() !== "string" ||
      value.engineAbi() !== NATIVE_ENGINE_ABI
    ) {
      throw nativeError("Native compiler binding has an incompatible ABI");
    }
    const after = await readNativeAssets();
    if (
      after?.manifestHash !== assets.manifestHash ||
      after.selected?.hash !== assets.selected.hash
    ) {
      throw nativeError("Native compiler changed while loading");
    }
  } finally {
    await removeSnapshot(directory, dlopenCompleted);
  }

  const binding = value as unknown as NativeBinding;
  loaded = { hash: assets.selected.hash, path, binding };
  return binding;
}

class NativeOperation {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private pendingBytes = 0;
  private closed = false;
  constructor(
    private readonly engine: NativeInstance | undefined,
    private readonly unicodeVersion: string | undefined
  ) {}

  request(request: unknown): Promise<unknown | undefined> {
    if (this.closed) {
      return Promise.reject(nativeError("Native operation is closed"));
    }
    const engine = this.engine;
    if (!engine) {
      return Promise.resolve(undefined);
    }
    if (
      record(request) &&
      request.operation === "canonicalReceipt" &&
      this.unicodeVersion !== process.versions.unicode
    ) {
      return Promise.resolve(undefined);
    }
    if (this.pending >= 64) {
      return Promise.reject(
        nativeError("Native operation queue exceeds bound")
      );
    }
    const source = JSON.stringify(request);
    const bytes = Buffer.byteLength(source);
    // Full Node validation handles larger receipts without native allocation.
    if (bytes > maxRequestBytes) {
      return Promise.resolve(undefined);
    }
    if (this.pendingBytes + bytes > maxRequestBytes) {
      return Promise.reject(
        nativeError("Native operation queued bytes exceed bound")
      );
    }
    this.pending += 1;
    this.pendingBytes += bytes;
    const result = this.tail
      .then(async () => {
        let response: unknown;
        try {
          response = JSON.parse(await engine.execute(source));
        } catch (cause) {
          throw Object.assign(nativeError("Native compiler operation failed"), {
            cause,
          });
        }
        if (!record(response) || typeof response.ok !== "boolean") {
          throw nativeError("Invalid native compiler response");
        }
        if (response.ok) {
          return response.result;
        }
        if (
          !record(response.error) ||
          typeof response.error.code !== "string" ||
          typeof response.error.message !== "string"
        ) {
          throw nativeError("Invalid native compiler error");
        }
        if (
          [
            "ERR_INTL_NATIVE_JSON_UNSUPPORTED",
            "ERR_INTL_NATIVE_FS_UNSUPPORTED",
          ].includes(response.error.code)
        ) {
          return undefined;
        }
        throw Object.assign(nativeError(response.error.message), {
          code: response.error.code,
        });
      })
      .finally(() => {
        this.pending -= 1;
        this.pendingBytes -= bytes;
      });
    this.tail = result.catch(() => undefined);
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
    try {
      this.engine?.close();
    } catch (cause) {
      throw Object.assign(
        nativeError("Native compiler operation could not close"),
        { cause }
      );
    }
  }
}

/** One bounded engine per operation; nested verification shares it, never authority. */
export async function withNativeOperation<T>(
  run: () => Promise<T>
): Promise<T> {
  if (storage.getStore()) {
    return run();
  }
  const mode = process.env.MIRAI_INTL_ENGINE ?? "auto";
  if (!["auto", "node", "rust"].includes(mode)) {
    throw nativeError("MIRAI_INTL_ENGINE must be auto, node or rust");
  }
  const binding = mode === "node" ? undefined : await loadBinding();
  if (mode === "rust" && !binding) {
    throw nativeError(
      "Rust compiler engine is required but no supported prebuilt binary is available"
    );
  }
  const rawLanes = process.env.MIRAI_INTL_CATALOG_CPU_LANES;
  const lanes =
    rawLanes === undefined ? availableParallelism() : Number(rawLanes);
  if (!Number.isSafeInteger(lanes) || lanes < 1) {
    throw nativeError("Catalog CPU lanes must be a positive integer");
  }
  let engine: NativeInstance | undefined;
  try {
    engine = binding
      ? new binding.NativeEngine(Math.min(4, availableParallelism(), lanes))
      : undefined;
  } catch (cause) {
    throw Object.assign(
      nativeError("Native compiler operation could not initialize"),
      { cause }
    );
  }
  const operation = new NativeOperation(engine, binding?.unicodeVersion());
  try {
    return await storage.run(operation, run);
  } finally {
    await operation.close();
  }
}

export async function nativeCanonicalReceipt(
  source: string
): Promise<boolean | undefined> {
  return withNativeOperation(async () => {
    const response = await storage
      .getStore()
      ?.request({ operation: "canonicalReceipt", source });
    if (response === undefined) {
      return undefined;
    }
    if (
      !record(response) ||
      typeof response.canonical !== "boolean" ||
      typeof response.hash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(response.hash)
    ) {
      throw nativeError("Invalid native canonical receipt response");
    }
    return response.canonical;
  });
}

export async function nativeDiscoverCatalogs(
  root: string
): Promise<Array<string> | undefined> {
  return withNativeOperation(async () => {
    const response = await storage
      .getStore()
      ?.request({ operation: "discoverCatalogs", root });
    if (response === undefined) {
      return undefined;
    }
    if (
      !record(response) ||
      !Array.isArray(response.paths) ||
      response.paths.length > 500000 ||
      response.paths.some(
        (path: unknown) =>
          typeof path !== "string" ||
          !isAbsolute(path) ||
          relative(root, path) === ".." ||
          relative(root, path).startsWith(`..${sep}`)
      ) ||
      new Set(response.paths).size !== response.paths.length
    ) {
      throw nativeError("Invalid native catalog discovery response");
    }
    return response.paths as Array<string>;
  });
}

export async function nativeDiscoverSources(
  root: string,
  generated: string
): Promise<Array<string> | undefined> {
  return withNativeOperation(async () => {
    const response = await storage
      .getStore()
      ?.request({ operation: "discoverSources", root, generated });
    if (response === undefined) {
      return undefined;
    }
    if (
      !record(response) ||
      !Array.isArray(response.paths) ||
      response.paths.length > 500000 ||
      response.paths.some(
        (path: unknown) =>
          typeof path !== "string" ||
          !isAbsolute(path) ||
          relative(root, path) === ".." ||
          relative(root, path).startsWith(`..${sep}`)
      ) ||
      new Set(response.paths).size !== response.paths.length
    ) {
      throw nativeError("Invalid native source discovery response");
    }
    return response.paths as Array<string>;
  });
}
