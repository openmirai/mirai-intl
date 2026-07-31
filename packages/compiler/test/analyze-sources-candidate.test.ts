import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import type { LoadedConventionCatalog } from "../src/catalog";
import { sha256 } from "../src/canonical";
import { createMiraiIntlClassifierWorkspaceTransactionV3 } from "../src/classifier-candidate";
import type {
  MiraiIntlSemanticBatchObservation,
  MiraiIntlSemanticEvidence,
} from "../src/transform";

const transformBatch = vi.hoisted(() => vi.fn());

vi.mock("../src/transform", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    transformMiraiIntlOwnerBatch: transformBatch,
  };
});

import {
  analyzeLoadedConventionSourceFiles,
  loadConventionSourceSnapshots,
} from "../src/analyze-sources";

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing analysis test fixture ${label}`);
  }
  return value;
}

describe("approved classifier production analysis", () => {
  it("sends only proven-present and unknown-active sources to semantic Programs", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-filtered-analysis-"))
    );
    const generatedDirectory = "generated";
    await write(join(root, "package.json"), '{"name":"analysis-test"}\n');
    await write(
      join(root, generatedDirectory, "index.ts"),
      "export declare function t(key: string): string;\n"
    );
    await write(join(root, "other.ts"), "export const other = 1;\n");
    const ownerCompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    } satisfies ts.CompilerOptions;
    const sourceFiles = [
      {
        absolute: join(root, "absent.ts"),
        file: "absent.ts",
        owner: "tsconfig.json",
        ownerCompilerOptions,
      },
      {
        absolute: join(root, "present.ts"),
        file: "present.ts",
        owner: "tsconfig.json",
        ownerCompilerOptions,
      },
      {
        absolute: join(root, "unknown.ts"),
        file: "unknown.ts",
        owner: "tsconfig.json",
        ownerCompilerOptions,
      },
    ];
    const [absent, present, unknown] = sourceFiles;
    if (!absent || !present || !unknown) {
      throw new Error("Classifier analysis fixture omitted a source");
    }
    await write(absent.absolute, 'import "./other";\n');
    await write(
      present.absolute,
      'import { t } from "./generated";\nt("key");\n'
    );
    await write(
      unknown.absolute,
      "declare const target: string;\nimport(target);\n"
    );
    const prepared = await loadConventionSourceSnapshots(sourceFiles);
    const loaded = {
      checkExceptions: [],
    } as unknown as LoadedConventionCatalog;
    transformBatch.mockImplementation(
      async (
        sources: ReadonlyArray<{
          authorizationEvidence: Readonly<{
            record(evidence: MiraiIntlSemanticEvidence): void;
            workspaceRoot: string;
          }>;
          id: string;
          source: string;
        }>,
        _options: unknown,
        observe?: (observation: MiraiIntlSemanticBatchObservation) => void
      ) => {
        observe?.({
          fallbackFiles: 0,
          fallbackPrograms: 0,
          sharedFiles: sources.length,
          sharedPrograms: sources.length === 0 ? 0 : 1,
        });
        return sources.map((source) => {
          const sourcePath = relative(root, source.id).replaceAll("\\", "/");
          const sourceHash = sha256(source.source);
          source.authorizationEvidence.record({
            ambientTypeFileLimit: 16,
            closureHash: sha256(`${sourcePath}:${sourceHash}`),
            declarations: [],
            libs: [],
            providerBudgetExceeded: false,
            providerRootLimit: 64,
            providers: [],
            source: sourcePath,
            sourceHash,
            unsupportedProviderResolutionOptions: [],
          });
          return { id: source.id, result: null };
        });
      }
    );

    const unfiltered = await analyzeLoadedConventionSourceFiles(
      loaded,
      root,
      generatedDirectory,
      sourceFiles,
      root,
      { classifier: { mode: "safe-unfiltered" } },
      prepared
    );
    const transaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(root);
    const filtered = await analyzeLoadedConventionSourceFiles(
      loaded,
      root,
      generatedDirectory,
      sourceFiles,
      root,
      { classifier: { mode: "approved", transaction } },
      prepared
    );

    expect(transformBatch.mock.calls[0]?.[0]).toHaveLength(3);
    expect(transformBatch.mock.calls[1]?.[0]).toHaveLength(2);
    expect(
      filtered.classifierProgramFiles.map((path) => relative(root, path))
    ).toEqual(["present.ts", "unknown.ts"]);
    expect(filtered.classifierAuthorities).toEqual(
      (await transaction.finalize()).authorities
    );
    expect(filtered.diagnostics).toEqual(unfiltered.diagnostics);
    expect(filtered.evidence).toEqual(
      unfiltered.evidence.filter(({ source }) => source !== "absent.ts")
    );
    expect(filtered.filesAnalyzed).toBe(unfiltered.filesAnalyzed);

    const manySources = Array.from({ length: 80 }, (_, index) => ({
      absolute: join(root, `many-${index}.ts`),
      file: `many-${index}.ts`,
      owner: `tsconfig.${index % 3}.json`,
      ownerCompilerOptions,
    }));
    await Promise.all(
      manySources.map(({ absolute }) =>
        write(absolute, 'import "./generated";\n')
      )
    );
    const manyPrepared = await loadConventionSourceSnapshots(manySources);
    const manyTransaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(root);
    const observations: Array<MiraiIntlSemanticBatchObservation> = [];
    const many = await analyzeLoadedConventionSourceFiles(
      loaded,
      root,
      generatedDirectory,
      manySources,
      root,
      {
        classifier: { mode: "approved", transaction: manyTransaction },
        semanticBatchObserver: (_owner, observation) =>
          observations.push(observation),
      },
      manyPrepared
    );
    expect(many.classifierProgramFiles).toHaveLength(80);
    expect(observations).toHaveLength(3);
    expect(
      observations.reduce(
        (programs, observation) => programs + observation.sharedPrograms,
        0
      )
    ).toBe(3);
  });

  it("rejects a structurally counterfeit approved transaction", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-counterfeit-analysis-"))
    );
    const generatedDirectory = "generated";
    await write(join(root, "package.json"), '{"name":"analysis-test"}\n');
    await write(join(root, generatedDirectory, "index.ts"), "export {};\n");
    const ownerCompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    } satisfies ts.CompilerOptions;
    const sourceFiles = [
      {
        absolute: join(root, "source.ts"),
        file: "source.ts",
        owner: "tsconfig.json",
        ownerCompilerOptions,
      },
    ];
    await write(
      required(sourceFiles[0], "counterfeit source").absolute,
      "export {};\n"
    );
    const prepared = await loadConventionSourceSnapshots(sourceFiles);
    const loaded = {
      checkExceptions: [],
    } as unknown as LoadedConventionCatalog;
    const real = await createMiraiIntlClassifierWorkspaceTransactionV3(root);
    const counterfeit = {
      authorize: real.authorize,
      finalize: real.finalize,
      workspaceRoot: real.workspaceRoot,
    };
    await expect(
      analyzeLoadedConventionSourceFiles(
        loaded,
        root,
        generatedDirectory,
        sourceFiles,
        root,
        { classifier: { mode: "approved", transaction: counterfeit } },
        prepared
      )
    ).rejects.toThrow("Unapproved");
  });

  it("rejects duplicate prepared source paths", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-duplicate-analysis-"))
    );
    const ownerCompilerOptions = {} satisfies ts.CompilerOptions;
    const sourceFiles = [
      {
        absolute: join(root, "source.ts"),
        file: "source.ts",
        owner: "tsconfig.json",
        ownerCompilerOptions,
      },
    ];
    await write(
      required(sourceFiles[0], "duplicate source").absolute,
      "export {};\n"
    );
    const [prepared] = await loadConventionSourceSnapshots(sourceFiles);
    await expect(
      analyzeLoadedConventionSourceFiles(
        { checkExceptions: [] } as unknown as LoadedConventionCatalog,
        root,
        "generated",
        [...sourceFiles, required(sourceFiles[0], "duplicate source")],
        root,
        {},
        [
          required(prepared, "prepared duplicate source"),
          required(prepared, "prepared duplicate source"),
        ]
      )
    ).rejects.toThrow("Duplicate Mirai Intl source path");
  });
});
