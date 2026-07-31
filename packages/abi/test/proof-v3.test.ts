import type {
  IntlClassifierShadowArtifactV3,
  IntlCheckLstatV3,
  IntlCheckReceipt,
  IntlCheckReceiptSelector,
  IntlCheckReceiptSelectorV1,
  IntlCheckReceiptSelectorV2,
  IntlCheckReceiptV2,
  IntlCheckReceiptV3,
  IntlCheckResolutionBindingV3,
  IntlCheckUnknownModuleBoundaryV3,
  IntlSourceClassifierBindingV3,
  IntlSourceLedgerEntryV3,
  PackageAuthoritySetV1,
} from "../src/index";
import {
  GeneratedFacadeProjectionProofKindV3,
  INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
  INTL_CHECK_RECEIPT_DIRECTORY,
  INTL_CHECK_RECEIPT_SELECTOR_NAME,
  INTL_CHECK_RECEIPT_V2_NAME,
  INTL_CHECK_RECEIPT_V3_NAME,
  INTL_PACKAGE_AUTHORITY_CLASSIFIERS_DIRECTORY,
  INTL_PACKAGE_AUTHORITY_DIRECTORY,
  INTL_PACKAGE_AUTHORITY_RECEIPTS_DIRECTORY,
  INTL_PACKAGE_AUTHORITY_SETS_DIRECTORY,
} from "../src/index";
import { describe, expect, expectTypeOf, it } from "vitest";

const hash = "sha256:0123456789abcdef" as const;

