import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compileCatalog,
  generateConventionCatalog,
  loadConventionCatalog,
  semanticMessageExportName,
  verifyConventionCatalog,
} from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createConventionApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-convention-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/dashboard",
    version: "1.2.3",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello {name}",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี {name}",
  });
  await writeJson(
    join(root, "src/locales/pages/{-$locale}/short-links/en.json"),
    { title: "{count, plural, one {# link} other {# links}}" }
  );
  await writeJson(
    join(root, "src/locales/pages/{-$locale}/short-links/th.json"),
    { title: "{count, plural, other {# ลิงก์}}" }
  );
  await writeJson(join(root, "src/locales/combined/en.json"), {
    ignored: "generated",
  });
  return root;
}

type SourceDeclaration = Readonly<{
  from: string;
  mount: string;
  path: string;
}>;

async function configureMountedSources(
  root: string,
  dependencies: Readonly<Record<string, string>>,
  sources: ReadonlyArray<SourceDeclaration>
): Promise<void> {
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4", ...dependencies },
    miraiIntl: { sources },
    name: "@example/dashboard",
    version: "1.2.3",
  });
}

async function createTranslationDependency(
  root: string,
  name: string,
  messages: Readonly<Record<string, unknown>>,
  options: Readonly<{
    locales?: ReadonlyArray<string>;
    sourcePath?: string;
    specifier?: string;
    symlink?: boolean;
  }> = {}
): Promise<Readonly<{ dependencyRoot: string; specifier: string }>> {
  const sourcePath = options.sourcePath ?? "src";
  const dependencyRoot =
    options.symlink === false
      ? join(root, "node_modules", ...name.split("/"))
      : join(root, "linked", ...name.split("/"));
  await writeJson(join(dependencyRoot, "package.json"), {
    exports: { ".": "./index.js" },
    name,
    version: "1.0.0",
  });
  for (const locale of options.locales ?? ["en", "th"]) {
    await writeJson(
      join(dependencyRoot, sourcePath, "global", `${locale}.json`),
      messages
    );
  }
  if (options.symlink !== false) {
    const installed = join(root, "node_modules", ...name.split("/"));
    await mkdir(join(installed, ".."), { recursive: true });
    await symlink(dependencyRoot, installed, "dir");
  }
  return {
    dependencyRoot,
    specifier:
      options.specifier ??
      (options.symlink === false ? "1.0.0" : `link:${dependencyRoot}`),
  };
}

