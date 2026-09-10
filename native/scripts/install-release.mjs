import { cp, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyNativeRelease } from "./release.mjs";

const [input] = process.argv.slice(2);
if (!input) {
  throw new Error("Expected downloaded all-target native directory");
}
await verifyNativeRelease(undefined, resolve(input));
const output = resolve("packages/compiler/native");
try {
  await lstat(output);
  throw new Error("Refusing to overwrite an existing native asset set");
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}
await cp(resolve(input), output, {
  recursive: true,
  errorOnExist: true,
  force: false,
});
await verifyNativeRelease();
