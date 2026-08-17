import {
  appendFile,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptyObjectSchema } from "@openmirai/intl-abi";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  compileCatalog,
  defineIntlConfig,
  emitArtifacts,
} from "../src/internal";
import type { CatalogSource, MessageSource } from "../src/internal";
import {
  invalidateMiraiIntlCatalogCache,
  isMiraiIntlTransformCandidate,
  resolveSealedSemanticRealpath,
  transformMiraiIntlOwnerBatch,
  transformMiraiIntlSource,
} from "../src/transform";
import type {
  MiraiIntlSemanticBatchObservation,
  MiraiIntlSemanticEvidence,
  MiraiIntlTransformResult,
} from "../src/transform";
import { mergeSemanticProviders } from "../src/semantic-providers";
import { writeArtifactSet } from "./non-authoritative-writer";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

const messageModule = "catalog.messages.gen.mjs";

const textResultSchema = { type: "string" } as const;
const countValuesSchema = {
  additionalProperties: false,
  properties: { count: { finite: true, type: "number" } },
  required: ["count"],
  type: "object",
} as const;
const fixtureMessages = [
  ["pages.home.title", "text"],
  ["pages.home.error.form.required", "text"],
  ["pages.home.error.form.invalid", "text"],
  ["pages.home.description", "rich"],
  ["pages.home.settings", "value"],
  ["pages.about.title", "text"],
  ["rootTitle", "text"],
  ["pages.{-$locale}.short-links.title", "text"],
  ["pages.{-$locale}.short-links.page.resultsCount", "text-with-count"],
  ["components.toast.activate.error", "text"],
  ["components.toast.activate.success", "text"],
  ["components.toast.add.error", "text"],
  ["components.toast.add.success", "text"],
  ["components.toast.status.active", "text"],
  ["components.toast.status.inactive", "text"],
  ["components.toast.locale.en", "text"],
  ["components.toast.locale.th", "text"],
  ["components.toast.rich", "rich"],
  ["components.toast.parameterized", "text-with-count"],
] as const;

function fixtureMessage([
  path,
  fixtureKind,
]: (typeof fixtureMessages)[number]): MessageSource {
  const kind = fixtureKind === "text-with-count" ? "text" : fixtureKind;
  return {
    kind,
    path,
    provenance: `packages/compiler/test/transform.test.ts:${path}`,
    resultSchema: textResultSchema,
    translations:
      fixtureKind === "text-with-count"
        ? { en: "{count}", th: "{count}" }
        : { en: "Fixture", th: "Fixture" },
    valuesSchema:
      fixtureKind === "text-with-count" ? countValuesSchema : emptyObjectSchema,
  };
}

const fixtureCatalogSource = defineIntlConfig({
  buildId: "transform-fixture-build",
  catalogPackage: "@example/transform-fixture",
  id: "transform-fixture",
  locales: ["en", "th"],
  messages: fixtureMessages.map(fixtureMessage),
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
} satisfies CatalogSource);
const fixtureArtifacts = emitArtifacts(
  compileCatalog(fixtureCatalogSource),
  "constants",
  { compact: true }
);

async function createGeneratedCatalog(): Promise<
  Readonly<{
    directory: string;
    generatedDirectory: string;
    root: string;
  }>
> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-transform-"));
  const generatedDirectory = join(root, "src/i18n/generated");
  await writeJson(join(root, "tsconfig.json"), {
    compilerOptions: {
      module: "ESNext",
      moduleResolution: "Bundler",
      paths: { "@/*": ["src/*"] },
    },
  });
  const written = await writeArtifactSet(generatedDirectory, fixtureArtifacts);
  const canonicalRoot = await realpath(root);
  return {
    directory: written.directory.replace(`${generatedDirectory}/`, ""),
    generatedDirectory: join(canonicalRoot, "src/i18n/generated"),
    root: canonicalRoot,
  };
}

function requireTransform(
  result: MiraiIntlTransformResult | null
): MiraiIntlTransformResult {
  expect(result).not.toBeNull();
  if (!result) {
    throw new Error("Expected source to be lowered");
  }
  return result;
}

function lowerHomeTitle(
  fixture: Readonly<{ generatedDirectory: string; root: string }>
): Promise<MiraiIntlTransformResult | null> {
  return transformMiraiIntlSource(
    'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); t("title");',
    join(fixture.root, "src/component.tsx"),
    {
      generatedDirectory: fixture.generatedDirectory,
      root: fixture.root,
    }
  );
}