describe("convention-first catalog discovery", () => {
  it("infers package, framework, locale, mount, and a private descriptor contract", async () => {
    const root = await createConventionApp();
    try {
      const loaded = await loadConventionCatalog(root);
      expect(loaded.config).toMatchObject({
        catalog: {
          buildId: "1.2.3",
          id: "@example/dashboard",
          locales: ["en", "th"],
          package: "@example/dashboard-intl-catalog",
          rendererCapabilityId: "portable-ir-v1",
          sourceLocale: "en",
        },
        output: "src/i18n/generated",
        sources: [
          {
            flattenDirectories: ["global"],
            root: "src/locales",
          },
        ],
      });
      expect(loaded.discovery).toEqual({
        catalogId: "@example/dashboard",
        catalogPackage: "@example/dashboard-intl-catalog",
        excludedDirectories: ["combined", "generated", "node_modules"],
        flattenDirectories: ["global"],
        framework: "vite",
        localeRoot: "src/locales",
        locales: ["en", "th"],
        output: "src/i18n/generated",
        representation: "precompiled",
        schemaVersion: 1,
        sourceLocale: "en",
      });
      expect(loaded.source.messages.map((message) => message.path)).toEqual([
        "greeting",
        "pages.{-$locale}.short-links.title",
      ]);
      expect(loaded.source.messages[0]?.valuesSchema).toEqual({
        additionalProperties: false,
        properties: { name: { type: "scalar" } },
        required: ["name"],
        type: "object",
      });

      const generated = await generateConventionCatalog(root, {
        collectEnvironment: false,
      });
      expect(generated.report).toMatchObject({
        authoritative: false,
        contracts: {
          discovery: { mode: "convention", schemaVersion: 1 },
          exceptions: { present: false, schemaVersion: 1 },
          messages: {
            generated: true,
            schemaVersion: 1,
            source: "message-ast",
          },
        },
        discovery: loaded.discovery,
      });
      const index = await readFile(
        join(root, "src/i18n/generated/index.ts"),
        "utf8"
      );
      expect(index).toContain("CatalogContract");
      expect(index).not.toMatch(/\bmessage_/u);
      expect(index).not.toMatch(/\bm\d+\b/u);
      expect(index).not.toContain("RuntimeMessage");
      const contract = JSON.parse(
        await readFile(
          join(generated.write.directory, "catalog.contract.gen.json"),
          "utf8"
        )
      ) as { messages: Array<Record<string, unknown> & { path: string }> };
      expect(contract.messages).toContainEqual(
        expect.objectContaining({
          path: "pages.{-$locale}.short-links.title",
        })
      );
      expect(
        contract.messages.every((message) => !("exportName" in message))
      ).toBe(true);
      await expect(
        verifyConventionCatalog(root, { collectEnvironment: false })
      ).resolves.toMatchObject({ valid: true, write: { changed: false } });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("infers exact value contracts from whole-locale value files", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-value-files-"));
    try {
      await writeJson(join(root, "package.json"), {
        dependencies: { vite: "8.1.4" },
        name: "@example/value-files",
        version: "1.0.0",
      });
      await writeJson(join(root, "locales/runtime/en.json"), {
        label: "Course catalog",
      });
      await writeJson(join(root, "locales/runtime/th.json"), {
        label: "แคตตาล็อกหลักสูตร",
      });
      const values = {
        flag: [true, false],
        mixedRecord: [
          {
            introduction: {
              details: { description: "Start here" },
              order: 1,
            },
            title: "Course steps",
          },
          {
            introduction: {
              details: { description: "เริ่มที่นี่" },
              order: 2,
            },
            title: "ขั้นตอนหลักสูตร",
          },
        ],
        nestedArray: [
          [["first"], ["second"]],
          [["หนึ่ง"], ["สอง"]],
        ],
        number: [1, 2],
        objectArray: [
          [
            { label: "Primary", value: "primary" },
            { value: "secondary", label: "Secondary" },
          ],
          [{ label: "หลัก", value: "primary" }],
        ],
        scalar: ["Plain text", "ข้อความธรรมดา"],
        stringArray: [
          ["first", "second"],
          ["หนึ่ง", "สอง"],
        ],
      } as const;
      for (const [name, translations] of Object.entries(values)) {
        await writeJson(
          join(root, "locales/runtime", name, "en.value.json"),
          translations[0]
        );
        await writeJson(
          join(root, "locales/runtime", name, "th.value.json"),
          translations[1]
        );
      }

      const loaded = await loadConventionCatalog(root);
      const messages = Object.fromEntries(
        loaded.source.messages.map((message) => [message.path, message])
      );

      expect(messages["runtime.label"]).toMatchObject({ kind: "text" });
      expect(messages["runtime.scalar"]).toMatchObject({
        kind: "value",
        resultSchema: { type: "string" },
      });
      expect(messages["runtime.flag"]?.resultSchema).toEqual({
        type: "boolean",
      });
      expect(messages["runtime.number"]?.resultSchema).toEqual({
        finite: true,
        integer: true,
        type: "number",
      });
      expect(messages["runtime.stringArray"]?.resultSchema).toEqual({
        items: { type: "string" },
        minItems: 1,
        type: "array",
      });
      expect(messages["runtime.objectArray"]?.resultSchema).toEqual({
        items: {
          additionalProperties: false,
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
          required: ["label", "value"],
          type: "object",
        },
        minItems: 1,
        type: "array",
      });
      expect(messages["runtime.nestedArray"]?.resultSchema).toEqual({
        items: {
          items: { type: "string" },
          minItems: 1,
          type: "array",
        },
        minItems: 1,
        type: "array",
      });
      expect(messages["runtime.mixedRecord"]?.resultSchema).toEqual({
        additionalProperties: false,
        properties: {
          introduction: {
            additionalProperties: false,
            properties: {
              details: {
                additionalProperties: false,
                properties: { description: { type: "string" } },
                required: ["description"],
                type: "object",
              },
              order: { finite: true, integer: true, type: "number" },
            },
            required: ["details", "order"],
            type: "object",
          },
          title: { type: "string" },
        },
        required: ["introduction", "title"],
        type: "object",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      en: [],
      error: "cannot infer an empty value array",
      name: "empty arrays",
      th: [],
    },
    {
      en: [1, "two"],
      error: "contains heterogeneous values",
      name: "heterogeneous arrays",
      th: [2, 3],
    },
    {
      en: null,
      error: "cannot infer a value schema from null",
      name: "null values",
      th: null,
    },
    {
      en: { label: "Primary" },
      error: "fixed-shape object mismatch",
      name: "cross-locale object shape mismatches",
      th: { title: "หลัก" },
    },
  ])("rejects $name in whole-locale value files", async ({ en, error, th }) => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-value-error-"));
    try {
      await writeJson(join(root, "package.json"), {
        dependencies: { vite: "8.1.4" },
        name: "@example/value-error",
        version: "1.0.0",
      });
      await writeJson(join(root, "locales/runtime/value/en.value.json"), en);
      await writeJson(join(root, "locales/runtime/value/th.value.json"), th);

      await expect(loadConventionCatalog(root)).rejects.toThrow(error);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps only the selected build after an atomic selector update", async () => {
    const root = await createConventionApp();
    try {
      const first = await generateConventionCatalog(root, {
        collectEnvironment: false,
      });
      const abandonedTemporary = join(
        root,
        "src/i18n/.generated.abandoned.tmp"
      );
      await mkdir(abandonedTemporary, { recursive: true });
      await writeJson(join(root, "src/locales/global/en.json"), {
        greeting: "Welcome {name}",
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        greeting: "ยินดีต้อนรับ {name}",
      });
      const second = await generateConventionCatalog(root, {
        collectEnvironment: false,
      });

      expect(second.write.contentHash).not.toBe(first.write.contentHash);
      await expect(
        readFile(
          join(first.write.directory, "catalog.contract.gen.json"),
          "utf8"
        )
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readdir(join(root, "src/i18n/generated/builds"))
      ).resolves.toEqual([second.write.contentHash.slice(7)]);
      await expect(readdir(join(root, "src/i18n"))).resolves.not.toContain(
        ".generated.abandoned.tmp"
      );

      const unchanged = await generateConventionCatalog(root, {
        collectEnvironment: false,
      });
      expect(unchanged.write).toEqual({ ...second.write, changed: false });
      await expect(
        readdir(join(root, "src/i18n/generated/builds"))
      ).resolves.toEqual([second.write.contentHash.slice(7)]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts only non-inferable formatter registrations and structured values", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "package.json"), {
        dependencies: { vite: "8.1.4" },
        miraiIntl: {
          formatterVersions: { money: "1.0.0" },
          values: {
            settings: {
              additionalProperties: false,
              properties: {
                retries: { finite: true, type: "number" },
                theme: { type: "string" },
              },
              required: ["retries", "theme"],
              type: "object",
            },
          },
        },
        name: "@example/dashboard",
        version: "1.2.3",
      });
      await writeJson(join(root, "src/locales/global/en.json"), {
        price: "{amount, number, custom:money:compact}",
        settings: { retries: 3, theme: "dark" },
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        price: "{amount, number, custom:money:compact}",
        settings: { retries: 2, theme: "light" },
      });

      const loaded = await loadConventionCatalog(root);
      expect(loaded.inputs.exceptionsPresent).toBe(true);
      expect(loaded.source.formatterVersions).toEqual({ money: "1.0.0" });
      expect(loaded.source.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            formatterIds: ["money"],
            kind: "text",
            path: "price",
          }),
          expect.objectContaining({
            kind: "value",
            path: "settings",
          }),
        ])
      );
      await expect(
        generateConventionCatalog(root, { collectEnvironment: false })
      ).resolves.toMatchObject({
        report: {
          contracts: { exceptions: { present: true } },
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("loads explicit JSON composition config with file-backed provenance", async () => {
    const root = await createConventionApp();
    try {
      const dependency = await createTranslationDependency(
        root,
        "@mirai/i18n",
        { button: { label: "Button" } },
        {
          sourcePath: "locales/components/ui",
          specifier: "workspace:*",
        }
      );
      await writeJson(join(root, "package.json"), {
        dependencies: {
          "@mirai/i18n": dependency.specifier,
          vite: "8.1.4",
        },
        name: "@example/dashboard",
        version: "1.2.3",
      });
      const configPath = join(root, "mirai-intl.config.json");
      const sources = [
        {
          from: "@mirai/i18n",
          mount: "components.ui",
          path: "locales/components/ui",
        },
      ];
      await writeJson(configPath, { sources });

      const first = await loadConventionCatalog(root);
      expect(first.configPath).toBe(await realpath(configPath));
      expect(first.inputs.exceptionsPresent).toBe(true);
      expect(first.source.messages.map((message) => message.path)).toContain(
        "components.ui.button.label"
      );
      const canonicalDependencyRoot = await realpath(dependency.dependencyRoot);
      expect(first.watch.files).toEqual(
        expect.arrayContaining([
          await realpath(configPath),
          join(canonicalDependencyRoot, "locales/components/ui/global/en.json"),
          join(canonicalDependencyRoot, "locales/components/ui/global/th.json"),
        ])
      );

      await writeJson(configPath, { sourceLocale: "th", sources });
      const changed = await loadConventionCatalog(root);
      expect(changed.configPath).toBe(await realpath(configPath));
      expect(changed.inputs.exceptionsHash).not.toBe(
        first.inputs.exceptionsHash
      );
      expect(changed.source.sourceLocale).toBe("th");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects simultaneous JSON and package.json configuration", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "mirai-intl.config.json"), { sources: [] });
      await writeJson(join(root, "package.json"), {
        dependencies: { vite: "8.1.4" },
        miraiIntl: { sourceLocale: "en" },
        name: "@example/dashboard",
        version: "1.2.3",
      });
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /mirai-intl\.config\.json and package\.json miraiIntl cannot both be present/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("composes implicit app messages with deterministic linked and installed mounted sources", async () => {
    const root = await createConventionApp();
    try {
      const ui = await createTranslationDependency(
        root,
        "@example/ui-i18n",
        { button: { label: "Button" } },
        { specifier: "workspace:*" }
      );
      const shared = await createTranslationDependency(
        root,
        "@example/shared-i18n",
        { notice: "Notice" },
        { symlink: false }
      );
      const sources = [
        {
          from: "@example/ui-i18n",
          mount: "components.ui",
          path: "src",
        },
        {
          from: "@example/shared-i18n",
          mount: "shared",
          path: "src",
        },
      ] as const;
      await configureMountedSources(
        root,
        {
          "@example/shared-i18n": shared.specifier,
          "@example/ui-i18n": ui.specifier,
        },
        sources
      );

      const first = await loadConventionCatalog(root);
      const firstHash = compileCatalog(first.source).catalog.manifest.hash;
      expect(first.source.messages.map((message) => message.path)).toEqual([
        "components.ui.button.label",
        "greeting",
        "pages.{-$locale}.short-links.title",
        "shared.notice",
      ]);
      expect(first.inputs.sourceFiles.map((file) => file.path)).toEqual(
        expect.arrayContaining([
          "node_modules/@example/shared-i18n/src/global/en.json",
          "node_modules/@example/ui-i18n/src/global/th.json",
          "src/locales/global/en.json",
        ])
      );

      await configureMountedSources(
        root,
        {
          "@example/shared-i18n": shared.specifier,
          "@example/ui-i18n": ui.specifier,
        },
        sources.toReversed()
      );
      const reordered = await loadConventionCatalog(root);
      expect(compileCatalog(reordered.source).catalog.manifest.hash).toBe(
        firstHash
      );
      expect(reordered.inputs.discoveryPolicyHash).toBe(
        first.inputs.discoveryPolicyHash
      );
      expect(reordered.inputs.exceptionsHash).toBe(first.inputs.exceptionsHash);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed for duplicate mounts, mixed locale sets, and exact or prefix message collisions", async () => {
    const root = await createConventionApp();
    try {
      const first = await createTranslationDependency(
        root,
        "@example/first-i18n",
        { title: "First" }
      );
      const second = await createTranslationDependency(
        root,
        "@example/second-i18n",
        { title: "Second" }
      );
      const dependencies = {
        "@example/first-i18n": first.specifier,
        "@example/second-i18n": second.specifier,
      };
      await configureMountedSources(root, dependencies, [
        { from: "@example/first-i18n", mount: "shared", path: "src" },
        { from: "@example/second-i18n", mount: "shared", path: "src" },
      ]);
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /duplicate mount/u
      );

      await rm(join(second.dependencyRoot, "src/global/th.json"));
      await configureMountedSources(root, dependencies, [
        { from: "@example/second-i18n", mount: "shared", path: "src" },
      ]);
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /missing configured locale th/u
      );
      await rm(join(second.dependencyRoot, "src/global/en.json"));
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /contains no locale files/u
      );

      await writeJson(join(first.dependencyRoot, "src/global/en.json"), {
        title: "Title",
      });
      await writeJson(join(first.dependencyRoot, "src/global/th.json"), {
        title: "หัวข้อ",
      });
      await configureMountedSources(root, dependencies, [
        {
          from: "@example/first-i18n",
          mount: "pages.{-$locale}.short-links",
          path: "src",
        },
      ]);
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /Collision at pages\.\{-\$locale\}\.short-links\.title/u
      );

      await writeJson(join(first.dependencyRoot, "src/global/en.json"), {
        detail: "Detail",
      });
      await writeJson(join(first.dependencyRoot, "src/global/th.json"), {
        detail: "รายละเอียด",
      });
      await configureMountedSources(root, dependencies, [
        { from: "@example/first-i18n", mount: "greeting", path: "src" },
      ]);
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /Object\/leaf collision between greeting/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("resolves mounted paths only inside declared installed dependency package roots", async () => {
    const root = await createConventionApp();
    try {
      await configureMountedSources(root, {}, [
        { from: "@example/missing-i18n", mount: "shared", path: "src" },
      ]);
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /must be declared/u
      );

      const dependency = await createTranslationDependency(
        root,
        "@example/secure-i18n",
        { title: "Secure" }
      );
      const dependencies = {
        "@example/secure-i18n": dependency.specifier,
      };
      await configureMountedSources(root, dependencies, [
        {
          from: "@example/secure-i18n",
          mount: "shared",
          path: "../outside",
        },
      ]);
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /path must stay inside/u
      );

      await rm(join(dependency.dependencyRoot, "src"), { recursive: true });
      const escaped = join(root, "escaped-translations");
      await writeJson(join(escaped, "global/en.json"), { title: "Escaped" });
      await writeJson(join(escaped, "global/th.json"), { title: "หลุด" });
      await symlink(escaped, join(dependency.dependencyRoot, "src"), "dir");
      await configureMountedSources(root, dependencies, [
        { from: "@example/secure-i18n", mount: "shared", path: "src" },
      ]);
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /escapes dependency package root/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("roots discovery and generated output at each deployable app package", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mirai-intl-workspace-"));
    const apps = [join(workspace, "apps/one"), join(workspace, "apps/two")];
    try {
      const hoistedDependency = join(
        workspace,
        "node_modules/@example/hoisted-i18n"
      );
      await writeJson(join(hoistedDependency, "package.json"), {
        exports: { ".": "./index.js" },
        name: "@example/hoisted-i18n",
        version: "1.0.0",
      });
      await writeJson(join(hoistedDependency, "src/global/en.json"), {
        title: "Shared title",
      });
      await writeJson(join(hoistedDependency, "src/global/th.json"), {
        title: "หัวข้อที่ใช้ร่วมกัน",
      });
      for (const [index, app] of apps.entries()) {
        await writeJson(join(app, "package.json"), {
          dependencies: {
            ...(index === 0 ? { "@example/hoisted-i18n": "1.0.0" } : {}),
            vite: "8.1.4",
          },
          ...(index === 0
            ? {
                miraiIntl: {
                  sources: [
                    {
                      from: "@example/hoisted-i18n",
                      mount: "shared",
                      path: "src",
                    },
                  ],
                },
              }
            : {}),
          name: `@example/app-${index + 1}`,
          version: "1.0.0",
        });
        await writeJson(join(app, "src/locales/global/en.json"), {
          title: `App ${index + 1}`,
        });
        await writeJson(join(app, "src/locales/global/th.json"), {
          title: `แอป ${index + 1}`,
        });
      }

      await expect(loadConventionCatalog(apps[0] ?? "")).resolves.toMatchObject(
        {
          source: {
            messages: expect.arrayContaining([
              expect.objectContaining({ path: "shared.title" }),
            ]),
          },
        }
      );

      const generated = await Promise.all(
        apps.map((app) =>
          generateConventionCatalog(app, { collectEnvironment: false })
        )
      );
      expect(generated.map((entry) => entry.report.catalog.catalogId)).toEqual([
        "@example/app-1",
        "@example/app-2",
      ]);
      expect(generated.map((entry) => entry.write.directory)).toEqual([
        expect.stringContaining("apps/one/src/i18n/generated/builds/"),
        expect.stringContaining("apps/two/src/i18n/generated/builds/"),
      ]);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails closed when locale roots or locale sets are ambiguous", async () => {
    const root = await createConventionApp();
    try {
      await mkdir(join(root, "locales"));
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /exactly one locale root/u
      );
      await rm(join(root, "locales"), { recursive: true });
      await writeJson(join(root, "src/locales/global/fr.json"), {
        greeting: "Bonjour {name}",
      });
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /locale directories disagree/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires a narrow source-locale decision when conventions are ambiguous", async () => {
    const root = await createConventionApp();
    try {
      await rename(
        join(root, "src/locales/global/en.json"),
        join(root, "src/locales/global/fr.json")
      );
      await rename(
        join(root, "src/locales/pages/{-$locale}/short-links/en.json"),
        join(root, "src/locales/pages/{-$locale}/short-links/fr.json")
      );

      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /source locale is ambiguous/u
      );

      await writeJson(join(root, "package.json"), {
        dependencies: { vite: "8.1.4" },
        miraiIntl: { sourceLocale: "th" },
        name: "@example/dashboard",
        version: "1.2.3",
      });
      await expect(loadConventionCatalog(root)).resolves.toMatchObject({
        discovery: { sourceLocale: "th" },
        source: { sourceLocale: "th" },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects path-aliasing dotted segments and locale-tree symlinks", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "src/locales/global/en.json"), {
        "profile.name": "Name",
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        "profile.name": "ชื่อ",
      });
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /message-path segment without dots/u
      );

      await writeJson(join(root, "src/locales/global/en.json"), {
        profile: { name: "Name" },
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        profile: { name: "ชื่อ" },
      });
      await symlink(
        join(root, "src/locales/global"),
        join(root, "src/locales/linked-global"),
        "dir"
      );
      await expect(loadConventionCatalog(root)).rejects.toThrowError(
        /does not follow symbolic link/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps collision-prone and route-placeholder names stable and distinct", () => {
    expect(semanticMessageExportName("a.u2d.b")).not.toBe(
      semanticMessageExportName("a-b")
    );
    expect(
      semanticMessageExportName("pages.{-$locale}.short-links.title")
    ).toMatch(/^message_[A-Za-z0-9_$]+_[a-f0-9]{16}$/u);
  });
});
