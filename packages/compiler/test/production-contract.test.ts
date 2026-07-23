import { spawnSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  generateConventionCatalog,
  loadConventionCatalog,
} from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

const fixturesRoot = resolve(
  import.meta.dirname,
  "../../../fixtures/convention"
);

async function copyConventionFixture(
  name: "dashboard" | "landing"
): Promise<Readonly<{ container: string; root: string }>> {
  const container = await mkdtemp(join(tmpdir(), `mirai-intl-${name}-`));
  const root = join(container, name);
  await cp(join(fixturesRoot, name), root, { recursive: true });
  return { container, root };
}

describe("production convention discovery", () => {
  it.each([
    {
      catalogId: "fe-openmirai-landing",
      catalogPackage: "fe-openmirai-landing-intl-catalog",
      fixture: "landing" as const,
      framework: "next",
      localeRoot: "locales",
      paths: [
        "pages.compare.description",
        "pages.compare.diffs.title",
        "pages.compare.summary",
      ],
    },
    {
      catalogId: "@mirai/internal-dashboard",
      catalogPackage: "@mirai/internal-dashboard-intl-catalog",
      fixture: "dashboard" as const,
      framework: "vite",
      localeRoot: "src/locales",
      paths: [
        "appName",
        "pages.{-$locale}.short-links.description",
        "pages.{-$locale}.short-links.mode",
        "pages.{-$locale}.short-links.owner",
        "pages.{-$locale}.short-links.page.resultsCount",
        "pages.{-$locale}.short-links.resultCount",
        "pages.{-$locale}.short-links.title",
      ],
    },
  ])(
    "discovers the standard $fixture layout without app-authored intl config",
    async ({
      catalogId,
      catalogPackage,
      fixture,
      framework,
      localeRoot,
      paths,
    }) => {
      const { container, root } = await copyConventionFixture(fixture);
      try {
        const loaded = await loadConventionCatalog(root);

        expect(loaded.discovery).toEqual({
          catalogId,
          catalogPackage,
          excludedDirectories: ["combined", "generated", "node_modules"],
          flattenDirectories: ["global"],
          framework,
          localeRoot,
          locales: ["en", "th"],
          output: "src/i18n/generated",
          representation: "precompiled",
          schemaVersion: 1,
          sourceLocale: "en",
        });
        expect(loaded.configPath).toBe(
          await realpath(join(root, "package.json"))
        );
        expect(loaded.inputs.exceptionsPresent).toBe(false);
        expect(loaded.inputs.sourceFiles.map((file) => file.path)).not.toEqual(
          expect.arrayContaining([expect.stringContaining("combined")])
        );
        expect(loaded.source.messages.map((message) => message.path)).toEqual(
          paths
        );
      } finally {
        await rm(container, { force: true, recursive: true });
      }
    }
  );
});

