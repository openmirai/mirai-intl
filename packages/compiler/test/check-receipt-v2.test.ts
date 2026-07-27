import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    dependencies: { vite: "8.1.4" },
    name: "@example/receipt-v2",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี",
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/page.ts"), "export const page = 1;\n");
  await writeJson(join(root, "tsconfig.base.json"), {
    compilerOptions: { strict: true },
  });
  await writeJson(join(root, "tsconfig.types.json"), {
    compilerOptions: { composite: true },
    files: [],
  });
  await writeJson(join(root, "tsconfig.json"), {
    extends: "./tsconfig.base.json",
    include: ["src/**/*.ts"],
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
    expect(
      first.projects[0]?.configManifest.map((entry) => entry.path)
    ).toEqual(["tsconfig.base.json", "tsconfig.json", "tsconfig.types.json"]);

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
});
