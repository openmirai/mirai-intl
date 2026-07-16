import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { NextConfig as OfficialNextConfig } from "next";
import { build as buildVite, createServer as createViteServer } from "vite";
import { describe, expect, it, vi } from "vitest";

import { withMiraiIntl } from "../src/next";
import { miraiIntlVite } from "../src/vite";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

const messageModule = "catalog.messages.gen.mjs";

async function createAdapterFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-adapter-"));
  const generated = join(root, "src/i18n/generated");
  const hash = "b".repeat(64);
  const directory = `builds/${hash}`;
  await writeJson(join(generated, "current.json"), {
    contentHash: `sha256:${hash}`,
    directory,
  });
  await writeFile(
    join(generated, "index.ts"),
    `// @mirai-intl-selector ${JSON.stringify({ contentHash: `sha256:${hash}`, directory, schemaVersion: 1 })}\n`,
    "utf8"
  );
  await writeJson(join(generated, directory, "catalog.contract.gen.json"), {
    catalogId: "fixture",
    messages: [{ kind: "text", path: "pages.home.title" }],
    schemaVersion: 1,
  });
  await writeJson(join(generated, directory, "catalog.provenance.gen.json"), {
    catalogHash: "sha256:catalog",
    entries: [],
    exports: [
      {
        descriptorExport: "m0",
        module: messageModule,
        path: "pages.home.title",
        runtimeExport: "r0",
      },
    ],
  });
  await writeFile(
    join(generated, directory, messageModule),
    "export const m0 = {};\n",
    "utf8"
  );
  return root;
}

async function createConventionViteFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-vite-lifecycle-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "7.3.6" },
    name: "@example/vite-app",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    title: "Title",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    title: "หัวข้อ",
  });
  return root;
}

async function createConventionViteBundleFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-vite-bundle-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "7.3.6" },
    name: "@example/vite-bundle-app",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    unrelated: "UNRELATED_DESCRIPTOR_SENTINEL",
    used: "REFERENCED_DESCRIPTOR_SENTINEL",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    unrelated: "UNRELATED_DESCRIPTOR_SENTINEL_TH",
    used: "REFERENCED_DESCRIPTOR_SENTINEL_TH",
  });
  await writeFile(
    join(root, "src/runtime.ts"),
    [
      "export function useTranslations() {",
      "  return { t: (message: { readonly path: string }) => message.path };",
      "}",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "src/main.ts"),
    [
      'import { useTranslations } from "./runtime";',
      "const { t } = useTranslations();",
      'console.log(t("used"));',
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(root, "src/ssr.ts"),
    [
      'import { useTranslations } from "./runtime";',
      "const { t } = useTranslations();",
      'export const render = () => t("used");',
      "",
    ].join("\n"),
    "utf8"
  );
  return root;
}

