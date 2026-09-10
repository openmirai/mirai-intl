import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hash } from "./release.mjs";

const [binary, target] = process.argv.slice(2);
assert.match(process.version, /^v24\./u);
let libc = "";
if (process.platform === "linux") {
  libc = process.report.getReport().header.glibcVersionRuntime
    ? "-gnu"
    : "-musl";
}
assert.equal(
  `${process.platform}-${process.arch}${libc}`,
  target,
  "Runtime gate must execute on the actual target"
);
const binding = createRequire(import.meta.url)(resolve(binary));
assert.equal(binding.engineAbi(), "mirai-intl-native-v1");
assert.equal(binding.unicodeVersion(), process.versions.unicode);
const engine = new binding.NativeEngine(2);
const root = await mkdtemp(join(tmpdir(), "intl-native-release-"));
async function request(input) {
  return JSON.parse(await engine.execute(JSON.stringify(input)));
}
try {
  const canonical = '{"a":"é","z":1e+21}\n';
  for (const [source, expected] of [
    [canonical, true],
    ['{"z":1,"a":2}\n', false],
    ["-0\n", false],
    ['"e\u0301"\n', false],
  ]) {
    const reply = await request({ operation: "canonicalReceipt", source });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.canonical, expected);
    assert.equal(reply.result.hash, hash(source));
  }
  const fallback = await request({
    operation: "canonicalReceipt",
    source: '"\\ud800"\n',
  });
  assert.equal(fallback.error.code, "ERR_INTL_NATIVE_JSON_UNSUPPORTED");
  const source = join(root, "source.txt");
  const content = Buffer.concat([
    Buffer.alloc(128 * 1024 - 1, 97),
    Buffer.from("😀สวัสดี"),
  ]);
  await writeFile(source, content);
  const files = await request({
    operation: "hashFiles",
    paths: [source, join(root, "missing")],
    utf8: true,
  });
  assert.equal(files.ok, true);
  assert.equal(files.result.files[0].value.hash, hash(content));
  assert.equal(files.result.files[1].error.code, "ENOENT");
  const classified = await request({
    operation: "classify",
    path: "page.tsx",
    source: "export const page = <div>Hello</div>;",
  });
  assert.equal(classified.ok, true);
  assert.equal(classified.result.requiresTypeScript, true);
  assert.equal(classified.result.diagnostics, 0);

  // Compare complete inventories, without relying on filesystem traversal order.
  // Keep one engine alive across mutations to reject cached discovery results.
  async function fixture(directory, path) {
    const absolute = join(directory, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, "{}");
  }
  async function inventory(input, expected) {
    const reply = await request(input);
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.deepEqual(
      reply.result.paths.toSorted(),
      expected.map((path) => join(input.root, path)).toSorted(),
      `${input.operation} must return the exact current inventory`
    );
  }
  const sourcesRoot = join(root, "sources");
  const supported = [
    "js",
    "jsx",
    "ts",
    "tsx",
    "cjs",
    "cjsx",
    "cts",
    "ctsx",
    "mjs",
    "mjsx",
    "mts",
    "mtsx",
  ].map((extension) => `src/file.${extension}`);
  const expectedSources = [
    ...supported,
    ".hidden.ts",
    "src/.hidden.tsx",
    "src/types.d.ts",
    "src/สวัสดี.ts",
    "src/generated-neighbor/keep.ts",
  ];
  for (const path of [
    ...expectedSources,
    "src/unsupported.json",
    "src/unsupported.vue",
    "src/upper.TS",
    "src/backup.ts.bak",
    "src/no-extension",
    "src/generated/omit.ts",
    "src/generated/deep/omit.tsx",
    ".hidden/omit.ts",
    "src/.hidden-dir/omit.ts",
    ...[
      ".git",
      ".next",
      ".turbo",
      ".vercel",
      "coverage",
      "dist",
      "node_modules",
    ].map((directory) => `src/${directory}/omit.ts`),
  ]) {
    await fixture(sourcesRoot, path);
  }
  const sourceRequest = {
    operation: "discoverSources",
    root: sourcesRoot,
    generated: "src/generated",
  };
  await inventory(sourceRequest, expectedSources);
  // Both serialized separator conventions must work on all target hosts.
  await inventory(
    { ...sourceRequest, generated: "src\\generated" },
    expectedSources
  );
  await rm(join(sourcesRoot, supported[0]));
  await fixture(sourcesRoot, "src/added.mts");
  await inventory(sourceRequest, [
    ...expectedSources.filter((path) => path !== supported[0]),
    "src/added.mts",
  ]);

  const catalogsRoot = join(root, "catalogs");
  for (const path of [
    "mirai-intl.config.json", // The workspace root is not a discovered child.
    "apps/configured/mirai-intl.config.json",
    "apps/configured/nested/mirai-intl.config.json", // Stop at a catalog boundary.
    "apps/convention/src/locales/en.json",
    "packages/shared/locales/en.json",
    "apps/hidden-marker/.mirai-intl.config.json",
    "apps/.hidden/mirai-intl.config.json",
    ...[
      ".git",
      ".mirai-intl",
      ".next",
      ".turbo",
      "coverage",
      "dist",
      "node_modules",
    ].map((directory) => `${directory}/ignored/mirai-intl.config.json`),
  ]) {
    await fixture(catalogsRoot, path);
  }
  const catalogRequest = { operation: "discoverCatalogs", root: catalogsRoot };
  const expectedCatalogs = [
    "apps/configured",
    "apps/convention",
    "packages/shared",
  ];
  await inventory(catalogRequest, expectedCatalogs);
  await rm(join(catalogsRoot, "apps/configured/mirai-intl.config.json"));
  await rm(join(catalogsRoot, "apps/convention/src/locales"), {
    recursive: true,
  });
  await fixture(catalogsRoot, "apps/added/mirai-intl.config.json");
  await inventory(catalogRequest, [
    "apps/configured/nested",
    "apps/added",
    "packages/shared",
  ]);
} finally {
  engine.close();
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(
  `${JSON.stringify({ target, node: process.version, unicode: process.versions.unicode, runtimePassed: true })}\n`
);
