import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  authorizePrivateMessageSliceRequest,
  clearPrivateMessageModuleIndexCache,
  loadPrivateMessageSlice,
  parsePrivateMessageSliceRequest,
  privateMessageModuleIndexBuildCount,
  privateMessageModuleReadCount,
  privateMessageSliceSpecifier,
  slicePrivateMessagesModule,
} from "../src/private-module";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

const moduleSource = [
  'import { defineMessageDescriptor } from "@openmirai/intl-abi";',
  'import { createPrecompiledDescriptor } from "@openmirai/intl-runtime";',
  "",
  'const p0 = /* @__PURE__ */ createPrecompiledLocaleRenderer({ en: () => "UNRELATED" });',
  "export const r0 = /* @__PURE__ */ createPrecompiledRuntimeMessage({ validatorId: 0 }, p0);",
  "export const m0 = /* @__PURE__ */ createPrecompiledDescriptor(/* @__PURE__ */ defineMessageDescriptor({ validatorId: 0 }), p0, r0);",
  "",
  'const p1 = /* @__PURE__ */ createPrecompiledLocaleRenderer({ en: () => "REFERENCED" });',
  "export const r1 = /* @__PURE__ */ createPrecompiledRuntimeMessage({ validatorId: 1 }, p1);",
  "export const m1 = /* @__PURE__ */ createPrecompiledDescriptor(/* @__PURE__ */ defineMessageDescriptor({ validatorId: 1 }), p1, r1);",
  "",
].join("\n");

