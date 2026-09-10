import type {
  IntlCheckReceiptV3,
  IntlCheckReceiptCountersV3,
  Sha256,
  RuntimeAbi,
} from "@openmirai/intl-abi";
import { GeneratedFacadeProjectionProofKindV3 } from "@openmirai/intl-abi";
import { afterEach, expect, it, vi } from "vitest";
import {
  buildIntlCheckReceiptV3,
  canonicalIntlCheckReceiptV3Bytes,
  parseCanonicalIntlCheckReceiptV3,
  parseCanonicalIntlCheckReceiptV3WithEngine,
  withReceiptParsingScope,
  parseIntlCheckReceiptV3,
  hashIntlCheckReceiptV3,
} from "../src/authorization-snapshot";
import * as canonical from "../src/canonical";
import * as nativeEngine from "../src/native-engine";
import { canonicalHash, canonicalJson, sha256 } from "../src/canonical";

// Synthetic normalized receipt and UTF-8 unknown-boundary evidence follow
// authorization-snapshot-v3.test.ts; no disk or published authority is cached.
function hash(label: string): Sha256 {
  return sha256(label);
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function first<T>(values: ReadonlyArray<T>): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error("Expected a non-empty fixture array");
  }
  return value;
}

function at<T>(values: ReadonlyArray<T>, index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`Expected fixture array entry ${index}`);
  }
  return value;
}

type Mutable<T> = T extends (...args: Array<never>) => unknown
  ? T
  : T extends readonly []
    ? []
    : T extends readonly [unknown, ...Array<unknown>]
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T extends ReadonlyArray<infer Item>
        ? Array<Mutable<Item>>
        : T extends object
          ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
          : T;

type MutableIntlCheckReceiptV3 = Mutable<IntlCheckReceiptV3>;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

function placeholderCounters(): IntlCheckReceiptCountersV3 {
  return {
    boundaryIdentities: 0,
    checkerProjects: 0,
    classifierBoundaries: 0,
    classifierCandidateRequests: 0,
    classifierFacadeImports: 0,
    classifierFilteredRequests: 0,
    classifierFullResolverRequests: 0,
    classifierOwnerFallbacks: 0,
    classifierSourcesBound: 0,
    controlSets: 0,
    declarationFiles: 0,
    exceptions: 0,
    fileIdentities: 0,
    loadedLibFiles: 0,
    lexicalFilesClassified: 0,
    lstatIdentities: 0,
    ownerProjects: 0,
    packageScopeIdentities: 0,
    physicalFrontiers: 0,
    probeIdentities: 0,
    providerClosures: 0,
    providerRoots: 0,
    realpathIdentities: 0,
    resolutionBindings: 0,
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: 0,
    sourceFiles: 0,
    typescriptLibFiles: 0,
    unknownActiveSources: 0,
    unknownBoundaryIdentities: 0,
  };
}

