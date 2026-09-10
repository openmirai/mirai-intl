import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  targets,
  hash,
  repositoryRoot,
  verifyNativeRelease,
} from "./release.mjs";
import { selectArtifacts } from "./artifact-pins.mjs";
import { matrix } from "./targets.mjs";

const revision = "a".repeat(40);
const context = { revision, attempt: "2", runId: "123", repositoryId: "456" };
function artifacts() {
  return targets.map((target, index) => ({
    id: index + 1,
    name: `native-${revision}-2-${target}`,
    digest: hash(target),
    size_in_bytes: 123,
    expired: false,
    workflow_run: { id: 123, repository_id: 456 },
  }));
}
test("all eight recipes require matching-architecture hosted runtime gates", () => {
  assert.deepEqual(matrix.map((item) => item.target).toSorted(), targets);
  assert.equal(new Set(matrix.map((item) => item.target)).size, 8);
  for (const item of matrix) {
    assert.ok(
      item.triple.includes(item.arch === "arm64" ? "aarch64" : "x86_64")
    );
    if (item.target.endsWith("gnu")) {
      assert.match(item.image, /manylinux_2_28/u);
    }
    if (item.target.endsWith("musl")) {
      assert.match(item.image, /alpine/u);
    }
  }
});
test("artifact pins reject missing/duplicate/expired/cross-run/wrong-repository/digestless artifacts", () => {
  assert.equal(selectArtifacts(artifacts(), context).length, 8);
  for (const mutate of [
    (values) => values.pop(),
    (values) => values.push(values[0]),
    (values) => {
      values[0].expired = true;
    },
    (values) => {
      values[0].expired = undefined;
    },
    (values) => {
      values[0].size_in_bytes = undefined;
    },
    (values) => {
      values[0].id = values[1].id;
    },
    (values) => {
      values[0].workflow_run.id = 124;
    },
    (values) => {
      values[0].workflow_run.repository_id = 457;
    },
    (values) => {
      values[0].digest = undefined;
    },
    (values) => {
      values[0].name = `native-${revision}-1-${targets[0]}`;
    },
  ]) {
    const values = artifacts();
    mutate(values);
    assert.throws(() => selectArtifacts(values, context), /native artifact/u);
  }
});
test("existing stage.mjs all-target output passes release gate and source mutation invalidates it", async () => {
  const root = await mkdtemp(join(tmpdir(), "intl-native-release-test-"));
  try {
    const input = join(root, "input");
    await mkdir(input);
    for (const target of targets) {
      await writeFile(
        join(input, `mirai-intl-${target}.node`),
        `fixture:${target}`
      );
    }
    const output = join(root, "native");
    const staged = spawnSync(
      process.execPath,
      [
        join(repositoryRoot, "native/scripts/stage.mjs"),
        "--input",
        input,
        "--output",
        output,
      ],
      { encoding: "utf8" }
    );
    assert.equal(staged.status, 0, staged.stderr);
    const verified = await verifyNativeRelease(repositoryRoot, output);
    assert.equal(verified.files.size, 9);
    const manifestPath = join(output, "engine-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.sourceHash = hash("another source");
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    await assert.rejects(
      verifyNativeRelease(repositoryRoot, output),
      /current sources/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
