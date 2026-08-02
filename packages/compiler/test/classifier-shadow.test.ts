import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  classifyMiraiIntlModuleBoundariesShadow,
  hashMiraiIntlClassifierBoundariesShadow,
  miraiIntlClassifierDecisionVectorShadow,
} from "../src/transform";
import { canonicalJson } from "../src/canonical";

function hash(value: string | Uint8Array): `sha256:${string}` {
  const digest = createHash("sha256").update(value).digest("hex");
  return `sha256:${digest}`;
}

function hashV3(domain: string, payload: unknown): `sha256:${string}` {
  return hash(canonicalJson(["mirai-intl", domain, 3, payload]));
}

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

describe("classifier V3 Phase-B boundary shadow", () => {
  it("enumerates every static boundary form and fails conservative on nonliterals", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-boundary-shadow-"))
    );
    const sourcePath = join(root, "src/source.ts");
    const facadePath = join(root, "src/facade.d.ts");
    await write(facadePath, "export declare const value: string;\n");
    const source = [
      'import "./facade";',
      'import facade from "./facade";',
      'import * as facadeNamespace from "./facade";',
      'import { value } from "./facade";',
      'export { value as exported } from "./facade";',
      'import facadeEquals = require("./facade");',
      'type Facade = import("./facade");',
      'declare module "./facade" {}',
      'void import("./facade");',
      'void require("./facade");',
      "declare const name: string;",
      "void import(name);",
      "void require(name);",
      "void facade;",
      "void facadeNamespace;",
      "void facadeEquals;",
      "void (null as unknown as Facade);",
      "",
    ].join("\n");
    const result = await classifyMiraiIntlModuleBoundariesShadow(
      source,
      sourcePath,
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      root,
      facadePath
    );

    expect(result.boundaries.map(({ kind }) => kind)).toEqual([
      "import",
      "import",
      "import",
      "import",
      "export",
      "import-equals",
      "import-type",
      "module-declaration",
      "dynamic-import",
      "require",
    ]);
    expect(result.boundaries.map(({ ordinal }) => ordinal)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(result.unknownBoundaries).toMatchObject([
      {
        kind: "dynamic-import",
        observationOrdinal: 10,
        reason: "nonliteral-specifier",
      },
      {
        kind: "require",
        observationOrdinal: 11,
        reason: "nonliteral-specifier",
      },
    ]);
    expect(result.ambiguous).toBe(false);
    expect(result.decision).toBe("facade-present");
    expect(result.requiresProgram).toBe(true);
    expect(result.counters).toEqual({
      boundaries: 10,
      generatedFacadeBoundaries: 10,
      referenceRequests: 10,
      resolutionFailures: 0,
      unknownBoundaries: 2,
    });
    expect(
      result.requests.every(({ frontier }) => frontier.probes.length > 0)
    ).toBe(true);
    expect(new Set(result.boundaries.map(({ nodeKind }) => nodeKind))).toEqual(
      new Set(["StringLiteral"])
    );
    expect(Object.keys(result.ledger[0] ?? {}).toSorted()).toEqual([
      "kind",
      "observationOrdinal",
      "ordinal",
      "resolutionMode",
      "source",
      "specifier",
    ]);
    expect(
      result.ledger.map(({ observationOrdinal }) => observationOrdinal)
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.boundaryHashInput).toBe(
      canonicalJson(["mirai-intl", "boundary-ledger", 3, result.ledger])
    );
    expect(result.boundaryHash).toBe(hashV3("boundary-ledger", result.ledger));
    expect(
      hashV3("boundary-ledger", [
        { ...result.ledger[0], specifier: "./substituted" },
        ...result.ledger.slice(1),
      ])
    ).not.toBe(result.boundaryHash);
  });

  it("binds multibyte unknown slices and source-sorted decision vectors", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-boundary-vector-"))
    );
    const facadePath = join(root, "src/facade.d.ts");
    await write(facadePath, "export declare const value: string;\n");
    const unknownSource = 'const ไทย = "./facade"; void import(ไทย);\n';
    const unknown = await classifyMiraiIntlModuleBoundariesShadow(
      unknownSource,
      join(root, "src/z.ts"),
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      root,
      facadePath
    );
    const absent = await classifyMiraiIntlModuleBoundariesShadow(
      "export const value = 1;\n",
      join(root, "src/a.ts"),
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      root,
      facadePath
    );
    const observation = unknown.unknownBoundaries[0];
    expect(observation).toBeDefined();
    if (!observation) {
      throw new Error("Expected one unknown boundary");
    }
    const characterStart = unknownSource.indexOf("import");
    const characterEnd = characterStart + "import(ไทย)".length;
    const byteStart = Buffer.byteLength(
      unknownSource.slice(0, characterStart),
      "utf8"
    );
    const byteEnd = Buffer.byteLength(
      unknownSource.slice(0, characterEnd),
      "utf8"
    );
    const sourceSliceHash = hash(
      Buffer.from(unknownSource.slice(characterStart, characterEnd), "utf8")
    );
    expect(observation.byteStart).toBe(byteStart);
    expect(observation.byteEnd).toBe(byteEnd);
    expect(observation.sourceSliceHash).toBe(sourceSliceHash);
    const expectedNodeHash = hashV3("unknown-boundary-node", [
      observation.kind,
      observation.nodeKind,
      observation.observationOrdinal,
      observation.reason,
      observation.source,
      byteStart,
      byteEnd,
      sourceSliceHash,
    ]);
    expect(observation.nodeHash).toBe(expectedNodeHash);
    expect(Object.keys(observation).toSorted()).toEqual([
      "byteEnd",
      "byteStart",
      "kind",
      "nodeHash",
      "nodeKind",
      "observationOrdinal",
      "reason",
      "source",
      "sourceSliceHash",
    ]);
    expect(unknown.decision).toBe("facade-unknown-active");
    expect(unknown.requiresProgram).toBe(true);
    expect(unknown.ambiguous).toBe(false);
    expect(unknown.requests).toEqual([]);
    expect(unknown.generatedFacadeOrdinals).toEqual([]);
    expect(unknown).not.toHaveProperty("frontiers");
    expect(unknown).not.toHaveProperty("projections");
    expect(absent.decision).toBe("facade-absent");
    expect(absent.requiresProgram).toBe(false);
    expect(
      unknown.ledger.map(({ observationOrdinal }) => observationOrdinal)
    ).toEqual([0]);
    expect(unknown.boundaryHash).toBe(
      hashV3("boundary-ledger", unknown.ledger)
    );
    const mutatedSliceHash = hash(Buffer.from("import(other)", "utf8"));
    const mutatedNodeHash = hashV3("unknown-boundary-node", [
      observation.kind,
      observation.nodeKind,
      observation.observationOrdinal,
      observation.reason,
      observation.source,
      byteStart,
      byteEnd,
      mutatedSliceHash,
    ]);
    expect(mutatedSliceHash).not.toBe(sourceSliceHash);
    expect(mutatedNodeHash).not.toBe(expectedNodeHash);
    expect(
      hashV3("boundary-ledger", [
        {
          ...observation,
          nodeHash: mutatedNodeHash,
          sourceSliceHash: mutatedSliceHash,
        },
      ])
    ).not.toBe(unknown.boundaryHash);
    const vector = miraiIntlClassifierDecisionVectorShadow([unknown, absent]);
    expect(vector.vector).toEqual([
      [join(root, "src/a.ts"), false],
      [join(root, "src/z.ts"), true],
    ]);
    expect(vector.hash).toBe(hashV3("requires-program-vector", vector.vector));
    const substitutedVector = vector.vector.map(([source, requiresProgram]) =>
      source === join(root, "src/a.ts")
        ? ([source, !requiresProgram] as const)
        : ([source, requiresProgram] as const)
    );
    expect(hashV3("requires-program-vector", substitutedVector)).not.toBe(
      vector.hash
    );
  });

  it("keeps stored tuple ordinals contiguous when an unknown boundary comes first", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-boundary-ordinal-"))
    );
    const sourcePath = join(root, "src/source.ts");
    const facadePath = join(root, "src/facade.d.ts");
    await write(facadePath, "export declare const value: string;\n");
    const result = await classifyMiraiIntlModuleBoundariesShadow(
      [
        "declare const name: string;",
        "void import(name);",
        'import "./facade";',
        "",
      ].join("\n"),
      sourcePath,
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      root,
      facadePath
    );

    expect(result.unknownBoundaries).toMatchObject([
      { observationOrdinal: 0, reason: "nonliteral-specifier" },
    ]);
    expect(result.boundaries).toMatchObject([{ ordinal: 0 }]);
  });

  it("uses the domain-separated V3 boundary-ledger hash preimage", () => {
    const result = hashMiraiIntlClassifierBoundariesShadow([
      {
        kind: "import",
        observationOrdinal: 0,
        ordinal: 0,
        resolutionMode: "import",
        source: "/workspace/src/source.ts",
        specifier: "./facade",
      },
    ]);

    expect(result.preimage).toBe(
      '["mirai-intl","boundary-ledger",3,[{"kind":"import","observationOrdinal":0,"ordinal":0,"resolutionMode":"import","source":"/workspace/src/source.ts","specifier":"./facade"}]]'
    );
    expect(result.hash).toBe(hash(result.preimage));
  });

  it("fails conservative when a resolved target cannot be canonicalized", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-boundary-realpath-"))
    );
    const sourcePath = join(root, "src/source.ts");
    const facadePath = join(root, "src/facade.d.ts");
    await write(facadePath, "export declare const value: string;\n");
    const originalRealpath = ts.sys.realpath;
    let removed = false;
    const realpathSpy = vi
      .spyOn(ts.sys, "realpath")
      .mockImplementation((path) => {
        const target = originalRealpath?.(path) ?? path;
        if (!removed && target === facadePath) {
          removed = true;
          rmSync(facadePath);
        }
        return target;
      });
    try {
      await expect(
        classifyMiraiIntlModuleBoundariesShadow(
          'import "./facade";\n',
          sourcePath,
          {
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
          },
          root,
          facadePath
        )
      ).rejects.toThrow(
        "Provider resolution frontier changed while resolving ./facade"
      );
    } finally {
      realpathSpy.mockRestore();
    }
  });

  it.each([
    {
      extension: ".ts",
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    },
    {
      extension: ".tsx",
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    {
      extension: ".mts",
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
    {
      extension: ".cts",
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    },
    {
      extension: ".ts",
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  ])(
    "binds exact usage mode and source metadata for $extension/$moduleResolution",
    async ({ extension, module, moduleResolution }) => {
      const root = await realpath(
        await mkdtemp(join(tmpdir(), "mirai-intl-boundary-mode-"))
      );
      await write(
        join(root, "package.json"),
        '{"name":"@example/modes","type":"module"}\n'
      );
      const sourcePath = join(root, `src/source${extension}`);
      const facadePath = join(root, "src/facade.d.ts");
      await write(facadePath, "export interface Value {}\n");
      const result = await classifyMiraiIntlModuleBoundariesShadow(
        [
          'import type { Value } from "./facade.js";',
          'type Imported = import("./facade.js").Value;',
          "",
        ].join("\n"),
        sourcePath,
        { module, moduleResolution },
        root,
        facadePath
      );

      expect(result.boundaries).toHaveLength(2);
      let expectedImpliedNodeFormat: "default" | "import" | "require" =
        "import";
      if (moduleResolution === ts.ModuleResolutionKind.Bundler) {
        expectedImpliedNodeFormat = "default";
      } else if (extension === ".cts") {
        expectedImpliedNodeFormat = "require";
      }
      expect(
        result.boundaries.every(
          (boundary) =>
            boundary.sourceExtension === extension &&
            boundary.impliedNodeFormat === expectedImpliedNodeFormat
        )
      ).toBe(true);
      expect(result.requests).toHaveLength(2);
      expect(result.generatedFacadeOrdinals).toEqual([0, 1]);
    }
  );

  it("passes explicit import/require modes and advanced resolver options to TypeScript", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-boundary-options-"))
    );
    const sourcePath = join(root, "src/source.ts");
    const facadePath = join(root, "src/facade.d.ts");
    await write(
      join(root, "package.json"),
      JSON.stringify({
        exports: {
          "./facade": {
            "mirai-shadow": "./src/facade.d.ts",
            default: "./src/not-facade.d.ts",
          },
        },
        imports: { "#facade": "./src/facade.d.ts" },
        name: "@example/shadow-options",
        type: "module",
      })
    );
    await write(facadePath, "export interface Value {}\n");
    await write(
      join(root, "src/not-facade.d.ts"),
      "export interface Value {}\n"
    );
    const source = [
      'import type { Value as Imported } from "#facade" with { "resolution-mode": "import" };',
      'import type { Value as Required } from "#facade" with { "resolution-mode": "require" };',
      'import type { Value as Aliased } from "@facade";',
      'import type { Value as Exported } from "@example/shadow-options/facade";',
      "",
    ].join("\n");
    const options = {
      baseUrl: root,
      customConditions: ["mirai-shadow"],
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      moduleSuffixes: [".native", ""],
      paths: { "@facade": ["src/facade.d.ts"] },
      rootDirs: [join(root, "src"), join(root, "generated")],
    } satisfies ts.CompilerOptions;
    const first = await classifyMiraiIntlModuleBoundariesShadow(
      source,
      sourcePath,
      options,
      root,
      facadePath
    );
    const second = await classifyMiraiIntlModuleBoundariesShadow(
      source,
      sourcePath,
      options,
      root,
      facadePath
    );

    expect(
      first.boundaries.map(({ resolutionMode }) => resolutionMode)
    ).toEqual(["import", "require", "import", "import"]);
    expect(first.generatedFacadeOrdinals).toEqual([0, 1, 2, 3]);
    expect(first.requests[3]?.resolvedFileName).toBe(facadePath);
    expect(first.requests[3]?.frontier.controlFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: join(root, "package.json") }),
      ])
    );
    expect(first.boundaryHashInput).toBe(second.boundaryHashInput);
    expect(first.boundaryHash).toBe(second.boundaryHash);
    expect(
      first.requests.map(({ resolvedFileName }) => resolvedFileName)
    ).toEqual(second.requests.map(({ resolvedFileName }) => resolvedFileName));
    const defaultCondition = await classifyMiraiIntlModuleBoundariesShadow(
      source,
      sourcePath,
      { ...options, customConditions: [] },
      root,
      facadePath
    );
    expect(defaultCondition.generatedFacadeOrdinals).toEqual([0, 1, 2]);
    expect(defaultCondition.requests[3]?.resolvedFileName).toBe(
      join(root, "src/not-facade.d.ts")
    );

    const rootDirsFacade = join(root, "generated/nested/facade.d.ts");
    await write(rootDirsFacade, "export interface Value {}\n");
    const rootDirsResult = await classifyMiraiIntlModuleBoundariesShadow(
      'import type { Value } from "./facade.js";\n',
      join(root, "src/nested/source.ts"),
      options,
      root,
      rootDirsFacade
    );
    expect(rootDirsResult.generatedFacadeOrdinals).toEqual([0]);

    const suffixedFacade = join(root, "src/suffixed.native.ts");
    await write(suffixedFacade, "export interface Value {}\n");
    const suffixResult = await classifyMiraiIntlModuleBoundariesShadow(
      'import type { Value } from "./suffixed.js";\n',
      sourcePath,
      options,
      root,
      suffixedFacade
    );
    expect(suffixResult.generatedFacadeOrdinals).toEqual([0]);
  });
});
