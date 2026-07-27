import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as AnalyzeSources from "../src/analyze-sources";
import type * as Compile from "../src/compile";
import type * as TypeScript from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instrumentation = vi.hoisted(() => ({
  analysisCalls: 0,
  compileCalls: 0,
  mutateAfterAnalysis: undefined as undefined | (() => Promise<void>),
  programs: 0,
}));

vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<typeof TypeScript>();
  const compiler = actual.default;
  const instrumented = Object.create(compiler) as typeof compiler;
  Object.defineProperty(instrumented, "createProgram", {
    value: (...arguments_: Parameters<typeof compiler.createProgram>) => {
      instrumentation.programs += 1;
      return compiler.createProgram(...arguments_);
    },
  });
  return { ...actual, default: instrumented };
});

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
  writeProvisionalBuildProof,
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
  await writeFile(
    join(root, "src/page.ts"),
    [
      'import { useTranslations } from "x";',
      "const translations = useTranslations();",
      'export const page = translations.t("greeting");',
      "",
    ].join("\n"),
    "utf8"
  );
  await writeJson(join(root, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

async function expectReceiptRemoved(root: string): Promise<void> {
  await expect(
    readFile(conventionCheckReceiptPath(root), "utf8")
  ).rejects.toMatchObject({ code: "ENOENT" });
}

describe("compiler-owned catalog snapshots", () => {
  beforeEach(() => {
    instrumentation.analysisCalls = 0;
    instrumentation.compileCalls = 0;
    instrumentation.mutateAfterAnalysis = undefined;
    instrumentation.programs = 0;
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
      expect(instrumentation.programs).toBeGreaterThan(0);
      instrumentation.programs = 0;
      await expect(verifyConventionCheckReceipt(root)).resolves.toEqual(
        authorization.receipt
      );
      const artifactRoot = join(root, "dist");
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(join(artifactRoot, "entry.js"), "export {};\n", "utf8");
      await expect(
        writeProvisionalBuildProof(root, artifactRoot, "client", [
          { path: "entry.js" },
        ])
      ).resolves.toMatchObject({
        state: "provisional",
        target: "client",
      });
      expect(instrumentation.analysisCalls).toBe(0);
      expect(instrumentation.programs).toBe(0);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects TypeScript source mutation during analysis and removes the receipt", async () => {
    const root = await createConventionApp();
    try {
      instrumentation.mutateAfterAnalysis = async () => {
        await writeFile(
          join(root, "src/page.ts"),
          "export const page = 2;\n",
          "utf8"
        );
      };

      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow(
        "Mirai Intl source inputs changed while source analysis ran"
      );
      await expectReceiptRemoved(root);
      expect(instrumentation.compileCalls).toBe(3);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects check-project config mutation during analysis and removes the receipt", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "tsconfig.after.json"), {
        include: ["src/**/*.ts"],
      });
      instrumentation.mutateAfterAnalysis = async () => {
        await writeJson(join(root, "mirai-intl.config.json"), {
          checkProjects: [{ path: "tsconfig.after.json", role: "owner" }],
        });
      };

      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow(
        "Mirai Intl inputs changed before receipt authorization"
      );
      await expectReceiptRemoved(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects generated artifact mutation during analysis and removes the receipt", async () => {
    const root = await createConventionApp();
    try {
      instrumentation.mutateAfterAnalysis = async () => {
        const selector = JSON.parse(
          await readFile(join(root, "src/i18n/generated/current.json"), "utf8")
        ) as { directory: string };
        await writeFile(
          join(
            root,
            "src/i18n/generated",
            selector.directory,
            "catalog.contract.gen.json"
          ),
          "{}\n",
          "utf8"
        );
      };

      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow(/Current artifact set .* does not match/u);
      await expectReceiptRemoved(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("returns the same default environment-aware verification as an independent check", async () => {
    const root = await createConventionApp();
    try {
      await writeFile(
        join(root, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n\n  .:\n    dependencies: {}\n",
        "utf8"
      );
      const authorization = await authorizeConventionCatalog(root);
      const independent = await verifyConventionCatalog(root);

      expect(authorization.verification).toEqual(independent);
      expect(authorization.verification.report.environment).not.toBeNull();
      expect(authorization.verification.report.authoritative).toBe(
        independent.report.authoritative
      );
      expect(Object.keys(authorization.verification)).toEqual([
        "report",
        "valid",
        "write",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
