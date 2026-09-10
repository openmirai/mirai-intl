import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import compilerPackage from "../package.json" with { type: "json" };
import { NATIVE_ENGINE_ABI, readNativeAssets } from "../src/native-assets";
import { computeCompilerImplementationIdentity } from "../src/integrity-identity";

const roots: Array<string> = [];
const digest = (bytes: string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "intl-native-assets-"));
  roots.push(root);
  const modules = join(root, "dist");
  const native = join(root, "native");
  await mkdir(modules);
  await mkdir(native);
  await writeFile(join(modules, "index.js"), "export const compiler = 1;\n");
  const target = "darwin-arm64";
  const file = `mirai-intl-${target}.node`;
  const bytes = "native-fixture";
  const manifest = {
    compilerVersion: compilerPackage.version,
    engineAbi: NATIVE_ENGINE_ABI,
    schemaVersion: 1,
    sourceHash: digest("source"),
    targets: { [target]: { file, hash: digest(bytes), bytes: bytes.length } },
  };
  await writeFile(join(native, file), bytes);
  await writeFile(
    join(native, "engine-manifest.json"),
    JSON.stringify(manifest)
  );
  return { root, modules, native, manifest, file, target };
}

it("binds a portable manifest while checking only the selected executable", async () => {
  const f = await fixture();
  const selected = await readNativeAssets(f.modules, f.target);
  const fallback = await readNativeAssets(f.modules, "unsupported-arch");
  expect(selected?.selected?.file).toBe(f.file);
  expect(fallback?.selected).toBeUndefined();
  expect(fallback?.manifestHash).toBe(selected?.manifestHash);
  const identity = await computeCompilerImplementationIdentity(f.modules);
  expect(
    identity.modules.entries.some(
      (entry) =>
        entry.path === "native/engine-manifest.json" &&
        entry.hash === selected?.manifestHash
    )
  ).toBe(true);
});

it("rejects changed selected binary bytes even at the same length", async () => {
  const f = await fixture();
  await writeFile(join(f.native, f.file), "native-Fixture");
  await expect(readNativeAssets(f.modules, f.target)).rejects.toThrow(
    "tampered"
  );
});

it("rejects missing, extra and symlinked assets", async () => {
  const f = await fixture();
  const binary = join(f.native, f.file);
  await rm(binary);
  await expect(readNativeAssets(f.modules, f.target)).rejects.toThrow(
    "inventory"
  );
  await writeFile(binary, "native-fixture");
  await writeFile(join(f.native, "unexplained.node"), "x");
  await expect(readNativeAssets(f.modules, f.target)).rejects.toThrow(
    "inventory"
  );
  await rm(join(f.native, "unexplained.node"));
  await rm(binary);
  await symlink(join(f.modules, "index.js"), binary);
  await expect(readNativeAssets(f.modules, f.target)).rejects.toThrow(
    "inventory"
  );
});

it("rejects incompatible manifest version, ABI, target and unbounded binary", async () => {
  const f = await fixture();
  for (const patch of [
    { compilerVersion: "0.0.0" },
    { engineAbi: "other" },
    { schemaVersion: 2 },
    { sourceHash: "invalid" },
    { targets: { "../../escape": f.manifest.targets["darwin-arm64"] } },
    {
      targets: {
        [f.target]: { ...f.manifest.targets["darwin-arm64"], bytes: 2 ** 30 },
      },
    },
  ]) {
    await writeFile(
      join(f.native, "engine-manifest.json"),
      JSON.stringify({ ...f.manifest, ...patch })
    );
    await expect(readNativeAssets(f.modules, f.target)).rejects.toThrow(
      /Invalid native/u
    );
  }
});

it("permits Node fallback only when the entire native directory is absent", async () => {
  const f = await fixture();
  await rm(f.native, { recursive: true });
  expect(await readNativeAssets(f.modules)).toBeUndefined();
  await mkdir(f.native);
  await expect(readNativeAssets(f.modules)).rejects.toMatchObject({
    code: "ERR_INTL_NATIVE_ASSET",
  });
  await rm(f.native, { recursive: true });
  await symlink(f.modules, f.native);
  await expect(readNativeAssets(f.modules)).rejects.toThrow("symlink");
});