function rawFixture(): MutableIntlCheckReceiptV3 {
  const normalizedOptions = { module: "ESNext", strict: true };
  const optionsHash = hashIntlCheckReceiptV3("project-normalized-options", [
    "tsconfig.json",
    normalizedOptions,
  ]);
  const resolverOptionsHash = canonicalHash(normalizedOptions);
  const placeholder = hash("placeholder");
  const value: MutableIntlCheckReceiptV3 = {
    application: { packageManifest: 0, workspaceLockfile: 1 },
    artifactAbi: "mirai-intl-artifact-v3",
    candidateIndexes: [
      {
        analyzerAbi: "mirai-intl-classifier-v3-shadow",
        control: 0,
        facade: {
          canonicalRoot: "packages/app",
          control: 0,
          file: 2,
          lexicalRoot: "packages/app",
          lstats: [0, 1],
          packageScopes: [0],
          probes: [0, 1],
          realpaths: [0],
        },
        indexHash: placeholder,
        lstats: [0, 1],
        mode: "filtered",
        optionsHash,
        owner: "tsconfig.json",
        packageScopes: [0],
        probes: [0, 1],
        projections: [
          {
            boundary: 0,
            canonicalRoot: "packages/app",
            control: 0,
            lexicalRoot: "packages/app",
            lstats: [0, 1],
            packageScopes: [0],
            probes: [0, 1],
            proofKind:
              GeneratedFacadeProjectionProofKindV3.FACADE_PACKAGE_EXPORT,
            realpaths: [0],
            status: "candidate",
          },
          {
            boundary: 1,
            canonicalRoot: "packages/other",
            control: 0,
            lexicalRoot: "packages/other",
            lstats: [0, 1],
            packageScopes: [0],
            probes: [0, 1],
            proofKind: GeneratedFacadeProjectionProofKindV3.UNMAPPED_EXTERNAL,
            realpaths: [0],
            status: "disjoint",
          },
        ],
        realpaths: [0],
        reasons: [],
      },
    ],
    classifierBindings: [
      {
        bindingHash: placeholder,
        boundaries: [0, 1],
        boundaryHash: placeholder,
        candidateIndex: 0,
        candidateIndexHash: placeholder,
        decision: "facade-present",
        mode: "filtered",
        requests: [
          {
            boundary: 0,
            frontier: 0,
            from: "src/main.ts",
            resolutionMode: "import",
            specifier: "@app/generated",
          },
        ],
        source: "src/main.ts",
        sourceHash: hash("src/main.ts"),
        unknownBoundaries: [],
      },
    ],
    compilerManifest: [2, 4],
    compilerManifestHash: placeholder,
    counters: placeholderCounters(),
    exceptions: [],
    exceptionsHash: placeholder,
    generationReceiptHash: hash("generation"),
    icu: {
      name: "@formatjs/icu-messageformat-parser",
      packageHash: hash("icu-package"),
      packageManifestHash: hash("icu-manifest"),
      version: "3.5.14",
    },
    projects: [
      {
        configManifest: [
          {
            extends: [],
            file: 4,
            path: "tsconfig.json",
            references: [],
          },
        ],
        configManifestHash: placeholder,
        normalizedOptions,
        normalizedOptionsHash: optionsHash,
        path: "tsconfig.json",
        resolverOptionsHash,
        role: "owner",
        rootFiles: ["src/main.ts"],
      },
    ],
    providerClosures: [
      {
        ambientTypeFileLimit: 1,
        closureHash: placeholder,
        declarationHash: placeholder,
        declarations: [2],
        libHash: placeholder,
        libs: [5],
        providerBudgetExceeded: false,
        providerRootLimit: 1,
        providers: [
          {
            declarationHash: placeholder,
            declarations: [2],
            hash: placeholder,
            kind: "generated",
            resolutions: [
              {
                frontier: 1,
                from: "src/main.ts",
                specifier: "@app/generated",
              },
            ],
            root: "packages/app",
          },
        ],
        source: "src/main.ts",
      },
    ],
    runtimeAbi: "mirai-intl-runtime-v3" as RuntimeAbi,
    schemaVersion: 3,
    sourceAuthorizationHash: placeholder,
    sources: [
      {
        classifierBindingHash: placeholder,
        file: "src/main.ts",
        hash: hash("src/main.ts"),
        owner: "tsconfig.json",
        providerClosureHash: placeholder,
        verdict: "accepted",
      },
    ],
    tables: {
      boundaries: [
        {
          kind: "import",
          observationOrdinal: 0,
          ordinal: 0,
          resolutionMode: "import",
          source: "src/main.ts",
          specifier: "@app/generated",
        },
        {
          kind: "import",
          observationOrdinal: 1,
          ordinal: 1,
          resolutionMode: "import",
          source: "src/main.ts",
          specifier: "@other/value",
        },
      ],
      controls: [{ files: [0, 1, 4] }],
      files: [
        {
          hash: hash("package.json"),
          path: "packages/app/package.json",
        },
        { hash: hash("pnpm-lock.yaml"), path: "pnpm-lock.yaml" },
        { hash: hash("generated"), path: "src/generated.ts" },
        { hash: hash("src/main.ts"), path: "src/main.ts" },
        { hash: hash("tsconfig.json"), path: "tsconfig.json" },
        {
          hash: hash("typescript-lib"),
          path: "vendor/typescript/lib.esnext.d.ts",
        },
      ],
      frontiers: [
        {
          control: 0,
          frontierHash: hash("frontier-placeholder"),
          lstats: [0, 1],
          optionsHash,
          packageName: "@app/generated",
          packageVersion: "1.0.0",
          probes: [0, 1],
          realpaths: [0],
          resolutionMode: "import",
          resolvedFile: 2,
        },
        {
          control: 0,
          frontierHash: hash("semantic-frontier-placeholder"),
          lstats: [],
          optionsHash: canonicalHash(normalizedOptions),
          packageName: "@app/generated",
          packageVersion: "1.0.0",
          probes: [0, 1],
          realpaths: [0],
          resolutionMode: "default",
          resolvedFile: null,
        },
      ],
      lstats: [
        {
          kind: "directory",
          linkTargetBase64: null,
          linkTargetHash: null,
          path: "packages/app",
        },
        {
          kind: "file",
          linkTargetBase64: null,
          linkTargetHash: null,
          path: "packages/app/package.json",
        },
      ],
      packageScopes: [
        {
          canonicalRoot: "packages/app",
          control: 0,
          lexicalRoot: "packages/app",
          manifest: 0,
          manifestLstat: 1,
          manifestProbe: 1,
          realpath: 0,
          rootLstat: 0,
        },
      ],
      probes: [
        { kind: "directory", path: "packages/app", present: true },
        { kind: "file", path: "packages/app/package.json", present: true },
      ],
      realpaths: [{ path: "packages/app", target: "packages/app" }],
      unknownBoundaries: [],
    },
    typescript: {
      libHash: placeholder,
      libs: [5],
      package: {
        name: "typescript",
        packageHash: hash("typescript-package"),
        packageManifestHash: hash("typescript-manifest"),
        version: "6.0.3",
      },
    },
  };
  value.tables.frontiers.sort((left, right) =>
    compareText(left.frontierHash, right.frontierHash)
  );
  const classifierFrontier = value.tables.frontiers.findIndex(
    (frontier) => frontier.resolutionMode === "import"
  );
  const semanticFrontier = value.tables.frontiers.findIndex(
    (frontier) => frontier.resolutionMode === "default"
  );
  first(first(value.classifierBindings).requests).frontier = classifierFrontier;
  first(first(first(value.providerClosures).providers).resolutions).frontier =
    semanticFrontier;
  return value;
}

