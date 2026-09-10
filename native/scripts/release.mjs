import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const targets = Object.freeze(
  [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64-gnu",
    "linux-x64-gnu",
    "linux-arm64-musl",
    "linux-x64-musl",
    "win32-arm64",
    "win32-x64",
  ].toSorted()
);
export const rustVersion = "1.98.0";
export const hash = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const exactKeys = (object, keys) =>
  object &&
  typeof object === "object" &&
  !Array.isArray(object) &&
  JSON.stringify(Object.keys(object).toSorted()) ===
    JSON.stringify([...keys].toSorted());
export async function regular(path, max = 64 * 1024 * 1024) {
  const stat = await lstat(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 1 ||
    stat.size > max
  ) {
    throw new Error(`Invalid release file: ${path}`);
  }
  const bytes = await readFile(path);
  if (bytes.length !== stat.size) {
    throw new Error(`Release file changed: ${path}`);
  }
  return bytes;
}
export async function sourceHash(root = repositoryRoot) {
  async function walk(directory) {
    const paths = [];
    for (const entry of await readdir(join(root, directory), {
      withFileTypes: true,
    })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        throw new Error("Symlink in native source tree");
      }
      if (entry.isDirectory()) {
        paths.push(...(await walk(path)));
      } else if (entry.isFile()) {
        paths.push(path);
      } else {
        throw new Error("Non-regular native source entry");
      }
    }
    return paths;
  }
  const paths = [
    "native/Cargo.toml",
    "native/Cargo.lock",
    "native/build.rs",
    ...(await walk("native/src")),
  ].toSorted();
  return hash(
    JSON.stringify(
      await Promise.all(
        paths.map(async (path) => ({
          path,
          hash: hash(await regular(join(root, path))),
        }))
      )
    )
  );
}
export async function verifyNativeRelease(
  root = repositoryRoot,
  directory = join(root, "packages/compiler/native")
) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Native release directory must be regular");
  }
  const bytes = await regular(join(directory, "engine-manifest.json"), 65536);
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  );
  const pkg = JSON.parse(
    await readFile(join(root, "packages/compiler/package.json"), "utf8")
  );
  if (
    ["preinstall", "install", "postinstall"].some((key) =>
      Object.hasOwn(pkg.scripts ?? {}, key)
    )
  ) {
    throw new Error("Compiler consumer install scripts are forbidden");
  }
  if (
    !exactKeys(manifest, [
      "compilerVersion",
      "engineAbi",
      "schemaVersion",
      "sourceHash",
      "targets",
    ]) ||
    manifest.compilerVersion !== pkg.version ||
    manifest.engineAbi !== "mirai-intl-native-v1" ||
    manifest.schemaVersion !== 1 ||
    !exactKeys(manifest.targets, targets) ||
    manifest.sourceHash !== (await sourceHash(root)) ||
    !bytes.equals(Buffer.from(`${JSON.stringify(manifest)}\n`))
  ) {
    throw new Error(
      "Native release manifest must match current sources/version and all eight targets"
    );
  }
  const files = new Map([["engine-manifest.json", bytes]]);
  for (const target of targets) {
    const item = manifest.targets[target];
    const file = `mirai-intl-${target}.node`;
    if (
      !exactKeys(item, ["file", "hash", "bytes"]) ||
      item.file !== file ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > 64 * 1024 * 1024
    ) {
      throw new Error(`Invalid native release target ${target}`);
    }
    const content = await regular(join(directory, file));
    if (content.length !== item.bytes || hash(content) !== item.hash) {
      throw new Error(`Native release digest mismatch: ${target}`);
    }
    files.set(file, content);
  }
  const inventory = await readdir(directory);
  if (
    JSON.stringify(inventory.toSorted()) !==
    JSON.stringify([...files.keys()].toSorted())
  ) {
    throw new Error("Native release inventory is incomplete or unexplained");
  }
  return { manifest, files };
}
export async function verifyPackedNative(tarball, expected) {
  const { t } = createRequire(
    new URL("../../packages/compiler/package.json", import.meta.url)
  )("tar");
  const seen = new Set();
  const pending = [];
  let failure;
  await t({
    file: tarball,
    strict: true,
    onReadEntry(entry) {
      if (!entry.path.startsWith("package/native/")) {
        entry.resume();
        return;
      }
      const file = entry.path.slice("package/native/".length);
      if (entry.type === "Directory" && file === "") {
        entry.resume();
        return;
      }
      const bytes = expected.files.get(file);
      if (
        entry.type !== "File" ||
        !bytes ||
        seen.has(file) ||
        entry.size !== bytes.length
      ) {
        failure = new Error(`Unexpected packed native asset: ${entry.path}`);
        entry.resume();
        return;
      }
      seen.add(file);
      pending.push(
        new Promise((resolveEntry, reject) => {
          const digest = createHash("sha256");
          entry.on("data", (chunk) => digest.update(chunk));
          entry.on("error", reject);
          entry.on("end", () => {
            if (`sha256:${digest.digest("hex")}` !== hash(bytes)) {
              failure = new Error(`Packed native digest mismatch: ${file}`);
            }
            resolveEntry();
          });
        })
      );
    },
  });
  await Promise.all(pending);
  if (failure) {
    throw failure;
  }
  if (seen.size !== expected.files.size) {
    throw new Error("Packed compiler is missing native prebuilt assets");
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await verifyNativeRelease();
  process.stdout.write(
    "Verified native release: all eight targets, source/version and exact binary digests\n"
  );
}
