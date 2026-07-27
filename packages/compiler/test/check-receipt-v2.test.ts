import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { proveConventionCatalog } from "../src/proof";

const roots: Array<string> = [];

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-receipt-v2-"));
  roots.push(root);
  await writeJson(join(root, "package.json"), {
    dependencies: { "@example/provider": "1.0.0", vite: "8.1.4" },
    name: "@example/receipt-v2",
    version: "1.0.0",
  });
  await writeJson(join(root, "node_modules/@example/provider/package.json"), {
    dependencies: { "@example/transitive": "1.0.0" },
    exports: { ".": "./index.js" },
    name: "@example/provider",
    types: "./index.d.ts",
    version: "1.0.0",
  });
  await writeFile(
    join(root, "node_modules/@example/provider/index.d.ts"),
    'export { key } from "@example/transitive";\n'
  );
  await writeFile(
    join(root, "node_modules/@example/provider/alternate.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await writeJson(join(root, "node_modules/@example/transitive/package.json"), {
    exports: { ".": "./index.js" },
    name: "@example/transitive",
    types: "./index.d.ts",
    version: "1.0.0",
  });
  await writeFile(
    join(root, "node_modules/@example/transitive/index.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await writeFile(
    join(root, "node_modules/@example/transitive/alternate.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await writeJson(join(root, "src/locales/global/en.json"), {
    group: { greeting: "Hello" },
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    group: { greeting: "สวัสดี" },
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "src/page.ts"),
    [
      'import { key } from "@example/provider";',
      'import { useTranslations } from "x";',
      'const { t } = useTranslations("group");',
      "export const page = t(key);",
      "",
    ].join("\n")
  );
  await writeFile(join(root, "src/legacy.js"), "export const legacy = 1;\n");
  await writeJson(join(root, "tsconfig.a.json"), {
    compilerOptions: {
      allowJs: true,
      moduleSuffixes: [".ios", ""],
      resolveJsonModule: true,
    },
  });
  await writeJson(join(root, "tsconfig.base.json"), {
    compilerOptions: { strict: true },
  });
  await writeJson(join(root, "tsconfig.types.json"), {
    compilerOptions: { composite: true },
    files: [],
  });
  await writeJson(join(root, "tsconfig.z.json"), {
    compilerOptions: { allowJs: false, resolveJsonModule: false },
  });
  await writeJson(join(root, "tsconfig.json"), {
    exclude: ["src/node_modules"],
    extends: ["./tsconfig.z.json", "./tsconfig.a.json", "./tsconfig.base.json"],
    include: ["src/**/*"],
    references: [{ path: "./tsconfig.types.json" }],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

afterEach(async () => {
  vi.doUnmock("typescript");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe("V2 build receipt verification", () => {
  it("writes deterministic V2 authority and verifies with zero semantic runs", async () => {
    const root = await fixture();
    const first = await proveConventionCatalog(root);
    const path = join(root, ".mirai-intl/check-receipt.v2.json");
    const firstBytes = await readFile(path, "utf8");
    const second = await proveConventionCatalog(root);

    expect(second).toEqual(first);
    await expect(readFile(path, "utf8")).resolves.toBe(firstBytes);
    expect(first.schemaVersion).toBe(2);
    expect(first.counters.semanticAuthorizationRuns).toBe(1);
    expect(first.counters.providerRoots).toBe(2);
    expect(first.projects[0]?.normalizedOptions.allowJs).toBe(true);
    expect(first.projects[0]?.normalizedOptions.moduleSuffixes).toEqual([
      ".ios",
      "",
    ]);
    expect(first.projects[0]?.normalizedOptions.resolveJsonModule).toBe(true);
    expect(first.projects[0]?.rootFiles).toEqual(
      expect.arrayContaining(["src/legacy.js", "src/page.ts"])
    );
    expect(
      first.providerClosures.find((closure) => closure.source === "src/page.ts")
        ?.providers
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resolutions: [
            expect.objectContaining({
              controlFiles: expect.arrayContaining([
                expect.objectContaining({
                  path: "node_modules/@example/provider/package.json",
                }),
              ]),
              packageName: "@example/provider",
              packageVersion: "1.0.0",
              specifier: "@example/provider",
            }),
          ],
          root: "node_modules/@example/provider/index.d.ts",
        }),
        expect.objectContaining({
          resolutions: [
            expect.objectContaining({
              controlFiles: expect.arrayContaining([
                expect.objectContaining({
                  path: "node_modules/@example/transitive/package.json",
                }),
              ]),
              from: "node_modules/@example/provider/index.d.ts",
              packageName: "@example/transitive",
              packageVersion: "1.0.0",
              specifier: "@example/transitive",
            }),
          ],
          root: "node_modules/@example/transitive/index.d.ts",
        }),
      ])
    );
    const providerResolution = first.providerClosures
      .find((closure) => closure.source === "src/page.ts")
      ?.providers.find(
        (provider) =>
          provider.root === "node_modules/@example/provider/index.d.ts"
      )
      ?.resolutions.at(0);
    expect(providerResolution?.optionsHash).toBe(
      first.projects[0]?.normalizedOptionsHash
    );
    expect(providerResolution?.probes).toEqual(
      expect.arrayContaining([
        {
          kind: "file",
          path: "node_modules/@example/provider/index.ios.d.ts",
          present: false,
        },
      ])
    );
    expect(
      first.projects[0]?.configManifest.map((entry) => entry.path)
    ).toEqual([
      "tsconfig.a.json",
      "tsconfig.base.json",
      "tsconfig.json",
      "tsconfig.types.json",
      "tsconfig.z.json",
    ]);
    expect(
      first.projects[0]?.configManifest.find(
        (entry) => entry.path === "tsconfig.json"
      )?.extends
    ).toEqual(["tsconfig.z.json", "tsconfig.a.json", "tsconfig.base.json"]);

    vi.resetModules();
    vi.doMock("typescript", () => {
      throw new Error("build verification imported TypeScript");
    });
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");
    await expect(verifyConventionBuildReceipt(root)).resolves.toMatchObject({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
      receipt: { schemaVersion: 2 },
    });
  }, 60_000);

  it("rejects source and generation corruption", async () => {
    const root = await fixture();
    await proveConventionCatalog(root);
    const sourcePath = join(root, "src/page.ts");
    const originalSource = await readFile(sourcePath, "utf8");
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");

    await writeFile(sourcePath, "export const page = 2;\n");
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /source is stale or corrupt/u
    );
    await writeFile(sourcePath, originalSource);

    const configPath = join(root, "tsconfig.base.json");
    const originalConfig = await readFile(configPath, "utf8");
    await writeJson(configPath, {
      compilerOptions: { strict: false },
    });
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /TypeScript config is stale or corrupt/u
    );
    await writeFile(configPath, originalConfig);

    const pointerPath = join(root, "src/i18n/generated/current.json");
    const pointer = JSON.parse(await readFile(pointerPath, "utf8")) as {
      generationReceiptHash: string;
    };
    pointer.generationReceiptHash = `sha256:${"0".repeat(64)}`;
    await writeFile(pointerPath, `${JSON.stringify(pointer)}\n`);
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(/./u);
  }, 60_000);

  it.each([
    [
      "nearer package addition",
      async (root: string) => {
        await writeJson(
          join(root, "src/node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./index.d.ts" },
            name: "@example/provider",
            version: "2.0.0",
          }
        );
        await writeFile(
          join(root, "src/node_modules/@example/provider/index.d.ts"),
          'export declare const key: "greeting";\n'
        );
      },
      /provider resolution frontier is stale/u,
    ],
    [
      "implementation addition",
      async (root: string) => {
        await writeFile(
          join(root, "node_modules/@example/provider/index.ts"),
          'export const key = "greeting" as const;\n'
        );
      },
      /provider resolution frontier is stale/u,
    ],
    [
      "module-suffixed implementation addition",
      async (root: string) => {
        await writeFile(
          join(root, "node_modules/@example/provider/index.ios.d.ts"),
          'export declare const key: "greeting";\n'
        );
      },
      /provider resolution frontier is stale/u,
    ],
    [
      "provider removal",
      async (root: string) => {
        await rm(join(root, "node_modules/@example/provider"), {
          recursive: true,
        });
      },
      /receipt input must be a regular file/u,
    ],
    [
      "exports retarget",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./alternate.js" },
            name: "@example/provider",
            types: "./index.d.ts",
            version: "1.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
    [
      "types retarget",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./index.js" },
            name: "@example/provider",
            types: "./alternate.d.ts",
            version: "1.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
    [
      "package identity mutation",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./index.js" },
            name: "@example/provider",
            types: "./index.d.ts",
            version: "2.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
    [
      "transitive exports retarget",
      async (root: string) => {
        await writeJson(
          join(root, "node_modules/@example/transitive/package.json"),
          {
            exports: { ".": "./alternate.js" },
            name: "@example/transitive",
            types: "./index.d.ts",
            version: "1.0.0",
          }
        );
      },
      /provider resolution control is stale or corrupt/u,
    ],
  ] as const)(
    "rejects provider authority after %s",
    async (_label, mutate, error) => {
      const root = await fixture();
      await proveConventionCatalog(root);
      await mutate(root);
      vi.resetModules();
      vi.doMock("typescript", () => {
        throw new Error("build verification imported TypeScript");
      });
      const { verifyConventionBuildReceipt } =
        await import("../src/check-receipt");
      await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(error);
    },
    60_000
  );

  it.each([
    ["typeRoots", { typeRoots: ["./node_modules/@types"] }],
    ["types", { types: ["@example/provider"] }],
  ] as const)(
    "fails closed when %s would bypass the traced module-resolution frontier",
    async (option, compilerOptions) => {
      const root = await fixture();
      await writeJson(join(root, "tsconfig.a.json"), {
        compilerOptions: {
          allowJs: true,
          moduleSuffixes: [".ios", ""],
          resolveJsonModule: true,
          ...compilerOptions,
        },
      });
      await expect(proveConventionCatalog(root)).rejects.toThrow(
        new RegExp(
          `does not support TypeScript provider resolution option\\(s\\): ${option}`,
          "u"
        )
      );
    },
    60_000
  );

  it("rejects legacy V1 explicitly", async () => {
    const root = await fixture();
    await proveConventionCatalog(root);
    await writeFile(
      join(root, ".mirai-intl/check-receipt.v2.json"),
      '{"schemaVersion":99}\n'
    );
    const { verifyConventionBuildReceipt } =
      await import("../src/check-receipt");
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /schema is unsupported/u
    );

    await rm(join(root, ".mirai-intl/check-receipt.v2.json"));
    await writeFile(
      join(root, ".mirai-intl/check-receipt.v1.json"),
      '{"schemaVersion":1}\n'
    );
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
      /V1 is unsupported/u
    );
  }, 60_000);

  it.each([
    [
      "addition",
      async (root: string) => {
        await writeFile(
          join(root, "src/added.js"),
          "export const added = 1;\n"
        );
      },
      /source universe is stale/u,
    ],
    [
      "deletion",
      async (root: string) => {
        await rm(join(root, "src/legacy.js"));
      },
      /receipt input must be a regular file/u,
    ],
    [
      "rename",
      async (root: string) => {
        await rename(join(root, "src/legacy.js"), join(root, "src/renamed.js"));
      },
      /receipt input must be a regular file/u,
    ],
  ] as const)(
    "rejects post-authorization source %s without semantic verification",
    async (_label, mutate, error) => {
      const root = await fixture();
      await proveConventionCatalog(root);
      await mutate(root);
      vi.resetModules();
      vi.doMock("typescript", () => {
        throw new Error("build verification imported TypeScript");
      });
      const { verifyConventionBuildReceipt } =
        await import("../src/check-receipt");
      await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(error);
    },
    60_000
  );

  it.each([
    ["script", "d.ts", "ts"],
    ["ES module", "d.mts", "mts"],
    ["CommonJS module", "d.cts", "cts"],
  ] as const)(
    "rejects a %s implementation added beside an authorized declaration",
    async (_label, declarationExtension, implementationExtension) => {
      const root = await fixture();
      const declaration = `src/shadow.${declarationExtension}`;
      await writeFile(
        join(root, declaration),
        "export declare const shadow: number;\n"
      );
      const receipt = await proveConventionCatalog(root);
      expect(receipt.projects[0]?.rootFiles).toContain(declaration);

      await writeFile(
        join(root, `src/shadow.${implementationExtension}`),
        "export const shadow = 1;\n"
      );
      vi.resetModules();
      vi.doMock("typescript", () => {
        throw new Error("build verification imported TypeScript");
      });
      const { verifyConventionBuildReceipt } =
        await import("../src/check-receipt");
      await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
        /check-project source universe is stale/u
      );
    },
    60_000
  );
});