function unknownFixtureInput() {
  const input = rawFixture();
  const sourceText =
    "const π = import(moduleName);\nconst value = require(otherName);\n";
  const sourceBytes = Buffer.from(sourceText);
  const slices = ["import(moduleName)", "require(otherName)"].map(
    (sourceSlice, observationOffset) => {
      const sliceBytes = Buffer.from(sourceSlice);
      const byteStart = sourceBytes.indexOf(sliceBytes);
      const byteEnd = byteStart + sliceBytes.length;
      const sourceSliceHash = sha256(sliceBytes);
      const kind = observationOffset === 0 ? "dynamic-import" : "require";
      const reason = "nonliteral-specifier";
      const observationOrdinal = observationOffset + 2;
      return {
        byteEnd,
        byteStart,
        kind,
        nodeHash: hashIntlCheckReceiptV3("unknown-boundary-node", [
          kind,
          "CallExpression",
          observationOrdinal,
          reason,
          "src/main.ts",
          byteStart,
          byteEnd,
          sourceSliceHash,
        ]),
        nodeKind: "CallExpression",
        observationOrdinal,
        reason,
        source: "src/main.ts",
        sourceSliceHash,
      } as const;
    }
  );
  input.tables.unknownBoundaries = slices;
  const binding = first(input.classifierBindings);
  binding.decision = "facade-unknown-active";
  binding.requests = [];
  binding.unknownBoundaries = [0, 1];
  const providerResolution = first(
    first(first(input.providerClosures).providers).resolutions
  );
  input.tables.frontiers = [
    at(input.tables.frontiers, providerResolution.frontier),
  ];
  providerResolution.frontier = 0;
  const facadeProjection = first(first(input.candidateIndexes).projections);
  facadeProjection.canonicalRoot = "packages/not-app";
  facadeProjection.lexicalRoot = "packages/not-app";
  facadeProjection.status = "disjoint";
  return { input, sourceBytes };
}

afterEach(() => vi.restoreAllMocks());

function receiptCanonicalCalls(spy: {
  mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> };
}): number {
  return spy.mock.calls.filter(
    ([value]) =>
      value !== null &&
      typeof value === "object" &&
      "schemaVersion" in value &&
      value.schemaVersion === 3
  ).length;
}

it("canonicalizes a trusted deeply frozen receipt only once", () => {
  const receipt = buildIntlCheckReceiptV3(rawFixture());
  expect(Object.isFrozen(receipt)).toBe(true);
  expect(Object.isFrozen(receipt.tables.files[0])).toBe(true);
  const spy = vi.spyOn(canonical, "canonicalJson");
  const bytes = canonicalIntlCheckReceiptV3Bytes(receipt);
  expect(canonicalIntlCheckReceiptV3Bytes(receipt)).toBe(bytes);
  expect(receiptCanonicalCalls(spy)).toBe(1);
});

