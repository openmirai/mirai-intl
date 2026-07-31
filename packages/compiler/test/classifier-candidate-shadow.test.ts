import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { GeneratedFacadeProjectionProofKindV3 } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/canonical";
import {
  buildMiraiIntlCandidateCheckpointShadow,
  createMiraiIntlPreparedCandidateSourceFile,
  hashMiraiIntlClassifierProjectOptionsV3,
} from "../src/classifier-candidate-shadow";
import { classifyMiraiIntlModuleBoundariesShadow } from "../src/transform";

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

describe("classifier V3 candidate-index shadow", () => {
  it("reuses only an exact prepared syntax tree and preserves fallback parity", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-prepared-classifier-"))
    );
    const facade = join(root, "generated/index.ts");
    const id = join(root, "source.ts");
    const source = 'import "./generated";\n';
    await write(join(root, "package.json"), '{"name":"prepared"}\n');
    await write(facade, "export const value = 1;\n");
    await write(id, source);
    const options = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    } satisfies ts.CompilerOptions;
    const preparedSourceFile = createMiraiIntlPreparedCandidateSourceFile(
      id,
      source,
      options
    );
    const preparedObservations: Array<string> = [];
    const prepared = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "production-proof",
      generatedFacadePath: facade,
      options,
      owner: "tsconfig.json",
      sources: [{ id, preparedSourceFile, source }],
      sourceObserver: (mode) => preparedObservations.push(mode),
      workspaceRoot: root,
    });
    expect(preparedObservations).toEqual(["prepared", "prepared"]);

    const fallbackObservations: Array<string> = [];
    const fallback = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "production-proof",
      generatedFacadePath: facade,
      options,
      owner: "tsconfig.json",
      sources: [{ id, source }],
      sourceObserver: (mode) => fallbackObservations.push(mode),
      workspaceRoot: root,
    });
    expect(fallbackObservations).toEqual(["parsed", "parsed"]);
    expect(prepared.sources).toEqual(fallback.sources);
    expect(prepared.index).toEqual(fallback.index);
    expect(prepared.referenceRequiresProgramVector).toEqual(
      fallback.referenceRequiresProgramVector
    );
    const unbound = ts.createSourceFile(
      id,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    await expect(
      buildMiraiIntlCandidateCheckpointShadow({
        executionMode: "production-proof",
        generatedFacadePath: facade,
        options,
        owner: "tsconfig.json",
        sources: [{ id, preparedSourceFile: unbound, source }],
        workspaceRoot: root,
      })
    ).rejects.toThrow("prepared classifier source binding");

    const mutated = createMiraiIntlPreparedCandidateSourceFile(
      id,
      source,
      options
    );
    (
      mutated.statements as ts.NodeArray<ts.Statement> & Array<ts.Statement>
    ).splice(0, 1);
    await expect(
      buildMiraiIntlCandidateCheckpointShadow({
        executionMode: "production-proof",
        generatedFacadePath: facade,
        options,
        owner: "tsconfig.json",
        sources: [{ id, preparedSourceFile: mutated, source }],
        workspaceRoot: root,
      })
    ).rejects.toThrow("prepared classifier source AST mutated");

    const textMutated = createMiraiIntlPreparedCandidateSourceFile(
      id,
      source,
      options
    );
    const importDeclaration = textMutated.statements.find(
      ts.isImportDeclaration
    );
    if (
      !importDeclaration ||
      !ts.isStringLiteralLike(importDeclaration.moduleSpecifier)
    ) {
      throw new Error("Prepared classifier mutation fixture was not parsed");
    }
    (
      importDeclaration.moduleSpecifier as ts.StringLiteralLike & {
        text: string;
      }
    ).text = "./other";
    await expect(
      buildMiraiIntlCandidateCheckpointShadow({
        executionMode: "production-proof",
        generatedFacadePath: facade,
        options,
        owner: "tsconfig.json",
        sources: [{ id, preparedSourceFile: textMutated, source }],
        workspaceRoot: root,
      })
    ).rejects.toThrow("prepared classifier source AST mutated");
  });

  it("uses proof-first precedence and resolves only conservative candidates", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-proof-first-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    const other = join(root, "src/other.ts");
    await write(
      join(root, "package.json"),
      JSON.stringify({
        exports: { "./generated": "./src/i18n/generated/index.ts" },
        imports: { "#generated": "./src/i18n/generated/index.ts" },
        name: "@mirai/proof-first",
      })
    );
    await write(facade, "export const value = 1;\n");
    await write(other, "export const other = 1;\n");
    const options = {
      baseUrl: root,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: { "@/*": ["src/*"] },
    } satisfies ts.CompilerOptions;
    const source = [
      'import "./other";',
      'import "./i18n/generated";',
      `import ${JSON.stringify(facade)};`,
      'import "#generated";',
      'export * from "@mirai/proof-first/generated";',
      'import "@/i18n/generated";',
      'import "unmapped-external";',
      "",
    ].join("\n");
    const base = {
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options,
      owner: "tsconfig.json",
      sources: [{ id: join(root, "src/source.ts"), source }],
      workspaceRoot: root,
    } as const;
    const production = await buildMiraiIntlCandidateCheckpointShadow({
      ...base,
      executionMode: "production-proof",
    });
    const qualification = await buildMiraiIntlCandidateCheckpointShadow({
      ...base,
      executionMode: "qualification-cached-reference",
    });

    expect(production.ownerMode).toBe("filtered");
    expect(production.candidateSet).toEqual([1, 2, 3, 4, 5]);
    expect(production.resolverCounters.resolverCalls).toBe(5);
    expect(production.sources[0]?.requests).toHaveLength(5);
    expect(production.index.barePackageProofs).toEqual([
      expect.objectContaining({
        boundary: 4,
        resolvedFileName: facade,
        status: "candidate",
      }),
      expect.objectContaining({ boundary: 5, status: "candidate" }),
      {
        boundary: 6,
        controlFiles: [],
        packageName: null,
        packageVersion: null,
        resolvedFileName: null,
        resolverFrontierHash: production.index.resolverFrontierHash,
        status: "proven-disjoint",
      },
    ]);
    expect(production.referenceFacadeSet).toEqual(
      qualification.referenceFacadeSet
    );
    expect(production.referenceRequiresProgramVector).toEqual(
      qualification.referenceRequiresProgramVector
    );
    expect(
      production.index.projections.map(({ boundary, proofKind }) => [
        boundary,
        proofKind,
      ])
    ).toEqual([
      [0, GeneratedFacadeProjectionProofKindV3.RELATIVE_DIRECT],
      [1, GeneratedFacadeProjectionProofKindV3.RELATIVE_DIRECT],
      [2, GeneratedFacadeProjectionProofKindV3.ABSOLUTE_DIRECT],
      [3, GeneratedFacadeProjectionProofKindV3.PACKAGE_IMPORTS],
      [4, GeneratedFacadeProjectionProofKindV3.FACADE_PACKAGE_EXPORT],
      [5, GeneratedFacadeProjectionProofKindV3.TSCONFIG_PATHS],
      [6, GeneratedFacadeProjectionProofKindV3.TSCONFIG_BASE_URL],
    ]);
  });

  it("forces every source into the Program on owner fallback without rewriting decisions", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-proof-fallback-"))
    );
    const facade = join(root, "generated/index.ts");
    await write(join(root, "package.json"), '{"name":"fallback"}\n');
    await write(facade, "export const value = 1;\n");
    await write(join(root, "other.ts"), "export const other = 1;\n");
    const result = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "production-proof",
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Node10,
      },
      owner: "tsconfig.json",
      sources: [
        { id: join(root, "absent.ts"), source: 'import "./other";\n' },
        { id: join(root, "present.ts"), source: 'import "./generated";\n' },
      ],
      workspaceRoot: root,
    });

    expect(result.ownerMode).toBe("owner-fallback");
    expect(result.candidateSet).toEqual([0, 1]);
    expect(result.resolverCounters.resolverCalls).toBe(2);
    expect(result.sources.map(({ decision }) => decision)).toEqual([
      "facade-absent",
      "facade-present",
    ]);
    expect(result.optimizedRequiresProgramVector).toEqual([
      [join(root, "absent.ts"), true],
      [join(root, "present.ts"), true],
    ]);
    expect(result.referenceRequiresProgramVector).toEqual(
      result.optimizedRequiresProgramVector
    );
  });

  it("freezes filtered owner mode and preserves exact reference parity", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-shadow-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    await write(
      join(root, "package.json"),
      '{"name":"@mirai/i18n","exports":{"./*":"./src/*"}}\n'
    );
    await write(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await write(facade, "export const value = 1;\n");
    await write(join(root, "src/other.ts"), "export const other = 1;\n");
    const options = {
      baseUrl: root,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      paths: {
        "@/*": ["src/*"],
        "@mirai/i18n/*": ["src/*"],
      },
    } satisfies ts.CompilerOptions;
    const result = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options,
      owner: "tsconfig.json",
      sources: [
        {
          id: join(root, "src/a.ts"),
          source: [
            'import "@/other";',
            'import "@/i18n/generated";',
            'import "@mirai/i18n/i18n/generated";',
            "",
          ].join("\n"),
        },
      ],
      workspaceRoot: root,
    });
    const reference = await classifyMiraiIntlModuleBoundariesShadow(
      [
        'import "@/other";',
        'import "@/i18n/generated";',
        'import "@mirai/i18n/i18n/generated";',
        "",
      ].join("\n"),
      join(root, "src/a.ts"),
      options,
      root,
      facade
    );

    expect(result.ownerMode).toBe("filtered");
    expect(result.sources[0]?.boundaryHash).toBe(reference.boundaryHash);
    expect(result.sources[0]?.decision).toBe(reference.decision);
    expect(result.sources[0]?.generatedFacadeOrdinals).toEqual(
      reference.generatedFacadeOrdinals
    );
    expect(
      result.sources[0]?.requests.map(
        ({ resolvedFileName }) => resolvedFileName
      )
    ).toEqual(
      reference.requests.map(({ resolvedFileName }) => resolvedFileName)
    );
    expect(result.referenceFacadeSet).toEqual([1, 2]);
    expect(result.candidateSet).toEqual([1, 2]);
    expect(result.optimizedFacadeSet).toEqual(result.referenceFacadeSet);
    expect(result.optimizedRequiresProgramVectorHash).toBe(
      result.referenceRequiresProgramVectorHash
    );
    expect(result.falseNegatives).toBe(0);
    expect(result.falsePositives).toBe(0);
    expect(result.checkpointAHash).toMatch(/^sha256:[a-f\d]{64}$/u);
    expect(result.index.activeConditions).toEqual([
      "import",
      "require",
      "types",
    ]);
    expect(result.index.optionsHash).toBe(
      sha256(
        canonicalJson([
          "mirai-intl",
          "project-normalized-options",
          3,
          ["tsconfig.json", { ...options, baseUrl: "" }],
        ])
      )
    );
    expect(
      hashMiraiIntlClassifierProjectOptionsV3("other.json", options, root)
    ).not.toBe(result.index.optionsHash);
    expect(result.index.controls.map(({ path }) => path)).toEqual([
      join(root, "package.json"),
      join(root, "pnpm-lock.yaml"),
    ]);
    expect(result.index.projections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ boundary: 0, status: "disjoint" }),
        expect.objectContaining({ boundary: 1, status: "candidate" }),
      ])
    );
  });

  it("uses the live package imports map and active custom conditions", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-imports-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    await write(
      join(root, "package.json"),
      JSON.stringify({
        imports: {
          "#facade": {
            "mirai-shadow": "./src/i18n/generated/index.ts",
            default: "./src/other.ts",
          },
          "#other": "./src/other.ts",
        },
        name: "@mirai/i18n",
      })
    );
    await write(facade, "export const value = 1;\n");
    await write(join(root, "src/other.ts"), "export const other = 1;\n");
    const result = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        customConditions: ["mirai-shadow"],
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      owner: "tsconfig.json",
      sources: [
        {
          id: join(root, "src/a.ts"),
          source: 'import "#facade";\nimport "#other";\n',
        },
      ],
      workspaceRoot: root,
    });

    expect(result.ownerMode).toBe("filtered");
    expect(result.candidateSet).toEqual([0]);
    expect(result.referenceFacadeSet).toEqual([0]);
    expect(result.index.activeConditions).toContain("mirai-shadow");
    expect(result.index.packageScopes).toEqual([
      expect.objectContaining({ manifestPath: join(root, "package.json") }),
    ]);
  });

  it("binds bare-package disjointness to its complete package frontier", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-bare-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    await write(facade, "export const value = 1;\n");
    await write(
      join(root, "node_modules/other/package.json"),
      JSON.stringify({
        name: "other",
        types: "index.d.ts",
        version: "1.0.0",
      })
    );
    await write(
      join(root, "node_modules/other/index.d.ts"),
      "export declare const other: string;\n"
    );
    const result = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      owner: "tsconfig.json",
      sources: [{ id: join(root, "src/a.ts"), source: 'import "other";\n' }],
      workspaceRoot: root,
    });

    expect(result.candidateSet).toEqual([]);
    expect(result.index.barePackageProofs).toEqual([
      expect.objectContaining({
        packageName: "other",
        packageVersion: "1.0.0",
        status: "proven-disjoint",
      }),
    ]);
    expect(
      result.index.barePackageProofs[0]?.controlFiles.map(({ path }) => path)
    ).toContain(join(root, "node_modules/other/package.json"));
    expect(result.index.barePackageProofs[0]?.resolverFrontierHash).toBe(
      result.index.resolverFrontierHash
    );
  });

  it("matches uncached evidence across cache keys and invalidates on manifest mutation", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-cache-parity-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    const imported = join(root, "src/imported.d.ts");
    const required = join(root, "src/required.d.ts");
    await write(facade, "export interface Facade {}\n");
    await write(imported, "export interface Value {}\n");
    await write(required, "export interface Value {}\n");
    await write(
      join(root, "package.json"),
      JSON.stringify({
        imports: {
          "#facade": "./src/i18n/generated/index.ts",
          "#mode": {
            import: "./src/imported.d.ts",
            require: "./src/required.d.ts",
          },
        },
        name: "@mirai/cache-parity",
      })
    );
    const source = [
      'import type { Facade } from "#facade";',
      'import type { Value as Imported } from "#mode" with { "resolution-mode": "import" };',
      'import type { Value as Required } from "#mode" with { "resolution-mode": "require" };',
      "",
    ].join("\n");
    const base = {
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
      owner: "tsconfig.json",
      sources: [{ id: join(root, "src/a.ts"), source }],
      workspaceRoot: root,
    } as const;
    const cached = await buildMiraiIntlCandidateCheckpointShadow(base);
    const uncached = await buildMiraiIntlCandidateCheckpointShadow({
      ...base,
      executionMode: "qualification-uncached-reference",
    });

    expect(cached.sources[0]?.boundaryHash).toBe(
      uncached.sources[0]?.boundaryHash
    );
    expect(
      cached.sources[0]?.requests.map(
        ({ resolvedFileName }) => resolvedFileName
      )
    ).toEqual(
      uncached.sources[0]?.requests.map(
        ({ resolvedFileName }) => resolvedFileName
      )
    );
    expect(cached.referenceFacadeSet).toEqual(uncached.referenceFacadeSet);
    expect(cached.referenceRequiresProgramVector).toEqual(
      uncached.referenceRequiresProgramVector
    );
    expect(cached.resolverCounters.resolverCalls).toBe(3);
    expect(cached.resolverFrontier.controlFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: join(root, "package.json") }),
      ])
    );

    await write(
      join(root, "package.json"),
      JSON.stringify({
        imports: {
          "#facade": "./src/imported.d.ts",
          "#mode": {
            import: "./src/required.d.ts",
            require: "./src/imported.d.ts",
          },
        },
        name: "@mirai/cache-parity",
      })
    );
    const mutated = await buildMiraiIntlCandidateCheckpointShadow(base);
    expect(mutated.index.indexHash).not.toBe(cached.index.indexHash);
    expect(mutated.referenceFacadeSet).toEqual([]);
    expect(mutated.resolverFrontier.controlFiles).not.toEqual(
      cached.resolverFrontier.controlFiles
    );
  });

  it.each([
    {
      manifest: {
        exports: {
          ".": ["./src/i18n/generated/index.ts", "./src/other.ts"],
        },
        name: "@mirai/i18n",
      },
      reason: "package-exports-ambiguous",
      source: 'import "./other";\n',
    },
    {
      manifest: {
        imports: { "#facade": 42 },
        name: "@mirai/i18n",
      },
      reason: "package-imports-ambiguous",
      source: 'import "#facade";\n',
    },
  ])(
    "freezes the owner for malformed package maps: $reason",
    async ({ manifest, reason, source }) => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "mirai-intl-candidate-malformed-"))
      );
      const facade = join(root, "src/i18n/generated/index.ts");
      await write(join(root, "package.json"), JSON.stringify(manifest));
      await write(facade, "export const value = 1;\n");
      await write(join(root, "src/other.ts"), "export const other = 1;\n");
      const result = await buildMiraiIntlCandidateCheckpointShadow({
        executionMode: "qualification-cached-reference",
        generatedFacadePath: facade,
        options: {
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
        owner: "tsconfig.json",
        sources: [{ id: join(root, "src/a.ts"), source }],
        workspaceRoot: root,
      });

      expect(result.ownerMode).toBe("owner-fallback");
      expect(result.index.reasons).toContain(reason);
      expect(result.candidateRequests).toBe(result.referenceBoundaries);
    }
  );

  it("invalidates negative topology evidence when a nearer manifest appears", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-topology-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    const sourcePath = join(root, "src/nested/a.ts");
    await write(
      join(root, "package.json"),
      JSON.stringify({
        imports: { "#facade": "./src/i18n/generated/index.ts" },
        name: "@mirai/i18n",
      })
    );
    await write(facade, "export const value = 1;\n");
    const input = {
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      owner: "tsconfig.json",
      sources: [{ id: sourcePath, source: 'import "#facade";\n' }],
      workspaceRoot: root,
    } as const;
    const before = await buildMiraiIntlCandidateCheckpointShadow(input);
    const negativeManifest = before.index.packageTopology.find(
      ({ manifest }) => manifest.path === join(root, "src/nested/package.json")
    );
    expect(negativeManifest?.manifest.kind).toBe("absent");

    await write(
      join(root, "src/nested/package.json"),
      JSON.stringify({ imports: { "#facade": "../other.ts" } })
    );
    await write(join(root, "src/other.ts"), "export const other = 1;\n");
    const after = await buildMiraiIntlCandidateCheckpointShadow(input);

    expect(after.index.indexHash).not.toBe(before.index.indexHash);
    expect(after.referenceFacadeSet).toEqual([]);
    expect(after.candidateSet).toEqual([]);
  });

  it.each([false, true])(
    "binds pnpm-style symlink topology with preserveSymlinks=$preserveSymlinks",
    async (preserveSymlinks) => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "mirai-intl-candidate-symlink-"))
      );
      const storedPackage = join(root, ".pnpm/store/pkg");
      const linkedPackage = join(root, "packages/pkg");
      const facade = join(root, "src/i18n/generated/index.ts");
      await write(
        join(storedPackage, "package.json"),
        JSON.stringify({
          imports: { "#facade": "../../../src/i18n/generated/index.ts" },
          name: "pkg",
        })
      );
      await write(join(storedPackage, "src/a.ts"), 'import "#facade";\n');
      await mkdir(join(root, "packages"), { recursive: true });
      await symlink(storedPackage, linkedPackage, "dir");
      await write(facade, "export const value = 1;\n");
      const result = await buildMiraiIntlCandidateCheckpointShadow({
        executionMode: "qualification-cached-reference",
        generatedFacadePath: facade,
        options: {
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          preserveSymlinks,
        },
        owner: "tsconfig.json",
        sources: [
          {
            id: join(linkedPackage, "src/a.ts"),
            source: 'import "#facade";\n',
          },
        ],
        workspaceRoot: root,
      });

      expect(result.ownerMode).toBe("owner-fallback");
      expect(result.index.reasons).toContain("symlink-boundary-ambiguous");
      expect(result.index.reasons.includes("preserve-symlinks")).toBe(
        preserveSymlinks
      );
      expect(
        result.index.packageTopology.some(
          ({ root: topologyRoot }) => topologyRoot.kind === "symlink"
        )
      ).toBe(true);
    }
  );

  it.each([
    {
      options: { preserveSymlinks: true },
      reason: "preserve-symlinks",
    },
    {
      options: { moduleResolution: ts.ModuleResolutionKind.Classic },
      reason: "unsupported-module-resolution",
    },
    {
      options: { moduleSuffixes: [".native"] },
      reason: "path-projection-ambiguous",
    },
  ])("freezes owner-wide fallback for $reason", async ({ options, reason }) => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-fallback-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    await write(facade, "export const value = 1;\n");
    await write(join(root, "src/other.ts"), "export const other = 1;\n");
    const result = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        ...options,
      },
      owner: "tsconfig.json",
      sources: [
        {
          id: join(root, "src/a.ts"),
          source: 'import "./other";\n',
        },
      ],
      workspaceRoot: root,
    });

    expect(result.ownerMode).toBe("owner-fallback");
    expect(result.index.reasons).toContain(reason);
    expect(result.candidateRequests).toBe(result.referenceBoundaries);
    expect(
      result.index.projections.every(({ status }) => status === "candidate")
    ).toBe(true);
    expect(
      result.index.barePackageProofs.every(
        ({ status }) => status === "candidate"
      )
    ).toBe(true);
  });

  it("freezes late projection-symlink fallback before deriving statuses and source order", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-late-symlink-"))
    );
    const facade = join(root, "generated/index.ts");
    await write(join(root, "package.json"), '{"name":"late-symlink"}\n');
    await write(facade, "export const value = 1;\n");
    await write(join(root, "src/other.ts"), "export const other = 1;\n");
    await symlink(join(root, "src"), join(root, "alias"), "dir");
    const sources = [
      { id: join(root, "src/a.ts"), source: 'import "@/other.ts";\n' },
      { id: join(root, "src/b.ts"), source: 'import "late-symlink";\n' },
    ];
    const input = {
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        baseUrl: root,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        paths: { "@/*": ["alias/*"] },
      },
      owner: "tsconfig.json",
      sources,
      workspaceRoot: root,
    } satisfies Parameters<typeof buildMiraiIntlCandidateCheckpointShadow>[0];
    const forward = await buildMiraiIntlCandidateCheckpointShadow(input);
    const reversed = await buildMiraiIntlCandidateCheckpointShadow({
      ...input,
      sources: sources.toReversed(),
    });

    expect(forward.ownerMode).toBe("owner-fallback");
    expect(forward.index.reasons).toContain("symlink-boundary-ambiguous");
    expect(
      forward.index.projections.every(({ status }) => status === "candidate")
    ).toBe(true);
    expect(
      forward.index.barePackageProofs.every(
        ({ status }) => status === "candidate"
      )
    ).toBe(true);
    expect(reversed.artifactHash).toBe(forward.artifactHash);
    expect(reversed.index.indexHash).toBe(forward.index.indexHash);
  });

  it("is deterministic and stores only portable lstat fields", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-stable-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    await write(facade, "export const value = 1;\n");
    const input = {
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      owner: "tsconfig.json",
      sources: [
        {
          id: join(root, "src/a.ts"),
          source: 'import "./i18n/generated";\n',
        },
      ],
      workspaceRoot: root,
    } as const;
    const first = await buildMiraiIntlCandidateCheckpointShadow(input);
    const second = await buildMiraiIntlCandidateCheckpointShadow(input);

    expect(first.index.indexHash).toBe(second.index.indexHash);
    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.checkpointAHash).toBe(second.checkpointAHash);
    expect(first.referenceRequiresProgramVector).toEqual(
      second.referenceRequiresProgramVector
    );
    expect(first.index.lstats[0]).not.toHaveProperty("ino");
    expect(first.index.lstats[0]).not.toHaveProperty("mode");
    expect(first.index.lstats[0]).not.toHaveProperty("size");
  });

  it("keeps unknown-active source-local without owner fallback or requests", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-candidate-unknown-"))
    );
    const facade = join(root, "src/i18n/generated/index.ts");
    await write(facade, "export const value = 1;\n");
    const result = await buildMiraiIntlCandidateCheckpointShadow({
      executionMode: "qualification-cached-reference",
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      owner: "tsconfig.json",
      sources: [
        {
          id: join(root, "src/a.ts"),
          source: "declare const name: string; void import(name);\n",
        },
      ],
      workspaceRoot: root,
    });
    expect(result.ownerMode).toBe("filtered");
    expect(result.referenceBoundaries).toBe(0);
    expect(result.candidateRequests).toBe(0);
    expect(result.index.projections).toEqual([]);
    expect(result.unknownBoundaries).toBe(1);
    expect(result.falseNegatives).toBe(0);
    expect(result.falsePositives).toBe(0);
    expect(result.sources[0]?.decision).toBe("facade-unknown-active");
    expect(result.optimizedRequiresProgramVectorHash).toBe(
      result.referenceRequiresProgramVectorHash
    );
  });
});
