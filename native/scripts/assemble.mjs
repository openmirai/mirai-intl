import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  hash,
  regular,
  sourceHash,
  targets,
  rustVersion,
  verifyNativeRelease,
} from "./release.mjs";

const [input, output, revision] = process.argv.slice(2);
if (!input || !output || !/^[a-f0-9]{40}$/u.test(revision ?? "")) {
  throw new Error(
    "Expected input, new bundle directory and immutable revision"
  );
}
const expectedSource = await sourceHash();
const bundle = resolve(output);
await mkdir(bundle, { recursive: false });
await mkdir(join(bundle, "evidence"));
for (const target of targets) {
  const receipt = JSON.parse(
    await regular(join(input, `${target}.json`), 65536)
  );
  const file = `mirai-intl-${target}.node`;
  const bytes = await regular(join(input, file));
  if (
    receipt.schemaVersion !== 1 ||
    receipt.target !== target ||
    receipt.sourceRevision !== revision ||
    receipt.sourceHash !== expectedSource ||
    !receipt.rust?.startsWith(`rustc ${rustVersion} `) ||
    receipt.file !== file ||
    receipt.hash !== hash(bytes) ||
    receipt.bytes !== bytes.length ||
    receipt.runtime?.target !== target ||
    receipt.runtime?.runtimePassed !== true ||
    !(receipt.runtime?.node ?? "").startsWith("v24.") ||
    (target.startsWith("linux-") &&
      !/@sha256:[a-f0-9]{64}$/u.test(receipt.image ?? ""))
  ) {
    throw new Error(
      `Native runtime/build evidence missing or mismatched: ${target}`
    );
  }
  await copyFile(
    join(input, `${target}.json`),
    join(bundle, "evidence", `${target}.json`)
  );
}
const pins = JSON.parse(await readFile("native-artifact-pins.json", "utf8"));
if (pins.revision !== revision || pins.artifacts.length !== targets.length) {
  throw new Error("Artifact pins do not match assembly");
}
await copyFile(
  "native-artifact-pins.json",
  join(bundle, "evidence", "artifact-pins.json")
);
const staged = spawnSync(
  process.execPath,
  [
    "native/scripts/stage.mjs",
    "--input",
    resolve(input),
    "--output",
    join(bundle, "native"),
  ],
  { stdio: "inherit" }
);
if (staged.error || staged.status !== 0) {
  throw new Error("All-target staging failed");
}
await verifyNativeRelease(undefined, join(bundle, "native"));
