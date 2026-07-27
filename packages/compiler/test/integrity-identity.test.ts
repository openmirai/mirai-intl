import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Sha256 } from "@openmirai/intl-abi";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalHash } from "../src/canonical";
import {
  computeApplicationPackageIdentity,
  computeCompilerImplementationIdentity,
  computeResolvedPackageIdentity,
  computeTypeScriptLibIdentity,
  createIntegrityManifest,
  getImmutableIntegrityIdentity,
} from "../src/integrity-identity";

const roots: Array<string> = [];

async function temporaryRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `mirai-intl-${name}-`));
  roots.push(root);
  return root;
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, contents, "utf8");
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("integrity manifests", () => {
  it("normalizes separators, sorts paths, and rejects duplicate or escaping paths", () => {
    const hash = `sha256:${"0".repeat(64)}` as Sha256;
    expect(
      createIntegrityManifest([
        { hash, path: "z.ts", size: 1 },
        { hash, path: "nested\\a.ts", size: 2 },
      ]).entries
    ).toEqual([
      { hash, path: "nested/a.ts", size: 2 },
      { hash, path: "z.ts", size: 1 },
    ]);

    expect(() =>
      createIntegrityManifest([
        { hash, path: "a.ts", size: 1 },
        { hash, path: "a.ts", size: 1 },
      ])
    ).toThrow("Duplicate integrity manifest path");
    expect(() =>
      createIntegrityManifest([{ hash, path: "../a.ts", size: 1 }])
    ).toThrow("Invalid integrity manifest path");
  });
});

describe("compiler implementation identity", () => {
  it("is path-independent and changes when a shipped module changes", async () => {
    const first = await temporaryRoot("compiler-a");
    const second = await temporaryRoot("compiler-b");
    for (const root of [first, second]) {
      await write(join(root, "proof.ts"), "export const proof = 1;\n");
      await write(
        join(root, "nested/generation.js"),
        "export const generation = 2;\n"
      );
      await write(join(root, "ignored.test.ts"), "throw new Error();\n");
      await write(join(root, "ignored.d.ts"), "export declare const x: 1;\n");
      await write(join(root, "ignored.js.map"), "{}\n");
    }

    const before = await computeCompilerImplementationIdentity(first);
    expect(await computeCompilerImplementationIdentity(second)).toEqual(before);
    expect(before.modules.entries.map((entry) => entry.path)).toEqual([
      "nested/generation.js",
      "proof.ts",
    ]);

    await write(join(second, "proof.ts"), "export const proof = 3;\n");
    expect((await computeCompilerImplementationIdentity(second)).hash).not.toBe(
      before.hash
    );
  });

  it("rejects symlinks and unexpected shipped paths", async () => {
    const root = await temporaryRoot("compiler-invalid");
    await write(join(root, "proof.ts"), "export {};\n");
    await symlink(join(root, "proof.ts"), join(root, "linked.ts"));
    await expect(computeCompilerImplementationIdentity(root)).rejects.toThrow(
      "contains a symlink"
    );
    await rm(join(root, "linked.ts"));
    await write(join(root, "README.md"), "unexpected\n");
    await expect(computeCompilerImplementationIdentity(root)).rejects.toThrow(
      "Unexpected compiler module path"
    );
  });
});

