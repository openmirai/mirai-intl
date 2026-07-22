import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new TypeError("Expected a valid release version");
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageFiles = [
  "packages/abi/package.json",
  "packages/compiler/package.json",
  "packages/runtime/package.json",
];

await Promise.all(
  packageFiles.map(async (relativePath) => {
    const path = resolve(root, relativePath);
    const manifest = JSON.parse(await readFile(path, "utf8"));
    manifest.version = version;
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  })
);