describe("generated named-key contract", () => {
  it("types conventional namespace keys and exact arguments while keeping compact descriptors private", async () => {
    const { container, root } = await copyConventionFixture("dashboard");
    try {
      const generated = await generateConventionCatalog(root, {
        collectEnvironment: false,
      });
      const declaration = await readFile(
        join(generated.write.directory, "catalog.schema.gen.d.ts"),
        "utf8"
      );
      const facade = await readFile(
        join(root, "src/i18n/generated/index.ts"),
        "utf8"
      );
      const contract = JSON.parse(
        await readFile(
          join(generated.write.directory, "catalog.contract.gen.json"),
          "utf8"
        )
      ) as { messages: ReadonlyArray<Record<string, unknown>> };
      const provenance = JSON.parse(
        await readFile(
          join(generated.write.directory, "catalog.provenance.gen.json"),
          "utf8"
        )
      ) as {
        exports: ReadonlyArray<{
          descriptorExport: string;
          module: string;
          path: string;
          runtimeExport: string;
        }>;
      };
      const titleExport = provenance.exports.find(
        ({ path }) => path === "pages.{-$locale}.short-links.title"
      );
      const titleModule = await readFile(
        join(generated.write.directory, titleExport?.module ?? "missing"),
        "utf8"
      );

      expect(declaration).toMatch(/export type CatalogContract\b/u);
      expect(
        await readFile(
          join(generated.write.directory, "catalog.manifest.gen.d.mts"),
          "utf8"
        )
      ).toContain(
        'TypedCatalogManifest<CatalogContract,readonly ["en","th"],"en">'
      );
      expect(facade).toMatch(/\bCatalogContract\b/u);
      expect(facade).toContain(
        "bindTranslationKeyFactory<BoundCatalogContract>()"
      );
      expect(facade).toContain(
        "bindTranslationKeyParser<BoundCatalogContract>()"
      );
      expect(facade).toContain(
        "export type TranslationNamespace = NamespacePaths<BoundCatalogContract>;"
      );
      expect(facade).toContain(
        "export type TranslationKey<Namespace extends TranslationNamespace> = ArgumentFreeTextKeysFor<BoundCatalogContract, Namespace>;"
      );
      expect(facade).toMatch(/export type \{ CatalogLocale \}/u);
      expect(facade).not.toMatch(/\bmessage_/u);
      expect(facade).not.toMatch(/\bm\d+\b/u);
      expect(
        contract.messages.every((message) => !("exportName" in message))
      ).toBe(true);
      expect(titleExport).toMatchObject({
        descriptorExport: "m6",
        module: "catalog.messages.gen.mjs",
        runtimeExport: "r6",
      });
      expect(titleModule).toContain("export const m6 =");
      expect(titleModule).toContain("Short links");
      expect(titleModule).not.toContain("catalogTree");
      expect(titleModule).not.toContain("namespace_");
      await expect(
        readFile(
          join(generated.write.directory, "catalog.descriptors.gen.mjs"),
          "utf8"
        )
      ).rejects.toMatchObject({ code: "ENOENT" });

      const typeFixtureRoot = join(container, "types");
      await cp(join(root, "src/i18n/generated"), typeFixtureRoot, {
        recursive: true,
      });
      const runtimeTranslations = resolve(
        import.meta.dirname,
        "../../runtime/src/translations.ts"
      );
      const runtimeCatalog = resolve(
        import.meta.dirname,
        "../../runtime/src/catalog.ts"
      );
      await writeFile(
        join(typeFixtureRoot, "runtime-shim.d.ts"),
        [
          `export { bindFormErrorTranslator, bindFormSchema, bindTranslationKeyFactory, bindTranslationKeyParser } from ${JSON.stringify(runtimeTranslations)};`,
          `export type { ArgumentFreeTextKeysFor, NamespacePaths } from ${JSON.stringify(runtimeTranslations)};`,
          `export type { TypedCatalogManifest } from ${JSON.stringify(runtimeCatalog)};`,
          "",
        ].join("\n"),
        "utf8"
      );
      const consumer = [
        'import { catalogManifest } from "./index";',
        'import type { CatalogContract, TranslationKey, TranslationNamespace } from "./index";',
        'import { createUseTranslations } from "@openmirai/intl-runtime/react-i18next";',
        'import { bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl-runtime";',
        'import type { UseTranslationHook } from "@openmirai/intl-runtime/react-i18next";',
        'import type { UseTranslations } from "@openmirai/intl-runtime/react";',
        "",
        "declare const useTranslations: UseTranslations<CatalogContract>;",
        "declare const useTranslation: UseTranslationHook<any>;",
        'const shortLinksNamespace = "pages.{-$locale}.short-links" satisfies TranslationNamespace;',
        'const directTitleKey: TranslationKey<typeof shortLinksNamespace> = "title";',
        'const titleKeys = ["title"] as const satisfies readonly TranslationKey<"pages.{-$locale}.short-links">[];',
        'directTitleKey satisfies "title";',
        'titleKeys[0] satisfies "title";',
        'catalogManifest.locales satisfies readonly ["en", "th"];',
        'catalogManifest.sourceLocale satisfies "en";',
        "const createTranslationKey = bindTranslationKeyFactory<CatalogContract>();",
        "const parseTranslationKey = bindTranslationKeyParser<CatalogContract>();",
        'createTranslationKey("pages.{-$locale}.short-links")("title") satisfies "pages.{-$locale}.short-links.title";',
        "declare const boundaryInput: unknown;",
        'const parsedTitle = parseTranslationKey("pages.{-$locale}.short-links", boundaryInput);',
        "const inferredUseTranslations = createUseTranslations(catalogManifest, useTranslation);",
        'inferredUseTranslations("pages.{-$locale}.short-links").t("title") satisfies string;',
        "const renderChildren = (children: ReadonlyArray<unknown>): unknown => children;",
        'const { t } = useTranslations("pages.{-$locale}.short-links");',
        "if (parsedTitle) t(parsedTitle) satisfies string;",
        "",
        't("title") satisfies string;',
        "t(directTitleKey) satisfies string;",
        't("owner", { name: "Ada" }) satisfies string;',
        't("owner", { name: 42 }) satisfies string;',
        't("page.resultsCount", { count: 2 }) satisfies string;',
        't("resultCount", { count: 2 }) satisfies string;',
        't("mode", { mode: "active" }) satisfies string;',
        't.rich("description", {',
        "  components: { strong: renderChildren },",
        '  values: { name: "Ada" },',
        "});",
        "",
        "// @ts-expect-error Unknown namespaces are not widened to string.",
        'useTranslations("pages.missing");',
        "// @ts-expect-error Generated namespace aliases reject typos.",
        'const missingNamespace: TranslationNamespace = "pages.missing";',
        "// @ts-expect-error Generated key aliases reject typos.",
        'const misspelledTitle: TranslationKey<"pages.{-$locale}.short-links"> = "titel";',
        "// @ts-expect-error Generated key aliases contain only argument-free text messages.",
        'const parameterizedOwner: TranslationKey<"pages.{-$locale}.short-links"> = "owner";',
        "// @ts-expect-error Deferred-key namespaces are catalog-bound.",
        'createTranslationKey("pages.missing")("title");',
        "// @ts-expect-error Parser namespaces are catalog-bound.",
        'parseTranslationKey("pages.missing", boundaryInput);',
        "// @ts-expect-error Deferred keys must be argument-free text messages.",
        'createTranslationKey("pages.{-$locale}.short-links")("owner");',
        "// @ts-expect-error Rich messages cannot be deferred as plain keys.",
        'createTranslationKey("pages.{-$locale}.short-links")("description");',
        "// @ts-expect-error Relative keys are scoped to the selected namespace.",
        't("missing");',
        "// @ts-expect-error A static message accepts no argument object.",
        't("title", {});',
        "// @ts-expect-error Required scalar arguments cannot be omitted.",
        't("owner");',
        "// @ts-expect-error Plain interpolation accepts only string or number.",
        't("owner", { name: false });',
        "// @ts-expect-error Plain interpolation rejects null.",
        't("owner", { name: null });',
        "// @ts-expect-error Plain interpolation rejects objects.",
        't("owner", { name: {} });',
        "// @ts-expect-error Plain interpolation rejects arrays.",
        't("owner", { name: [] });',
        "// @ts-expect-error Plural inputs are numeric.",
        't("resultCount", { count: "2" });',
        "// @ts-expect-error Select inputs are strings.",
        't("mode", { mode: 1 });',
        "// @ts-expect-error Fresh argument objects reject extra fields.",
        't("resultCount", { count: 2, extra: true });',
        "const extraCount = { count: 2, extra: true };",
        "// @ts-expect-error Inferred variables cannot bypass exact arguments.",
        't("resultCount", extraCount);',
        "// @ts-expect-error Rich messages use the rich operation.",
        't("description", { name: "Ada" });',
        "// @ts-expect-error Text messages cannot be rendered as rich messages.",
        't.rich("title", { components: {} });',
        "// @ts-expect-error Rich component maps require every parsed tag.",
        't.rich("description", { components: {}, values: { name: "Ada" } });',
        "// @ts-expect-error Rich values retain their inferred scalar contract.",
        't.rich("description", { components: { strong: renderChildren }, values: { name: false } });',
        "// @ts-expect-error Rich component maps reject undeclared tags.",
        't.rich("description", { components: { em: renderChildren, strong: renderChildren }, values: { name: "Ada" } });',
        "",
      ].join("\n");
      await writeFile(join(typeFixtureRoot, "consumer.ts"), consumer, "utf8");
      await writeFile(
        join(typeFixtureRoot, "tsconfig.json"),
        `${JSON.stringify({
          compilerOptions: {
            exactOptionalPropertyTypes: true,
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            noUncheckedIndexedAccess: true,
            paths: {
              "@openmirai/intl-abi": [
                resolve(import.meta.dirname, "../../abi/src/index.ts"),
              ],
              "@openmirai/intl-runtime/react": [
                resolve(import.meta.dirname, "../../runtime/src/react.ts"),
              ],
              "@openmirai/intl-runtime": [
                join(typeFixtureRoot, "runtime-shim.d.ts"),
              ],
              "@openmirai/intl-runtime/react-i18next": [
                resolve(
                  import.meta.dirname,
                  "../../runtime/src/react-i18next.ts"
                ),
              ],
            },
            skipLibCheck: false,
            strict: true,
            target: "ES2024",
            types: [],
            verbatimModuleSyntax: true,
          },
          include: [
            "index.ts",
            "builds/**/*.d.mts",
            "builds/**/*.d.ts",
            "consumer.ts",
            "runtime-shim.d.ts",
          ],
        })}\n`,
        "utf8"
      );

      for (const alias of ["typescript-5-9", "typescript-6", "typescript-7"]) {
        const result = spawnSync(
          process.execPath,
          [
            resolve(
              import.meta.dirname,
              `../../../node_modules/${alias}/bin/tsc`
            ),
            "--project",
            join(typeFixtureRoot, "tsconfig.json"),
            "--pretty",
            "false",
          ],
          {
            encoding: "utf8",
            killSignal: "SIGKILL",
            maxBuffer: 1024 * 1024,
            shell: false,
            timeout: 120_000,
          }
        );

        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(`${result.stdout}${result.stderr}`).toBe("");
        expect(result.status).toBe(0);
      }
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 420_000);
});
