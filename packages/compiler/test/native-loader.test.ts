import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import type * as FsPromises from "node:fs/promises";
import type * as NodeModule from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import compilerPackage from "../package.json";
import type * as NativeAssets from "../src/native-assets";

const hooks = vi.hoisted(() => ({
  root: "",
  corruptSnapshot: false,
  failCleanup: false,
  load: (_path: string): unknown => undefined,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof FsPromises>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) =>
      hooks.corruptSnapshot && String(args[0]).includes("mirai-intl-native-")
        ? Buffer.from("corrupt snapshot")
        : actual.readFile(...args),
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (hooks.failCleanup && String(args[0]).includes("mirai-intl-native-")) {
        throw Object.assign(new Error("cleanup denied"), { code: "EACCES" });
      }
      return actual.rm(...args);
    },
  };
});
vi.mock("node:module", async (original) => ({
  ...(await original<typeof NodeModule>()),
  createRequire: () => (path: string) => hooks.load(path),
}));
vi.mock("../src/native-assets", async (original) => {
  const actual = await original<typeof NativeAssets>();
  return {
    ...actual,
    readNativeAssets: () =>
      actual.readNativeAssets(join(hooks.root, "src"), "darwin-arm64"),
  };
});
const good = Buffer.from("verified original binary");
const digest = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const binding = {
  NativeEngine: class {
    close() {}
    async execute() {
      return JSON.stringify({
        ok: true,
        result: { canonical: true, hash: digest(good) },
      });
    }
  },
  engineAbi: () => "mirai-intl-native-v1",
  unicodeVersion: () => process.versions.unicode,
};
let originalPath: string;
beforeEach(async () => {
  vi.resetModules();
  hooks.corruptSnapshot = false;
  hooks.failCleanup = false;
  vi.stubEnv("MIRAI_INTL_ENGINE", "rust");
  hooks.root = await mkdtemp(join(tmpdir(), "intl-loader-test-"));
  await mkdir(join(hooks.root, "src"));
  await mkdir(join(hooks.root, "native"));
  originalPath = join(hooks.root, "native", "mirai-intl-darwin-arm64.node");
  await writeFile(originalPath, good);
  await writeFile(
    join(hooks.root, "native", "engine-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      compilerVersion: compilerPackage.version,
      engineAbi: "mirai-intl-native-v1",
      sourceHash: digest(good),
      targets: {
        "darwin-arm64": {
          file: "mirai-intl-darwin-arm64.node",
          bytes: good.length,
          hash: digest(good),
        },
      },
    })
  );
  hooks.load = () => binding;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(hooks.root, { recursive: true, force: true });
});

it("loads owned verified bytes even when package bytes are swapped and restored at dlopen", async () => {
  let snapshot = "";
  hooks.load = (path) => {
    snapshot = path;
    writeFileSync(originalPath, "replacement");
    try {
      expect(path).not.toBe(originalPath);
      expect(readFileSync(path)).toEqual(good);
      if (process.platform !== "win32") {
        expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
        expect(statSync(path).mode & 0o777).toBe(0o400);
      }
    } finally {
      writeFileSync(originalPath, good);
    }
    return binding;
  };
  const { withNativeOperation } = await import("../src/native-engine");
  await expect(withNativeOperation(async () => "ok")).resolves.toBe("ok");
  expect(() => readFileSync(snapshot)).toThrow(/ENOENT/u);
});

it("rejects persistent package replacement after loading and never retries", async () => {
  let calls = 0;
  hooks.load = (path) => {
    calls++;
    expect(readFileSync(path)).toEqual(good);
    writeFileSync(originalPath, "replacement");
    return binding;
  };
  const { withNativeOperation } = await import("../src/native-engine");
  const failed = withNativeOperation(async () => "unexpected");
  await expect(failed).rejects.toMatchObject({
    code: "ERR_INTL_NATIVE_ENGINE",
  });
  await writeFile(originalPath, good);
  await expect(withNativeOperation(async () => "unexpected")).rejects.toBe(
    await failed.catch((error) => error)
  );
  expect(calls).toBe(1);
});

it("poisons dlopen failure and removes its private snapshot", async () => {
  let calls = 0;
  let snapshot = "";
  const fault = Object.assign(new Error("dlopen failed"), { code: "EACCES" });
  hooks.load = (path) => {
    calls++;
    snapshot = path;
    throw fault;
  };
  const { withNativeOperation } = await import("../src/native-engine");
  await expect(
    withNativeOperation(async () => "unexpected")
  ).rejects.toMatchObject({ cause: fault });
  await expect(
    withNativeOperation(async () => "unexpected")
  ).rejects.toMatchObject({ cause: fault });
  expect(calls).toBe(1);
  expect(() => readFileSync(snapshot)).toThrow(/ENOENT/u);
});