describe("private message virtual slices", () => {
  it("canonicalizes descriptor queries and retains only the selected closure", () => {
    const specifier = privateMessageSliceSpecifier(
      "./catalog.manifest.gen.mjs",
      ["m1", "m0", "m1"]
    );
    expect(specifier).toBe(
      "./catalog.manifest.gen.mjs?__mirai_intl_exports=m0,m1"
    );
    expect(parsePrivateMessageSliceRequest(specifier)).toEqual({
      descriptorExports: ["m0", "m1"],
      file: "./catalog.manifest.gen.mjs",
    });

    const sliced = slicePrivateMessagesModule(moduleSource, ["m1"]);
    expect(sliced).toContain("REFERENCED");
    expect(sliced).toContain("const p1 =");
    expect(sliced).toContain("export const r1 =");
    expect(sliced).toContain("export const m1 =");
    expect(sliced).not.toContain("UNRELATED");
    expect(sliced).not.toMatch(/\b[prm]0\b/u);
  });

  it("rejects malformed, duplicate, extra, unknown, and incomplete requests", () => {
    expect(() =>
      privateMessageSliceSpecifier("./catalog.manifest.gen.mjs", ["message"])
    ).toThrowError(/Invalid private message export/u);
    expect(() =>
      parsePrivateMessageSliceRequest(
        "./catalog.manifest.gen.mjs?__mirai_intl_exports=m0&extra=true"
      )
    ).toThrowError(/unexpected fields/u);
    expect(() =>
      parsePrivateMessageSliceRequest(
        "./catalog.manifest.gen.mjs?__mirai_intl_exports=m0&__mirai_intl_exports=m1"
      )
    ).toThrowError(/unexpected fields/u);
    expect(() => slicePrivateMessagesModule(moduleSource, ["m9"])).toThrowError(
      /complete p9\/r9\/m9 closure/u
    );
    expect(() =>
      slicePrivateMessagesModule(
        moduleSource.replace("const p1 =", "const q1 ="),
        ["m1"]
      )
    ).toThrowError(/unexpected binding q1/u);
    expect(() =>
      slicePrivateMessagesModule(moduleSource.replace(/^const p1 =.*$/mu, ""), [
        "m1",
      ])
    ).toThrowError(/complete p1\/r1\/m1 closure/u);
    expect(() =>
      slicePrivateMessagesModule(
        `${moduleSource}export const m1 = undefined;\n`,
        ["m1"]
      )
    ).toThrowError(/repeats m1/u);
    expect(() =>
      slicePrivateMessagesModule(
        `${moduleSource}console.log("side effect");\n`,
        ["m1"]
      )
    ).toThrowError(/unexpected top-level statement/u);
  });

  it("reads and indexes a large immutable module once across many private slices", async () => {
    clearPrivateMessageModuleIndexCache();
    const messageCount = 2_221;
    const source = [
      'import { defineMessageDescriptor } from "@openmirai/intl-abi";',
      ...Array.from({ length: messageCount }, (_, index) => [
        `const p${index} = ${index};`,
        `export const r${index} = p${index};`,
        `export const m${index} = r${index};`,
      ]).flat(),
      "",
    ].join("\n");
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-private-cache-"));
    const file = join(root, "catalog.messages.gen.mjs");
    await writeFile(file, source, "utf8");
    try {
      for (let index = 0; index < 256; index += 1) {
        const selected = index % messageCount;
        const sliced = await loadPrivateMessageSlice({
          currentFile: join(root, "current.json"),
          descriptorExports: [`m${selected}`],
          file: join(root, "catalog.manifest.gen.mjs"),
          messageFile: file,
        });
        expect(sliced).toContain(`export const m${selected} = r${selected};`);
        expect(sliced).not.toContain(
          `export const m${(selected + 1) % messageCount} =`
        );
      }

      expect(privateMessageModuleReadCount()).toBe(1);
      expect(privateMessageModuleIndexBuildCount()).toBe(1);
      slicePrivateMessagesModule(`${source}\n`, ["m0"], file);
      expect(privateMessageModuleIndexBuildCount()).toBe(2);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("authorizes only the selected content-addressed private carrier", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-private-auth-"));
    const generated = join(root, "src/i18n/generated");
    const hash = "c".repeat(64);
    const directory = `builds/${hash}`;
    const selectedDirectory = join(generated, directory);
    const selected = join(selectedDirectory, "catalog.messages.gen.mjs");
    const carrier = join(selectedDirectory, "catalog.manifest.gen.mjs");
    const facade = join(generated, "index.ts");
    await writeJson(join(generated, "current.json"), {
      contentHash: `sha256:${hash}`,
      directory,
    });
    await mkdir(join(selected, ".."), { recursive: true });
    await writeFile(selected, moduleSource, "utf8");
    await writeFile(carrier, "export const catalogManifest = {};\n", "utf8");
    await writeFile(
      facade,
      `// @mirai-intl-selector ${JSON.stringify({ contentHash: `sha256:${hash}`, directory, schemaVersion: 1 })}\n`,
      "utf8"
    );
    const query = "?__mirai_intl_exports=m1";

    try {
      await expect(
        authorizePrivateMessageSliceRequest(`${carrier}${query}`, { root })
      ).resolves.toMatchObject({
        descriptorExports: ["m1"],
        currentFile: join(generated, "current.json"),
        file: carrier,
        messageFile: selected,
      });

      const foreign = join(root, "foreign/catalog.manifest.gen.mjs");
      await mkdir(join(foreign, ".."), { recursive: true });
      await writeFile(foreign, moduleSource, "utf8");
      await expect(
        authorizePrivateMessageSliceRequest(`${foreign}${query}`, { root })
      ).rejects.toThrowError(/selected carrier/u);

      const escaped = `${generated}/builds/../catalog.manifest.gen.mjs`;
      await expect(
        authorizePrivateMessageSliceRequest(`${escaped}${query}`, { root })
      ).rejects.toThrowError(/escape segments/u);

      const linked = join(root, "linked/catalog.manifest.gen.mjs");
      await mkdir(join(linked, ".."), { recursive: true });
      await symlink(carrier, linked, "file");
      await expect(
        authorizePrivateMessageSliceRequest(`${linked}${query}`, { root })
      ).rejects.toThrowError(/selected carrier|symbolic link/u);

      await writeFile(
        facade,
        `// @mirai-intl-selector ${JSON.stringify({ contentHash: `sha256:${"d".repeat(64)}`, directory, schemaVersion: 1 })}\n`,
        "utf8"
      );
      await expect(
        authorizePrivateMessageSliceRequest(`${carrier}${query}`, { root })
      ).rejects.toThrowError(/selector/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
