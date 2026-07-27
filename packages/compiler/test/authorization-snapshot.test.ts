import type {
  IntlCheckReceiptV1,
  IntlCheckReceiptV2,
  RuntimeAbi,
  Sha256,
} from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import {
  buildIntlCheckReceiptV2,
  buildSourceAuthorizationSnapshot,
  parseCanonicalIntlCheckReceiptV2,
  parseIntlCheckReceiptV2,
  parseSourceAuthorizationSnapshot,
} from "../src/authorization-snapshot";
import type { SourceAuthorizationSnapshotInput } from "../src/authorization-snapshot";
import { canonicalHash, canonicalJson, sha256 } from "../src/canonical";

function hash(label: string): Sha256 {
  return sha256(label);
}

function file(path: string) {
  return { hash: hash(path), path };
}

function packageIdentity(name: string) {
  return {
    name,
    packageHash: hash(`${name}:package`),
    packageManifestHash: hash(`${name}:manifest`),
    version: "1.0.0",
  };
}

function input(): SourceAuthorizationSnapshotInput {
  return {
    application: {
      packageManifest: file("package.json"),
      workspaceLockfile: file("pnpm-lock.yaml"),
    },
    artifactAbi: "mirai-intl-artifact-v2",
    compilerManifest: [file("proof.ts"), file("analyze-sources.ts")],
    exceptions: [
      {
        file: "src/excepted.ts",
        nodeHash: hash("excepted-node"),
        reason: "Reviewed product copy",
        rule: "hardcoded-literal",
      },
    ],
    generationReceiptHash: hash("generation-receipt"),
    icu: packageIdentity("@formatjs/icu-messageformat-parser"),
    projects: [
      {
        configManifest: [
          {
            extends: [],
            hash: hash("tsconfig-owner"),
            path: "tsconfig.json",
            references: [],
          },
        ],
        normalizedOptions: { module: "ESNext", strict: true },
        path: "tsconfig.json",
        role: "owner",
        rootFiles: ["src/excepted.ts", "src/main.ts"],
      },
      {
        configManifest: [
          {
            extends: ["tsconfig.json"],
            hash: hash("tsconfig-checker"),
            path: "config/tsconfig.check.json",
            references: [],
          },
        ],
        normalizedOptions: { noEmit: true },
        path: "config/tsconfig.check.json",
        role: "checker",
        rootFiles: [],
      },
    ],
    providerClosures: ["src/main.ts", "src/excepted.ts"].map((source) => ({
      ambientTypeFileLimit: 10,
      declarations: [file(`types/${source.replaceAll("/", "-")}.d.ts`)],
      libs: [file("node_modules/typescript/lib/lib.es2024.d.ts")],
      providerBudgetExceeded: false as const,
      providerRootLimit: 4,
      providers: [
        {
          declarations: [file("types/provider.d.ts")],
          kind: "workspace" as const,
          root: "types",
        },
      ],
      source,
    })),
    runtimeAbi: "1.0.0" as RuntimeAbi,
    sources: [
      {
        file: "src/main.ts",
        hash: hash("main"),
        owner: "tsconfig.json",
        verdict: "accepted",
      },
      {
        file: "src/excepted.ts",
        hash: hash("excepted"),
        owner: "tsconfig.json",
        verdict: "exception",
      },
    ],
    typescript: {
      libs: [file("node_modules/typescript/lib/lib.es2024.d.ts")],
      package: packageIdentity("typescript"),
    },
  };
}

function receipt(): IntlCheckReceiptV2 {
  return buildIntlCheckReceiptV2(buildSourceAuthorizationSnapshot(input()));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mutatePrimitive(value: unknown): unknown {
  if (typeof value === "string") {
    return SHA256_PATTERN.test(value) ? hash(`mutated:${value}`) : `${value}-x`;
  }
  if (typeof value === "number") {
    return value + 1;
  }
  if (typeof value === "boolean") {
    return !value;
  }
  return value;
}

const SHA256_PATTERN = /^sha256:[\da-f]{64}$/u;

function primitivePaths(
  value: unknown,
  path: ReadonlyArray<string | number> = []
): Array<ReadonlyArray<string | number>> {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [path];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      primitivePaths(entry, [...path, index])
    );
  }
  if (typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      key === "sourceAuthorizationHash"
        ? []
        : primitivePaths(entry, [...path, key])
    );
  }
  return [];
}

function mutateAtPath(
  value: unknown,
  path: ReadonlyArray<string | number>
): void {
  let current = value as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    current = current[key] as Record<string | number, unknown>;
  }
  const leaf = path.at(-1);
  if (leaf === undefined) {
    throw new Error("Mutation path must not be empty");
  }
  current[leaf] = mutatePrimitive(current[leaf]);
}

function withFreshAuthorizationHash<T extends object>(
  value: T
): Omit<T, "sourceAuthorizationHash"> & { sourceAuthorizationHash: Sha256 } {
  const { sourceAuthorizationHash: _old, ...base } = value as T & {
    sourceAuthorizationHash: unknown;
  };
  return { ...base, sourceAuthorizationHash: canonicalHash(base) };
}

