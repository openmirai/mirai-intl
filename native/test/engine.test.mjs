import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  canonicalJson,
  sha256,
} from "../../packages/compiler/src/canonical.ts";
import { addonTransport, workerTransport } from "./transports.mjs";

const addon = resolve("native/target/release/mirai_intl_engine.node");
const worker = resolve("native/target/release/mirai-intl-worker");

for (const [name, create] of [
  ["addon", () => addonTransport(addon)],
  ["worker", () => workerTransport(worker)],
]) {
  test(`${name}: canonical JSON matches the existing Node encoder`, async (context) => {
    const engine = create();
    context.after(() => engine.close());
    const values = [
      null,
      true,
      0,
      -0,
      1e21,
      1e-7,
      1e-6,
      1.2345678901234567,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      { z: "e\u0301", a: "สวัสดี", escaped: '\n\t"\\', astral: "😀" },
      { "\ue000": 1, 𐀀: 2, 10: 3, 2: 4 },
      [
        "\u2028",
        "\u2029",
        { source: "<b>{count, plural, one {# item} other {# items}}</b>" },
      ],
    ];
    for (const value of values) {
      const source = JSON.stringify(value);
      const reply = await engine.request({
        operation: "canonicalJson",
        source,
      });
      assert.equal(reply.ok, true, JSON.stringify(reply));
      assert.equal(reply.result.canonical, canonicalJson(value));
      assert.equal(reply.result.hash, sha256(canonicalJson(value)));
      assert.equal(reply.result.sourceHash, sha256(source));
    }
    for (const source of ['{"e\\u0301":1}', "1e400", "{", '"\\ud800"']) {
      const reply = await engine.request({
        operation: "canonicalJson",
        source,
      });
      assert.equal(reply.ok, false);
      assert.equal(reply.error.code, "ERR_INTL_NATIVE_JSON_UNSUPPORTED");
    }
  });

  test(`${name}: file batches preserve exact hashes, UTF-8 and regular-file rejection`, async (context) => {
    const root = await mkdtemp(join(tmpdir(), "intl-native-parity-"));
    context.after(() => rm(root, { recursive: true, force: true }));
    const engine = create();
    context.after(() => engine.close());
    const good = join(root, "good.ts");
    const invalid = join(root, "invalid.ts");
    const missing = join(root, "missing.ts");
    const link = join(root, "linked.ts");
    const bytes = Buffer.concat([
      Buffer.alloc(128 * 1024 - 1, 97),
      Buffer.from("สวัสดี😀"),
    ]);
    await writeFile(good, bytes);
    await writeFile(invalid, Buffer.from([0xff]));
    await symlink(good, link);
    const reply = await engine.request({
      operation: "hashFiles",
      paths: [good, invalid, missing, link],
      utf8: true,
    });
    assert.equal(reply.ok, true);
    assert.deepEqual(
      reply.result.files.map((file) => file.ok),
      [true, false, false, false]
    );
    assert.equal(reply.result.files[0].value.hash, sha256(bytes));
    assert.equal(reply.result.files[0].value.bytes, bytes.length);
    assert.equal(reply.result.files[2].error.code, "ENOENT");
    await writeFile(good, "changed");
    const after = await engine.request({
      operation: "hashFiles",
      paths: [good],
      utf8: true,
    });
    assert.equal(after.result.files[0].value.hash, sha256("changed"));
  });

  test(`${name}: Oxc never substitutes parsing for TypeScript authorization`, async (context) => {
    const engine = create();
    context.after(() => engine.close());
    const reply = await engine.request({
      operation: "classify",
      path: "page.tsx",
      source: "export const page = <div>Hello</div>;",
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.requiresTypeScript, true);
    assert.equal(reply.result.diagnostics, 0);
  });
}