describe("private named-key lowering", () => {
  it("selects every eligible first-party source without source-text authority", () => {
    expect(
      isMiraiIntlTransformCandidate(
        'import { useTranslations as useT } from "x";',
        join("/repo", "src", "eligible.tsx")
      )
    ).toBe(true);
    expect(
      isMiraiIntlTransformCandidate(
        'import { createInstance } from "i18next"; const i18n = createInstance(); i18n.t("title");',
        join("/repo", "src", "unsafe-i18next.ts")
      )
    ).toBe(true);
    expect(
      isMiraiIntlTransformCandidate(
        'import { getServerTranslations } from "x";',
        `${join("/repo", "src", "server.ts")}?loader=query`
      )
    ).toBe(true);
    expect(
      isMiraiIntlTransformCandidate(
        'import { createTranslationKey } from "@/i18n/generated";',
        join("/repo", "src", "schema.ts")
      )
    ).toBe(true);
    expect(
      isMiraiIntlTransformCandidate(
        'import { useTranslations } from "x";',
        join("/repo", "node_modules", "package", "index.ts")
      )
    ).toBe(false);
    expect(
      isMiraiIntlTransformCandidate(
        'import { useTranslations } from "x";',
        join("/repo", "src", "styles.css")
      )
    ).toBe(false);
    expect(
      isMiraiIntlTransformCandidate(
        "export const answer = 42;",
        join("/repo", "src", "plain.ts")
      )
    ).toBe(true);
  });

  it("rejects direct i18next.t calls before an application build", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/unsafe-i18next.ts");
    await mkdir(join(fixture.root, "node_modules/i18next"), {
      recursive: true,
    });
    await writeFile(
      join(fixture.root, "node_modules/i18next/index.d.ts"),
      [
        "export interface i18n {",
        "  changeLanguage(locale: string): Promise<void>;",
        "  exists(key: string): boolean;",
        "  getResource(locale: string, namespace: string, key: string): unknown;",
        "  init(): Promise<void>;",
        "  t(key: string): string;",
        "}",
        "export function createInstance(): i18n;",
        "",
      ].join("\n")
    );
    const source = [
      'import { createInstance } from "i18next";',
      "const i18n = createInstance();",
      'i18n.t("pages.home.title");',
      "",
    ].join("\n");

    try {
      await expect(
        transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      ).rejects.toThrowError(/Direct i18next\.t\(\.\.\.\) is not type-safe/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects controller instance translation bypasses", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/unsafe-controller.ts");
    const source = [
      "declare const controller: { getActiveInstance(): { t(key: string): string } };",
      'controller.getActiveInstance().t("pages.home.title");',
      "",
    ].join("\n");

    try {
      await expect(
        transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      ).rejects.toThrowError(/Direct i18next\.t\(\.\.\.\) is not type-safe/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers aliases plus text, rich, value, root, and direct-result calls", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/example.tsx");
    const source = [
      '"use client";',
      'import { useTranslations as useT } from "@/hooks/useTranslations";',
      "",
      'const { t: translate } = useT("pages.home");',
      "const root = useT();",
      'translate("title");',
      'translate.rich("description", { components: {}, values: {} });',
      'translate.value("settings");',
      'root.t("rootTitle");',
      'useT("pages.about").t("title");',
      'useT("pages.{-$locale}.short-links").t("title");',
      'useT("pages.{-$locale}.short-links").t("page.resultsCount", { count: 2 });',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code.indexOf('"use client"')).toBeLessThan(
        result.code.indexOf("catalog.manifest.gen.mjs")
      );
      expect(result.code.indexOf("catalog.manifest.gen.mjs")).toBeLessThan(
        result.code.indexOf("@/hooks/useTranslations")
      );
      expect(
        result.code.match(
          /from ".*catalog\.manifest\.gen\.mjs\?__mirai_intl_exports=m\d+(?:,m\d+)*"/gu
        )
      ).toHaveLength(1);
      expect(result.code).not.toContain("catalog.descriptors.gen.mjs");
      expect(result.code).not.toMatch(/__miraiIntl_m\d+/u);
      expect(result.code).toContain("translate(__miraiIntlMessage");
      expect(result.code).toContain("translate.rich(__miraiIntlMessage");
      expect(result.code).toContain("translate.value(__miraiIntlMessage");
      expect(result.code).toContain("root.t(__miraiIntlMessage");
      expect(result.code).toMatch(
        /useT\("pages\.about"\)\.t\(__miraiIntlMessage\d+\)/u
      );
      expect(result.code).toMatch(
        /useT\("pages\.\{-\$locale\}\.short-links"\)\.t\(__miraiIntlMessage\d+\)/u
      );
      expect(result.code).toMatch(
        /useT\("pages\.\{-\$locale\}\.short-links"\)\.t\(__miraiIntlMessage\d+, \{ count: 2 \}\)/u
      );
      expect(result.map.version).toBe(3);
      expect(result.map.sources).toEqual([id]);
      expect(result.map.sourcesContent).toEqual([source]);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("tracks Landing object-form server translators through Promise.all and later destructuring", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/server.tsx");
    const source = [
      'import { getServerTranslations as getT } from "@/i18n/server";',
      "export async function render(locale: string) {",
      "  const [homeTranslations, aboutTranslations] = await Promise.all([",
      '    getT({ locale, namespace: "pages.home" }),',
      '    getT({ locale, namespace: "pages.about" }),',
      "  ]);",
      "  const { t } = homeTranslations;",
      "  const { t: tAbout } = aboutTranslations;",
      '  return [t("title"), tAbout("title")];',
      "}",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toMatch(/t\(__miraiIntlMessage\d+\)/u);
      expect(result.code).toMatch(/tAbout\(__miraiIntlMessage\d+\)/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers translation calls nested in interpolation values", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/nested.tsx");
    const source = [
      'import { useTranslations } from "@/hooks/useTranslations";',
      'const { t } = useTranslations("pages.home");',
      't("title", { fallback: t("error.form.invalid") });',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toMatch(
        /t\(__miraiIntlMessage\d+, \{ fallback: t\(__miraiIntlMessage\d+\) \}\)/u
      );
      expect(result.code).not.toContain('t("error.form.invalid")');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers generated-facade deferred keys to standalone literals without descriptor retention", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/schema.ts");
    const source = [
      'import { createTranslationKey as createKey } from "@/i18n/generated";',
      'const messageKey = createKey("components.toast");',
      'export const errorKey = messageKey("activate.error");',
      'export const inlineKey = createKey("pages.home")("title");',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain(
        'export const errorKey = "components.toast.activate.error";'
      );
      expect(result.code).toContain(
        'export const inlineKey = "pages.home.title";'
      );
      expect(result.code).not.toContain("createTranslationKey");
      expect(result.code).not.toContain("createKey");
      expect(result.code).not.toContain("messageKey");
      expect(result.code).not.toContain("catalog.messages.gen.mjs");
      expect(result.dependencies).not.toContain(
        join(fixture.generatedDirectory, fixture.directory, messageModule)
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers stored generated-facade named keys through the namespace registry", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/stored-key.ts");
    const source = [
      'import type { TranslationKey } from "@/i18n/generated";',
      'import { useTranslations } from "x";',
      'const config: { labelKey: TranslationKey<"components.toast">; route: string } = { labelKey: "activate.error", route: "/toast" };',
      'const { t } = useTranslations("components.toast");',
      "export const translated = t(config.labelKey);",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain('labelKey: "activate.error"');
      expect(result.code).toContain(
        '__miraiIntlTranslateDynamicText(t, config.labelKey, "components.toast", __miraiIntlDynamicTextRegistry)'
      );
      expect(result.code).toContain('["components.toast.activate.error"]');
      expect(result.code).not.toContain('["activate.error"]');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers the canonical generated boundary parser through the namespace registry", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/parse-key.ts");
    const source = [
      'import { parseTranslationKey as parseKey } from "@/i18n/generated";',
      "declare const input: unknown;",
      'export const parsed = parseKey("components.toast", input);',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain("parseCompilerTranslationKey");
      expect(result.code).toContain("createCompilerDynamicTextRegistry");
      expect(result.code).toContain('input, "components.toast"');
      expect(result.code).toContain('["components.toast.activate.error"]');
      expect(result.code).toContain('["components.toast.activate.success"]');
      expect(result.code).toContain('["components.toast.add.error"]');
      expect(result.code).toContain('["components.toast.add.success"]');
      expect(result.code).toContain('["components.toast.status.active"]');
      expect(result.code).toContain('["components.toast.status.inactive"]');
      expect(result.code).not.toContain('["components.toast.parameterized"]');
      expect(result.code).not.toContain('["components.toast.rich"]');
      expect(result.code).not.toContain("parseKey");
      expect(result.code).not.toContain("parseTranslationKey as");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers generated form-error translators to a closed error.form registry", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/form-error.tsx");
    const source = [
      'import { createFormErrorTranslator } from "@/i18n/generated";',
      'import { useTranslations } from "x";',
      'const { t } = useTranslations("pages.home");',
      'export const translateError = createFormErrorTranslator("pages.home", t);',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain("createCompilerFormErrorTranslator");
      expect(result.code).toContain('"pages.home"');
      expect(result.code).toContain('"pages.home.error.form.invalid"');
      expect(result.code).toContain('"pages.home.error.form.required"');
      expect(result.code).not.toContain("createFormErrorTranslator");
      expect(result.code).not.toContain('"pages.home.title"');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers form-error translators for namespaces without form entries", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/empty-form-error.ts");
    const source = [
      'import { createFormErrorTranslator } from "@/i18n/generated";',
      'import { useTranslations } from "x";',
      'const { t } = useTranslations("pages.about");',
      'export const translateError = createFormErrorTranslator("pages.about", t);',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain("createCompilerFormErrorTranslator");
      expect(result.code).toContain('"pages.about"');
      expect(result.code).not.toContain("error.form");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers generated form schemas to a closed error.form registry", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/form-schema.ts");
    const source = [
      'import { createFormSchema as createSchema } from "@/i18n/generated";',
      'export const schema = createSchema("pages.home", ({ error }) => ({ required: error("required"), invalid: error("invalid") }));',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain("createCompilerFormSchema");
      expect(result.code).toContain('"pages.home"');
      expect(result.code).toContain('"pages.home.error.form.invalid"');
      expect(result.code).toContain('"pages.home.error.form.required"');
      expect(result.code).not.toContain("createSchema");
      expect(result.code).not.toContain("createFormSchema as");
      expect(result.code).not.toContain('"pages.home.title"');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves generated form-schema helpers and their facade import", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/form-schema-helper.ts");
    const source = [
      'import { createFormSchema as createSchema } from "@/i18n/generated";',
      "export const createRatingSchema = createSchema.helper((required: string) => ({ required }));",
      "",
    ].join("\n");

    try {
      await expect(
        transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      ).resolves.toBeNull();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves a form-schema helper while lowering a mixed root schema", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/form-schema-mixed.ts");
    const source = [
      'import { createFormSchema as createSchema } from "@/i18n/generated";',
      "export const createRequiredSchema = createSchema.helper((required: string) => ({ required }));",
      'export const schema = createSchema("pages.home", ({ error }) => createRequiredSchema(error("required")));',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain(
        'import { createFormSchema as createSchema } from "@/i18n/generated"'
      );
      expect(result.code).toContain("createSchema.helper");
      expect(result.code).toContain("createCompilerFormSchema");
      expect(result.code).toContain('"pages.home.error.form.required"');
      expect(result.code).not.toContain('createSchema("pages.home"');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("still rejects non-helper form-schema factory escapes", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/form-schema-escape.ts");

    try {
      await expect(
        transformMiraiIntlSource(
          [
            'import { createFormSchema as createSchema } from "@/i18n/generated";',
            "export const escaped = createSchema;",
            "",
          ].join("\n"),
          id,
          {
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          }
        )
      ).rejects.toThrowError(
        /createFormSchema escapes the supported generated-factory syntax/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("allocates a collision-safe compiler form-schema helper", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/form-schema-collision.ts");
    const source = [
      'import { createFormSchema } from "@/i18n/generated";',
      'const createCompilerFormSchema = "occupied";',
      'export const schema = createFormSchema("pages.home", ({ error }) => ({ required: error("required") }));',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain(
        "createCompilerFormSchema as __miraiIntlCreateCompilerFormSchema"
      );
      expect(result.code).toContain(
        '__miraiIntlCreateCompilerFormSchema("pages.home"'
      );
      expect(result.code).toContain(
        'const createCompilerFormSchema = "occupied"'
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("requires form-schema factory provenance from the generated facade", async () => {
    const fixture = await createGeneratedCatalog();
    const options = {
      generatedDirectory: fixture.generatedDirectory,
      root: fixture.root,
    };
    await writeFile(
      join(fixture.root, "src/spoof-form-schema.ts"),
      "export const createFormSchema = () => undefined;\n",
      "utf8"
    );

    try {
      await expect(
        transformMiraiIntlSource(
          'import { createFormSchema } from "@/spoof-form-schema"; createFormSchema("pages.home", ({ error }) => error("required"));',
          join(fixture.root, "src/spoof-form-schema-use.ts"),
          options
        )
      ).rejects.toThrowError(
        /must be imported directly from the configured generated facade/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("requires a parsed boundary key to be narrowed before translation", async () => {
    const fixture = await createGeneratedCatalog();
    const options = {
      generatedDirectory: fixture.generatedDirectory,
      root: fixture.root,
    };
    const imports = [
      'import { parseTranslationKey } from "@/i18n/generated";',
      'import { useTranslations } from "x";',
      "declare const input: unknown;",
      'const { t } = useTranslations("components.toast");',
      'const key = parseTranslationKey("components.toast", input);',
    ];

    try {
      await expect(
        transformMiraiIntlSource(
          [...imports, "export const translated = t(key);", ""].join("\n"),
          join(fixture.root, "src/parse-key-unguarded.ts"),
          options
        )
      ).rejects.toThrowError(/must be finite named-key unions/u);

      const guarded = requireTransform(
        await transformMiraiIntlSource(
          [
            ...imports,
            "export const translated = key ? t(key) : undefined;",
            "",
          ].join("\n"),
          join(fixture.root, "src/parse-key-guarded.ts"),
          options
        )
      );
      expect(guarded.code).toContain("parseCompilerTranslationKey");
      expect(guarded.code).toContain("translateCompilerDynamicText");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("requires deferred-key factory provenance from the canonical generated facade", async () => {
    const fixture = await createGeneratedCatalog();
    const options = {
      generatedDirectory: fixture.generatedDirectory,
      root: fixture.root,
    };
    await writeFile(
      join(fixture.root, "src/spoof.ts"),
      "export const createTranslationKey = () => () => 'spoof';\n",
      "utf8"
    );
    await mkdir(join(fixture.root, "src/i18n"), { recursive: true });
    await writeFile(
      join(fixture.root, "src/i18n/index.ts"),
      'export { createTranslationKey } from "./generated";\n',
      "utf8"
    );

    try {
      for (const [index, imported] of ["@/spoof", "@/i18n"].entries()) {
        await expect(
          transformMiraiIntlSource(
            `import { createTranslationKey } from ${JSON.stringify(imported)}; createTranslationKey("pages.home")("title");`,
            join(fixture.root, `src/spoof-${index}.ts`),
            options
          )
        ).rejects.toThrowError(
          /must be imported directly from the configured generated facade/u
        );
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("fails closed for unsafe or incompatible deferred translation keys", async () => {
    const fixture = await createGeneratedCatalog();
    const options = {
      generatedDirectory: fixture.generatedDirectory,
      root: fixture.root,
    };
    const cases = [
      {
        error: /Dynamic translation-key namespaces/u,
        use: 'createTranslationKey(namespace)("title")',
      },
      {
        error: /requires exactly one literal namespace/u,
        use: 'createTranslationKey("pages.home", "extra")("title")',
      },
      {
        error: /Unknown translation namespace missing/u,
        use: 'createTranslationKey("missing")("title")',
      },
      {
        error: /Dynamic deferred translation keys/u,
        use: 'createTranslationKey("pages.home")(key)',
      },
      {
        error: /requires exactly one literal key/u,
        use: 'createTranslationKey("pages.home")("title", "extra")',
      },
      {
        error: /requires exactly one literal key/u,
        use: 'createTranslationKey("pages.home")()',
      },
      {
        error: /Unknown translation path pages\.home\.missing/u,
        use: 'createTranslationKey("pages.home")("missing")',
      },
      {
        error: /must be text, not rich/u,
        use: 'createTranslationKey("pages.home")("description")',
      },
      {
        error: /must be text, not value/u,
        use: 'createTranslationKey("pages.home")("settings")',
      },
      {
        error: /cannot require arguments/u,
        use: 'createTranslationKey("components.toast")("parameterized")',
      },
      {
        error: /escapes the supported generated-factory syntax/u,
        use: "consume(createTranslationKey)",
      },
    ];

    try {
      for (const [index, testCase] of cases.entries()) {
        await expect(
          transformMiraiIntlSource(
            [
              'import { createTranslationKey } from "@/i18n/generated";',
              `${testCase.use};`,
            ].join("\n"),
            join(fixture.root, `src/deferred-failure-${index}.ts`),
            options
          )
        ).rejects.toThrowError(testCase.error);
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 15_000);

  it("uses TypeScript symbols so nested shadowed factories and translators are untouched", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/shadowed.ts");
    const source = [
      'import { useTranslations } from "@/hooks/useTranslations";',
      'const { t } = useTranslations("pages.home");',
      'const lowered = t("title");',
      "function local(t: (key: string) => string) {",
      '  return t("title");',
      "}",
      "function other(useTranslations: (namespace: string) => { t: (key: string) => string }) {",
      '  return useTranslations("pages.home").t("title");',
      "}",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code.match(/__miraiIntlMessage\d+/gu)).toHaveLength(2);
      expect(result.code).toContain('return t("title")');
      expect(result.code).toContain(
        'return useTranslations("pages.home").t("title")'
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("permits translator bindings in React hook dependency arrays", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/memoized.tsx");
    const source = [
      'import { useMemo } from "react";',
      'import { useTranslations } from "x";',
      'const { t } = useTranslations("pages.home");',
      'const title = useMemo(() => t("title"), [t]);',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain("t(__miraiIntlMessage0)");
      expect(result.code).toContain("[t]");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers finite tuple, matrix, and record maps to frozen exact selections", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/maps.ts");
    const source = [
      'import { useTranslations } from "x";',
      'const ACTIONS = ["activate", "add"] as const;',
      'const STATES = ["error", "success"] as const;',
      'const STATUS = { enabled: "status.active", disabled: "status.inactive" } as const;',
      'const { t } = useTranslations("components.toast");',
      'const tuple = t.map(["status.active", "status.inactive"]);',
      "const matrix = t.map(ACTIONS, STATES);",
      "const record = t.map(STATUS);",
      "export { matrix, record, tuple };",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code.match(/catalog\.manifest\.gen\.mjs/gu)).toHaveLength(
        1
      );
      expect(result.code).not.toContain("t.map(");
      expect(result.code.match(/Object\.freeze/gu)).toHaveLength(5);
      expect(result.code).toContain('["activate"]: Object.freeze');
      expect(result.code).toContain('["enabled"]: t(__miraiIntlMessage');
      expect(result.code).toContain('["status.active"]: t(__miraiIntlMessage');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("lowers finite named-key unions into one minimal deterministic full-path registry", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/dynamic.ts");
    const source = [
      'import { useTranslations } from "x";',
      'declare const key: "components.toast.activate.error" | "status.active";',
      'declare const additionalKey: "add.success";',
      'const { t } = useTranslations("components.toast");',
      "const translated = t(key);",
      "const translatedAgain = t(additionalKey);",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain("translateCompilerDynamicText");
      expect(result.code).toContain("createCompilerDynamicTextRegistry");
      expect(result.code).toContain('["components.toast.status.active"]');
      expect(result.code).toContain('["components.toast.activate.error"]');
      expect(result.code).toContain('["components.toast.add.success"]');
      expect(result.code).not.toContain(
        '["components.toast.activate.success"]'
      );
      expect(result.code).not.toContain('["components.toast.add.error"]');
      expect(result.code).not.toContain('["components.toast.status.inactive"]');
      expect(result.code).not.toContain('["components.toast.parameterized"]');
      expect(result.code).not.toContain('["components.toast.rich"]');
      expect(result.code).not.toContain('["pages.home.title"]');
      expect(result.code).not.toContain('["status.active"]');
      expect(result.code).not.toContain("t(key)");
      expect(result.code).toContain(
        '__miraiIntlTranslateDynamicText(t, key, "components.toast", __miraiIntlDynamicTextRegistry)'
      );
      expect(
        result.code.match(/__miraiIntlCreateDynamicTextRegistry\(/gu)
      ).toHaveLength(1);
      expect(result.code.indexOf("activate.error")).toBeLessThan(
        result.code.indexOf("add.success")
      );
      expect(result.code.indexOf("add.success")).toBeLessThan(
        result.code.indexOf("status.active")
      );
      expect(result.code).toMatch(
        /\/\* @__PURE__ \*\/ __miraiIntlCreateDynamicTextRegistry\(/u
      );
      expect([
        ...new Set(
          result.dependencies.filter((entry) => entry.endsWith(messageModule))
        ),
      ]).toHaveLength(0);
      expect(result.code).toContain(
        "catalog.manifest.gen.mjs?__mirai_intl_exports="
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("resolves finite template unions derived from local readonly tuples", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/template-union.ts");
    const source = [
      'import { useTranslations } from "x";',
      'const ACTIONS = ["activate", "add"] as const;',
      'const STATES = ["error", "success"] as const;',
      "type Action = (typeof ACTIONS)[number];",
      "type State = (typeof STATES)[number];",
      "type MessageKey = `${Action}.${State}`;",
      "declare const action: Action;",
      "declare const state: State;",
      "const key: MessageKey = `${action}.${state}`;",
      'const { t } = useTranslations("components.toast");',
      "export const translated = t(key);",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).not.toContain("t(key)");
      expect(result.code).toContain('["components.toast.activate.error"]');
      expect(result.code).toContain('["components.toast.activate.success"]');
      expect(result.code).toContain('["components.toast.add.error"]');
      expect(result.code).toContain('["components.toast.add.success"]');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves finite item keys through generated-facade satisfies arrays", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/navigation.ts");
    const source = [
      'import type { TranslationKey } from "@/i18n/generated";',
      'import { useTranslations } from "x";',
      "const items = [",
      '  { labelKey: "activate.error" },',
      '  { labelKey: "status.active" },',
      '] as const satisfies readonly { labelKey: TranslationKey<"components.toast"> }[];',
      'const { t } = useTranslations("components.toast");',
      "export const translated = items.map((item) => t(item.labelKey));",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(source).not.toContain("__mirai_intl_exports");
      expect(result.code).toContain('["components.toast.activate.error"]');
      expect(result.code).toContain('["components.toast.status.active"]');
      expect(result.code).not.toContain(
        '["components.toast.activate.success"]'
      );
      expect(result.code).not.toContain('["components.toast.add.error"]');
      expect(result.code).not.toContain('["components.toast.add.success"]');
      expect(result.code).not.toContain('["components.toast.status.inactive"]');
      expect(result.code).toContain(
        "catalog.manifest.gen.mjs?__mirai_intl_exports="
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("fails closed for widened mapped property keys from memoized satisfies arrays", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/memoized-options.ts");
    const reactRoot = join(fixture.root, "node_modules/react");
    await mkdir(reactRoot, { recursive: true });
    await writeJson(join(reactRoot, "package.json"), {
      name: "react",
      types: "./index.d.ts",
      version: "1.0.0",
    });
    await writeFile(
      join(reactRoot, "index.d.ts"),
      "export declare function useMemo<Value>(factory: () => Value, dependencies: readonly unknown[]): Value;\n",
      "utf8"
    );
    const source = [
      'import { useMemo } from "react";',
      'import { useTranslations } from "x";',
      "const options = useMemo(",
      "  () =>",
      "    [",
      '      { value: "activate.error" },',
      '      { value: "status.active" },',
      "    ] satisfies Array<{ value: string }>,",
      "  []",
      ");",
      'const { t } = useTranslations("components.toast");',
      "export const translated = options.map((option) => t(option.value));",
      "",
    ].join("\n");

    try {
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record() {},
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        }
      );

      expect(candidate?.result).toBeUndefined();
      expect(candidate?.error).toBeInstanceOf(Error);
      expect(
        candidate?.error instanceof Error ? candidate.error.message : ""
      ).toMatch(/Translation key expressions must be finite named-key unions/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves finite mapped property keys from memoized satisfies arrays in a compatible shared Program", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/memoized-options.ts");
    const reactRoot = join(fixture.root, "node_modules/react");
    await mkdir(reactRoot, { recursive: true });
    await writeJson(join(reactRoot, "package.json"), {
      name: "react",
      types: "./index.d.ts",
      version: "1.0.0",
    });
    await writeFile(
      join(reactRoot, "index.d.ts"),
      "export declare function useMemo<Value>(factory: () => Value, dependencies: readonly unknown[]): Value;\n",
      "utf8"
    );
    const source = [
      'import { useMemo } from "react";',
      'import { useTranslations } from "x";',
      "const options = useMemo(",
      "  () =>",
      "    [",
      '      { value: "activate.error" },',
      '      { value: "status.active" },',
      '    ] satisfies Array<{ value: "activate.error" | "status.active" }>,',
      "  []",
      ");",
      'const { t } = useTranslations("components.toast");',
      "export const translated = options.map((option) => t(option.value));",
      "",
    ].join("\n");

    try {
      let observation: MiraiIntlSemanticBatchObservation | undefined;
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record() {},
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          observation = value;
        }
      );

      expect(candidate?.error).toBeUndefined();
      expect(observation).toEqual({
        fallbackFiles: 0,
        fallbackPrograms: 0,
        sharedFiles: 1,
        sharedPrograms: 1,
      });
      expect(candidate?.result?.code).toContain(
        '["components.toast.activate.error"]'
      );
      expect(candidate?.result?.code).toContain(
        '["components.toast.status.active"]'
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("shares compatible mapped translator aliases and named callbacks with exact reference parity", async () => {
    const fixture = await createGeneratedCatalog();
    await writeFile(
      join(fixture.root, "src/home-option.ts"),
      'export type HomeOption = "title" | "error.form.required";\n',
      "utf8"
    );
    const sources = [
      [
        'import type { TranslationKey } from "./i18n/generated";',
        'import { useTranslations } from "x";',
        'const options = [{ value: "activate.error" }, { value: "status.active" }] satisfies Array<{ value: TranslationKey<"components.toast"> }>;',
        'const { t: translate } = useTranslations("components.toast");',
        "export const translated = options.map((option) => translate(option.value));",
        "",
      ].join("\n"),
      [
        'import type { TranslationKey } from "./i18n/generated";',
        'import { useTranslations } from "x";',
        'const options = [{ value: "activate.error" }, { value: "status.active" }] satisfies Array<{ value: TranslationKey<"components.toast"> }>;',
        'const { t } = useTranslations("components.toast");',
        'const render = (option: { value: TranslationKey<"components.toast"> }) => t(option.value);',
        "export const translated = options.map(render);",
        "",
      ].join("\n"),
      [
        'import type { TranslationKey } from "./i18n/generated";',
        'import type { HomeOption } from "./home-option";',
        'import { useTranslations } from "x";',
        'declare module "./i18n/generated" { interface HomeMarker {} }',
        'const options = [{ value: "title" }, { value: "error.form.required" }] satisfies Array<{ value: HomeOption & TranslationKey<"pages.home"> }>;',
        'const { t } = useTranslations("pages.home");',
        "export const translated = options.map((option) => t(option.value));",
        "",
      ].join("\n"),
      [
        'import type { TranslationKey } from "./i18n/generated";',
        'import { useTranslations } from "x";',
        'type ToastKey = TranslationKey<"components.toast">;',
        "declare const retainedFacadeSlice: ToastKey;",
        "declare const options: Array<{ value: string }>;",
        'const { t } = useTranslations("components.toast");',
        "export const translated = options.map((option) => t(option.value));",
        "",
      ].join("\n"),
    ];

    try {
      const ids = sources.map((_, index) =>
        join(fixture.root, "src", `mapped-alias-${index}.ts`)
      );
      const candidateEvidence = new Map<string, MiraiIntlSemanticEvidence>();
      let observation: MiraiIntlSemanticBatchObservation | undefined;
      const candidates = await transformMiraiIntlOwnerBatch(
        sources.map((source, index) => ({
          authorizationEvidence: {
            record(value) {
              const id = ids[index];
              if (id) {
                candidateEvidence.set(id, value);
              }
            },
            workspaceRoot: "/",
          },
          id: ids[index] ?? "",
          source,
        })),
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          observation = value;
        }
      );
      const references = await Promise.all(
        sources.map(async (source, index) => {
          const id = ids[index] ?? "";
          let evidence: MiraiIntlSemanticEvidence | undefined;
          let result: MiraiIntlTransformResult | null | undefined;
          let error: unknown;
          try {
            result = await transformMiraiIntlSource(source, id, {
              authorizationEvidence: {
                record(value) {
                  evidence = value;
                },
                workspaceRoot: "/",
              },
              generatedDirectory: fixture.generatedDirectory,
              root: fixture.root,
            });
          } catch (caught) {
            error = caught;
          }
          return { error, evidence, result };
        })
      );

      expect(observation).toEqual({
        fallbackFiles: 1,
        fallbackPrograms: 1,
        sharedFiles: 3,
        sharedPrograms: 1,
      });
      for (const [index, candidate] of candidates.entries()) {
        const id = ids[index] ?? "";
        const reference = references[index];
        expect(candidate?.result).toEqual(reference?.result);
        expect(
          candidate?.error instanceof Error ? candidate.error.message : null
        ).toBe(
          reference?.error instanceof Error ? reference.error.message : null
        );
        expect(candidateEvidence.get(id)).toEqual(reference?.evidence);
        expect(
          candidateEvidence
            .get(id)
            ?.providers.some((provider) =>
              provider.resolutions.some(
                (resolution) => resolution.probes.length > 0
              )
            )
        ).toBe(true);
      }
      expect(candidates[3]?.result).toBeUndefined();
      expect(
        candidates[3]?.error instanceof Error ? candidates[3].error.message : ""
      ).toMatch(/finite named-key unions or generated deferred keys/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 15_000);

  it("resolves only project-local providers needed by finite enum, locale, and config keys", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/imported-keys.ts");
    await writeFile(
      join(fixture.root, "src/actions.ts"),
      [
        'export enum ToastAction { ACTIVATE = "activate", ADD = "add" }',
        "export const ACTIONS: ReadonlyArray<ToastAction> = [ToastAction.ACTIVATE, ToastAction.ADD];",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(fixture.root, "src/locales.ts"),
      [
        'import { catalogManifest } from "@/i18n/generated";',
        'import type { CatalogLocale } from "@/i18n/generated";',
        "export const LOCALES: ReadonlyArray<CatalogLocale> = catalogManifest.locales;",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(fixture.root, "src/items.ts"),
      [
        'import type { TranslationKey } from "@/i18n/generated";',
        "export const ITEMS = [",
        '  { labelKey: "status.active" },',
        '  { labelKey: "status.inactive" },',
        '] as const satisfies readonly { labelKey: TranslationKey<"components.toast"> }[];',
        "",
      ].join("\n"),
      "utf8"
    );
    const source = [
      'import { useTranslations } from "x";',
      'import { ACTIONS, ToastAction } from "./actions";',
      'import { ITEMS } from "./items";',
      'import { LOCALES } from "./locales";',
      'const { t } = useTranslations("components.toast");',
      "export const actions = ACTIONS.map((action: ToastAction) => t(`${action}.error`));",
      "export const items = ITEMS.map((item) => t(item.labelKey));",
      "export const locales = LOCALES.map((locale) => t(`locale.${locale}`));",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      for (const path of [
        "components.toast.activate.error",
        "components.toast.add.error",
        "components.toast.status.active",
        "components.toast.status.inactive",
        "components.toast.locale.en",
        "components.toast.locale.th",
      ]) {
        expect(result.code).toContain(`["${path}"]`);
      }
      expect(result.code).not.toContain(
        '["components.toast.activate.success"]'
      );
      expect(result.code).not.toContain('["components.toast.add.success"]');
      expect(
        result.code.match(/__miraiIntlCreateDynamicTextRegistry\(/gu)
      ).toHaveLength(1);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves imported finite type guards that use modern built-ins", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/guarded-key.ts");
    await writeFile(
      join(fixture.root, "src/statuses.ts"),
      [
        'export const STATUSES = ["active", "inactive"] as const;',
        "export type Status = (typeof STATUSES)[number];",
        "export const STATUS_SET = new Set<string>(STATUSES);",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(fixture.root, "src/is-status.ts"),
      [
        'import type { Status } from "./statuses";',
        'import { STATUS_SET } from "./statuses";',
        "export const isStatus = (value: string): value is Status => STATUS_SET.has(value);",
        "",
      ].join("\n"),
      "utf8"
    );
    const source = [
      'import { useTranslations } from "x";',
      'import { isStatus } from "./is-status";',
      "declare const rawStatus: string;",
      "const status = isStatus(rawStatus) ? rawStatus : null;",
      'const { t } = useTranslations("components.toast");',
      'export const translated = status ? t(`status.${status}`) : "";',
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain('["components.toast.status.active"]');
      expect(result.code).toContain('["components.toast.status.inactive"]');
      expect(result.code).not.toContain('["components.toast.activate.error"]');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a provider file that escapes through a workspace symlink", async () => {
    const fixture = await createGeneratedCatalog();
    const external = await mkdtemp(
      join(tmpdir(), "mirai-intl-provider-outside-")
    );
    const id = join(fixture.root, "src/escaped-provider-key.ts");
    const provider = join(external, "provider.ts");
    await writeFile(provider, 'export declare const key: "title";\n', "utf8");
    await symlink(provider, join(fixture.root, "src/provider.ts"), "file");
    const source = [
      'import { useTranslations } from "x";',
      'import { key } from "./provider";',
      'const { t } = useTranslations("pages.home");',
      "export const translated = t(key);",
      "",
    ].join("\n");

    try {
      await expect(
        transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      ).rejects.toThrowError(
        /Provider resolution (?:probe|realpath) for \.\/provider escapes its workspace root/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
      await rm(external, { force: true, recursive: true });
    }
  });

  it("rejects an absent provider beneath a directory symlink escape", async () => {
    const fixture = await createGeneratedCatalog();
    const external = await mkdtemp(
      join(tmpdir(), "mirai-intl-provider-directory-outside-")
    );
    const id = join(fixture.root, "src/escaped-provider-key.ts");
    await symlink(external, join(fixture.root, "src/provider"), "dir");
    const source = [
      'import { useTranslations } from "x";',
      'import { key } from "./provider/key";',
      'const { t } = useTranslations("pages.home");',
      "export const translated = t(key);",
      "",
    ].join("\n");

    try {
      await expect(
        transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      ).rejects.toThrowError(
        /Provider resolution probe for \.\/provider\/key escapes its workspace root/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
      await rm(external, { force: true, recursive: true });
    }
  });

  it("seals module and type-reference resolution to the current workspace", async () => {
    const first = await createGeneratedCatalog();
    const second = await createGeneratedCatalog();
    const outside = await mkdtemp(join(tmpdir(), "mirai-intl-provider-cwd-"));
    const originalCwd = process.cwd();
    const createViteProvider = async (
      root: string,
      moduleKey: string,
      ambientKey: string
    ): Promise<void> => {
      const providerRoot = join(root, "node_modules/vite");
      await writeJson(join(providerRoot, "package.json"), {
        exports: {
          "./client": {
            types: "./client.d.ts",
          },
        },
        name: "vite",
        types: "client.d.ts",
        version: "0.0.0-fixture",
      });
      await writeFile(
        join(providerRoot, "client.d.ts"),
        [
          `export type WorkspaceKey = "${moduleKey}";`,
          `declare global { type AmbientWorkspaceKey = "${ambientKey}"; }`,
          "",
        ].join("\n"),
        "utf8"
      );
    };
    const analyze = async (
      fixture: Awaited<ReturnType<typeof createGeneratedCatalog>>
    ): Promise<MiraiIntlSemanticEvidence> => {
      const id = join(fixture.root, "src/vite-key.ts");
      const source = [
        'import type { WorkspaceKey } from "vite/client";',
        'import { useTranslations } from "x";',
        "declare const key: WorkspaceKey | AmbientWorkspaceKey;",
        'const { t } = useTranslations("pages.home");',
        "export const translated = t(key);",
        "",
      ].join("\n");
      let evidence: MiraiIntlSemanticEvidence | undefined;
      const [result] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                evidence = value;
              },
              workspaceRoot: fixture.root,
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            baseUrl: ".",
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            paths: { "*": ["./*"] },
            typeRoots: ["./node_modules"],
            types: ["vite/client"],
          },
        }
      );
      expect(result?.error).toBeUndefined();
      expect(result?.result?.code).toContain('["pages.home.title"]');
      expect(result?.result?.code).toContain(
        '["pages.home.error.form.required"]'
      );
      if (!evidence) {
        throw new Error("Expected root-local provider evidence");
      }
      return evidence;
    };

    try {
      await createViteProvider(first.root, "title", "error.form.required");
      await createViteProvider(second.root, "title", "error.form.required");
      await createViteProvider(outside, "settings", "settings");
      await mkdir(join(outside, "vite"), { recursive: true });
      await writeFile(
        join(outside, "vite/client.ts"),
        'export type WorkspaceKey = "settings";\n',
        "utf8"
      );
      process.chdir(outside);

      const firstEvidence = await analyze(first);
      const secondEvidence = await analyze(second);
      const repeatedFirstEvidence = await analyze(first);

      expect(repeatedFirstEvidence).toEqual(firstEvidence);
      for (const [evidence, workspaceRoot] of [
        [firstEvidence, first.root],
        [secondEvidence, second.root],
      ] as const) {
        const viteResolutions = evidence.providers.flatMap(({ resolutions }) =>
          resolutions.filter(({ specifier }) => specifier === "vite/client")
        );
        expect(viteResolutions).toHaveLength(2);
        expect(
          viteResolutions.some(
            ({ controlFiles, packageName }) =>
              packageName === "vite" &&
              controlFiles.some(({ path }) =>
                path.startsWith(join(workspaceRoot, "node_modules/vite/"))
              )
          )
        ).toBe(true);
        expect(
          viteResolutions.every(({ controlFiles, probes, realpaths }) =>
            [...controlFiles, ...probes, ...realpaths].every(({ path }) =>
              path.startsWith(workspaceRoot)
            )
          )
        ).toBe(true);
      }
    } finally {
      process.chdir(originalCwd);
      await rm(first.root, { force: true, recursive: true });
      await rm(second.root, { force: true, recursive: true });
      await rm(outside, { force: true, recursive: true });
    }
  });

  it("requires explicit realpath identity for every positive sealed path", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-realpath-proof-"));
    const file = join(root, "provider.d.ts");
    const link = join(root, "provider-link.d.ts");
    await writeFile(file, 'export type Key = "title";\n', "utf8");
    await symlink(file, link, "file");
    try {
      expect(() => resolveSealedSemanticRealpath(new Map(), file)).toThrow(
        `Sealed semantic VFS rejected unrecorded realpath query: ${file}`
      );
      expect(resolveSealedSemanticRealpath(new Map([[file, file]]), file)).toBe(
        file
      );
      expect(resolveSealedSemanticRealpath(new Map([[link, file]]), link)).toBe(
        file
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves configured ambient React types for automatic JSX props", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/contextual-props.tsx");
    await writeJson(join(fixture.root, "tsconfig.json"), {
      compilerOptions: {
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@/*": ["src/*"] },
        typeRoots: ["./node_modules/@types"],
        types: ["react"],
      },
    });
    const reactRoot = join(fixture.root, "node_modules/@types/react");
    await mkdir(reactRoot, { recursive: true });
    await writeJson(join(reactRoot, "package.json"), {
      name: "@types/react",
      types: "index.d.ts",
      version: "0.0.0-fixture",
    });
    await writeFile(
      join(reactRoot, "index.d.ts"),
      [
        "export as namespace React;",
        "export type FC<Props> = (props: Props) => unknown;",
        "declare global { namespace JSX { interface IntrinsicElements { div: unknown; } } }",
        "",
      ].join("\n"),
      "utf8"
    );
    const source = [
      'import type { TranslationKey } from "@/i18n/generated";',
      'import { useTranslations } from "x";',
      'interface Props { labelKey: TranslationKey<"components.toast">; }',
      "export const Component: React.FC<Props> = ({ labelKey }) => {",
      '  const { t } = useTranslations("components.toast");',
      "  return <div>{t(labelKey)}</div>;",
      "};",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain('["components.toast.activate.error"]');
      expect(result.code).toContain('["components.toast.status.inactive"]');
      expect(result.code).not.toContain('["components.toast.parameterized"]');
      expect(result.code).not.toContain('["components.toast.rich"]');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("matches full-facade reference lowering for aliased, type-only, and form helper slices", async () => {
    const fixture = await createGeneratedCatalog();
    const sources = [
      [
        'import { createTranslationKey as keyFor } from "./i18n/generated";',
        'export const titleKey = keyFor("pages.home")("title");',
        "",
      ].join("\n"),
      [
        'import type { TranslationKey as Key } from "./i18n/generated";',
        'import { useTranslations } from "x";',
        'declare const key: Key<"components.toast">;',
        'const { t } = useTranslations("components.toast");',
        "export const translated = t(key);",
        "",
      ].join("\n"),
      [
        'import { createFormErrorTranslator as createError, createFormSchema as schemaFor } from "./i18n/generated";',
        "declare const t: (key: string) => string;",
        'export const translateError = createError("pages.home", t);',
        'export const schema = schemaFor("pages.home", ({ error }) => ({ required: error("required") }));',
        "",
      ].join("\n"),
    ];

    try {
      const candidateEvidence: Array<MiraiIntlSemanticEvidence> = [];
      let observation: MiraiIntlSemanticBatchObservation | undefined;
      const results = await transformMiraiIntlOwnerBatch(
        sources.map((source, index) => ({
          authorizationEvidence: {
            record(evidence) {
              candidateEvidence.push(evidence);
            },
            workspaceRoot: "/",
          },
          id: join(fixture.root, "src", `facade-slice-${index}.ts`),
          source,
        })),
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          observation = value;
        },
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );
      const reference = await Promise.all(
        sources.map(async (source, index) => {
          let evidence: MiraiIntlSemanticEvidence | undefined;
          const result = await transformMiraiIntlSource(
            source,
            join(fixture.root, "src", `facade-slice-${index}.ts`),
            {
              authorizationEvidence: {
                record(value) {
                  evidence = value;
                },
                workspaceRoot: "/",
              },
              generatedDirectory: fixture.generatedDirectory,
              root: fixture.root,
            }
          );
          return { evidence, result };
        })
      );

      expect(observation).toEqual({
        fallbackFiles: 0,
        fallbackPrograms: 0,
        sharedFiles: 3,
        sharedPrograms: 1,
      });
      expect(results.map(({ error }) => error)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
      expect(results.map(({ result }) => result)).toEqual(
        reference.map(({ result }) => result)
      );
      expect(candidateEvidence).toEqual(
        reference.map(({ evidence }) => evidence)
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("retains exact reference evidence for every stable generated-facade runtime import", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/stable-facade-runtime.ts");
    const source = [
      'import { catalogManifest, isCatalogLocale, loadCatalogResource } from "./i18n/generated";',
      "export const locales = catalogManifest.locales;",
      "export const isLocale = isCatalogLocale;",
      "export const loadLocale = loadCatalogResource;",
      "",
    ].join("\n");

    try {
      let candidateEvidence: MiraiIntlSemanticEvidence | undefined;
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                candidateEvidence = value;
              },
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );
      let referenceEvidence: MiraiIntlSemanticEvidence | undefined;
      const reference = await transformMiraiIntlSource(source, id, {
        authorizationEvidence: {
          record(value) {
            referenceEvidence = value;
          },
          workspaceRoot: "/",
        },
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });

      expect(candidate?.error).toBeUndefined();
      expect(candidate?.result).toEqual(reference);
      expect(candidateEvidence).toEqual(referenceEvidence);
      expect(candidateEvidence?.providers.length).toBeGreaterThan(0);
      expect(candidateEvidence?.declarations.length).toBeGreaterThan(0);
      expect(candidateEvidence?.libs.length).toBeGreaterThan(0);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("seals generated .d.mts evidence for a consumer facade batch", async () => {
    const fixture = await createGeneratedCatalog();
    const intlPackage = join(fixture.root, "node_modules/@openmirai/intl");
    await writeJson(join(intlPackage, "package.json"), {
      exports: {
        "./runtime": { types: "./runtime.d.ts" },
        "./types": { types: "./types.d.ts" },
      },
      name: "@openmirai/intl",
      types: "./types.d.ts",
    });
    await writeFile(
      join(intlPackage, "types.d.ts"),
      [
        "export type JsonObject = Record<string, unknown>;",
        "export type TypedCatalogManifest<Contract, Locales extends readonly string[], SourceLocale extends Locales[number]> = { readonly locales: Locales; readonly sourceLocale: SourceLocale; };",
        "export type NamespacePaths<Contract> = string;",
        "export type ArgumentFreeTextKeysFor<Contract, Namespace> = string;",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(intlPackage, "runtime.d.ts"),
      [
        "export declare function bindFormErrorTranslator<Contract>(): unknown;",
        "export declare function bindFormSchema<Contract>(): unknown;",
        "export declare function bindRecoveringFormErrorTranslator<Contract>(): unknown;",
        "export declare function bindRecoveringTranslationKeyFactory<Contract>(): unknown;",
        "export declare function bindRecoveringTranslationKeyParser<Contract>(): unknown;",
        "export declare function bindTranslationKeyFactory<Contract>(): unknown;",
        "export declare function bindTranslationKeyParser<Contract>(): unknown;",
        "",
      ].join("\n"),
      "utf8"
    );
    const sources = Array.from({ length: 17 }, (_, index) => ({
      id: join(fixture.root, "src", `consumer-${index}.tsx`),
      source: [
        'import { useTranslations } from "x";',
        'import { catalogManifest, isCatalogLocale, loadCatalogResource } from "@/i18n/generated";',
        'import type { CatalogContract, TranslationNamespace } from "@/i18n/generated";',
        'const { t } = useTranslations("pages.home");',
        `export const title${index} = t("title");`,
        `export const locale${index} = catalogManifest.sourceLocale;`,
        `export type Contract${index} = CatalogContract;`,
        `export type Namespace${index} = TranslationNamespace;`,
        `export const isLocale${index} = isCatalogLocale;`,
        `export const loadLocale${index} = loadCatalogResource;`,
        "",
      ].join("\n"),
    }));
    let recordedEvidence: MiraiIntlSemanticEvidence | undefined;

    try {
      const results = await transformMiraiIntlOwnerBatch(
        sources.map(({ id, source }) => ({
          authorizationEvidence: {
            record(value) {
              recordedEvidence ??= value;
            },
            workspaceRoot: fixture.root,
          },
          id,
          source,
        })),
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            allowImportingTsExtensions: true,
            allowJs: false,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
            incremental: false,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            isolatedModules: true,
            jsx: ts.JsxEmit.ReactJSX,
            lib: ["lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.es2024.d.ts"],
            noEmit: true,
            paths: { "@/*": ["./src/*"] },
            pathsBasePath: fixture.root,
            resolveJsonModule: true,
            skipLibCheck: true,
            strict: true,
            target: ts.ScriptTarget.ES2024,
          },
        }
      );

      expect(results).toHaveLength(17);
      expect(results.map(({ error }) => error)).toEqual(
        Array.from({ length: 17 }, () => undefined)
      );
      expect(
        recordedEvidence?.declarations.some(({ path }) =>
          path.endsWith("catalog.manifest.gen.d.mts")
        )
      ).toBe(true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("matches reference evidence and diagnostics for every static facade import form", async () => {
    const fixture = await createGeneratedCatalog();
    const cases = [
      {
        error: /^$/u,
        evidence: true,
        name: "namespace",
        source: [
          'import * as catalog from "./i18n/generated";',
          "export const manifest = catalog.catalogManifest;",
          "",
        ].join("\n"),
      },
      {
        error: /^$/u,
        evidence: true,
        name: "side-effect",
        source: 'import "./i18n/generated";\nexport const value = 1;\n',
      },
      {
        error: /Generated facade import is unsupported: default/u,
        evidence: false,
        name: "default",
        source:
          'import generated from "./i18n/generated";\nexport const value = generated;\n',
      },
      {
        error: /Generated facade import is unsupported: missingFacadeExport/u,
        evidence: false,
        name: "invalid-named",
        source:
          'import { missingFacadeExport } from "./i18n/generated";\nexport const value = missingFacadeExport;\n',
      },
    ] as const;

    try {
      for (const testCase of cases) {
        const id = join(fixture.root, "src", `facade-${testCase.name}.ts`);
        let candidateEvidence: MiraiIntlSemanticEvidence | undefined;
        const [candidate] = await transformMiraiIntlOwnerBatch(
          [
            {
              authorizationEvidence: {
                record(value) {
                  candidateEvidence = value;
                },
                workspaceRoot: "/",
              },
              id,
              source: testCase.source,
            },
          ],
          {
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          },
          undefined,
          false,
          {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              moduleResolution: ts.ModuleResolutionKind.Bundler,
            },
          }
        );
        let referenceEvidence: MiraiIntlSemanticEvidence | undefined;
        let referenceResult: MiraiIntlTransformResult | null | undefined;
        let referenceError: unknown;
        try {
          referenceResult = await transformMiraiIntlSource(
            testCase.source,
            id,
            {
              authorizationEvidence: {
                record(value) {
                  referenceEvidence = value;
                },
                workspaceRoot: "/",
              },
              generatedDirectory: fixture.generatedDirectory,
              root: fixture.root,
            }
          );
        } catch (error) {
          referenceError = error;
        }

        expect(candidate?.result).toEqual(referenceResult);
        const candidateMessage =
          candidate?.error instanceof Error ? candidate.error.message : "";
        const referenceMessage =
          referenceError instanceof Error ? referenceError.message : "";
        expect(candidateMessage).toBe(referenceMessage);
        expect(candidateMessage).toMatch(testCase.error);
        expect(candidateEvidence).toEqual(referenceEvidence);
        expect(candidateEvidence !== undefined).toBe(testCase.evidence);
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("keeps ordinary default and side-effect imports on inert no-Program reuse", async () => {
    const fixture = await createGeneratedCatalog();
    const ordinaryRoot = join(fixture.root, "node_modules/ordinary-import");
    await writeJson(join(ordinaryRoot, "package.json"), {
      name: "ordinary-import",
      types: "index.d.ts",
      version: "0.0.0-fixture",
    });
    await writeFile(
      join(ordinaryRoot, "index.d.ts"),
      "declare const value: number;\nexport default value;\n",
      "utf8"
    );
    const sources = [
      'import ordinary from "ordinary-import";\nexport const value = ordinary;\n',
      'import "ordinary-import";\nexport const value = 1;\n',
    ];

    try {
      const evidence: Array<MiraiIntlSemanticEvidence> = [];
      let observation: MiraiIntlSemanticBatchObservation | undefined;
      const results = await transformMiraiIntlOwnerBatch(
        sources.map((source, index) => ({
          authorizationEvidence: {
            record(value) {
              evidence.push(value);
            },
            workspaceRoot: "/",
          },
          id: join(fixture.root, "src", `ordinary-import-${index}.ts`),
          source,
        })),
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          observation = value;
        },
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );

      expect(results.map(({ error }) => error)).toEqual([undefined, undefined]);
      expect(results.map(({ result }) => result)).toEqual([null, null]);
      expect(evidence).toHaveLength(2);
      expect(observation).toEqual({
        fallbackFiles: 0,
        fallbackPrograms: 0,
        sharedFiles: 2,
        sharedPrograms: 0,
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("bounds virtual facade occupancy probes linearly for 256 owner sources", async () => {
    const fixture = await createGeneratedCatalog();
    const sourceCount = 256;
    const source = [
      'import type { CatalogContract } from "./i18n/generated";',
      "export type CatalogKey = keyof CatalogContract;",
      "",
    ].join("\n");
    let probes = 0;
    const fileExistsImplementation = ts.sys.fileExists;
    const fileExists = vi
      .spyOn(ts.sys, "fileExists")
      .mockImplementation((path) => {
        probes += 1;
        return fileExistsImplementation(path);
      });
    const directoryExistsImplementation = ts.sys.directoryExists;
    const directoryExists = directoryExistsImplementation
      ? vi.spyOn(ts.sys, "directoryExists").mockImplementation((path) => {
          probes += 1;
          return directoryExistsImplementation(path);
        })
      : undefined;
    const realpathImplementation = ts.sys.realpath;
    const realpathSpy = realpathImplementation
      ? vi.spyOn(ts.sys, "realpath").mockImplementation((path) => {
          probes += 1;
          return realpathImplementation(path);
        })
      : undefined;
    try {
      const results = await transformMiraiIntlOwnerBatch(
        Array.from({ length: sourceCount }, (_, index) => ({
          authorizationEvidence: {
            record() {},
            workspaceRoot: fixture.root,
          },
          id: join(fixture.root, "src", `owner-${String(index)}.ts`),
          source,
        })),
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );
      expect(results).toHaveLength(sourceCount);
      expect(results.find(({ error }) => error !== undefined)?.error).toBe(
        undefined
      );
      expect(probes).toBeLessThan(sourceCount * 192);
    } finally {
      fileExists.mockRestore();
      directoryExists?.mockRestore();
      realpathSpy?.mockRestore();
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it("canonicalizes virtual facade evidence while retaining facade mutation identity", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/react/useTranslations.tsx");
    const providerRoot = join(
      fixture.root,
      "node_modules/@openmirai/intl-i18next"
    );
    await writeJson(join(providerRoot, "package.json"), {
      name: "@openmirai/intl-i18next",
      types: "index.d.ts",
      version: "0.0.0-fixture",
    });
    await writeFile(
      join(providerRoot, "index.d.ts"),
      [
        "export declare function createProviderBoundUseTranslations<Catalog>():",
        "  (namespace?: keyof Catalog) => { t(key: string): string };",
        "",
      ].join("\n"),
      "utf8"
    );
    const source = [
      'import { createProviderBoundUseTranslations } from "@openmirai/intl-i18next";',
      'import type { CatalogContract } from "../i18n/generated";',
      "export const useTranslations =",
      "  createProviderBoundUseTranslations<CatalogContract>();",
      "",
    ].join("\n");
    const analyze = async (): Promise<
      Readonly<{
        candidate: MiraiIntlSemanticEvidence;
        reference: MiraiIntlSemanticEvidence;
      }>
    > => {
      let candidateEvidence: MiraiIntlSemanticEvidence | undefined;
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                candidateEvidence = value;
              },
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );
      let referenceEvidence: MiraiIntlSemanticEvidence | undefined;
      await transformMiraiIntlSource(source, id, {
        authorizationEvidence: {
          record(value) {
            referenceEvidence = value;
          },
          workspaceRoot: "/",
        },
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });
      expect(candidate?.error).toBeUndefined();
      expect(candidateEvidence).toEqual(referenceEvidence);
      if (!candidateEvidence || !referenceEvidence) {
        throw new Error("Expected exact semantic evidence");
      }
      return { candidate: candidateEvidence, reference: referenceEvidence };
    };

    try {
      const initial = await analyze();
      expect(initial.candidate.providers).not.toEqual([]);
      const generatedProviders = initial.candidate.providers.filter(
        (provider) => provider.kind === "generated"
      );
      expect(generatedProviders).toHaveLength(1);
      expect(
        new Set(
          generatedProviders[0]?.resolutions.map(
            (resolution) => `${resolution.from}\u0000${resolution.specifier}`
          )
        ).size
      ).toBe(generatedProviders[0]?.resolutions.length);
      expect(
        initial.candidate.providers.some(
          (provider) =>
            provider.root.includes(".mirai-intl-generated-facade.") ||
            provider.resolutions.some((resolution) =>
              resolution.from.includes(".mirai-intl-generated-facade.")
            )
        )
      ).toBe(false);

      await appendFile(
        join(fixture.generatedDirectory, "index.ts"),
        "// stable facade mutation\n",
        "utf8"
      );
      invalidateMiraiIntlCatalogCache({
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });
      const mutated = await analyze();

      expect(mutated.candidate).toEqual(mutated.reference);
      expect(mutated.candidate.closureHash).not.toBe(
        initial.candidate.closureHash
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("merges canonical provider evidence and rejects conflicting nested identities", () => {
    const resolution = {
      controlFiles: [
        {
          hash: "sha256:package-json" as const,
          path: "/workspace/package.json",
        },
      ],
      from: "/workspace/generated/index.ts",
      packageName: null,
      packageVersion: null,
      probes: [
        {
          kind: "file" as const,
          path: "/workspace/generated/schema.d.ts",
          present: true,
        },
      ],
      realpaths: [
        {
          path: "/workspace/generated/schema.d.ts",
          target: "/workspace/generated/schema.d.ts",
        },
      ],
      specifier: "./schema",
    };
    const provider = {
      declarations: [
        {
          hash: "sha256:declaration-a" as const,
          path: "generated/index.ts",
        },
      ],
      kind: "generated" as const,
      resolutions: [resolution],
      root: "generated/index.ts",
    };
    expect(
      mergeSemanticProviders([
        provider,
        {
          ...provider,
          declarations: [
            {
              hash: "sha256:declaration-b",
              path: "generated/schema.d.ts",
            },
          ],
        },
      ])
    ).toEqual([
      {
        ...provider,
        declarations: [
          provider.declarations[0],
          {
            hash: "sha256:declaration-b",
            path: "generated/schema.d.ts",
          },
        ],
      },
    ]);
    expect(() =>
      mergeSemanticProviders([
        provider,
        {
          ...provider,
          declarations: [
            {
              hash: "sha256:conflict",
              path: "generated/index.ts",
            },
          ],
          resolutions: [],
        },
      ])
    ).toThrow("Conflicting semantic provider declaration identity");
    expect(() =>
      mergeSemanticProviders([
        provider,
        {
          ...provider,
          declarations: [],
          resolutions: [
            {
              ...resolution,
              probes: resolution.probes.map((probe) => ({
                ...probe,
                present: false,
              })),
            },
          ],
        },
      ])
    ).toThrow("Conflicting semantic provider resolution identity");
  });

  it("upgrades a processed root facade slice for a transitive CatalogContract dependency", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/transitive-contract.ts");
    await writeFile(
      join(fixture.root, "src/home-key.ts"),
      [
        'import type { HomeCatalog } from "./home-contract";',
        "export type HomeKey = keyof HomeCatalog;",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(fixture.root, "src/home-contract.ts"),
      [
        'import type { CatalogContract } from "./i18n/generated";',
        'export type HomeCatalog = CatalogContract["pages"]["home"];',
        "",
      ].join("\n"),
      "utf8"
    );
    const source = [
      'import type { TranslationKey } from "./i18n/generated";',
      'import type { HomeKey } from "./home-key";',
      'import { useTranslations } from "x";',
      'declare const key: HomeKey & TranslationKey<"pages.home">;',
      'const { t } = useTranslations("pages.home");',
      "export const translated = t(key);",
      "",
    ].join("\n");

    try {
      let candidateEvidence: MiraiIntlSemanticEvidence | undefined;
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                candidateEvidence = value;
              },
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );
      let referenceEvidence: MiraiIntlSemanticEvidence | undefined;
      const reference = await transformMiraiIntlSource(source, id, {
        authorizationEvidence: {
          record(value) {
            referenceEvidence = value;
          },
          workspaceRoot: "/",
        },
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });

      expect(candidate?.error).toBeUndefined();
      expect(candidate?.result).toEqual(reference);
      expect(candidateEvidence).toEqual(referenceEvidence);
      expect(candidate?.result?.code).toContain(
        '["pages.home.error.form.required"]'
      );
      expect(candidate?.result?.code).toContain('["pages.home.title"]');

      const schemaDeclaration = join(
        fixture.generatedDirectory,
        fixture.directory,
        "catalog.schema.gen.d.mts"
      );
      await appendFile(schemaDeclaration, "// schema mutation\n", "utf8");
      let mutatedCandidateEvidence: MiraiIntlSemanticEvidence | undefined;
      const [mutatedCandidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                mutatedCandidateEvidence = value;
              },
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );
      let mutatedReferenceEvidence: MiraiIntlSemanticEvidence | undefined;
      const mutatedReference = await transformMiraiIntlSource(source, id, {
        authorizationEvidence: {
          record(value) {
            mutatedReferenceEvidence = value;
          },
          workspaceRoot: "/",
        },
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });

      expect(mutatedCandidate?.error).toBeUndefined();
      expect(mutatedCandidate?.result).toEqual(mutatedReference);
      expect(mutatedCandidateEvidence).toEqual(mutatedReferenceEvidence);
      expect(mutatedCandidateEvidence?.closureHash).not.toBe(
        candidateEvidence?.closureHash
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("falls back to the full facade for re-exports, general namespaces, dynamic aliases, and module augmentation", async () => {
    const fixture = await createGeneratedCatalog();
    const cases = [
      [
        'export type { TranslationKey } from "./i18n/generated";',
        "export const value = 1;",
        "",
      ].join("\n"),
      [
        'import type { TranslationNamespace as Namespace } from "./i18n/generated";',
        "export type AnyNamespace = Namespace;",
        "",
      ].join("\n"),
      [
        'import { createTranslationKey } from "./i18n/generated";',
        "const alias = createTranslationKey;",
        'export const key = alias("pages.home")("title");',
        "",
      ].join("\n"),
      [
        'import type { TranslationKey } from "./i18n/generated";',
        'declare module "./i18n/generated" { interface MiraiIntlMarker {} }',
        'export type HomeKey = TranslationKey<"pages.home">;',
        "",
      ].join("\n"),
      [
        'import type { CatalogContract } from "./i18n/generated";',
        'export type HomeCatalog = CatalogContract["pages"]["home"];',
        "",
      ].join("\n"),
    ];

    try {
      for (const [index, source] of cases.entries()) {
        const id = join(fixture.root, "src", `full-facade-${index}.ts`);
        let candidateEvidence: MiraiIntlSemanticEvidence | undefined;
        let observation: MiraiIntlSemanticBatchObservation | undefined;
        const [candidate] = await transformMiraiIntlOwnerBatch(
          [
            {
              authorizationEvidence: {
                record(value) {
                  candidateEvidence = value;
                },
                workspaceRoot: "/",
              },
              id,
              source,
            },
          ],
          {
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          },
          (value) => {
            observation = value;
          },
          false,
          {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              moduleResolution: ts.ModuleResolutionKind.Bundler,
            },
          }
        );
        let referenceEvidence: MiraiIntlSemanticEvidence | undefined;
        let referenceResult: MiraiIntlTransformResult | null | undefined;
        let referenceError: unknown;
        try {
          referenceResult = await transformMiraiIntlSource(source, id, {
            authorizationEvidence: {
              record(value) {
                referenceEvidence = value;
              },
              workspaceRoot: "/",
            },
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          });
        } catch (error) {
          referenceError = error;
        }

        expect(candidate?.result).toEqual(referenceResult);
        expect(
          candidate?.error instanceof Error ? candidate.error.message : null
        ).toBe(referenceError instanceof Error ? referenceError.message : null);
        expect(candidateEvidence).toEqual(referenceEvidence);
        expect(observation?.fallbackPrograms).toBe(index === 3 ? 1 : 0);
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 30_000);

  it("requires semantic analysis for translator-shaped calls with uncertain provenance", async () => {
    const fixture = await createGeneratedCatalog();
    const sources = [
      'declare const t: (key: string) => string; export const value = t("title");',
      'declare const t: { rich(key: string): string }; export const value = t.rich("title");',
      'declare const controller: { t(key: string): string }; export const value = controller.t("title");',
      'declare const props: { t: { value(key: string): unknown } }; export const value = props.t.value("settings");',
    ];

    try {
      let observation: MiraiIntlSemanticBatchObservation | undefined;
      const results = await transformMiraiIntlOwnerBatch(
        sources.map((source, index) => ({
          authorizationEvidence: {
            record() {},
            workspaceRoot: "/",
          },
          id: join(fixture.root, "src", `uncertain-translator-${index}.ts`),
          source,
        })),
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          observation = value;
        }
      );

      expect(observation).toEqual({
        fallbackFiles: 0,
        fallbackPrograms: 0,
        sharedFiles: sources.length,
        sharedPrograms: 1,
      });
      expect(results).toHaveLength(sources.length);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("fuses more than 64 active roots when their sealed frontiers agree", async () => {
    const fixture = await createGeneratedCatalog();
    const sources = Array.from({ length: 130 }, (_, index) => ({
      authorizationEvidence: {
        record() {},
        workspaceRoot: "/",
      },
      id: join(fixture.root, "src", `fused-active-${index}.ts`),
      source: [
        'import type { TranslationKey } from "./i18n/generated";',
        `export type Key${index} = TranslationKey<"pages.home">;`,
        "",
      ].join("\n"),
    }));

    try {
      let observation: MiraiIntlSemanticBatchObservation | undefined;
      const results = await transformMiraiIntlOwnerBatch(
        sources,
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          observation = value;
        },
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
        }
      );

      expect(observation).toEqual({
        fallbackFiles: 0,
        fallbackPrograms: 0,
        sharedFiles: sources.length,
        sharedPrograms: 1,
      });
      expect(results).toHaveLength(sources.length);
      expect(results.every((result) => result.error === undefined)).toBe(true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }, 15_000);

  it("matches reference diagnostics for invalid extracted form-schema builders", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/extracted-form-schema.ts");
    const source = [
      'import { createFormSchema } from "./i18n/generated";',
      "export const build = createFormSchema.helper(() =>",
      '  createFormSchema("pages.home", ({ error }) => error("missing"))',
      ");",
      "",
    ].join("\n");

    try {
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record() {},
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        }
      );
      let referenceError: unknown;
      try {
        await transformMiraiIntlSource(source, id, {
          authorizationEvidence: {
            record() {},
            workspaceRoot: "/",
          },
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        });
      } catch (error) {
        referenceError = error;
      }

      expect(candidate?.error).toBeInstanceOf(Error);
      expect(
        candidate?.error instanceof Error ? candidate.error.message : ""
      ).toBe(referenceError instanceof Error ? referenceError.message : "");
      expect(
        candidate?.error instanceof Error ? candidate.error.message : ""
      ).toMatch(/missing/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("matches reference diagnostics for invalid sliced key and form-error calls", async () => {
    const fixture = await createGeneratedCatalog();
    const cases = [
      [
        'import { createTranslationKey } from "./i18n/generated";',
        'export const key = createTranslationKey("pages.home")("missing");',
        "",
      ].join("\n"),
      [
        'import { createFormSchema } from "./i18n/generated";',
        'export const schema = createFormSchema("pages.home", ({ error }) => ({ invalid: error("missing") }));',
        "",
      ].join("\n"),
    ];

    try {
      for (const [index, source] of cases.entries()) {
        const id = join(fixture.root, "src", `invalid-slice-${index}.ts`);
        const [candidate] = await transformMiraiIntlOwnerBatch(
          [
            {
              authorizationEvidence: {
                record() {},
                workspaceRoot: "/",
              },
              id,
              source,
            },
          ],
          {
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          },
          undefined,
          false,
          {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              moduleResolution: ts.ModuleResolutionKind.Bundler,
            },
          }
        );
        let referenceError: unknown;
        try {
          await transformMiraiIntlSource(source, id, {
            authorizationEvidence: {
              record() {},
              workspaceRoot: "/",
            },
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          });
        } catch (error) {
          referenceError = error;
        }

        expect(candidate?.error).toBeInstanceOf(Error);
        expect(referenceError).toBeInstanceOf(Error);
        if (
          !(candidate?.error instanceof Error) ||
          !(referenceError instanceof Error)
        ) {
          throw new Error("Expected matching candidate and reference errors");
        }
        expect(candidate.error.message).toBe(referenceError.message);
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("discovers automatic typeRoots and keeps inert sources Program-free", async () => {
    const fixture = await createGeneratedCatalog();
    const typesRoot = join(fixture.root, "types");
    await mkdir(join(typesRoot, "mirai-test"), { recursive: true });
    await writeFile(
      join(typesRoot, "mirai-test/index.d.ts"),
      ['declare type AmbientHomeKey = "title";', ""].join("\n"),
      "utf8"
    );
    await writeJson(join(typesRoot, "mirai-test/package.json"), {
      name: "mirai-test",
      types: "index.d.ts",
      version: "0.0.0-fixture",
    });
    await writeJson(join(fixture.root, "tsconfig.json"), {
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        typeRoots: ["./types"],
      },
    });
    const activeSource = [
      'import { useTranslations } from "x";',
      "declare const key: AmbientHomeKey;",
      'const { t } = useTranslations("pages.home");',
      "export const translated = t(key);",
      "",
    ].join("\n");
    const inertSource = "export const ordinary = 1;\n";

    try {
      let observation: MiraiIntlSemanticBatchObservation | undefined;
      let activeEvidence: MiraiIntlSemanticEvidence | undefined;
      const results = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                activeEvidence = value;
              },
              workspaceRoot: "/",
            },
            id: join(fixture.root, "src/ambient-key.ts"),
            source: activeSource,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          observation = value;
        },
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            typeRoots: [typesRoot],
          },
        }
      );
      expect(results[0]?.error).toBeUndefined();
      expect(results[0]?.result?.code).toContain("__miraiIntlMessage0");
      expect(
        activeEvidence?.providers.some(
          ({ kind, root }) =>
            kind === "ambient" && root.endsWith("/types/mirai-test/index.d.ts")
        )
      ).toBe(true);
      expect(observation).toEqual({
        fallbackFiles: 0,
        fallbackPrograms: 0,
        sharedFiles: 1,
        sharedPrograms: 1,
      });

      let inertObservation: MiraiIntlSemanticBatchObservation | undefined;
      const [inertResult] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record() {},
              workspaceRoot: "/",
            },
            id: join(fixture.root, "src/inert.ts"),
            source: inertSource,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        (value) => {
          inertObservation = value;
        }
      );
      expect(inertResult).toMatchObject({ result: null });
      expect(inertObservation).toEqual({
        fallbackFiles: 0,
        fallbackPrograms: 0,
        sharedFiles: 1,
        sharedPrograms: 0,
      });
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("interns transitive declarations under one external provider boundary", async () => {
    const fixture = await createGeneratedCatalog();
    const providerRoot = join(fixture.root, "node_modules/wide-provider");
    await mkdir(providerRoot, { recursive: true });
    await writeJson(join(providerRoot, "package.json"), {
      exports: {
        ".": {
          types: "./index.d.ts",
        },
      },
      name: "wide-provider",
      type: "module",
      version: "0.0.0-fixture",
    });
    const declarationCount = 80;
    await Promise.all(
      Array.from({ length: declarationCount }, async (_, index) => {
        await writeFile(
          join(providerRoot, `provider-${index}.d.ts`),
          `export declare const key${index}: "title";\n`,
          "utf8"
        );
      })
    );
    await writeFile(
      join(providerRoot, "index.d.ts"),
      [
        ...Array.from(
          { length: declarationCount },
          (_, index) => `export { key${index} } from "./provider-${index}.js";`
        ),
        "",
      ].join("\n"),
      "utf8"
    );
    const id = join(fixture.root, "src/external-provider.ts");
    const source = [
      'import { useTranslations } from "x";',
      'import { key0 } from "wide-provider";',
      'const { t } = useTranslations("pages.home");',
      "export const translated = t(key0);",
      "",
    ].join("\n");

    try {
      let candidateEvidence: MiraiIntlSemanticEvidence | undefined;
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                candidateEvidence = value;
              },
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        }
      );
      let referenceEvidence: MiraiIntlSemanticEvidence | undefined;
      const reference = await transformMiraiIntlSource(source, id, {
        authorizationEvidence: {
          record(value) {
            referenceEvidence = value;
          },
          workspaceRoot: "/",
        },
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });

      expect(candidate?.error).toBeUndefined();
      expect(candidate?.result).toEqual(reference);
      expect(candidateEvidence).toEqual(referenceEvidence);
      expect(candidateEvidence?.providerBudgetExceeded).toBe(false);
      expect(
        candidateEvidence?.providers.filter(
          ({ kind, root }) =>
            kind === "external" && root.includes("/wide-provider/")
        )
      ).toHaveLength(1);
      expect(
        candidateEvidence?.declarations.filter(({ path }) =>
          path.includes("/wide-provider/")
        )
      ).toHaveLength(declarationCount + 1);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("resolves pnpm-style external package self-references inside a sealed closure", async () => {
    const fixture = await createGeneratedCatalog();
    const packageStoreRelative = join(
      ".pnpm",
      "wide-state@1.0.0",
      "node_modules",
      "wide-state"
    );
    const packageRoot = join(
      fixture.root,
      "node_modules",
      packageStoreRelative
    );
    await mkdir(join(packageRoot, "esm/deep"), { recursive: true });
    await writeJson(join(packageRoot, "package.json"), {
      exports: {
        "./deep/middleware": {
          types: "./esm/deep/middleware.d.mts",
        },
        "./sibling": {
          types: "./esm/sibling.d.mts",
        },
        "./vanilla": {
          types: "./esm/vanilla.d.mts",
        },
      },
      name: "wide-state",
      type: "module",
      version: "1.0.0",
    });
    await writeFile(
      join(packageRoot, "esm/vanilla.d.mts"),
      ['export type ProviderKey = "title";', ""].join("\n"),
      "utf8"
    );
    await writeFile(
      join(packageRoot, "esm/deep/middleware.d.mts"),
      [
        'import type { ProviderKey } from "wide-state/vanilla";',
        'declare module "../vanilla.mjs" { interface ProviderMarker {} }',
        "export declare const key: ProviderKey;",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(packageRoot, "esm/sibling.d.mts"),
      [
        'import type { ProviderKey } from "wide-state/vanilla";',
        "export declare const siblingKey: ProviderKey;",
        "",
      ].join("\n"),
      "utf8"
    );
    await symlink(
      packageStoreRelative,
      join(fixture.root, "node_modules/wide-state"),
      "dir"
    );
    const id = join(fixture.root, "src/pnpm-provider.ts");
    const source = [
      'import { useTranslations } from "x";',
      'import { key } from "wide-state/deep/middleware";',
      'import { siblingKey } from "wide-state/sibling";',
      'const { t } = useTranslations("pages.home");',
      "export const translated = t(Math.random() > 0.5 ? key : siblingKey);",
      "",
    ].join("\n");

    try {
      let candidateEvidence: MiraiIntlSemanticEvidence | undefined;
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record(value) {
                candidateEvidence = value;
              },
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        }
      );
      let referenceEvidence: MiraiIntlSemanticEvidence | undefined;
      const reference = await transformMiraiIntlSource(source, id, {
        authorizationEvidence: {
          record(value) {
            referenceEvidence = value;
          },
          workspaceRoot: "/",
        },
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });

      expect(candidate?.error).toBeUndefined();
      expect(candidate?.result).toEqual(reference);
      expect(candidateEvidence).toEqual(referenceEvidence);
      expect(candidateEvidence?.providerBudgetExceeded).toBe(false);
      expect(
        candidateEvidence?.providers.filter(
          ({ kind, root }) =>
            kind === "external" && root.includes("/wide-state/")
        )
      ).toHaveLength(1);
      expect(
        candidateEvidence?.declarations
          .filter(({ path }) => path.includes("/wide-state/"))
          .map(({ path }) => path.split("/").at(-1))
          .toSorted()
      ).toEqual(["middleware.d.mts", "sibling.d.mts", "vanilla.d.mts"]);

      const [preserveSymlinks] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record() {},
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            preserveSymlinks: true,
          },
        }
      );
      expect(
        preserveSymlinks?.error instanceof Error
          ? preserveSymlinks.error.message
          : ""
      ).toMatch(/does not support preserveSymlinks=true/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("preserves transitive form-schema types outside the selected facade slice", async () => {
    const fixture = await createGeneratedCatalog();
    const schemaId = join(fixture.root, "src/schema.ts");
    await writeFile(
      schemaId,
      [
        'import { createFormSchema } from "@/i18n/generated";',
        'export const schema = createFormSchema("pages.home", () => ({ key: "title" as const }));',
        'export type SchemaKey = typeof schema["key"];',
        "",
      ].join("\n"),
      "utf8"
    );
    const id = join(fixture.root, "src/transitive-schema.ts");
    const source = [
      'import { useTranslations } from "x";',
      'import type { SchemaKey } from "./schema";',
      "declare const key: SchemaKey;",
      'const { t } = useTranslations("pages.home");',
      "export const translated = t(key);",
      "",
    ].join("\n");

    try {
      const [candidate] = await transformMiraiIntlOwnerBatch(
        [
          {
            authorizationEvidence: {
              record() {},
              workspaceRoot: "/",
            },
            id,
            source,
          },
        ],
        {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        },
        undefined,
        false,
        {
          compilerOptions: {
            baseUrl: fixture.root,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            paths: { "@/*": ["src/*"] },
          },
        }
      );
      const reference = await transformMiraiIntlSource(source, id, {
        generatedDirectory: fixture.generatedDirectory,
        root: fixture.root,
      });

      expect(candidate?.error).toBeUndefined();
      expect(candidate?.result).toEqual(reference);
      expect(candidate?.result?.code).toContain("__miraiIntlMessage0");
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    { exceeds: false, providerCount: 64 },
    { exceeds: true, providerCount: 66 },
  ])(
    "keeps the exact provider budget boundary in a sealed closure ($providerCount providers)",
    async ({ exceeds, providerCount }) => {
      const fixture = await createGeneratedCatalog();
      const id = join(fixture.root, "src/provider-budget.ts");
      for (let index = 0; index < providerCount; index += 1) {
        const source =
          index === providerCount - 1
            ? 'export declare const key: "title";\n'
            : `export { key } from "./provider-${index + 1}";\n`;
        await writeFile(
          join(fixture.root, `src/provider-${index}.ts`),
          source,
          "utf8"
        );
      }
      const source = [
        'import { useTranslations } from "x";',
        'import { key } from "./provider-0";',
        'const { t } = useTranslations("pages.home");',
        "export const translated = t(key);",
        "",
      ].join("\n");

      try {
        let evidence: MiraiIntlSemanticEvidence | undefined;
        let observation: MiraiIntlSemanticBatchObservation | undefined;
        const [result] = await transformMiraiIntlOwnerBatch(
          [
            {
              authorizationEvidence: {
                record(value) {
                  evidence = value;
                },
                workspaceRoot: "/",
              },
              id,
              source,
            },
          ],
          {
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          },
          (value) => {
            observation = value;
          }
        );
        expect(observation).toEqual({
          fallbackFiles: 0,
          fallbackPrograms: 0,
          sharedFiles: 1,
          sharedPrograms: 1,
        });
        expect(evidence?.providerBudgetExceeded).toBe(exceeds);
        expect(result?.error instanceof Error).toBe(exceeds);
        expect(
          result?.error instanceof Error ? result.error.message : ""
        ).toMatch(exceeds ? /exceeded the 64-file provider budget/u : /^$/u);
        expect(result?.result == null).toBe(exceeds);
      } finally {
        await rm(fixture.root, { force: true, recursive: true });
      }
    }
  );

  it("lowers namespace-bound server dynamic calls through the same private runtime lookup", async () => {
    const fixture = await createGeneratedCatalog();
    const id = join(fixture.root, "src/server-dynamic.ts");
    const source = [
      'import { getServerTranslations } from "x";',
      'declare const key: "title";',
      'const { t } = await getServerTranslations("pages.home");',
      "const translated = t(key);",
      "",
    ].join("\n");

    try {
      const result = requireTransform(
        await transformMiraiIntlSource(source, id, {
          generatedDirectory: fixture.generatedDirectory,
          root: fixture.root,
        })
      );

      expect(result.code).toContain('["pages.home.title"]');
      expect(result.code).not.toContain('["pages.home.description"]');
      expect(result.code).not.toContain('["pages.home.settings"]');
      expect(result.code).toContain(
        '__miraiIntlTranslateDynamicText(t, key, "pages.home", __miraiIntlDynamicTextRegistry)'
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("fails closed for unsafe or invalid finite maps", async () => {
    const fixture = await createGeneratedCatalog();
    const options = {
      generatedDirectory: fixture.generatedDirectory,
      root: fixture.root,
    };
    const cases = [
      {
        error: /locally declared as const literals/u,
        source: 'const KEYS = ["status.active"];',
        use: "t.map(KEYS)",
      },
      {
        error: /must not contain spreads/u,
        source: 'const BASE = ["status.active"] as const;',
        use: 't.map([...BASE, "status.inactive"] as const)',
      },
      {
        error: /repeats output key status\.active/u,
        source: "",
        use: 't.map(["status.active", "status.active"] as const)',
      },
      {
        error: /record keys must be literals/u,
        source: 'const key = "enabled";',
        use: 't.map({ [key]: "status.active" } as const)',
      },
      {
        error: /record values must be string literals/u,
        source: 'const path = "status.active";',
        use: "t.map({ enabled: path } as const)",
      },
      {
        error: /Unknown translation path components\.toast\.missing/u,
        source: "",
        use: 't.map(["missing"] as const)',
      },
      {
        error: /only supports text messages/u,
        source: "",
        use: 't.map(["rich"] as const)',
      },
      {
        error: /cannot select parameterized message/u,
        source: "",
        use: 't.map(["parameterized"] as const)',
      },
    ];

    try {
      for (const [index, testCase] of cases.entries()) {
        const source = [
          'import { useTranslations } from "x";',
          testCase.source,
          'const { t } = useTranslations("components.toast");',
          `${testCase.use};`,
        ].join("\n");
        await expect(
          transformMiraiIntlSource(
            source,
            join(fixture.root, `src/map-failure-${index}.ts`),
            options
          )
        ).rejects.toThrowError(testCase.error);
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("fails closed for dynamic keys, unknown messages, kind mismatches, and escaped translator aliases", async () => {
    const fixture = await createGeneratedCatalog();
    const options = {
      generatedDirectory: fixture.generatedDirectory,
      root: fixture.root,
    };
    const cases = [
      {
        error: /finite named-key unions or generated deferred keys/u,
        source:
          'import { useTranslations } from "x"; declare const key: string; const { t } = useTranslations("pages.home"); t(key);',
      },
      {
        error: /finite named-key unions or generated deferred keys/u,
        source:
          'import { useTranslations } from "x"; declare const key: unknown; const { t } = useTranslations("pages.home"); t(key);',
      },
      {
        error: /finite named-key unions or generated deferred keys/u,
        source:
          'import { useTranslations } from "x"; declare const key: any; const { t } = useTranslations("pages.home"); t(key);',
      },
      {
        error: /literal non-root namespace/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations(); t(key);',
      },
      {
        error: /exactly one argument/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); t(key, values);',
      },
      {
        error: /Dynamic useTranslations namespace/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations(namespace); t("title");',
      },
      {
        error: /t\.dynamic is unavailable/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); t.dynamic(key);',
      },
      {
        error: /Unknown translation path pages\.home\.missing/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); t("missing");',
      },
      {
        error: /Unknown form error key pages\.home\.error\.form\.missing/u,
        source:
          'import { createFormSchema } from "@/i18n/generated"; createFormSchema("pages.home", ({ error }) => error("missing"));',
      },
      {
        error: /Form schema error keys must be literal registered keys/u,
        source:
          'import { createFormSchema } from "@/i18n/generated"; declare const key: string; createFormSchema("pages.home", ({ error }) => error(key));',
      },
      {
        error: /requires t\.rich but description is a rich message/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); t("description");',
      },
      {
        error: /Translator binding t escapes the supported call syntax/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); consume(t);',
      },
      {
        error: /Translator binding t escapes the supported call syntax/u,
        source:
          'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); factory({ t });',
      },
      {
        error: /Conditional translation results must use the same namespace/u,
        source:
          'import { useTranslations } from "x"; declare const condition: boolean; const home = useTranslations("pages.home"); const about = useTranslations("pages.about"); const { t } = condition ? home : about; t("title");',
      },
      {
        error: /Translation wrapper hooks cannot be statically lowered/u,
        source:
          'import { useTranslations } from "x"; const useDocumentViewerTranslations = () => useTranslations("pages.home"); const { t } = useDocumentViewerTranslations(); t("title");',
      },
      {
        error:
          /Translation call must use a useTranslations\(\)\/getServerTranslations\(\) binding in this module/u,
        source:
          'import type { Translator } from "@/hooks/useTranslations"; export const items = ({ t }: { t: Translator<"pages.home"> }) => t("title");',
      },
      {
        error: /parseTranslationKey requires a literal namespace/u,
        source:
          'import { parseTranslationKey } from "@/i18n/generated"; declare const namespace: string; parseTranslationKey(namespace, "title");',
      },
    ];

    try {
      for (const [index, testCase] of cases.entries()) {
        await expect(
          transformMiraiIntlSource(
            testCase.source,
            join(fixture.root, `src/failure-${index}.ts`),
            options
          )
        ).rejects.toThrowError(testCase.error);
      }
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("returns null for modules without eligible translator calls", async () => {
    const fixture = await createGeneratedCatalog();
    try {
      await expect(
        transformMiraiIntlSource(
          "export const answer = 42;\n",
          join(fixture.root, "src/plain.ts"),
          {
            generatedDirectory: fixture.generatedDirectory,
            root: fixture.root,
          }
        )
      ).resolves.toBeNull();
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});

describe("generated catalog read confinement", () => {
  it("rejects a symlinked generated catalog root", async () => {
    const fixture = await createGeneratedCatalog();
    const external = join(fixture.root, "external-generated");
    try {
      await rename(fixture.generatedDirectory, external);
      await symlink(external, fixture.generatedDirectory, "dir");

      await expect(lowerHomeTitle(fixture)).rejects.toThrowError(
        /Generated catalog root must be a non-symlink directory/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a symlinked current pointer with otherwise valid content", async () => {
    const fixture = await createGeneratedCatalog();
    const pointer = join(fixture.generatedDirectory, "current.json");
    const external = join(fixture.root, "external-current.json");
    try {
      await rename(pointer, external);
      await symlink(external, pointer, "file");

      await expect(lowerHomeTitle(fixture)).rejects.toThrowError(
        /Generated current pointer must be a non-symlink regular file/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a symlinked selected build with otherwise valid artifacts", async () => {
    const fixture = await createGeneratedCatalog();
    const selected = join(fixture.generatedDirectory, fixture.directory);
    const external = join(fixture.root, "external-selected-build");
    try {
      await rename(selected, external);
      await symlink(external, selected, "dir");

      await expect(lowerHomeTitle(fixture)).rejects.toThrowError(
        /Generated selected directory must not be a symbolic link/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it.each([
    ["catalog.contract.gen.json", "contract"],
    ["catalog.provenance.gen.json", "provenance"],
  ])("rejects a symlinked generated %s", async (fileName, artifactLabel) => {
    const fixture = await createGeneratedCatalog();
    const selected = join(fixture.generatedDirectory, fixture.directory);
    const artifact = join(selected, fileName);
    const external = join(fixture.root, `external-${fileName}`);
    try {
      await rename(artifact, external);
      await symlink(external, artifact, "file");

      await expect(lowerHomeTitle(fixture)).rejects.toThrowError(
        new RegExp(
          `Generated catalog ${artifactLabel} must be a non-symlink regular file`,
          "u"
        )
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a symlinked private message module with otherwise valid JavaScript", async () => {
    const fixture = await createGeneratedCatalog();
    const selected = join(fixture.generatedDirectory, fixture.directory);
    const module = join(selected, messageModule);
    const external = join(fixture.root, "external-message.mjs");
    try {
      await rename(module, external);
      await symlink(external, module, "file");

      await expect(lowerHomeTitle(fixture)).rejects.toThrowError(
        /Generated private message module must be a non-symlink regular file/u
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
});
