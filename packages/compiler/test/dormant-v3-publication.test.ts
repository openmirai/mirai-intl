import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  conventionCheckReceiptSelectorPath,
  readConventionCheckReceipt,
  verifyConventionBuildReceipt,
} from "../src/check-receipt";
import {
  authorizeConventionCatalog,
  verifyConventionCheckReceipt,
} from "../src/proof";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createConventionApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-dormant-v3-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { "@example/provider": "1.0.0", vite: "8.1.4" },
    name: "@example/dormant-v3",
    version: "1.0.0",
  });
  await writeJson(join(root, "node_modules/@example/provider/package.json"), {
    exports: { ".": "./index.js" },
    name: "@example/provider",
    types: "./index.d.ts",
    version: "1.0.0",
  });
  await writeFile(
    join(root, "node_modules/@example/provider/index.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await writeJson(join(root, "src/locales/global/en.json"), {
    group: { greeting: "Hello" },
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    group: { greeting: "สวัสดี" },
  });
  await writeFile(
    join(root, "src/page.ts"),
    [
      'import { key } from "@example/provider";',
      'import { useTranslations } from "x";',
      'const translations = useTranslations("group");',
      "export const page = translations.t(key);",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(join(root, "src/quiet.ts"), "export const quiet = 1;\n");
  await writeJson(join(root, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

const authorityDirectories = [
  "receipts/v2",
  "receipts/v3",
  "classifiers/v3",
  "sets/v1",
] as const;

async function authorityObjects(
  root: string
): Promise<ReadonlyArray<Readonly<{ bytes: string; path: string }>>> {
  const entries = await Promise.all(
    authorityDirectories.map(async (directory) => {
      const absolute = join(root, ".mirai-intl/authority", directory);
      const names = await readdir(absolute);
      return Promise.all(
        names.map(async (name) => ({
          bytes: await readFile(join(absolute, name), "utf8"),
          path: `${directory}/${name}`,
        }))
      );
    })
  );
  return entries
    .flat()
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

describe("dormant V3 authority publication", () => {
  it("keeps exact V2 authority active and makes repeated publication an inode-stable no-op", async () => {
    const root = await createConventionApp();
    try {
      await authorizeConventionCatalog(root, {
        collectEnvironment: false,
        dormantV3: true,
      });

      const [immutableV2Name] = await readdir(
        join(root, ".mirai-intl/authority/receipts/v2")
      );
      expect(immutableV2Name).toBeDefined();
      const immutableV2Bytes = await readFile(
        join(
          root,
          ".mirai-intl/authority/receipts/v2",
          immutableV2Name as string
        ),
        "utf8"
      );
      expect(JSON.parse(immutableV2Bytes)).toMatchObject({ schemaVersion: 2 });
      await expect(
        readFile(join(root, ".mirai-intl/check-receipt.v3.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      const selectorPath = conventionCheckReceiptSelectorPath(root);
      const selectorBytes = await readFile(selectorPath, "utf8");
      expect(JSON.parse(selectorBytes)).toMatchObject({ schemaVersion: 2 });
      await expect(verifyConventionCheckReceipt(root)).resolves.toBeDefined();

      const before = await Promise.all(
        (await authorityObjects(root)).map(async ({ bytes, path }) => {
          const metadata = await stat(
            join(root, ".mirai-intl/authority", path)
          );
          return { bytes, ino: metadata.ino, mtimeMs: metadata.mtimeMs, path };
        })
      );
      await expect(
        authorizeConventionCatalog(root, {
          collectEnvironment: false,
          dormantV3: true,
          dormantV3PublicationBoundary(boundary) {
            if (boundary === "selector-renamed") {
              throw new Error("post-commit observer failed");
            }
          },
        })
      ).resolves.toBeDefined();
      const after = await Promise.all(
        (await authorityObjects(root)).map(async ({ bytes, path }) => {
          const metadata = await stat(
            join(root, ".mirai-intl/authority", path)
          );
          return { bytes, ino: metadata.ino, mtimeMs: metadata.mtimeMs, path };
        })
      );
      expect(after).toEqual(before);
      expect(await readFile(selectorPath, "utf8")).toBe(selectorBytes);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 120_000);

  it("leaves the prior selector valid across every pre-commit interruption and corrupt-object failure", async () => {
    const root = await createConventionApp();
    try {
      await authorizeConventionCatalog(root, {
        collectEnvironment: false,
        dormantV3: true,
      });
      const selectorPath = conventionCheckReceiptSelectorPath(root);
      const selectorBytes = await readFile(selectorPath, "utf8");
      const boundaries = [
        "v2-receipt-installed",
        "v2-set-installed",
        "v3-authority-installed",
        "v3-receipt-installed",
        "v3-set-installed",
        "before-selector-rename",
      ] as const;
      for (const interrupted of boundaries) {
        await expect(
          authorizeConventionCatalog(root, {
            collectEnvironment: false,
            dormantV3: true,
            dormantV3PublicationBoundary(boundary) {
              if (boundary === interrupted) {
                throw new Error(`interrupted at ${boundary}`);
              }
            },
          })
        ).rejects.toThrow(`interrupted at ${interrupted}`);
        expect(await readFile(selectorPath, "utf8")).toBe(selectorBytes);
        await expect(verifyConventionCheckReceipt(root)).resolves.toBeDefined();
      }
      await expect(
        authorizeConventionCatalog(root, {
          collectEnvironment: false,
          dormantV3: true,
          dormantV3PublicationDeadlineMs: 100,
          dormantV3PublicationNow: () => 100,
        })
      ).rejects.toThrow("publication deadline expired");
      expect(await readFile(selectorPath, "utf8")).toBe(selectorBytes);

      const facadePath = join(root, "src/i18n/generated/index.ts");
      const facadeBytes = await readFile(facadePath, "utf8");
      let mutatedFacade = false;
      await expect(
        authorizeConventionCatalog(root, {
          collectEnvironment: false,
          dormantV3: true,
          async dormantV3PublicationBoundary(boundary) {
            if (boundary === "before-selector-rename" && !mutatedFacade) {
              mutatedFacade = true;
              await writeFile(facadePath, `${facadeBytes}\n`, "utf8");
            }
          },
        })
      ).rejects.toThrow(/classifier|facade|mutated|receipt identities/u);
      expect(mutatedFacade).toBe(true);
      expect(await readFile(selectorPath, "utf8")).toBe(selectorBytes);
      await writeFile(facadePath, facadeBytes, "utf8");

      const packageRootAlias = `${root}-publisher-symlink`;
      await symlink(root, packageRootAlias);
      try {
        await expect(
          authorizeConventionCatalog(packageRootAlias, {
            collectEnvironment: false,
            dormantV3: true,
          })
        ).rejects.toThrow("non-symlink directory");
      } finally {
        await rm(packageRootAlias, { force: true });
      }

      for (const parent of [
        ".mirai-intl",
        ".mirai-intl/authority",
        ".mirai-intl/authority/receipts",
        ".mirai-intl/authority/receipts/v3",
        ".mirai-intl/authority/classifiers",
        ".mirai-intl/authority/classifiers/v3",
        ".mirai-intl/authority/sets",
        ".mirai-intl/authority/sets/v1",
      ]) {
        const directory = join(root, parent);
        const backup = `${directory}.publisher-test-backup`;
        const external = await mkdtemp(
          join(tmpdir(), "mirai-intl-external-target-")
        );
        await rename(directory, backup);
        await symlink(external, directory);
        try {
          await expect(
            authorizeConventionCatalog(root, {
              collectEnvironment: false,
              dormantV3: true,
            })
          ).rejects.toThrow("non-symlink directory");
          expect(await readdir(external)).toEqual([]);
        } finally {
          await rm(directory, { force: true });
          await rename(backup, directory);
          await rm(external, { force: true, recursive: true });
        }
      }
      expect(await readFile(selectorPath, "utf8")).toBe(selectorBytes);

      const [authority] = await readdir(
        join(root, ".mirai-intl/authority/classifiers/v3")
      );
      expect(authority).toBeDefined();
      const authorityPath = join(
        root,
        ".mirai-intl/authority/classifiers/v3",
        authority as string
      );
      const authorityBytes = await readFile(authorityPath, "utf8");
      await writeFile(authorityPath, `${authorityBytes} `, "utf8");
      await expect(
        authorizeConventionCatalog(root, {
          collectEnvironment: false,
          dormantV3: true,
        })
      ).rejects.toThrow("immutable object is corrupt");
      expect(await readFile(selectorPath, "utf8")).toBe(selectorBytes);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 180_000);

  it("selects V3 in production and live-verifies classifier-skipped sources", async () => {
    const root = await createConventionApp();
    try {
      const authorization = await authorizeConventionCatalog(root, {
        collectEnvironment: false,
      });
      expect(authorization.receipt.schemaVersion).toBe(3);
      await expect(readConventionCheckReceipt(root)).resolves.toMatchObject({
        receipt: { schemaVersion: 3 },
        selection: "authority-set",
      });
      await expect(verifyConventionBuildReceipt(root)).resolves.toMatchObject({
        buildReceiptVerifications: 1,
        buildSemanticAnalysisRuns: 0,
        receipt: { schemaVersion: 3 },
      });
      await writeFile(join(root, "src/quiet.ts"), "export const quiet = 2;\n");
      await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
        /stale|corrupt|invalid/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 120_000);

  it("produces byte-identical portable authority DAGs under different checkout roots", async () => {
    const left = await createConventionApp();
    const right = await createConventionApp();
    try {
      await authorizeConventionCatalog(left, {
        collectEnvironment: false,
        dormantV3: true,
      });
      await authorizeConventionCatalog(right, {
        collectEnvironment: false,
        dormantV3: true,
      });
      expect(await authorityObjects(right)).toEqual(
        await authorityObjects(left)
      );
      expect(
        await readFile(conventionCheckReceiptSelectorPath(right), "utf8")
      ).toBe(await readFile(conventionCheckReceiptSelectorPath(left), "utf8"));
    } finally {
      await Promise.all([
        rm(left, { force: true, recursive: true }),
        rm(right, { force: true, recursive: true }),
      ]);
    }
  }, 120_000);
});
