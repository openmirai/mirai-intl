import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  canonicalJson,
  sha256,
  decodeUtf8Fatal,
} from "../../packages/compiler/src/canonical.ts";
import { addonTransport, workerTransport } from "./transports.mjs";

const [backend, scenario, manifestPath, lifecycle = "cold"] =
  process.argv.slice(2);
assert.ok(["node", "addon", "worker"].includes(backend));
assert.ok(["hash", "receipt"].includes(scenario));
assert.ok(["cold", "warm"].includes(lifecycle));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let engine;
if (backend === "addon") {
  engine = addonTransport(
    resolve("native/target/release/mirai_intl_engine.node"),
    4
  );
}
if (backend === "worker") {
  engine = workerTransport(
    resolve("native/target/release/mirai-intl-worker"),
    4
  );
}

async function operation() {
  if (scenario === "receipt") {
    for (const entry of manifest.receipts) {
      const source = await readFile(entry.path, "utf8");
      if (engine) {
        const reply = await engine.request({
          operation: "canonicalReceipt",
          source,
        });
        assert.equal(reply.ok, true, JSON.stringify(reply));
        assert.equal(reply.result.canonical, true);
        assert.equal(reply.result.hash, entry.hash);
      } else {
        assert.equal(`${canonicalJson(JSON.parse(source))}\n`, source);
        assert.equal(sha256(source), entry.hash);
      }
    }
  } else if (engine) {
    const reply = await engine.request({
      operation: "hashFiles",
      paths: manifest.files.map((entry) => entry.path),
      utf8: true,
    });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.equal(reply.result.files.length, manifest.files.length);
    for (const [index, result] of reply.result.files.entries()) {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.value.hash, manifest.files[index].hash);
      assert.equal(result.value.bytes, manifest.files[index].bytes);
    }
  } else {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: 16 }, async () => {
        for (;;) {
          const entry = manifest.files[cursor++];
          if (!entry) {
            return;
          }
          const metadata = await lstat(entry.path);
          assert.ok(metadata.isFile() && !metadata.isSymbolicLink());
          const bytes = await readFile(entry.path);
          decodeUtf8Fatal(bytes, entry.path);
          assert.equal(bytes.length, entry.bytes);
          assert.equal(sha256(bytes), entry.hash);
        }
      })
    );
  }
}

try {
  if (lifecycle === "warm") {
    process.stdout.write('{"type":"ready","protocol":"ci-operation-v1"}\n');
    for await (const line of createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    })) {
      const request = JSON.parse(line);
      if (request.type === "shutdown") {
        break;
      }
      assert.equal(request.type, "run");
      await operation();
      process.stdout.write(
        `${JSON.stringify({ type: "result", id: request.id, ok: true })}\n`
      );
    }
  } else {
    await operation();
    process.stdout.write(
      `${JSON.stringify({ backend, scenario, ok: true })}\n`
    );
  }
} finally {
  await engine?.close();
}
