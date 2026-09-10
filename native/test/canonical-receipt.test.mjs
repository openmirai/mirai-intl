import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import {
  canonicalJson,
  sha256,
} from "../../packages/compiler/src/canonical.ts";
import { addonTransport, workerTransport } from "./transports.mjs";

function corpus() {
  let state = 0x12345678;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  const values = [];
  const data = new DataView(new ArrayBuffer(8));
  for (let index = 0; index < 1000; index++) {
    data.setUint32(0, random());
    data.setUint32(4, random());
    const value = data.getFloat64(0);
    if (Number.isFinite(value)) {
      values.push(value);
    }
    values.push({
      a: [index, random() % 2 === 0, null],
      z: `สวัสดี😀${String.fromCharCode(random() % 128)}\n`,
      𐀀: random(),
      "\ue000": "é",
    });
  }
  const valid = values.map((value) => `${canonicalJson(value)}\n`);
  return [
    ...valid,
    ...valid
      .slice(0, 500)
      .flatMap((source) => [
        source.slice(0, -1),
        ` ${source}`,
        `${source}\n`,
        source.replace('"a":', '"a" :'),
      ]),
  ];
}

for (const [name, create] of [
  [
    "addon",
    () =>
      addonTransport(resolve("native/target/release/mirai_intl_engine.node")),
  ],
  [
    "worker",
    () => workerTransport(resolve("native/target/release/mirai-intl-worker")),
  ],
]) {
  test(`${name}: streaming receipt decisions match Node over deterministic numeric/Unicode mutations`, async (context) => {
    const engine = create();
    context.after(() => engine.close());
    for (const source of corpus()) {
      let expected = false;
      try {
        expected = `${canonicalJson(JSON.parse(source))}\n` === source;
      } catch {
        /* Invalid JSON cannot pass. */
      }
      const reply = await engine.request({
        operation: "canonicalReceipt",
        source,
      });
      assert.equal(reply.ok, true, JSON.stringify(reply));
      assert.equal(reply.result.canonical, expected, source);
      assert.equal(reply.result.hash, sha256(source));
    }
    for (const source of [
      '"\\ud800"\n',
      '{"\\udfff":1}\n',
      `${"[".repeat(140)}0${"]".repeat(140)}\n`,
    ]) {
      const reply = await engine.request({
        operation: "canonicalReceipt",
        source,
      });
      assert.equal(reply.ok, false);
      assert.equal(reply.error.code, "ERR_INTL_NATIVE_JSON_UNSUPPORTED");
      assert.equal(`${canonicalJson(JSON.parse(source))}\n`, source);
    }
  });
}