it("retains canonical bytes after parsing while still enforcing canonical input", () => {
  const bytes = canonicalIntlCheckReceiptV3Bytes(
    buildIntlCheckReceiptV3(rawFixture())
  );
  const spy = vi.spyOn(canonical, "canonicalJson");
  const parsed = parseCanonicalIntlCheckReceiptV3(bytes);
  expect(canonicalIntlCheckReceiptV3Bytes(parsed)).toBe(bytes);
  expect(receiptCanonicalCalls(spy)).toBe(1);
  expect(() => parseCanonicalIntlCheckReceiptV3(` ${bytes}`)).toThrow(
    /canonical/u
  );
});

it("retains trusted identity and bytes across rebuilds but rechecks live unknown-boundary evidence", () => {
  const { input, sourceBytes } = unknownFixtureInput();
  const readSourceBytes = vi.fn(() => sourceBytes);
  const options = { readSourceBytes };
  const receipt = buildIntlCheckReceiptV3(input, undefined, options);
  const bytes = canonicalIntlCheckReceiptV3Bytes(receipt);
  readSourceBytes.mockClear();
  const rebuilt = buildIntlCheckReceiptV3(receipt, undefined, options);
  expect(rebuilt).toBe(receipt);
  expect(canonicalIntlCheckReceiptV3Bytes(rebuilt)).toBe(bytes);
  expect(readSourceBytes).toHaveBeenCalledTimes(1);
  readSourceBytes.mockReturnValue(Buffer.alloc(sourceBytes.length, 32));
  expect(() => buildIntlCheckReceiptV3(receipt, undefined, options)).toThrow(
    /sourceSliceHash/u
  );
  expect(readSourceBytes).toHaveBeenCalledTimes(2);
  const ioError = Object.assign(new Error("source unreadable"), {
    code: "EACCES",
  });
  readSourceBytes.mockImplementation(() => {
    throw ioError;
  });
  expect(() => buildIntlCheckReceiptV3(receipt, undefined, options)).toThrow(
    ioError
  );
  expect(readSourceBytes).toHaveBeenCalledTimes(3);
});

it("revalidates fresh source evidence when parsing the same bytes again", () => {
  const { input, sourceBytes } = unknownFixtureInput();
  const readSourceBytes = vi.fn(() => sourceBytes);
  const options = { readSourceBytes };
  const bytes = canonicalIntlCheckReceiptV3Bytes(
    buildIntlCheckReceiptV3(input, undefined, options)
  );
  parseCanonicalIntlCheckReceiptV3(bytes, undefined, options);
  readSourceBytes.mockReturnValue(Buffer.alloc(sourceBytes.length, 32));
  expect(() =>
    parseCanonicalIntlCheckReceiptV3(bytes, undefined, options)
  ).toThrow(/sourceSliceHash/u);
});

it("never trusts or caches arbitrary mutable or caller-frozen objects", () => {
  const trusted = buildIntlCheckReceiptV3(rawFixture());
  const mutable = mutableClone(trusted);
  expect(canonicalIntlCheckReceiptV3Bytes(mutable)).toBe(
    canonicalIntlCheckReceiptV3Bytes(trusted)
  );
  mutable.sourceAuthorizationHash = hash("tampered");
  expect(() => canonicalIntlCheckReceiptV3Bytes(mutable)).toThrow(
    /Intl check receipt/u
  );
  expect(() =>
    canonicalIntlCheckReceiptV3Bytes(Object.freeze(mutable))
  ).toThrow(/Intl check receipt/u);
  expect(() =>
    buildIntlCheckReceiptV3({ ...trusted, unexpected: true })
  ).toThrow(/Intl check receipt/u);
});

it("preserves named hashes and receipt counters against the full untrusted rebuild", () => {
  const trusted = buildIntlCheckReceiptV3(rawFixture());
  const rebuilt = buildIntlCheckReceiptV3(mutableClone(trusted));
  expect(rebuilt).not.toBe(trusted);
  expect(rebuilt).toEqual(trusted);
  expect(parseIntlCheckReceiptV3(rebuilt)).toEqual(trusted);
  expect(buildIntlCheckReceiptV3(trusted)).toBe(trusted);
});