describe("source authorization snapshots", () => {
  it("canonically sorts complete inputs and derives every counter and hash", () => {
    const snapshot = buildSourceAuthorizationSnapshot(input());
    expect(snapshot.projects.map((project) => project.path)).toEqual([
      "config/tsconfig.check.json",
      "tsconfig.json",
    ]);
    expect(snapshot.sources.map((source) => source.file)).toEqual([
      "src/excepted.ts",
      "src/main.ts",
    ]);
    expect(snapshot.providerClosures.map((closure) => closure.source)).toEqual([
      "src/excepted.ts",
      "src/main.ts",
    ]);
    expect(snapshot.counters).toMatchObject({
      checkerProjects: 1,
      exceptions: 1,
      ownerProjects: 1,
      providerClosures: 2,
      providerRoots: 2,
      semanticAuthorizationRuns: 1,
      semanticFilesAnalyzed: 2,
      sourceFiles: 2,
    });
    expect(parseSourceAuthorizationSnapshot(snapshot)).toEqual(snapshot);
  });

  it("binds every receipt field except the hash itself", () => {
    const value = receipt();
    const { sourceAuthorizationHash, ...base } = value;
    expect(sourceAuthorizationHash).toBe(canonicalHash(base));

    const changedHashOnly = {
      ...value,
      sourceAuthorizationHash: hash("unrelated"),
    };
    const { sourceAuthorizationHash: _changed, ...unchangedBase } =
      changedHashOnly;
    expect(canonicalHash(unchangedBase)).toBe(sourceAuthorizationHash);
    expect(() => parseIntlCheckReceiptV2(changedHashOnly)).toThrow(
      "does not bind every other receipt field"
    );
  });

  it("rejects a mutation of every primitive receipt field", () => {
    const value = receipt();
    const paths = primitivePaths(value);
    expect(paths.length).toBeGreaterThan(50);
    for (const path of paths) {
      const changed = clone(value);
      mutateAtPath(changed, path);
      expect(
        () => parseIntlCheckReceiptV2(changed),
        `mutation at ${path.join(".")}`
      ).toThrow(/./u);
    }
  });

  it("rejects missing, duplicate, unsorted, and extra manifest data", () => {
    const value = receipt();

    const missing = clone(value) as Record<string, unknown>;
    delete missing.generationReceiptHash;
    expect(() => parseIntlCheckReceiptV2(missing)).toThrow(
      "unexpected or missing fields"
    );

    const duplicated: IntlCheckReceiptV2 = {
      ...clone(value),
      sources: [
        clone(
          value.sources.at(0) ??
            (() => {
              throw new Error("Expected a source fixture");
            })()
        ),
        clone(
          value.sources.at(0) ??
            (() => {
              throw new Error("Expected a source fixture");
            })()
        ),
        ...clone(value.sources.slice(1)),
      ],
    };
    expect(() => parseIntlCheckReceiptV2(duplicated)).toThrow(
      "duplicate identity"
    );

    const unsorted: IntlCheckReceiptV2 = {
      ...clone(value),
      sources: clone(value.sources).toReversed(),
    };
    expect(() => parseIntlCheckReceiptV2(unsorted)).toThrow(
      "canonically sorted"
    );

    const extra = { ...value, unexpected: true };
    expect(() => parseIntlCheckReceiptV2(extra)).toThrow(
      "unexpected or missing fields"
    );
  });

  it("rejects ownership, provider closure, exception, and counter mismatches", () => {
    const original = receipt();
    const checker = original.projects.find(
      (project) => project.role === "checker"
    );
    if (!checker) {
      throw new Error("Expected a checker fixture");
    }
    const ownership: IntlCheckReceiptV2 = {
      ...clone(original),
      sources: original.sources.map((source, index) =>
        index === 0 ? { ...source, owner: checker.path } : source
      ),
    };
    expect(() =>
      parseIntlCheckReceiptV2(withFreshAuthorizationHash(ownership))
    ).toThrow("must be owned by exactly one owner project");

    const closureOriginal = receipt();
    const closure: IntlCheckReceiptV2 = {
      ...clone(closureOriginal),
      sources: closureOriginal.sources.map((source, index) =>
        index === 0
          ? { ...source, providerClosureHash: hash("wrong closure") }
          : source
      ),
    };
    expect(() =>
      parseIntlCheckReceiptV2(withFreshAuthorizationHash(closure))
    ).toThrow("matching provider closure");

    const exceptionOriginal = receipt();
    const exception: IntlCheckReceiptV2 = {
      ...clone(exceptionOriginal),
      sources: exceptionOriginal.sources.map((source, index) =>
        index === 0 ? { ...source, verdict: "accepted" as const } : source
      ),
    };
    expect(() =>
      parseIntlCheckReceiptV2(withFreshAuthorizationHash(exception))
    ).toThrow("exception verdict mismatch");

    const countersOriginal = receipt();
    const counters = {
      ...clone(countersOriginal),
      counters: {
        ...countersOriginal.counters,
        semanticAuthorizationRuns: 2,
      },
    };
    expect(() =>
      parseIntlCheckReceiptV2(withFreshAuthorizationHash(counters))
    ).toThrow("must equal 1");
  });

  it("does not accept V1 as V2 and requires canonical receipt bytes", () => {
    const v1: IntlCheckReceiptV1 = {
      artifactAbi: "v1",
      authorityHash: hash("authority"),
      catalogHash: hash("catalog"),
      compilerHash: hash("compiler"),
      exceptions: [],
      exceptionsHash: hash("exceptions"),
      projects: [],
      runtimeAbi: "1.0.0" as RuntimeAbi,
      schemaVersion: 1,
      sources: [],
      typescriptHash: hash("typescript"),
    };
    expect(() => parseIntlCheckReceiptV2(v1)).toThrow(/./u);

    const value = receipt();
    expect(parseCanonicalIntlCheckReceiptV2(canonicalJson(value))).toEqual(
      value
    );
    expect(() =>
      parseCanonicalIntlCheckReceiptV2(JSON.stringify(value))
    ).toThrow("canonical JSON bytes");
  });
});
