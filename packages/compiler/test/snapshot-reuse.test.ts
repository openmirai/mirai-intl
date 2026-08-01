import type NodeFsPromises from "node:fs/promises";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as AnalyzeSources from "../src/analyze-sources";
import type * as Compile from "../src/compile";
import type * as ProviderResolutionIdentity from "../src/provider-resolution-identity";
import type ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const instrumentation = vi.hoisted(() => ({
  analysisCalls: 0,
  compileCalls: 0,
  frontierCaptureCalls: 0,
  frontierInputs: 0,
  frontierMutation: undefined as
    | undefined
    | ((
        workspaceRoot: string,
        resolution: Awaited<
          ReturnType<
            typeof ProviderResolutionIdentity.captureProviderResolutionFrontier
          >
        >
      ) => Promise<void>),
  frontierMutationProbe: undefined as
    | undefined
    | Readonly<{ kind: "directory" | "file"; path: string }>,
  uniqueFrontierInputs: 0,
  mutateAfterAnalysis: undefined as undefined | (() => Promise<void>),
  programs: 0,
  projectConfigReadsDuringAnalysis: 0,
  projectConfigReads: 0,
  sourceParses: new Map<string, number>(),
  sourceReads: new Map<string, number>(),
  trackedRoot: undefined as string | undefined,
  trackSourceIo: false,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    async readFile(...arguments_: Parameters<typeof actual.readFile>) {
      const path = String(arguments_[0]).replaceAll("\\", "/");
      if (
        instrumentation.trackSourceIo &&
        /\/src\/(?:other|page)\.ts$/u.test(path)
      ) {
        const reads = (instrumentation.sourceReads.get(path) ?? 0) + 1;
        instrumentation.sourceReads.set(path, reads);
      }
      if (
        instrumentation.trackSourceIo &&
        path ===
          `${instrumentation.trackedRoot?.replaceAll("\\", "/")}/tsconfig.json`
      ) {
        instrumentation.projectConfigReads += 1;
      }
      return Reflect.apply(actual.readFile, actual, arguments_);
    },
  };
});

vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const compiler = Reflect.get(actual, "default") as typeof ts;
  const instrumented = Object.create(compiler) as typeof compiler;
  Object.defineProperty(instrumented, "createProgram", {
    value: (...arguments_: Parameters<typeof compiler.createProgram>) => {
      instrumentation.programs += 1;
      return compiler.createProgram(...arguments_);
    },
  });
  Object.defineProperty(instrumented, "createSourceFile", {
    value: (...arguments_: Parameters<typeof compiler.createSourceFile>) => {
      const path = String(arguments_[0]).replaceAll("\\", "/");
      if (
        instrumentation.trackSourceIo &&
        /\/src\/(?:other|page)\.ts$/u.test(path)
      ) {
        instrumentation.sourceParses.set(
          path,
          (instrumentation.sourceParses.get(path) ?? 0) + 1
        );
      }
      return compiler.createSourceFile(...arguments_);
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

vi.mock("../src/provider-resolution-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof ProviderResolutionIdentity>();
  return {
    ...actual,
    async captureProviderResolutionFrontier(
      ...arguments_: Parameters<typeof actual.captureProviderResolutionFrontier>
    ) {
      const resolution = await actual.captureProviderResolutionFrontier(
        ...arguments_
      );
      instrumentation.frontierCaptureCalls += 1;
      instrumentation.frontierMutationProbe ??= resolution.probes.find(
        (probe) => !probe.present
      );
      if (
        instrumentation.frontierMutation &&
        instrumentation.frontierCaptureCalls ===
          instrumentation.uniqueFrontierInputs
      ) {
        await instrumentation.frontierMutation(arguments_[0], resolution);
      }
      return resolution;
    },
  };
});

vi.mock("../src/analyze-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyzeSources>();
  return {
    ...actual,
    analyzeLoadedConventionSourceFiles: async (
      ...arguments_: Parameters<
        typeof actual.analyzeLoadedConventionSourceFiles
      >
    ) => {
      instrumentation.analysisCalls += 1;
      const configReadsBefore = instrumentation.projectConfigReads;
      const result = await actual.analyzeLoadedConventionSourceFiles(
        ...arguments_
      );
      instrumentation.projectConfigReadsDuringAnalysis +=
        instrumentation.projectConfigReads - configReadsBefore;
      const frontierInputs = result.evidence.flatMap((entry) =>
        entry.providers.flatMap((provider) => provider.resolutions)
      );
      instrumentation.frontierInputs = frontierInputs.length;
      instrumentation.uniqueFrontierInputs = new Set(
        frontierInputs.map((input) => JSON.stringify(input))
      ).size;
      await instrumentation.mutateAfterAnalysis?.();
      return result;
    },
  };
});

import { verifyConventionCatalog } from "../src/catalog";
import { conventionCheckReceiptSelectorPath } from "../src/check-receipt";
import {
  authorizeConventionCatalog,
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
    dependencies: { "@example/provider": "1.0.0", vite: "8.1.4" },
    name: "@example/snapshot",
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
  await writeFile(
    join(root, "src/other.ts"),
    [
      'import { key } from "@example/provider";',
      'import { useTranslations } from "x";',
      'const translations = useTranslations("group");',
      "export const other = translations.t(key);",
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
    readFile(conventionCheckReceiptSelectorPath(root), "utf8")
  ).rejects.toMatchObject({ code: "ENOENT" });
}

describe("compiler-owned catalog snapshots", () => {
  beforeEach(() => {
    instrumentation.analysisCalls = 0;
    instrumentation.compileCalls = 0;
    instrumentation.frontierCaptureCalls = 0;
    instrumentation.frontierInputs = 0;
    instrumentation.frontierMutation = undefined;
    instrumentation.frontierMutationProbe = undefined;
    instrumentation.uniqueFrontierInputs = 0;
    instrumentation.mutateAfterAnalysis = undefined;
    instrumentation.programs = 0;
    instrumentation.projectConfigReadsDuringAnalysis = 0;
    instrumentation.projectConfigReads = 0;
    instrumentation.sourceParses.clear();
    instrumentation.sourceReads.clear();
    instrumentation.trackSourceIo = false;
    instrumentation.trackedRoot = undefined;
  });

  it("reuses the ensure snapshot and preserves receipt, report, and artifact bytes", async () => {
    const root = await createConventionApp();
    try {
      const authorization = await authorizeConventionCatalog(root, {
        collectEnvironment: false,
      });

      // Authorization reuses the ensured compilation. Its final uncached
      // generation-input identity and committed payload-manifest audit do not
      // need to compile the same catalog a second time.
      expect(instrumentation.compileCalls).toBe(1);
      expect(instrumentation.analysisCalls).toBe(1);
      await expect(
        readFile(conventionCheckReceiptSelectorPath(root), "utf8")
      ).resolves.toContain('"schemaVersion":2');

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

  it("seals each source once and reuses one parsed SourceFile through analysis", async () => {
    const root = await createConventionApp();
    instrumentation.trackSourceIo = true;
    instrumentation.trackedRoot = await realpath(root);
    try {
      await authorizeConventionCatalog(root, { collectEnvironment: false });

      // Source text is parsed once. Two byte reads cover initial sealing and
      // the single complete receipt-bound publication pass. The classifier
      // hashes the sealed bytes and delegates its repeated live-source reads
      // to that commit-last publication barrier.
      expect([...instrumentation.sourceReads.values()].toSorted()).toEqual([
        2, 2,
      ]);
      expect([...instrumentation.sourceParses.values()].toSorted()).toEqual([
        1, 1,
      ]);
      expect(instrumentation.projectConfigReads).toBeGreaterThan(0);
      // Project config bytes follow the same initial-seal plus commit-last
      // publication-barrier ownership as source bytes.
      expect(instrumentation.projectConfigReadsDuringAnalysis).toBe(2);
    } finally {
      instrumentation.trackSourceIo = false;
      instrumentation.trackedRoot = undefined;
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("captures each transaction-local provider frontier once plus one final live recheck", async () => {
    const root = await createConventionApp();
    try {
      await authorizeConventionCatalog(root, { collectEnvironment: false });

      expect(instrumentation.frontierInputs).toBeGreaterThan(
        instrumentation.uniqueFrontierInputs
      );
      expect(instrumentation.uniqueFrontierInputs).toBeGreaterThan(0);
      expect(instrumentation.frontierCaptureCalls).toBe(
        instrumentation.uniqueFrontierInputs
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects a provider frontier mutation after the memoized capture pass", async () => {
    const root = await createConventionApp();
    instrumentation.frontierMutation = async (workspaceRoot) => {
      await expectReceiptRemoved(root);
      const probe = instrumentation.frontierMutationProbe;
      if (!probe) {
        throw new Error("Fixture did not expose a missing frontier probe");
      }
      const file = join(workspaceRoot, probe.path);
      if (probe.kind === "directory") {
        await mkdir(file, { recursive: true });
      } else {
        await mkdir(join(file, ".."), { recursive: true });
        await writeFile(file, "export {};\n", "utf8");
      }
      instrumentation.frontierMutation = undefined;
    };
    try {
      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow(
        /provider resolution frontier is stale|classifier proof frontier mutated/u
      );
      await expectReceiptRemoved(root);
    } finally {
      instrumentation.frontierMutation = undefined;
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
      // The complete publication barrier rejects the mutation without
      // compiling the generated catalog a second time.
      expect(instrumentation.compileCalls).toBe(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects a provider package control mutation after semantic resolution", async () => {
    const root = await createConventionApp();
    try {
      instrumentation.mutateAfterAnalysis = async () => {
        await writeJson(
          join(root, "node_modules/@example/provider/package.json"),
          {
            exports: { ".": "./alternate.js" },
            name: "@example/provider",
            types: "./index.d.ts",
            version: "1.0.0",
          }
        );
      };

      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow(
        /provider resolution frontier is stale \(control\)|classifier proof frontier mutated/u
      );
      await expectReceiptRemoved(root);
    } finally {
      instrumentation.mutateAfterAnalysis = undefined;
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects a source mutation after its earlier final hash but before publication", async () => {
    const root = await createConventionApp();
    try {
      await expect(
        authorizeConventionCatalog(root, {
          beforePublicationBarrier: () =>
            writeFile(
              join(root, "src/page.ts"),
              "export const page = 3;\n",
              "utf8"
            ),
          collectEnvironment: false,
        })
      ).rejects.toThrow(
        "Mirai Intl source inputs changed while source analysis ran"
      );
      await expectReceiptRemoved(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects invalid UTF-8 source bytes and writes no receipt", async () => {
    const root = await createConventionApp();
    try {
      await writeFile(join(root, "src/page.ts"), Buffer.from([0x80]));
      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow("must contain valid UTF-8");
      await expectReceiptRemoved(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects a valid source replaced with invalid UTF-8 before publication", async () => {
    const root = await createConventionApp();
    try {
      instrumentation.mutateAfterAnalysis = async () => {
        await writeFile(join(root, "src/page.ts"), Buffer.from([0x80]));
      };
      await expect(
        authorizeConventionCatalog(root, { collectEnvironment: false })
      ).rejects.toThrow("must contain valid UTF-8");
      await expectReceiptRemoved(root);
    } finally {
      instrumentation.mutateAfterAnalysis = undefined;
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it.each([
    [
      "insertion",
      async (root: string) => {
        await writeFile(join(root, "src/late-marker.txt"), "late\n", "utf8");
      },
    ],
    [
      "deletion",
      async (root: string) => {
        await rm(join(root, "src/ledger-marker.txt"));
      },
    ],
    [
      "case-only rename",
      async (root: string) => {
        await rename(
          join(root, "src/ledger-marker.txt"),
          join(root, "src/LEDGER-MARKER.txt")
        );
      },
    ],
    [
      "symlink replacement",
      async (root: string) => {
        const marker = join(root, "src/ledger-marker.txt");
        await rm(marker);
        await symlink(join(root, "package.json"), marker);
      },
    ],
  ] as const)(
    "rejects a non-source directory-ledger %s and writes no receipt",
    async (_label, mutate) => {
      const root = await createConventionApp();
      await writeFile(join(root, "src/ledger-marker.txt"), "sealed\n", "utf8");
      instrumentation.mutateAfterAnalysis = () => mutate(root);
      try {
        await expect(
          authorizeConventionCatalog(root, { collectEnvironment: false })
        ).rejects.toThrow(
          "Mirai Intl filesystem transaction ledger changed while source analysis ran"
        );
        await expectReceiptRemoved(root);
      } finally {
        instrumentation.mutateAfterAnalysis = undefined;
        await rm(root, { force: true, recursive: true });
      }
    },
    60_000
  );

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
        "Mirai Intl generated catalog changed while source analysis ran"
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
      ).rejects.toThrow(
        "Selected generated artifact directory does not match its destination files: catalog.contract.gen.json is corrupt"
      );
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
