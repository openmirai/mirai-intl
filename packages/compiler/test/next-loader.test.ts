import { cp, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { regenerateMiraiIntlCatalog } from "../src/lifecycle";
import miraiIntlNextLoader from "../src/next-loader";

const dashboardFixture = resolve(
  import.meta.dirname,
  "../../../fixtures/convention/dashboard"
);

const messageModule = "catalog.messages.gen.mjs";

function runLoader(
  root: string,
  resourcePath: string,
  source: string
): Promise<Readonly<{ code: string; dependencies: ReadonlyArray<string> }>> {
  return new Promise((resolvePromise, rejectPromise) => {
    const dependencies: Array<string> = [];
    miraiIntlNextLoader.call(
      {
        addDependency(path) {
          dependencies.push(path);
        },
        async: () => (error, code) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          if (code === undefined) {
            rejectPromise(new Error("Next loader returned no source"));
            return;
          }
          resolvePromise({ code, dependencies });
        },
        cacheable: vi.fn(),
        getOptions: () => ({ root }),
        resourcePath,
      },
      source
    );
  });
}

describe("mirai intl Next loader", () => {
  it("returns unrelated modules before reading options or discovering a catalog", () => {
    const inputMap = { mappings: "unchanged" };
    const callback = vi.fn();
    const cacheable = vi.fn();
    const getOptions = vi.fn(() => {
      throw new Error("Unrelated modules must not read intl options");
    });

    miraiIntlNextLoader.call(
      {
        addDependency: vi.fn(),
        async: () => callback,
        cacheable,
        getOptions,
        resourcePath: join("/repo", "src", "plain.ts"),
      },
      "export const answer = 42;\n",
      inputMap
    );

    expect(cacheable).toHaveBeenCalledWith(true);
    expect(getOptions).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      null,
      "export const answer = 42;\n",
      inputMap
    );
  });

  it("lowers canonical generated-facade deferred keys without message imports", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-next-key-"));
    const root = join(container, "dashboard");
    await cp(dashboardFixture, root, { recursive: true });
    const resourcePath = join(root, "src/schema.ts");
    const source = [
      'import { createTranslationKey } from "./i18n/generated";',
      'export const key = createTranslationKey("pages.{-$locale}.short-links")("title");',
      "",
    ].join("\n");
    try {
      const result = await runLoader(root, resourcePath, source);
      expect(result.code).toContain(
        'export const key = "pages.{-$locale}.short-links.title";'
      );
      expect(result.code).not.toContain("createTranslationKey");
      expect(result.code).not.toContain(messageModule);
      expect(result.dependencies).toEqual(
        expect.arrayContaining([
          join(root, "src/i18n/generated/current.json"),
          join(root, "src/i18n/generated/index.ts"),
        ])
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rotates warm-cache imports and dependencies when old reader files are retained", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-next-cache-"));
    const root = join(container, "dashboard");
    await cp(dashboardFixture, root, { recursive: true });
    const generatedRoot = join(root, "src/i18n/generated");
    const resourcePath = join(root, "src/page.tsx");
    const source = [
      'import { useTranslations } from "x";',
      'const { t } = useTranslations("pages.{-$locale}.short-links");',
      'export const title = t("title");',
      "",
    ].join("\n");
    try {
      const first = await runLoader(root, resourcePath, source);
      const firstPointer = JSON.parse(
        await readFile(join(generatedRoot, "current.json"), "utf8")
      ) as { directory: string };
      const firstDirectory = join(generatedRoot, firstPointer.directory);
      const backup = join(container, "retained-reader-build");
      await cp(firstDirectory, backup, { recursive: true });

      expect(first.code).toContain(firstPointer.directory);
      expect(first.code).toContain(messageModule);
      expect(first.code).toMatch(/import \{ m\d+ as __miraiIntlMessage0 \}/u);
      expect(first.dependencies).toEqual(
        expect.arrayContaining([
          join(generatedRoot, "current.json"),
          join(firstDirectory, "catalog.contract.gen.json"),
          join(firstDirectory, "catalog.provenance.gen.json"),
          join(firstDirectory, messageModule),
        ])
      );
      const firstPrivateModule = await readFile(
        join(firstDirectory, messageModule),
        "utf8"
      );
      expect(firstPrivateModule).toContain("Short links");
      expect(firstPrivateModule).toContain("Manage");

      await writeFile(
        join(root, "src/locales/pages/{-$locale}/short-links/en.json"),
        `${JSON.stringify(
          {
            description: "Manage <strong>{name}</strong>",
            mode: "{mode, select, active {Active} other {All}}",
            owner: "Owner {name}",
            page: {
              resultsCount: "{count, plural, one {# result} other {# results}}",
            },
            resultCount: "{count, plural, one {# link} other {# links}}",
            title: "Rotated short links",
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      await regenerateMiraiIntlCatalog({ root });
      const secondPointer = JSON.parse(
        await readFile(join(generatedRoot, "current.json"), "utf8")
      ) as { directory: string };
      expect(secondPointer.directory).not.toBe(firstPointer.directory);
      const secondDirectory = join(generatedRoot, secondPointer.directory);

      // Production generation is restart-only. Retention here models a reader
      // that is intentionally allowed to finish while a prepared selector is
      // observed by the next warm compilation.
      await cp(backup, firstDirectory, { recursive: true });
      const second = await runLoader(root, resourcePath, source);

      expect(second.code).toContain(secondPointer.directory);
      expect(second.code).not.toContain(firstPointer.directory);
      expect(second.code).toContain(messageModule);
      expect(second.code).toMatch(/import \{ m\d+ as __miraiIntlMessage0 \}/u);
      expect(second.dependencies).toEqual(
        expect.arrayContaining([
          join(generatedRoot, "current.json"),
          join(secondDirectory, "catalog.contract.gen.json"),
          join(secondDirectory, "catalog.provenance.gen.json"),
          join(secondDirectory, messageModule),
        ])
      );
      await expect(stat(firstDirectory)).resolves.toBeDefined();
      await expect(stat(secondDirectory)).resolves.toBeDefined();
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 30_000);
});
