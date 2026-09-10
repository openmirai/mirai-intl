import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  symlink,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  nativeCanonicalReceipt,
  withNativeOperation,
} from "../../packages/compiler/src/native-engine.ts";
import { discoverWorkspaceCatalogs } from "../../packages/compiler/src/workspace-catalogs.ts";
import { collectConventionSourceFiles } from "../../packages/compiler/src/source-discovery.ts";

test("native source scanning matches Node extensions, generated exclusions and fresh inventories", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "intl-native-sources-"));
  const prior = process.env.MIRAI_INTL_ENGINE;
  context.after(async () => {
    if (prior === undefined) {
      delete process.env.MIRAI_INTL_ENGINE;
    } else {
      process.env.MIRAI_INTL_ENGINE = prior;
    }
    await rm(root, { recursive: true, force: true });
  });
  for (const file of [
    ".hidden.ts",
    "..valid.ts",
    "a.js",
    "a.jsx",
    "a.ts",
    "a.tsx",
    "a.cjs",
    "a.cjsx",
    "a.cts",
    "a.ctsx",
    "a.mjs",
    "a.mjsx",
    "a.mts",
    "a.mtsx",
    "a.TS",
    "a.json",
    "src/index.d.ts",
    "src/generated/index.ts",
    "src/generated/deep/index.ts",
    "src/generated-more/index.ts",
    ".hidden/index.ts",
    "node_modules/pkg/index.ts",
    "dist/index.ts",
  ]) {
    const path = join(root, file);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "export {};\n");
  }
  await symlink(join(root, "a.ts"), join(root, "link.ts"));
  await symlink(join(root, "src"), join(root, "linked"), "dir");
  for (const generated of [
    "src/generated",
    "src\\generated",
    "./src/generated",
    "",
    "absent",
    "a.ts",
  ]) {
    process.env.MIRAI_INTL_ENGINE = "node";
    const expected = await collectConventionSourceFiles(root, generated);
    assert(expected.includes(join(root, "..valid.ts")));
    process.env.MIRAI_INTL_ENGINE = "rust";
    assert.deepEqual(
      await collectConventionSourceFiles(root, generated),
      expected
    );
  }
  await withNativeOperation(async () => {
    const before = await collectConventionSourceFiles(root, "src/generated");
    await writeFile(join(root, "new.ts"), "export {};\n");
    const after = await collectConventionSourceFiles(root, "src/generated");
    assert.equal(after.length, before.length + 1);
    assert(after.includes(join(root, "new.ts")));
  });
});

test("native discovery preserves Node inventory, ordering, symlink rules and fresh additions", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "intl-native-discovery-"));
  const prior = process.env.MIRAI_INTL_ENGINE;
  context.after(async () => {
    if (prior === undefined) {
      delete process.env.MIRAI_INTL_ENGINE;
    } else {
      process.env.MIRAI_INTL_ENGINE = prior;
    }
    await rm(root, { recursive: true, force: true });
  });
  for (const path of [
    "apps/B/src/locales",
    "apps/a/locales",
    "packages/i18n/locales",
    "packages/i18n/nested/locales",
    "node_modules/ignored/locales",
    ".hidden/locales",
    "dist/ignored/locales",
    "apps/configured",
  ]) {
    await mkdir(join(root, path), { recursive: true });
  }
  await writeFile(join(root, "apps/configured/mirai-intl.config.json"), "{}");
  await symlink(join(root, "apps/a"), join(root, "apps/link"), "dir");
  process.env.MIRAI_INTL_ENGINE = "node";
  const expected = await discoverWorkspaceCatalogs(root);
  assert.equal(expected.length, 4);
  process.env.MIRAI_INTL_ENGINE = "rust";
  assert.deepEqual(await discoverWorkspaceCatalogs(root), expected);
  await withNativeOperation(async () => {
    assert.deepEqual(await discoverWorkspaceCatalogs(root), expected);
    await mkdir(join(root, "apps/new/locales"), { recursive: true });
    assert.equal((await discoverWorkspaceCatalogs(root)).length, 5);
    await rm(join(root, "apps/new"), { recursive: true });
    assert.deepEqual(await discoverWorkspaceCatalogs(root), expected);
  });
  await assert.rejects(discoverWorkspaceCatalogs(join(root, "absent")), {
    code: "ENOENT",
  });
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    const denied = join(root, "unreadable");
    await mkdir(denied);
    await chmod(denied, 0);
    try {
      await assert.rejects(discoverWorkspaceCatalogs(root), { code: "EACCES" });
    } finally {
      await chmod(denied, 0o700);
    }
  }
});

test("native receipt operation serializes concurrent requests and supports clean reopening", async (context) => {
  const prior = process.env.MIRAI_INTL_ENGINE;
  process.env.MIRAI_INTL_ENGINE = "rust";
  context.after(() => {
    if (prior === undefined) {
      delete process.env.MIRAI_INTL_ENGINE;
    } else {
      process.env.MIRAI_INTL_ENGINE = prior;
    }
  });
  for (let index = 0; index < 4; index += 1) {
    await withNativeOperation(async () => {
      assert.deepEqual(
        await Promise.all(
          Array.from({ length: 16 }, () => nativeCanonicalReceipt('{"a":1}\n'))
        ),
        Array(16).fill(true)
      );
      assert.equal(await nativeCanonicalReceipt('{ "a":1}\n'), false);
      assert.equal(await nativeCanonicalReceipt('"\\ud800"\n'), undefined);
    });
  }
});

test("Node-API rejects calls after close and rejects closing active work", async () => {
  const { NativeEngine, engineAbi } = createRequire(import.meta.url)(
    resolve("native/target/release/mirai_intl_engine.node")
  );
  assert.equal(engineAbi(), "mirai-intl-native-v1");
  const engine = new NativeEngine(1);
  const pending = engine.execute(
    JSON.stringify({
      operation: "canonicalReceipt",
      source: `"${"a".repeat(1000000)}"\n`,
    })
  );
  assert.throws(() => engine.close(), /in flight/u);
  await pending;
  engine.close();
  engine.close();
  assert.throws(() => engine.execute("{}"), /closed/u);
});
