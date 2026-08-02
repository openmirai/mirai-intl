import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyConventionBuildReceipt } from "../src/check-receipt";
import { proveConventionCatalog } from "../src/proof";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createWorkspace(): Promise<{
  appRoot: string;
  sharedSource: string;
  workspaceRoot: string;
}> {
  const workspaceRoot = await mkdtemp(
    join(tmpdir(), "mirai-intl-source-universe-")
  );
  const appRoot = join(workspaceRoot, "packages/app");
  const sharedSource = join(workspaceRoot, "packages/shared/src/copy.tsx");
  await writeFile(
    join(workspaceRoot, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n"
  );
  await writeJson(join(appRoot, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/app",
    version: "1.0.0",
  });
  await writeJson(join(appRoot, "src/locales/global/en.json"), {
    greeting: "Hello",
  });
  await writeJson(join(appRoot, "src/locales/global/th.json"), {
    greeting: "สวัสดี",
  });
  await mkdir(join(appRoot, "src"), { recursive: true });
  await writeFile(join(appRoot, "src/page.ts"), "export const page = 1;\n");
  await mkdir(join(sharedSource, ".."), { recursive: true });
  await writeFile(sharedSource, "export const shared = 1;\n");
  await writeJson(join(appRoot, "tsconfig.intl.json"), {
    include: ["src/**/*.ts", "../shared/src/**/*.tsx"],
  });
  await writeJson(join(appRoot, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.intl.json", role: "owner" }],
  });
  return { appRoot, sharedSource, workspaceRoot };
}

describe("owner TypeScript source universe authority", () => {
  it("rejects discovered eligible sources outside every owner project", async () => {
    const { appRoot, workspaceRoot } = await createWorkspace();
    try {
      const unowned = join(appRoot, "ignored/Unowned.tsx");
      await mkdir(join(unowned, ".."), { recursive: true });
      await writeFile(
        unowned,
        "export const Unowned = () => <div>Ignored prose</div>;\n"
      );

      await expect(proveConventionCatalog(appRoot)).rejects.toThrow(
        /packages\/app\/ignored\/Unowned\.tsx must have exactly one owner; found 0/u
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }, 60_000);

  it("analyzes and receipts every owner-tsconfig source, including workspace siblings", async () => {
    const { appRoot, sharedSource, workspaceRoot } = await createWorkspace();
    try {
      await writeFile(
        sharedSource,
        "export const Shared = () => <div>Untranslated shared prose</div>;\n"
      );
      await expect(proveConventionCatalog(appRoot)).rejects.toThrow(
        /source analysis failed with 1 diagnostic/u
      );

      await writeFile(sharedSource, "export const shared = 1;\n");
      await expect(proveConventionCatalog(appRoot)).resolves.toMatchObject({
        sources: [
          {
            file: "packages/app/src/page.ts",
            owner: "tsconfig.intl.json",
            verdict: "accepted",
          },
          {
            file: "packages/shared/src/copy.tsx",
            owner: "tsconfig.intl.json",
            verdict: "accepted",
          },
        ],
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }, 60_000);

  it("does not let a broad package include absorb siblings of an explicit external file", async () => {
    const { appRoot, sharedSource, workspaceRoot } = await createWorkspace();
    try {
      await writeJson(join(appRoot, "tsconfig.intl.json"), {
        include: ["**/*.ts", "../shared/src/copy.tsx"],
      });
      await writeFile(
        join(dirname(sharedSource), "unrelated.ts"),
        'export const prose = "not part of this project";\n'
      );

      const receipt = await proveConventionCatalog(appRoot);
      expect(receipt.sources.map(({ file }) => file)).not.toContain(
        "packages/shared/src/unrelated.ts"
      );
      await expect(
        verifyConventionBuildReceipt(appRoot)
      ).resolves.toMatchObject({
        buildReceiptVerifications: 1,
        buildSemanticAnalysisRuns: 0,
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }, 60_000);
});