describe("Vite adapter", () => {
  it("runs as a pre transform and returns code plus a source map", async () => {
    const root = await createAdapterFixture();
    try {
      const plugin = miraiIntlVite({ root });
      expect(plugin.name).toBe("mirai-intl");
      expect(plugin.enforce).toBe("pre");
      const result = await plugin.transform(
        'import { useTranslations } from "x"; const { t } = useTranslations("pages.home"); t("title");',
        join(root, "src/component.tsx")
      );
      expect(result).toMatchObject({ map: { version: 3 } });
      expect(result?.code).toContain("t(__miraiIntlMessage0)");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("lowers deferred keys only through the canonical generated facade", async () => {
    const root = await createAdapterFixture();
    try {
      const plugin = miraiIntlVite({ root });
      const result = await plugin.transform(
        [
          'import { createTranslationKey } from "./i18n/generated";',
          'export const key = createTranslationKey("pages.home")("title");',
          "",
        ].join("\n"),
        join(root, "src/schema.ts")
      );
      expect(result?.code).toContain('export const key = "pages.home.title";');
      expect(result?.code).not.toContain("createTranslationKey");
      expect(result?.code).not.toContain(messageModule);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("bundles the referenced private message without an unrelated descriptor sentinel", async () => {
    const root = await createConventionViteBundleFixture();
    try {
      const result = await buildVite({
        build: {
          minify: false,
          rollupOptions: {
            external: ["@openmirai/intl-abi", "@openmirai/intl-runtime"],
            input: join(root, "src/main.ts"),
          },
          write: false,
        },
        configFile: false,
        logLevel: "silent",
        plugins: [miraiIntlVite({ root })],
        root,
      });
      const outputs = (
        Array.isArray(result) ? result : [result]
      ) as ReadonlyArray<{
        output: ReadonlyArray<Readonly<{ code?: string; type: string }>>;
      }>;
      const code = outputs
        .flatMap(({ output }) => output)
        .filter((entry) => entry.type === "chunk")
        .map((entry) => entry.code ?? "")
        .join("\n");

      expect(code).toContain("REFERENCED_DESCRIPTOR_SENTINEL");
      expect(code).toContain("REFERENCED_DESCRIPTOR_SENTINEL_TH");
      expect(code).not.toContain("UNRELATED_DESCRIPTOR_SENTINEL");
      expect(code).not.toContain("UNRELATED_DESCRIPTOR_SENTINEL_TH");
      expect(code).not.toContain("catalog.descriptors.gen.mjs");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps the selected build stable and requires restart for live locale edits", async () => {
    const root = await createConventionViteBundleFixture();
    const plugin = miraiIntlVite({ root });
    const server = await createViteServer({
      appType: "custom",
      configFile: false,
      logLevel: "silent",
      plugins: [plugin],
      resolve: {
        alias: {
          "@openmirai/intl-abi": resolve(
            import.meta.dirname,
            "../../abi/src/index.ts"
          ),
          "@openmirai/intl-runtime": resolve(
            import.meta.dirname,
            "../../runtime/src/index.ts"
          ),
        },
      },
      root,
      server: { hmr: false, middlewareMode: true },
    });
    try {
      await server.pluginContainer.buildStart({});
      const first = (await server.ssrLoadModule("/src/ssr.ts")) as {
        render(): string;
      };
      expect(first.render()).toBe("used");

      const generatedRoot = join(root, "src/i18n/generated");
      const before = JSON.parse(
        await readFile(join(generatedRoot, "current.json"), "utf8")
      ) as { directory: string };
      const localeFile = join(root, "src/locales/global/th.json");
      await writeJson(localeFile, {
        unrelated: "UNRELATED_DESCRIPTOR_SENTINEL_TH",
        used: "REFERENCED_DESCRIPTOR_SENTINEL_TH_UPDATED",
      });
      const logger = { error: vi.fn() };
      await plugin.handleHotUpdate({
        file: localeFile,
        server: {
          config: { logger },
          watcher: {
            add: vi.fn(),
            off: vi.fn(),
            on: vi.fn(),
          },
        },
      });

      const after = JSON.parse(
        await readFile(join(generatedRoot, "current.json"), "utf8")
      ) as { directory: string };
      expect(after).toEqual(before);
      await expect(
        stat(join(generatedRoot, before.directory))
      ).resolves.toBeDefined();
      await expect(readdir(join(generatedRoot, "builds"))).resolves.toEqual([
        before.directory.slice("builds/".length),
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Restart Vite/u)
      );

      const second = (await server.ssrLoadModule("/src/ssr.ts")) as {
        render(): string;
      };
      expect(second.render()).toBe("used");
    } finally {
      await server.close();
      await rm(root, { force: true, recursive: true });
    }
  }, 15_000);

  it("generates before readers, watches locale JSON, and requires restart instead of live rotation", async () => {
    const root = await createConventionViteFixture();
    const watched: Array<string> = [];
    const logger = { error: vi.fn() };
    const watcher = {
      add: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    };
    const server = {
      config: { logger },
      watcher,
    };
    try {
      const canonicalRoot = await realpath(root);
      const plugin = miraiIntlVite();
      plugin.configResolved({ root });
      await plugin.buildStart.call({
        addWatchFile(file: string) {
          watched.push(file);
        },
      });

      expect(watched).toEqual(
        expect.arrayContaining([
          join(canonicalRoot, "package.json"),
          join(canonicalRoot, "src/locales"),
          join(canonicalRoot, "src/locales/global/en.json"),
          join(canonicalRoot, "src/locales/global/th.json"),
        ])
      );
      const current = JSON.parse(
        await readFile(join(root, "src/i18n/generated/current.json"), "utf8")
      ) as { directory: string };
      const runtime = JSON.parse(
        await readFile(
          join(
            root,
            "src/i18n/generated",
            current.directory,
            "catalog.runtime.gen.json"
          ),
          "utf8"
        )
      ) as { manifest: { rendererCapabilityId: string } };
      expect(runtime.manifest.rendererCapabilityId).toBe("portable-ir-v1");

      const cleanup = plugin.configureServer(server);
      expect(watcher.add).toHaveBeenCalledWith(
        join(canonicalRoot, "src/locales")
      );
      expect(watcher.on).toHaveBeenCalledWith("add", expect.any(Function));
      expect(watcher.on).toHaveBeenCalledWith("unlink", expect.any(Function));

      await writeJson(join(root, "src/locales/global/en.json"), {
        before: "Before",
        title: "Updated title",
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        before: "ก่อน",
        title: "หัวข้อใหม่",
      });
      await plugin.handleHotUpdate({
        file: join(root, "src/locales/global/en.json"),
        server,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringMatching(/Restart Vite/u)
      );
      const afterEdit = JSON.parse(
        await readFile(join(root, "src/i18n/generated/current.json"), "utf8")
      ) as { directory: string };
      expect(afterEdit).toEqual(current);
      await expect(
        readdir(join(root, "src/i18n/generated/builds"))
      ).resolves.toEqual([current.directory.slice("builds/".length)]);

      const result = await plugin.transform(
        'import { useTranslations } from "x"; const { t } = useTranslations(); t("title");',
        join(root, "src/component.tsx")
      );
      expect(result?.code).toContain("m0 as __miraiIntlMessage0");
      expect(result?.code).toContain("t(__miraiIntlMessage0)");
      cleanup();
      expect(watcher.off).toHaveBeenCalledTimes(2);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("watches every mounted dependency source through its canonical package path", async () => {
    const root = await createConventionViteFixture();
    const dependencyRoot = join(root, "linked/ui-i18n");
    const installedRoot = join(root, "node_modules/@example/ui-i18n");
    const watched: Array<string> = [];
    try {
      await writeJson(join(dependencyRoot, "package.json"), {
        name: "@example/ui-i18n",
        version: "1.0.0",
      });
      await writeJson(join(dependencyRoot, "src/global/en.json"), {
        label: "Label",
      });
      await writeJson(join(dependencyRoot, "src/global/th.json"), {
        label: "ป้ายกำกับ",
      });
      await mkdir(join(installedRoot, ".."), { recursive: true });
      await symlink(dependencyRoot, installedRoot, "dir");
      await writeJson(join(root, "package.json"), {
        dependencies: {
          "@example/ui-i18n": "workspace:*",
          vite: "7.3.6",
        },
        miraiIntl: {
          sources: [
            {
              from: "@example/ui-i18n",
              mount: "components.ui",
              path: "src",
            },
          ],
        },
        name: "@example/vite-app",
        version: "1.0.0",
      });

      const plugin = miraiIntlVite({ root });
      await plugin.buildStart.call({
        addWatchFile(file: string) {
          watched.push(file);
        },
      });
      const canonicalDependencyRoot = await realpath(
        join(dependencyRoot, "src")
      );
      expect(watched).toEqual(
        expect.arrayContaining([
          canonicalDependencyRoot,
          join(canonicalDependencyRoot, "global/en.json"),
          join(canonicalDependencyRoot, "global/th.json"),
        ])
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("leaves unrelated source edits to normal Vite HMR", async () => {
    const root = await createConventionViteFixture();
    const logger = { error: vi.fn() };
    const watcher = {
      add: vi.fn(),
      off: vi.fn(),
      on: vi.fn(),
    };
    try {
      const plugin = miraiIntlVite({ root });
      await plugin.buildStart.call({ addWatchFile: vi.fn() });

      await expect(
        plugin.handleHotUpdate({
          file: join(root, "src/component.tsx"),
          server: { config: { logger }, watcher },
        })
      ).resolves.toBeUndefined();
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("Next adapter", () => {
  it("accepts and preserves the official Next config type", () => {
    const officialConfig: OfficialNextConfig = {};
    const wrapped = withMiraiIntl(officialConfig);

    wrapped satisfies OfficialNextConfig;
    expect(wrapped).toBeDefined();
  });

  it("merges Turbopack rules and preserves the existing webpack callback", () => {
    const existingWebpack = vi.fn((config: Record<string, unknown>) => ({
      ...config,
      existingWebpack: true,
    }));
    const wrapped = withMiraiIntl(
      {
        turbopack: {
          rules: {
            "*.tsx": { loaders: ["existing-loader"] },
          },
        },
        webpack: existingWebpack,
      },
      { root: "/repo" }
    );

    const tsxRule = wrapped.turbopack?.rules?.["*.tsx"];
    expect(Array.isArray(tsxRule)).toBe(true);
    expect(tsxRule).toEqual([
      { loaders: ["existing-loader"] },
      {
        condition: { not: "foreign" },
        loaders: [
          expect.objectContaining({
            loader: expect.stringMatching(/next-loader\.js$/u),
            options: {
              generatedDirectory: "src/i18n/generated",
              root: "/repo",
            },
          }),
        ],
      },
    ]);
    expect(wrapped.turbopack?.rules?.["*.ts"]).toEqual(
      expect.objectContaining({ loaders: expect.any(Array) })
    );

    const base = { module: { rules: ["base-rule"] } };
    const webpackResult = wrapped.webpack?.(base, { mode: "production" });
    expect(existingWebpack).toHaveBeenCalledOnce();
    expect(webpackResult).toMatchObject({ existingWebpack: true });
    expect(webpackResult?.module?.rules).toEqual([
      "base-rule",
      expect.objectContaining({
        enforce: "pre",
        use: [
          expect.objectContaining({
            loader: expect.stringMatching(/next-loader\.js$/u),
          }),
        ],
      }),
    ]);
    expect(webpackResult?.plugins).toEqual([expect.any(Object)]);
  });

  it("ensures the convention catalog in webpack before compilation", async () => {
    const root = await createConventionViteFixture();
    try {
      const wrapped = withMiraiIntl({}, { root });
      const webpackResult = wrapped.webpack?.(
        { module: { rules: [] } },
        { mode: "production" }
      );
      const plugin = webpackResult?.plugins?.[0] as {
        apply(compiler: unknown): void;
      };
      let beforeCompile: (() => Promise<unknown>) | undefined;
      plugin.apply({
        hooks: {
          beforeCompile: {
            tapPromise(_name: string, callback: () => Promise<unknown>) {
              beforeCompile = callback;
            },
          },
        },
      });
      expect(beforeCompile).toBeTypeOf("function");
      await beforeCompile?.();
      await expect(
        readFile(join(root, "src/i18n/generated/current.json"), "utf8")
      ).resolves.toContain('"directory"');
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