const receipt = {
  application: {
    packageManifest: 0,
    workspaceLockfile: 1,
  },
  artifactAbi: "mirai-intl-artifact-v3",
  candidateIndexes: [
    {
      analyzerAbi: "mirai-intl-analyzer-v3",
      control: 0,
      facade: {
        canonicalRoot: "/workspace/node_modules/@openmirai/intl",
        control: 0,
        file: 2,
        lexicalRoot: "/workspace/node_modules/@openmirai/intl",
        lstats: [0],
        packageScopes: [0],
        probes: [0],
        realpaths: [0],
      },
      indexHash: hash,
      lstats: [0],
      mode: "filtered",
      optionsHash: hash,
      owner: "packages/app/tsconfig.json",
      packageScopes: [0],
      probes: [0],
      projections: [
        {
          boundary: 0,
          canonicalRoot: "/workspace/packages/other",
          control: 0,
          lexicalRoot: "/workspace/packages/other",
          lstats: [0],
          packageScopes: [0],
          probes: [0],
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
      bindingHash: hash,
      boundaries: [0],
      boundaryHash: hash,
      candidateIndex: 0,
      candidateIndexHash: hash,
      decision: "facade-unknown-active",
      mode: "filtered",
      requests: [
        {
          boundary: 0,
          frontier: 0,
          from: "packages/app/src/page.ts",
          resolutionMode: "import",
          specifier: "@openmirai/intl/generated",
        },
      ],
      source: "packages/app/src/page.ts",
      sourceHash: hash,
      unknownBoundaries: [0],
    },
  ],
  compilerManifest: [3],
  compilerManifestHash: hash,
  counters: {
    boundaryIdentities: 1,
    checkerProjects: 0,
    classifierBoundaries: 1,
    classifierCandidateRequests: 1,
    classifierFacadeImports: 0,
    classifierFilteredRequests: 0,
    classifierFullResolverRequests: 1,
    classifierOwnerFallbacks: 0,
    classifierSourcesBound: 1,
    controlSets: 1,
    declarationFiles: 1,
    exceptions: 0,
    fileIdentities: 6,
    loadedLibFiles: 1,
    lexicalFilesClassified: 1,
    lstatIdentities: 1,
    ownerProjects: 1,
    packageScopeIdentities: 1,
    physicalFrontiers: 1,
    probeIdentities: 1,
    providerClosures: 1,
    providerRoots: 1,
    realpathIdentities: 1,
    resolutionBindings: 1,
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: 1,
    sourceFiles: 1,
    typescriptLibFiles: 1,
    unknownActiveSources: 1,
    unknownBoundaryIdentities: 1,
  },
  exceptions: [],
  exceptionsHash: hash,
  generationReceiptHash: hash,
  icu: {
    name: "@formatjs/icu-messageformat-parser",
    packageHash: hash,
    packageManifestHash: hash,
    version: "3.5.3",
  },
  projects: [
    {
      configManifest: [
        {
          extends: [],
          file: 4,
          path: "packages/app/tsconfig.json",
          references: [],
        },
      ],
      configManifestHash: hash,
      normalizedOptions: {
        module: "ESNext",
        strict: true,
      },
      normalizedOptionsHash: hash,
      path: "packages/app/tsconfig.json",
      resolverOptionsHash: hash,
      role: "owner",
      rootFiles: ["packages/app/src/page.ts"],
    },
  ],
  providerClosures: [
    {
      ambientTypeFileLimit: 32,
      closureHash: hash,
      declarationHash: hash,
      declarations: [5],
      libHash: hash,
      libs: [5],
      providerBudgetExceeded: false,
      providerRootLimit: 16,
      providers: [
        {
          declarationHash: hash,
          declarations: [5],
          hash,
          kind: "external",
          resolutions: [],
          root: "node_modules/@types/node",
        },
      ],
      source: "packages/app/src/page.ts",
    },
  ],
  runtimeAbi: "1.0.0",
  schemaVersion: 3,
  sourceAuthorizationHash: hash,
  sources: [
    {
      classifierBindingHash: hash,
      file: "packages/app/src/page.ts",
      hash,
      owner: "packages/app/tsconfig.json",
      providerClosureHash: hash,
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
        source: "packages/app/src/page.ts",
        specifier: "@openmirai/intl/generated",
      },
    ],
    controls: [{ files: [0, 1] }],
    files: [
      { hash, path: "package.json" },
      { hash, path: "pnpm-lock.yaml" },
      { hash, path: "packages/app/src/generated.ts" },
      { hash, path: "packages/compiler/dist/proof.js" },
      { hash, path: "packages/app/tsconfig.json" },
      { hash, path: "node_modules/typescript/lib/lib.es2024.d.ts" },
    ],
    frontiers: [
      {
        control: 0,
        frontierHash: hash,
        lstats: [0],
        optionsHash: hash,
        packageName: null,
        packageVersion: null,
        probes: [0],
        realpaths: [0],
        resolutionMode: "import",
        resolvedFile: null,
      },
    ],
    lstats: [
      {
        kind: "directory",
        linkTargetBase64: null,
        linkTargetHash: null,
        path: "/workspace/packages/app",
      },
    ],
    packageScopes: [
      {
        canonicalRoot: "/workspace/packages/app",
        control: 0,
        lexicalRoot: "/workspace/packages/app",
        manifest: 0,
        manifestLstat: 0,
        manifestProbe: 0,
        realpath: 0,
        rootLstat: 0,
      },
    ],
    probes: [
      {
        kind: "file",
        path: "/workspace/packages/app/package.json",
        present: true,
      },
    ],
    realpaths: [
      {
        path: "/workspace/packages/app",
        target: "/workspace/packages/app",
      },
    ],
    unknownBoundaries: [
      {
        byteEnd: 21,
        byteStart: 8,
        kind: "dynamic-import",
        nodeHash: hash,
        nodeKind: "CallExpression",
        observationOrdinal: 1,
        reason: "nonliteral-specifier",
        source: "packages/app/src/page.ts",
        sourceSliceHash: hash,
      },
    ],
  },
  typescript: {
    libHash: hash,
    libs: [5],
    package: {
      name: "typescript",
      packageHash: hash,
      packageManifestHash: hash,
      version: "7.0.2",
    },
  },
} as const satisfies IntlCheckReceiptV3;

const shadowArtifact = {
  analyzerAbi: "mirai-intl-analyzer-v3",
  boundaryCategories: {
    import: 10951,
    unknown: 1,
  },
  candidateRequests: 80,
  canonicalExpandedV3Bytes: 2048,
  canonicalV2Bytes: 4096,
  canonicalV3Bytes: 1024,
  catalogInputHash: hash,
  compilerHash: hash,
  facadeImports: 80,
  fallbackOwners: [],
  filteredRequests: 10871,
  inputHash: hash,
  lockfileHash: hash,
  optimizedRequiresProgramVector: [["packages/app/src/page.ts", true]],
  optimizedRequiresProgramVectorHash: hash,
  ownerCount: 1,
  ownerModes: [{ mode: "filtered", owner: "packages/app/tsconfig.json" }],
  peakRssBytes: 1024,
  projectInputsHash: hash,
  referenceLiteralBoundaryRequests: 10951,
  referenceRequiresProgramVector: [["packages/app/src/page.ts", true]],
  referenceRequiresProgramVectorHash: hash,
  sourceUniverseHash: hash,
  timingsMs: {
    canonicalize: 1,
    hash: 1,
    parse: 1,
    shadowTotal: 4,
  },
  typescriptHash: hash,
  unknownActiveSources: 1,
  unknownBoundaryCount: 1,
} as const satisfies IntlClassifierShadowArtifactV3;

function acceptsCurrentReceipt(value: IntlCheckReceipt): 2 | 3 {
  return value.schemaVersion;
}

type ClassifierDecision =
  IntlCheckReceiptV3["classifierBindings"][number]["decision"];

function requiresProgramForDecision(decision: ClassifierDecision): boolean {
  return decision !== "facade-absent";
}

const bindingWithDuplicateDerivedField = {
  ...receipt.classifierBindings[0],
  // @ts-expect-error requiresProgram is derived from decision, not persisted.
  requiresProgram: true,
} satisfies IntlSourceClassifierBindingV3;

const receiptWithDuplicateShadowField = {
  ...receipt,
  // @ts-expect-error parity vectors belong only to the shadow artifact.
  optimizedRequiresProgramVector: [["packages/app/src/page.ts", true]],
} satisfies IntlCheckReceiptV3;

describe("IntlCheckReceiptV3", () => {
  it("represents classifier-authorized sources without invented semantic evidence", () => {
    const lexicalOnly = {
      classifierBindingHash: hash,
      file: "packages/app/src/lexical-only.ts",
      hash,
      owner: "packages/app/tsconfig.json",
      providerClosureHash: null,
      verdict: "accepted",
    } as const satisfies IntlSourceLedgerEntryV3;

    expectTypeOf(lexicalOnly).toMatchTypeOf<IntlSourceLedgerEntryV3>();
    expect(lexicalOnly.providerClosureHash).toBeNull();
    expect(receipt.counters.lexicalFilesClassified).toBe(1);
    expect(receipt.counters.semanticFilesAnalyzed).toBe(1);
  });

  it("represents a minimal normalized V3 receipt", () => {
    expectTypeOf(receipt).toMatchTypeOf<IntlCheckReceiptV3>();
    expectTypeOf(receipt.schemaVersion).toEqualTypeOf<3>();
    expect(acceptsCurrentReceipt(receipt)).toBe(3);
  });

  it("exposes boundary references on resolution bindings", () => {
    const binding: IntlCheckResolutionBindingV3 | undefined =
      receipt.classifierBindings[0]?.requests[0];

    expect(binding).toBeDefined();
    if (binding === undefined) {
      throw new Error(
        "expected the V3 fixture to contain a resolution binding"
      );
    }

    expect(binding.boundary).toBe(0);
    expect(receipt.tables.boundaries[binding.boundary]).toMatchObject({
      resolutionMode: binding.resolutionMode,
      specifier: binding.specifier,
    });
  });

  it("represents a merged literal and source-local unknown observation ledger", () => {
    const literal = receipt.tables.boundaries[0];
    const unknown: IntlCheckUnknownModuleBoundaryV3 | undefined =
      receipt.tables.unknownBoundaries[
        receipt.classifierBindings[0]?.unknownBoundaries[0] ?? -1
      ];

    expect(literal?.observationOrdinal).toBe(0);
    expect(unknown).toMatchObject({
      byteEnd: 21,
      byteStart: 8,
      observationOrdinal: 1,
      reason: "nonliteral-specifier",
    });
    expect(receipt.classifierBindings[0]?.decision).toBe(
      "facade-unknown-active"
    );
    expect(
      requiresProgramForDecision(receipt.classifierBindings[0]?.decision)
    ).toBe(true);
  });

  it("maps all classifier decisions exactly to requiresProgram", () => {
    expect(requiresProgramForDecision("facade-absent")).toBe(false);
    expect(requiresProgramForDecision("facade-present")).toBe(true);
    expect(requiresProgramForDecision("facade-unknown-active")).toBe(true);
  });

  it("keeps classifier parity vectors on the exact shadow artifact", () => {
    expectTypeOf(
      shadowArtifact
    ).toMatchTypeOf<IntlClassifierShadowArtifactV3>();
    expectTypeOf<keyof IntlClassifierShadowArtifactV3>().toEqualTypeOf<
      keyof typeof shadowArtifact
    >();
    expect(shadowArtifact.optimizedRequiresProgramVector).toEqual(
      shadowArtifact.referenceRequiresProgramVector
    );
    expect(bindingWithDuplicateDerivedField.requiresProgram).toBe(true);
    expect(
      receiptWithDuplicateShadowField.optimizedRequiresProgramVector
    ).toHaveLength(1);
  });

  it("keeps portable lstat authority free of host filesystem identity", () => {
    const portableLstat = {
      kind: "symlink",
      linkTargetBase64: "Li4vdGFyZ2V0",
      linkTargetHash: hash,
      path: "/workspace/link",
    } as const satisfies IntlCheckLstatV3;

    const hostSpecificLstat: IntlCheckLstatV3 = {
      kind: "file",
      linkTargetBase64: null,
      linkTargetHash: null,
      path: "/workspace/file",
      // @ts-expect-error device identity is transaction-local, not receipt ABI.
      dev: 1,
    };

    expect(portableLstat.linkTargetHash).toBe(hash);
    expectTypeOf(hostSpecificLstat).toEqualTypeOf<IntlCheckLstatV3>();
  });

  it("preserves V2 as a distinct reader variant", () => {
    expectTypeOf<IntlCheckReceiptV2>().not.toEqualTypeOf<IntlCheckReceiptV3>();
    expectTypeOf<IntlCheckReceiptV2["schemaVersion"]>().toEqualTypeOf<2>();
    expectTypeOf<IntlCheckReceiptV3["schemaVersion"]>().toEqualTypeOf<3>();
  });

  it("freezes the atomic V2/V3 selector and path ABI", () => {
    const v2 = {
      receiptHash: hash,
      receiptName: INTL_CHECK_RECEIPT_V2_NAME,
      receiptSchemaVersion: 2,
      schemaVersion: 1,
    } as const satisfies IntlCheckReceiptSelectorV1;
    const v3 = {
      authorityHash: hash,
      authorityName: INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME,
      receiptHash: hash,
      receiptName: INTL_CHECK_RECEIPT_V3_NAME,
      receiptSchemaVersion: 3,
      schemaVersion: 1,
    } as const satisfies IntlCheckReceiptSelectorV1;

    expect(INTL_CHECK_RECEIPT_DIRECTORY).toBe(".mirai-intl");
    expect(INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME).toBe(
      "classifier-authority.v3.json"
    );
    expect(INTL_CHECK_RECEIPT_SELECTOR_NAME).toBe("check-receipt.current.json");
    expect(v2.receiptSchemaVersion).toBe(2);
    expect(v3.receiptSchemaVersion).toBe(3);
  });

  it("freezes the immutable package authority-set and selector ABI", () => {
    const authoritySet = {
      classifierAuthority: { hash, schemaVersion: 3 },
      package: {
        manifestHash: hash,
        name: "@example/app",
        root: "packages/app",
      },
      receipt: { hash, schemaVersion: 3 },
      schemaVersion: 1,
    } as const satisfies PackageAuthoritySetV1;
    const selector = {
      authoritySetHash: hash,
      schemaVersion: 2,
    } as const satisfies IntlCheckReceiptSelectorV2;
    const acceptedSelector: IntlCheckReceiptSelector = selector;

    expect(INTL_PACKAGE_AUTHORITY_DIRECTORY).toBe("authority");
    expect(INTL_PACKAGE_AUTHORITY_RECEIPTS_DIRECTORY).toBe("receipts");
    expect(INTL_PACKAGE_AUTHORITY_CLASSIFIERS_DIRECTORY).toBe("classifiers");
    expect(INTL_PACKAGE_AUTHORITY_SETS_DIRECTORY).toBe("sets");
    expect(authoritySet.classifierAuthority?.schemaVersion).toBe(3);
    expect(acceptedSelector.schemaVersion).toBe(2);
  });
});