it("native byte validation retains named hashes, counters and live source evidence", async () => {
  vi.spyOn(nativeEngine, "nativeCanonicalReceipt").mockResolvedValue(true);
  const { input, sourceBytes } = unknownFixtureInput();
  const readSourceBytes = vi.fn(() => sourceBytes);
  const receipt = buildIntlCheckReceiptV3(input, undefined, {
    readSourceBytes,
  });
  const bytes = canonicalIntlCheckReceiptV3Bytes(receipt);
  const spy = vi.spyOn(canonical, "canonicalJson");
  const parsed = await parseCanonicalIntlCheckReceiptV3WithEngine(
    bytes,
    undefined,
    { readSourceBytes }
  );
  expect(parsed).toEqual(receipt);
  expect(canonicalIntlCheckReceiptV3Bytes(parsed)).toBe(bytes);
  expect(receiptCanonicalCalls(spy)).toBe(0);
  readSourceBytes.mockReturnValue(Buffer.alloc(sourceBytes.length, 32));
  await expect(
    parseCanonicalIntlCheckReceiptV3WithEngine(bytes, undefined, {
      readSourceBytes,
    })
  ).rejects.toThrow(/sourceSliceHash/u);
  readSourceBytes.mockReturnValue(sourceBytes);
  await expect(
    parseCanonicalIntlCheckReceiptV3WithEngine(
      `${canonicalJson({ ...receipt, sourceAuthorizationHash: hash("tampered") })}\n`,
      undefined,
      { readSourceBytes }
    )
  ).rejects.toThrow(/Intl check receipt/u);
  await expect(
    parseCanonicalIntlCheckReceiptV3WithEngine(
      `${canonicalJson({ ...receipt, counters: { ...receipt.counters, checkerProjects: 99999 } })}\n`,
      undefined,
      { readSourceBytes }
    )
  ).rejects.toThrow(/Intl check receipt/u);
});

it("native unsupported input uses the full Node canonical validator", async () => {
  const native = vi
    .spyOn(nativeEngine, "nativeCanonicalReceipt")
    .mockResolvedValue(undefined);
  const receipt = buildIntlCheckReceiptV3(rawFixture());
  const bytes = canonicalIntlCheckReceiptV3Bytes(receipt);
  expect(await parseCanonicalIntlCheckReceiptV3WithEngine(bytes)).toEqual(
    receipt
  );
  await expect(
    parseCanonicalIntlCheckReceiptV3WithEngine(` ${bytes}`)
  ).rejects.toThrow(/canonical/u);
  native.mockResolvedValue(false);
  await expect(
    parseCanonicalIntlCheckReceiptV3WithEngine(bytes)
  ).rejects.toThrow(/canonical/u);
  const failure = Object.assign(new Error("native operation failed"), {
    code: "EACCES",
  });
  native.mockRejectedValue(failure);
  await expect(parseCanonicalIntlCheckReceiptV3WithEngine(bytes)).rejects.toBe(
    failure
  );
});

it("reuses exact immutable receipt structure within one operation while rechecking live sources", async () => {
  const native = vi
    .spyOn(nativeEngine, "nativeCanonicalReceipt")
    .mockResolvedValue(true);
  const { input, sourceBytes } = unknownFixtureInput();
  const readSourceBytes = vi.fn(() => sourceBytes);
  const bytes = canonicalIntlCheckReceiptV3Bytes(
    buildIntlCheckReceiptV3(input, undefined, { readSourceBytes })
  );
  await withReceiptParsingScope(async () => {
    const firstParsed = await parseCanonicalIntlCheckReceiptV3WithEngine(
      bytes,
      undefined,
      { readSourceBytes }
    );
    readSourceBytes.mockClear();
    expect(
      await parseCanonicalIntlCheckReceiptV3WithEngine(bytes, undefined, {
        readSourceBytes,
      })
    ).toBe(firstParsed);
    expect(native).toHaveBeenCalledTimes(1);
    expect(readSourceBytes).toHaveBeenCalledTimes(1);
    readSourceBytes.mockReturnValue(Buffer.alloc(sourceBytes.length, 32));
    await expect(
      parseCanonicalIntlCheckReceiptV3WithEngine(bytes, undefined, {
        readSourceBytes,
      })
    ).rejects.toThrow(/sourceSliceHash/u);
    const ioError = Object.assign(new Error("current source is unreadable"), {
      code: "EACCES",
    });
    readSourceBytes.mockImplementation(() => {
      throw ioError;
    });
    await expect(
      parseCanonicalIntlCheckReceiptV3WithEngine(bytes, undefined, {
        readSourceBytes,
      })
    ).rejects.toBe(ioError);
  });
  readSourceBytes.mockReturnValue(sourceBytes);
  await withReceiptParsingScope(() =>
    parseCanonicalIntlCheckReceiptV3WithEngine(bytes, undefined, {
      readSourceBytes,
    })
  );
  expect(native).toHaveBeenCalledTimes(2);
});