describe("resolved dependency identity", () => {
  it("binds canonical package metadata and resolved entry bytes", async () => {
    const root = await temporaryRoot("dependency");
    const dependencyRoot = join(root, "node_modules/fixture-dependency");
    await write(
      join(dependencyRoot, "package.json"),
      JSON.stringify({
        main: "index.js",
        name: "fixture-dependency",
        version: "1.0.0",
      })
    );
    await write(join(dependencyRoot, "index.js"), "export const value = 1;\n");
    await write(
      join(dependencyRoot, "helper.js"),
      "export const helper = 1;\n"
    );

    const before = await computeResolvedPackageIdentity(
      "fixture-dependency",
      root
    );
    expect(before.entry.path).toBe("index.js");
    expect(before.packageFiles.entries.map((entry) => entry.path)).toEqual([
      "helper.js",
      "index.js",
      "package.json",
    ]);
    await write(
      join(dependencyRoot, "helper.js"),
      "export const helper = 2;\n"
    );
    const afterNonEntryMutation = await computeResolvedPackageIdentity(
      "fixture-dependency",
      root
    );
    expect(afterNonEntryMutation.hash).not.toBe(before.hash);

    await write(join(dependencyRoot, "index.js"), "export const value = 2;\n");
    const afterEntryMutation = await computeResolvedPackageIdentity(
      "fixture-dependency",
      root
    );
    expect(afterEntryMutation.hash).not.toBe(afterNonEntryMutation.hash);

    await write(
      join(dependencyRoot, "package.json"),
      JSON.stringify({
        main: "index.js",
        name: "fixture-dependency",
        version: "1.0.1",
      })
    );
    expect(
      (await computeResolvedPackageIdentity("fixture-dependency", root)).hash
    ).not.toBe(afterEntryMutation.hash);
  });

  it("caches the immutable compiler and dependency identity per process", async () => {
    const first = getImmutableIntegrityIdentity();
    const second = getImmutableIntegrityIdentity();
    expect(second).toBe(first);
    await expect(first).resolves.toMatchObject({
      icuParser: { name: "@formatjs/icu-messageformat-parser" },
      typescript: { name: "typescript" },
    });
  });
});

describe("TypeScript lib identity", () => {
  it("binds a normalized declaration manifest and changes on lib mutation", async () => {
    const root = await temporaryRoot("typescript");
    await write(join(root, "lib/lib.es2024.d.ts"), "interface Example {}\n");
    await write(join(root, "lib/typescript.js"), "ignored\n");

    const before = await computeTypeScriptLibIdentity(root);
    expect(before.libs.entries.map((entry) => entry.path)).toEqual([
      "lib.es2024.d.ts",
    ]);
    await write(
      join(root, "lib/lib.es2024.d.ts"),
      "interface Example { changed: true }\n"
    );
    expect((await computeTypeScriptLibIdentity(root)).hash).not.toBe(
      before.hash
    );
  });
});

describe("application package identity", () => {
  it("omits an absent workspace lock from its canonical identity", async () => {
    const root = await temporaryRoot("application-without-lock");
    await write(
      join(root, "package.json"),
      JSON.stringify({ name: "application", private: true })
    );

    const identity = await computeApplicationPackageIdentity(root);
    expect(identity).not.toHaveProperty("lock");
    expect(identity.hash).toBe(
      canonicalHash({ packageJsonHash: identity.packageJsonHash })
    );
  });

  it("is path-independent, uncached, and binds workspace lock mutations", async () => {
    const first = await temporaryRoot("application-a");
    const second = await temporaryRoot("application-b");
    for (const root of [first, second]) {
      await write(
        join(root, "package.json"),
        JSON.stringify({ name: "application", private: true })
      );
      await write(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    }

    const before = await computeApplicationPackageIdentity(first);
    expect(before.lock).toEqual({
      hash: expect.stringMatching(/^sha256:/u),
      name: "pnpm-lock.yaml",
    });
    expect(before.hash).toBe(
      canonicalHash({
        lock: before.lock,
        packageJsonHash: before.packageJsonHash,
      })
    );
    expect(await computeApplicationPackageIdentity(second)).toEqual(before);
    await write(
      join(first, "package.json"),
      JSON.stringify({ name: "application", private: true, version: "1.0.0" })
    );
    const afterPackageMutation = await computeApplicationPackageIdentity(first);
    expect(afterPackageMutation.hash).not.toBe(before.hash);
    await write(
      join(first, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\npackages: {}\n"
    );
    expect((await computeApplicationPackageIdentity(first)).hash).not.toBe(
      afterPackageMutation.hash
    );
  });
});
