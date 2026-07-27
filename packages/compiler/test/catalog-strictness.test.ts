import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CatalogValidationError, loadConventionCatalog } from "../src/catalog";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createCatalog(
  english: Readonly<Record<string, unknown>>,
  thai: Readonly<Record<string, unknown>>
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-strict-catalog-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/strict-catalog",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), english);
  await writeJson(join(root, "src/locales/global/th.json"), thai);
  return root;
}

describe("required locale message values", () => {
  it.each([
    ["empty", "", /greeting th must be a non-empty translation string/u],
    [
      "whitespace-only",
      " \n\t",
      /greeting th must be a non-empty translation string/u,
    ],
    [
      "null",
      null,
      /greeting has cross-locale kind mismatch: en=string, th=null/u,
    ],
    [
      "wrong-kind",
      42,
      /greeting has cross-locale kind mismatch: en=string, th=number/u,
    ],
  ])("rejects a %s required translation", async (_name, value, message) => {
    const root = await createCatalog(
      { greeting: "Hello" },
      { greeting: value }
    );
    try {
      await expect(loadConventionCatalog(root)).rejects.toThrow(message);
      await expect(loadConventionCatalog(root)).rejects.toMatchObject({
        file: "src/locales/global/th.json",
        locale: "th",
        name: CatalogValidationError.name,
        path: "greeting",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a missing required translation key", async () => {
    const root = await createCatalog({ greeting: "Hello" }, {});
    try {
      await expect(loadConventionCatalog(root)).rejects.toThrow(
        /<root> locale keys differ between en and th/u
      );
      await expect(loadConventionCatalog(root)).rejects.toMatchObject({
        file: "src/locales/global/th.json",
        locale: "th",
        name: CatalogValidationError.name,
        path: "greeting",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    ["null", null],
    ["number", 42],
  ])("rejects uniformly invalid %s message values", async (_name, value) => {
    const root = await createCatalog({ greeting: value }, { greeting: value });
    try {
      await expect(loadConventionCatalog(root)).rejects.toThrow(
        new RegExp(
          `Translation path greeting has invalid message kind ${_name}`,
          "u"
        )
      );
      await expect(loadConventionCatalog(root)).rejects.toMatchObject({
        file: "src/locales/global/en.json",
        locale: "en",
        name: CatalogValidationError.name,
        path: "greeting",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
