import { createHash } from "node:crypto";
import {
  lstat,
  readdir,
  readFile,
  mkdir,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Release producers stage already-built assets. Consumer installation never runs Cargo.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const supported = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64-gnu",
  "linux-x64-gnu",
  "linux-arm64-musl",
  "linux-x64-musl",
  "win32-arm64",
  "win32-x64",
].toSorted();
const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (
    !["--input", "--output", "--targets"].includes(key) ||
    !value ||
    options[key]
  ) {
    throw new Error(
      "Usage: stage.mjs --input DIR --output DIR [--targets target,target]; omit targets for all release platforms"
    );
  }
  options[key] = value;
}
if (!options["--input"] || !options["--output"]) {
  throw new Error("Input and output directories are required");
}
const targets = options["--targets"]
  ? options["--targets"].split(",").toSorted()
  : supported;
if (
  !targets.length ||
  new Set(targets).size !== targets.length ||
  targets.some((target) => !supported.includes(target))
) {
  throw new Error("Invalid native target selection");
}
const input = resolve(options["--input"]);
const output = resolve(options["--output"]);
const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function regular(path) {
  const entry = await lstat(path);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.size < 1 ||
    entry.size > 64 * 1024 * 1024
  ) {
    throw new Error(`Invalid native producer file: ${path}`);
  }
  const bytes = await readFile(path);
  if (bytes.length !== entry.size) {
    throw new Error(`Native producer file changed: ${path}`);
  }
  return bytes;
}
async function sources(directory) {
  const result = [];
  for (const entry of await readdir(join(root, directory), {
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink()) {
      throw new Error("Native source tree must not contain symlinks");
    }
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      result.push(...(await sources(path)));
    } else if (entry.isFile()) {
      result.push(path);
    } else {
      throw new Error("Native source tree must contain regular files");
    }
  }
  return result;
}
const sourcePaths = [
  "native/Cargo.toml",
  "native/Cargo.lock",
  "native/build.rs",
  ...(await sources("native/src")),
].toSorted();
const sourceEntries = await Promise.all(
  sourcePaths.map(async (path) => ({
    path,
    hash: hash(await regular(join(root, path))),
  }))
);
const version = JSON.parse(
  await readFile(join(root, "packages/compiler/package.json"), "utf8")
).version;
const manifest = {
  compilerVersion: version,
  engineAbi: "mirai-intl-native-v1",
  schemaVersion: 1,
  sourceHash: hash(JSON.stringify(sourceEntries)),
  targets: {},
};
const assets = [];
for (const target of targets) {
  const file = `mirai-intl-${target}.node`;
  const bytes = await regular(join(input, file));
  assets.push({ file, bytes });
  manifest.targets[target] = { bytes: bytes.length, file, hash: hash(bytes) };
}
// Never overwrite an existing asset set or leave a manifest selecting partial copies.
await mkdir(output, { recursive: false });
for (const { file, bytes } of assets) {
  await copyFile(join(input, file), join(output, file));
  if (hash(await regular(join(output, file))) !== hash(bytes)) {
    throw new Error("Native producer asset changed during staging");
  }
}
await writeFile(
  join(output, "engine-manifest.json"),
  `${JSON.stringify(manifest)}\n`,
  { flag: "wx" }
);
process.stdout.write(
  `${JSON.stringify({ output, targets, sourceHash: manifest.sourceHash, releaseComplete: targets.length === supported.length })}\n`
);