it("serializes concurrent initialization and makes one snapshot for all operations", async () => {
  const paths: Array<string> = [];
  hooks.load = (path) => {
    paths.push(path);
    return binding;
  };
  const { withNativeOperation } = await import("../src/native-engine");
  await expect(
    Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        withNativeOperation(async () => index)
      )
    )
  ).resolves.toEqual(Array.from({ length: 12 }, (_, index) => index));
  expect(paths).toHaveLength(1);
  await expect(withNativeOperation(async () => "later")).resolves.toBe("later");
  expect(paths).toHaveLength(1);
  await writeFile(originalPath, "replacement");
  await expect(
    withNativeOperation(async () => "unexpected")
  ).rejects.toMatchObject({ code: "ERR_INTL_NATIVE_ENGINE" });
  await writeFile(originalPath, good);
  await expect(
    withNativeOperation(async () => "unexpected")
  ).rejects.toMatchObject({ code: "ERR_INTL_NATIVE_ENGINE" });
  expect(paths).toHaveLength(1);
});

it("verifies snapshot bytes before dlopen and permanently rejects corruption", async () => {
  hooks.corruptSnapshot = true;
  const load = vi.fn(() => binding);
  hooks.load = load;
  const { withNativeOperation } = await import("../src/native-engine");
  await expect(
    withNativeOperation(async () => "unexpected")
  ).rejects.toMatchObject({ code: "ERR_INTL_NATIVE_ENGINE" });
  hooks.corruptSnapshot = false;
  await expect(
    withNativeOperation(async () => "unexpected")
  ).rejects.toMatchObject({ code: "ERR_INTL_NATIVE_ENGINE" });
  expect(load).not.toHaveBeenCalled();
});

it.skipIf(process.platform === "win32")(
  "poisons post-load cleanup failures rather than reporting success",
  async () => {
    let snapshot = "";
    let calls = 0;
    hooks.load = (path) => {
      snapshot = path;
      calls++;
      hooks.failCleanup = true;
      return binding;
    };
    const { withNativeOperation } = await import("../src/native-engine");
    try {
      await expect(
        withNativeOperation(async () => "unexpected")
      ).rejects.toMatchObject({ cause: { code: "EACCES" } });
      hooks.failCleanup = false;
      await expect(
        withNativeOperation(async () => "unexpected")
      ).rejects.toMatchObject({ cause: { code: "EACCES" } });
      expect(calls).toBe(1);
    } finally {
      hooks.failCleanup = false;
      if (snapshot) {
        await rm(dirname(snapshot), { recursive: true, force: true });
      }
    }
  }
);

it("owns selected verified bytes independently of subsequent package writes", async () => {
  const { readNativeAssets } = await import("../src/native-assets");
  const assets = await readNativeAssets();
  await writeFile(originalPath, "replacement");
  expect(assets?.selected?.verifiedBytes).toEqual(good);
});

it("retains only one Windows locked snapshot and retries cleanup at exit", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const prior = new Set(process.listeners("exit"));
  let snapshot = "";
  let calls = 0;
  hooks.load = (path) => {
    snapshot = path;
    calls++;
    hooks.failCleanup = true;
    return binding;
  };
  const { withNativeOperation } = await import("../src/native-engine");
  try {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    await expect(withNativeOperation(async () => "ok")).resolves.toBe("ok");
    await expect(withNativeOperation(async () => "again")).resolves.toBe(
      "again"
    );
    expect(calls).toBe(1);
    expect(readFileSync(snapshot)).toEqual(good);
    const cleanup = process
      .listeners("exit")
      .filter((listener) => !prior.has(listener));
    expect(cleanup).toHaveLength(1);
    hooks.failCleanup = false;
    for (const listener of cleanup) {
      process.removeListener("exit", listener);
      listener(0);
    }
    expect(() => readFileSync(snapshot)).toThrow(/ENOENT/u);
  } finally {
    if (platform) {
      Object.defineProperty(process, "platform", platform);
    }
    for (const listener of process.listeners("exit")) {
      if (!prior.has(listener)) {
        process.removeListener("exit", listener);
      }
    }
    hooks.failCleanup = false;
    if (snapshot) {
      await rm(dirname(snapshot), { recursive: true, force: true });
    }
  }
});
