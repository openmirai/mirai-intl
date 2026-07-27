import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as AnalyzeSources from "../src/analyze-sources";
import type * as Compile from "../src/compile";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instrumentation = vi.hoisted(() => ({
  analysisCalls: 0,
  compileCalls: 0,
  mutateAfterAnalysis: undefined as undefined | (() => Promise<void>),
}));

vi.mock("../src/compile", async (importOriginal) => {
  const actual = await importOriginal<typeof Compile>();
  return {
    ...actual,
    compileCatalog: (
      ...arguments_: Parameters<typeof actual.compileCatalog>
    ) => {
      instrumentation.compileCalls += 1;
      return actual.compileCatalog(...arguments_);
    },
  };
});

vi.mock("../src/analyze-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyzeSources>();
  return {
    ...actual,
    analyzeConventionSourceFiles: async (
      ...arguments_: Parameters<typeof actual.analyzeConventionSourceFiles>
    ) => {
      instrumentation.analysisCalls += 1;
      const result = await actual.analyzeConventionSourceFiles(...arguments_);
      await instrumentation.mutateAfterAnalysis?.();
      return result;
    },
  };
});

import { canonicalJson } from "../src/canonical";
import { verifyConventionCatalog } from "../src/catalog";
import {
  authorizeConventionCatalog,
  conventionCheckReceiptPath,
  verifyConventionCheckReceipt,
} from "../src/proof";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createConventionApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-snapshot-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/snapshot",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี",
  });
  await writeFile(join(root, "src/page.ts"), "export const page = 1;\n");
  await writeJson(join(root, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

describe("compiler-owned catalog snapshots", () => {
  beforeEach(() => {
    instrumentation.analysisCalls = 0;
    instrumentation.compileCalls = 0;
    instrumentation.mutateAfterAnalysis = undefined;
  });

  it("reuses the ensure snapshot and preserves receipt, report, and artifact bytes", async () => {
    const root = await createConventionApp();
    try {
      const authorization = await authorizeConventionCatalog(root, {
        collectEnvironment: false,
      });

      // Phase 1 removes the generation/report/verification recompiles. Source
      // analysis still owns one independent catalog load until Phase 2.
      expect(instrumentation.compileCalls).toBe(3);
      expect(instrumentation.analysisCalls).toBe(1);
      expect(await readFile(conventionCheckReceiptPath(root), "utf8")).toBe(
        `${canonicalJson(authorization.receipt)}\n`
      );

      const independent = await verifyConventionCatalog(root, {
        collectEnvironment: false,
      });
      expect(authorization.verification.report).toEqual(independent.report);
      expect(authorization.verification.write).toEqual(independent.write);

      instrumentation.analysisCalls = 0;
      await expect(verifyConventionCheckReceipt(root)).resolves.toEqual(
        authorization.receipt
      );
      expect(instrumentation.analysisCalls).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects catalog mutation across the independently reloaded receipt-after barrier", async () => {
    const root = await createConventionApp();
    try {
      instrumentation.mutateAfterAnalysis = async () => {
        await writeJson(join(root, "src/locales/global/en.json"), {
          greeting: "Changed during analysis",
        });
      };

      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow("Generated artifacts are stale");
      await expect(
        readFile(conventionCheckReceiptPath(root), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(instrumentation.compileCalls).toBe(3);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
