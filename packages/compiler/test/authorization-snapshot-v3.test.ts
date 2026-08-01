import type {
  IntlCheckReceiptV2,
  IntlCheckReceiptCountersV3,
  IntlCheckReceiptV3,
  RuntimeAbi,
  Sha256,
} from "@openmirai/intl-abi";
import { GeneratedFacadeProjectionProofKindV3 } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import {
  buildMiraiIntlClassifierAuthorityV3,
  parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3,
} from "../src/classifier-authority";
import type { MiraiIntlClassifierAuthorityV3 } from "../src/classifier-authority";
import type { MiraiIntlClassifierReceiptProjectionV3 } from "../src/classifier-candidate";
import type { MiraiIntlCandidateCheckpointShadow } from "../src/classifier-candidate-shadow";

import {
  buildIntlCheckReceiptV2,
  buildIntlCheckReceiptV3,
  buildIntlCheckReceiptV3ClassifierAuthorityBinding,
  buildIntlCheckReceiptV3FromClassifierProjections,
  buildIntlCheckReceiptV3FromNativeInputs,
  buildIntlCheckReceiptV3PersistedAuthorityBinding,
  buildSourceAuthorizationSnapshot,
  canonicalIntlCheckReceiptV2Bytes,
  canonicalExpandedIntlCheckReceiptV3Bytes,
  canonicalIntlCheckReceiptV3Bytes,
  createIntlCheckReceiptV3HashMetrics,
  hashIntlCheckReceiptV3,
  parseCanonicalIntlCheckReceipt,
  parseCanonicalIntlCheckReceiptV3,
  parseIntlCheckReceipt,
  parseIntlCheckReceiptV3,
} from "../src/authorization-snapshot";
import type { IntlCheckReceiptV3NativeInput } from "../src/authorization-snapshot";
import { canonicalHash, canonicalJson, sha256 } from "../src/canonical";

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

function fixture(): IntlCheckReceiptV3 {
  return buildIntlCheckReceiptV3(rawFixture());
}

function alternateOwnerFixture(): IntlCheckReceiptV3 {
  const input = rawFixture();
  const owner = "tsconfig.secondary.json";
  const source = "src/secondary.ts";
  const normalizedOptions = { module: "NodeNext", strict: true };
  const normalizedOptionsHash = hashIntlCheckReceiptV3(
    "project-normalized-options",
    [owner, normalizedOptions]
  );
  const resolverOptionsHash = canonicalHash(normalizedOptions);
  const project = first(input.projects);
  project.path = owner;
  project.normalizedOptions = normalizedOptions;
  project.normalizedOptionsHash = normalizedOptionsHash;
  project.resolverOptionsHash = resolverOptionsHash;
  project.rootFiles = [source];
  first(project.configManifest).path = owner;
  input.tables.files[4] = { hash: hash(owner), path: owner };
  const index = first(input.candidateIndexes);
  index.optionsHash = normalizedOptionsHash;
  index.owner = owner;
  const binding = first(input.classifierBindings);
  binding.source = source;
  binding.sourceHash = hash(source);
  for (const request of binding.requests) {
    request.from = source;
  }
  for (const boundary of input.tables.boundaries) {
    boundary.source = source;
  }
  const closure = first(input.providerClosures);
  closure.source = source;
  for (const provider of closure.providers) {
    for (const resolution of provider.resolutions) {
      resolution.from = source;
    }
  }
  const ledger = first(input.sources);
  ledger.file = source;
  ledger.hash = hash(source);
  ledger.owner = owner;
  input.tables.files[3] = { hash: hash(source), path: source };
  for (const frontier of input.tables.frontiers) {
    frontier.optionsHash =
      frontier.resolutionMode === "default"
        ? resolverOptionsHash
        : normalizedOptionsHash;
  }
  return buildIntlCheckReceiptV3(input);
}

function rehashAuthority(
  value: Omit<MiraiIntlClassifierAuthorityV3, "resultHash">
): MiraiIntlClassifierAuthorityV3 {
  const rawIndexBinding = value.indexBinding as Readonly<
    Record<string, unknown>
  >;
  const indexBinding = {
    ...rawIndexBinding,
    resolverFrontierHash: sha256(
      canonicalJson([
        "mirai-intl",
        "classifier-transaction-resolver-frontier",
        3,
        rawIndexBinding.resolverFrontier,
      ])
    ),
  };
  const checkpointAHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-checkpoint-a",
      3,
      value.checkpointAInput,
    ])
  );
  const indexHash = sha256(
    canonicalJson([
      "mirai-intl",
      "generated-facade-candidate-index",
      3,
      indexBinding,
    ])
  );
  const optimizedRequiresProgramVectorHash = sha256(
    canonicalJson([
      "mirai-intl",
      "requires-program-vector",
      3,
      value.optimizedRequiresProgramVector,
    ])
  );
  const referenceRequiresProgramVectorHash = sha256(
    canonicalJson([
      "mirai-intl",
      "requires-program-vector",
      3,
      value.referenceRequiresProgramVector,
    ])
  );
  const artifactBinding = {
    ...(value.artifactBinding as Readonly<Record<string, unknown>>),
    checkpointAHash,
    index: {
      ...indexBinding,
      indexHash,
    },
    optimizedRequiresProgramVector: value.optimizedRequiresProgramVector,
    optimizedRequiresProgramVectorHash,
    referenceRequiresProgramVector: value.referenceRequiresProgramVector,
    referenceRequiresProgramVectorHash,
    sourceIdentities: value.sources.map(({ source, sourceHash }) => ({
      source,
      sourceHash,
    })),
  };
  return buildMiraiIntlClassifierAuthorityV3({
    ...value,
    artifactHash: sha256(
      canonicalJson([
        "mirai-intl",
        "classifier-checkpoint-b",
        3,
        artifactBinding,
      ])
    ),
    artifactBinding,
    checkpointAHash,
    indexBinding,
    indexHash,
    optimizedRequiresProgramVectorHash,
    referenceRequiresProgramVectorHash,
  });
}

function mutateRehashedAuthority(
  authority: MiraiIntlClassifierAuthorityV3,
  mutate: (value: Record<string, unknown>) => void
): MiraiIntlClassifierAuthorityV3 {
  const value = mutableClone(authority) as unknown as Record<string, unknown>;
  delete value.resultHash;
  mutate(value);
  return rehashAuthority(
    value as unknown as Omit<MiraiIntlClassifierAuthorityV3, "resultHash">
  );
}

function classifierAuthorityFixture(
  receipt: IntlCheckReceiptV3,
  workspaceRoot = "/workspace"
): MiraiIntlClassifierAuthorityV3 {
  const binding = first(receipt.classifierBindings);
  const source = `${workspaceRoot}/${binding.source}`;
  const index = first(receipt.candidateIndexes);
  const ledger = [
    ...binding.boundaries.map((reference) => ({
      ...receipt.tables.boundaries[reference],
      source,
    })),
    ...binding.unknownBoundaries.map((reference) => {
      const boundary = receipt.tables.unknownBoundaries[reference];
      if (boundary === undefined) {
        throw new Error("Missing authority fixture unknown boundary");
      }
      return {
        ...boundary,
        nodeHash: hashIntlCheckReceiptV3("unknown-boundary-node", [
          boundary.kind,
          boundary.nodeKind,
          boundary.observationOrdinal,
          boundary.reason,
          source,
          boundary.byteStart,
          boundary.byteEnd,
          boundary.sourceSliceHash,
        ]),
        source,
      };
    }),
  ].toSorted(
    (left, right) =>
      Number(left?.observationOrdinal) - Number(right?.observationOrdinal)
  );
  const boundaryHash = hashIntlCheckReceiptV3("boundary-ledger", ledger);
  const sourceHash = binding.sourceHash;
  const requiresProgram =
    binding.mode === "owner-fallback" || binding.decision !== "facade-absent";
  const requiresProgramVector = [[source, requiresProgram]] as const;
  const checkpointAInput = [
    [source, boundaryHash, binding.decision, sourceHash],
  ] as const;
  const sources = [
    {
      boundaryHash,
      decision: binding.decision,
      requiresProgram,
      source,
      sourceHash,
    },
  ] as const;
  const authorityFiles = (
    receipt.tables.controls[index.control]?.files ?? []
  ).map((reference) => {
    const file = receipt.tables.files[reference];
    if (file === undefined) {
      throw new Error("Missing authority fixture control file");
    }
    return { ...file, path: `${workspaceRoot}/${file.path}` };
  });
  const authorityLstats = index.lstats.map((reference) => {
    const lstat = receipt.tables.lstats[reference];
    if (lstat === undefined) {
      throw new Error("Missing authority fixture lstat");
    }
    return { ...lstat, path: `${workspaceRoot}/${lstat.path}` };
  });
  const authorityProbes = index.probes.map((reference) => {
    const probe = receipt.tables.probes[reference];
    if (probe === undefined) {
      throw new Error("Missing authority fixture probe");
    }
    return { ...probe, path: `${workspaceRoot}/${probe.path}` };
  });
  const authorityRealpaths = index.realpaths.map((reference) => {
    const identity = receipt.tables.realpaths[reference];
    if (identity === undefined) {
      throw new Error("Missing authority fixture realpath");
    }
    return {
      path: `${workspaceRoot}/${identity.path}`,
      target: `${workspaceRoot}/${identity.target}`,
    };
  });
  const resolverFrontier = {
    controlFiles: authorityFiles,
    from: workspaceRoot,
    packageName: null,
    packageVersion: null,
    probes: authorityProbes,
    realpaths: authorityRealpaths,
    specifier: "*transaction-global*",
  };
  const resolverFrontierHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-transaction-resolver-frontier",
      3,
      resolverFrontier,
    ])
  );
  const candidateBoundaryRefs = [
    ...new Set(
      index.projections
        .filter((projection) => projection.status === "candidate")
        .map((projection) => projection.boundary)
    ),
  ].toSorted((left, right) => left - right);
  const requests = binding.requests;
  const facadeSet = [
    ...new Set(
      requests
        .filter(
          (request) =>
            receipt.tables.frontiers[request.frontier]?.resolvedFile ===
            index.facade.file
        )
        .map((request) => request.boundary)
    ),
  ].toSorted((left, right) => left - right);
  const packageScopes = index.packageScopes.map((reference) => {
    const scope = receipt.tables.packageScopes[reference];
    const manifest =
      scope?.manifest === null || scope?.manifest === undefined
        ? undefined
        : receipt.tables.files[scope.manifest];
    if (scope === undefined || manifest === undefined) {
      throw new Error("Missing authority fixture package scope");
    }
    return {
      canonicalRoot: `${workspaceRoot}/${scope.canonicalRoot}`,
      lexicalRoot: `${workspaceRoot}/${scope.lexicalRoot}`,
      manifestHash: manifest.hash,
      manifestPath: `${workspaceRoot}/${manifest.path}`,
    };
  });
  const packageTopology = index.packageScopes.map((reference) => {
    const scope = receipt.tables.packageScopes[reference];
    const manifestFile =
      scope === undefined || scope.manifest === null
        ? undefined
        : receipt.tables.files[scope.manifest];
    const manifest =
      scope === undefined
        ? undefined
        : receipt.tables.lstats[scope.manifestLstat];
    const root =
      scope === undefined ? undefined : receipt.tables.lstats[scope.rootLstat];
    if (scope === undefined || manifest === undefined || root === undefined) {
      throw new Error("Missing authority fixture package topology");
    }
    return {
      canonicalRoot: `${workspaceRoot}/${scope.canonicalRoot}`,
      manifest: { ...manifest, path: `${workspaceRoot}/${manifest.path}` },
      manifestHash: manifestFile?.hash ?? null,
      root: { ...root, path: `${workspaceRoot}/${root.path}` },
    };
  });
  const indexBinding = {
    activeConditions: ["import", "node", "require", "types"],
    analyzerAbi: "mirai-intl-classifier-v3-shadow",
    barePackageProofs: index.projections.flatMap((projection) => {
      const boundary = receipt.tables.boundaries[projection.boundary];
      if (
        boundary === undefined ||
        boundary.specifier.startsWith(".") ||
        boundary.specifier.startsWith("#") ||
        boundary.specifier.startsWith("/")
      ) {
        return [];
      }
      const request = requests.find(
        (candidate) => candidate.boundary === projection.boundary
      );
      const frontier =
        request === undefined
          ? undefined
          : receipt.tables.frontiers[request.frontier];
      const controlFiles =
        frontier === undefined
          ? []
          : (receipt.tables.controls[frontier.control]?.files ?? []).map(
              (reference) => {
                const file = receipt.tables.files[reference];
                if (file === undefined) {
                  throw new Error("Missing bare-package control file");
                }
                return { ...file, path: `${workspaceRoot}/${file.path}` };
              }
            );
      const resolvedFile =
        frontier?.resolvedFile === null || frontier?.resolvedFile === undefined
          ? undefined
          : receipt.tables.files[frontier.resolvedFile];
      return [
        {
          boundary: projection.boundary,
          controlFiles,
          packageName: frontier?.packageName ?? null,
          packageVersion: frontier?.packageVersion ?? null,
          resolvedFileName:
            resolvedFile === undefined
              ? null
              : `${workspaceRoot}/${resolvedFile.path}`,
          resolverFrontierHash,
          status:
            projection.status === "candidate"
              ? ("candidate" as const)
              : ("proven-disjoint" as const),
        },
      ];
    }),
    candidateBoundaryRefs,
    canonicalRoot: `${workspaceRoot}/packages/app`,
    controls: authorityFiles,
    facade: `${workspaceRoot}/src/generated.ts`,
    lexicalRoot: `${workspaceRoot}/packages/app`,
    lstats: authorityLstats,
    mode: index.mode,
    optionsHash: index.optionsHash,
    owner: index.owner,
    packageScopes,
    packageTopology,
    probes: authorityProbes,
    projections: index.projections.map((projection) => ({
      boundary: projection.boundary,
      canonicalRoot: `${workspaceRoot}/${projection.canonicalRoot}`,
      lexicalRoot: `${workspaceRoot}/${projection.lexicalRoot}`,
      proofKind: projection.proofKind,
      status: projection.status,
    })),
    realpaths: authorityRealpaths,
    reasons: [],
    resolverFrontier,
    resolverFrontierHash,
  };
  const boundaryRefs = binding.boundaries;
  const boundaryKinds = boundaryRefs.map(
    (reference) => receipt.tables.boundaries[reference]?.kind
  );
  const artifactBinding = {
    boundaryCategoryCounts: Object.fromEntries(
      [...new Set(boundaryKinds)]
        .filter((kind): kind is NonNullable<typeof kind> => kind !== undefined)
        .map((kind) => [
          kind,
          boundaryKinds.filter((candidate) => candidate === kind).length,
        ])
    ),
    candidateRequests: candidateBoundaryRefs.length,
    candidateSet: candidateBoundaryRefs,
    checkpointAHash: hash("embedded-checkpoint-a"),
    fallbackReasonCounts: {},
    facadeImports: facadeSet.length,
    falseNegatives: 0,
    falsePositives: 0,
    index: { ...indexBinding, indexHash: hash("embedded-index") },
    optimizedFacadeSet: facadeSet,
    optimizedRequiresProgramVector: requiresProgramVector,
    optimizedRequiresProgramVectorHash: hash("embedded-optimized-vector"),
    ownerFallbacks: 0,
    ownerMode: index.mode,
    referenceBoundaries: boundaryRefs.length,
    referenceFacadeSet: facadeSet,
    referenceRequiresProgramVector: requiresProgramVector,
    referenceRequiresProgramVectorHash: hash("embedded-reference-vector"),
    resolverCounters: {
      cacheHits: 0,
      hostCalls: 0,
      programs: 0,
      resolverCalls: requests.length,
    },
    resolverFrontier: indexBinding.resolverFrontier,
    sourceCount: 1,
    unknownBoundaries: binding.unknownBoundaries.length,
  };
  return rehashAuthority({
    artifactBinding,
    artifactHash: hash("placeholder"),
    checkpointAHash: hash("placeholder"),
    checkpointAInput,
    indexBinding,
    indexHash: hash("placeholder"),
    inputHash: hash("classifier-input"),
    optimizedRequiresProgramVector: requiresProgramVector,
    optimizedRequiresProgramVectorHash: hash("placeholder"),
    receiptProjectionHash: hash("fixture-receipt-projection"),
    referenceRequiresProgramVector: requiresProgramVector,
    referenceRequiresProgramVectorHash: hash("placeholder"),
    sources,
    workspaceRoot,
  });
}

function nativeInputFromV3(
  receipt: IntlCheckReceiptV3
): IntlCheckReceiptV3NativeInput {
  const file = (reference: number) => {
    const identity = receipt.tables.files[reference];
    if (identity === undefined) {
      throw new Error(`Missing V3 fixture file ${reference}`);
    }
    return identity;
  };
  const probe = (reference: number) => {
    const identity = receipt.tables.probes[reference];
    if (identity === undefined) {
      throw new Error(`Missing V3 fixture probe ${reference}`);
    }
    return identity;
  };
  const realpathIdentity = (reference: number) => {
    const identity = receipt.tables.realpaths[reference];
    if (identity === undefined) {
      throw new Error(`Missing V3 fixture realpath ${reference}`);
    }
    return identity;
  };
  const frontier = (reference: number) => {
    const identity = receipt.tables.frontiers[reference];
    if (identity === undefined) {
      throw new Error(`Missing V3 fixture frontier ${reference}`);
    }
    return identity;
  };
  return {
    application: {
      packageManifest: file(receipt.application.packageManifest),
      workspaceLockfile: file(receipt.application.workspaceLockfile),
    },
    artifactAbi: receipt.artifactAbi,
    compilerManifest: receipt.compilerManifest.map(file),
    exceptions: receipt.exceptions,
    generationReceiptHash: receipt.generationReceiptHash,
    icu: receipt.icu,
    observedCounters: {
      semanticAuthorizationRuns: 1,
      semanticFilesAnalyzed: receipt.providerClosures.length,
    },
    projects: receipt.projects.map((project) => ({
      configManifest: project.configManifest.map((config) => ({
        extends: config.extends,
        hash: file(config.file).hash,
        path: config.path,
        references: config.references,
      })),
      normalizedOptions: project.normalizedOptions,
      path: project.path,
      role: project.role,
      rootFiles: project.rootFiles,
    })),
    providerClosures: receipt.providerClosures.map((closure) => ({
      ambientTypeFileLimit: closure.ambientTypeFileLimit,
      declarations: closure.declarations.map(file),
      libs: closure.libs.map(file),
      providerBudgetExceeded: false,
      providerRootLimit: closure.providerRootLimit,
      providers: closure.providers.map((provider) => ({
        declarations: provider.declarations.map(file),
        kind: provider.kind,
        resolutions: provider.resolutions.map((resolution) => {
          const evidence = frontier(resolution.frontier);
          return {
            controlFiles:
              receipt.tables.controls[evidence.control]?.files.map(file) ?? [],
            from: resolution.from,
            optionsHash: canonicalHash(
              first(receipt.projects).normalizedOptions
            ),
            packageName: evidence.packageName,
            packageVersion: evidence.packageVersion,
            probes: evidence.probes.map(probe),
            realpaths: evidence.realpaths.map(realpathIdentity),
            specifier: resolution.specifier,
          };
        }),
        root: provider.root,
      })),
      source: closure.source,
    })),
    runtimeAbi: receipt.runtimeAbi,
    sources: receipt.sources.map(
      ({ file: source, hash: sourceHash, owner, verdict }) => ({
        file: source,
        hash: sourceHash,
        owner,
        verdict,
      })
    ),
    typescript: {
      libs: receipt.typescript.libs.map(file),
      package: receipt.typescript.package,
    },
  };
}

function v2FixtureFromV3(receipt: IntlCheckReceiptV3): IntlCheckReceiptV2 {
  return buildIntlCheckReceiptV2(
    buildSourceAuthorizationSnapshot(nativeInputFromV3(receipt))
  );
}

function classifierProjectionFixture(
  receipt: IntlCheckReceiptV3,
  authorityValue = classifierAuthorityFixture(receipt),
  workspaceRoot = "/workspace"
): Readonly<{
  authority: MiraiIntlClassifierAuthorityV3;
  projection: MiraiIntlClassifierReceiptProjectionV3;
}> {
  const binding = first(receipt.classifierBindings);
  const index = first(receipt.candidateIndexes);
  const projectionFile = (reference: number) => {
    const identity = receipt.tables.files[reference];
    if (identity === undefined) {
      throw new Error(`Missing projection fixture file ${reference}`);
    }
    return identity;
  };
  const projectionProbe = (reference: number) => {
    const identity = receipt.tables.probes[reference];
    if (identity === undefined) {
      throw new Error(`Missing projection fixture probe ${reference}`);
    }
    return identity;
  };
  const projectionRealpath = (reference: number) => {
    const identity = receipt.tables.realpaths[reference];
    if (identity === undefined) {
      throw new Error(`Missing projection fixture realpath ${reference}`);
    }
    return identity;
  };
  const absoluteSource = `${workspaceRoot}/${binding.source}`;
  const boundaries = binding.boundaries.map((reference) => {
    const boundary = receipt.tables.boundaries[reference];
    if (boundary === undefined) {
      throw new Error("Missing projection fixture boundary");
    }
    return {
      ...boundary,
      impliedNodeFormat: boundary.resolutionMode,
      nodeKind: "ImportDeclaration",
      source: `${workspaceRoot}/${boundary.source}`,
      sourceExtension: ".ts",
    };
  });
  const unknownBoundaries = binding.unknownBoundaries.map((reference) => {
    const boundary = receipt.tables.unknownBoundaries[reference];
    if (boundary === undefined) {
      throw new Error("Missing projection fixture unknown boundary");
    }
    const source = `${workspaceRoot}/${boundary.source}`;
    return {
      ...boundary,
      nodeHash: hashIntlCheckReceiptV3("unknown-boundary-node", [
        boundary.kind,
        boundary.nodeKind,
        boundary.observationOrdinal,
        boundary.reason,
        source,
        boundary.byteStart,
        boundary.byteEnd,
        boundary.sourceSliceHash,
      ]),
      source,
    };
  });
  const ledger = [
    ...boundaries.map(
      ({
        impliedNodeFormat: _implied,
        nodeKind: _nodeKind,
        sourceExtension: _extension,
        ...boundary
      }) => boundary
    ),
    ...unknownBoundaries,
  ].toSorted(
    (left, right) => left.observationOrdinal - right.observationOrdinal
  );
  const receiptRequests = binding.requests;
  const requests = [
    ...new Map(
      receiptRequests.map((request) => [canonicalJson(request), request])
    ).values(),
  ].map((resolution) => {
    const boundary = boundaries.find(
      (candidate) =>
        candidate.ordinal ===
        receipt.tables.boundaries[resolution.boundary]?.ordinal
    );
    const frontier = receipt.tables.frontiers[resolution.frontier];
    if (boundary === undefined || frontier === undefined) {
      throw new Error("Missing projection fixture request evidence");
    }
    const resolvedFile =
      frontier.resolvedFile === null
        ? undefined
        : receipt.tables.files[frontier.resolvedFile];
    return {
      boundary,
      canonicalTarget:
        resolvedFile === undefined
          ? null
          : `${workspaceRoot}/${resolvedFile.path}`,
      frontier: {
        controlFiles:
          receipt.tables.controls[frontier.control]?.files.map((reference) => {
            const identity = projectionFile(reference);
            return { ...identity, path: `${workspaceRoot}/${identity.path}` };
          }) ?? [],
        from: absoluteSource,
        packageName: frontier.packageName,
        packageVersion: frontier.packageVersion,
        probes: frontier.probes.map((reference) => {
          const identity = projectionProbe(reference);
          return { ...identity, path: `${workspaceRoot}/${identity.path}` };
        }),
        realpaths: frontier.realpaths.map((reference) => {
          const identity = projectionRealpath(reference);
          return {
            path: `${workspaceRoot}/${identity.path}`,
            target: `${workspaceRoot}/${identity.target}`,
          };
        }),
        specifier: resolution.specifier,
      },
      resolutionMode: resolution.resolutionMode,
      resolvedFileName:
        resolvedFile === undefined
          ? null
          : `${workspaceRoot}/${resolvedFile.path}`,
    };
  });
  const source = {
    ambiguous: false,
    boundaries,
    boundaryHash: hashIntlCheckReceiptV3("boundary-ledger", ledger),
    boundaryHashInput: canonicalJson([
      "mirai-intl",
      "boundary-ledger",
      3,
      ledger,
    ]),
    counters: {
      boundaries: boundaries.length,
      generatedFacadeBoundaries: binding.decision === "facade-present" ? 1 : 0,
      referenceRequests: requests.length,
      resolutionFailures: 0,
      unknownBoundaries: unknownBoundaries.length,
    },
    decision: binding.decision,
    generatedFacadeOrdinals:
      binding.decision === "facade-present" ? [first(boundaries).ordinal] : [],
    ledger,
    requests,
    requiresProgram: binding.decision !== "facade-absent",
    resolutionFailures: [],
    source: absoluteSource,
    sourceHash: binding.sourceHash,
    unknownBoundaries,
  };
  const artifactBinding = authorityValue.artifactBinding as Omit<
    MiraiIntlCandidateCheckpointShadow,
    "artifactHash" | "sources" | "timings"
  >;
  const projection = {
    checkpoint: {
      ...artifactBinding,
      artifactHash: authorityValue.artifactHash,
    },
    generatedFacadeHash:
      receipt.tables.files[index.facade.file]?.hash ?? sha256("missing-facade"),
    generatedFacadePath: `${workspaceRoot}/${receipt.tables.files[index.facade.file]?.path}`,
    inputHash: authorityValue.inputHash,
    owner: index.owner,
    sources: [source],
    workspaceRoot,
  } satisfies MiraiIntlClassifierReceiptProjectionV3;
  const receiptProjectionHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-receipt-projection",
      3,
      projection,
    ])
  );
  const authority = mutateRehashedAuthority(authorityValue, (value) => {
    value.receiptProjectionHash = receiptProjectionHash;
  });
  return { authority, projection };
}

function rebindProjectionFixture(
  evidence: ReturnType<typeof classifierProjectionFixture>,
  projection: MiraiIntlClassifierReceiptProjectionV3
): ReturnType<typeof classifierProjectionFixture> {
  const receiptProjectionHash = sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-receipt-projection",
      3,
      projection,
    ])
  );
  return {
    authority: mutateRehashedAuthority(evidence.authority, (value) => {
      value.receiptProjectionHash = receiptProjectionHash;
    }),
    projection,
  };
}

function repeatedFixtureInput(sourceCount: number): IntlCheckReceiptV3 {
  const raw = rawFixture();
  const semanticFrontier = raw.tables.frontiers.findIndex(
    (frontier) => frontier.resolutionMode === "default"
  );
  const sourceNames = Array.from(
    { length: sourceCount },
    (_, index) => `src/repeated/${index.toString().padStart(4, "0")}.ts`
  );
  raw.tables.boundaries = sourceNames.flatMap((source) => [
    {
      kind: "import",
      observationOrdinal: 0,
      ordinal: 0,
      resolutionMode: "import",
      source,
      specifier: "@app/generated",
    },
    {
      kind: "import",
      observationOrdinal: 1,
      ordinal: 1,
      resolutionMode: "import",
      source,
      specifier: "@other/value",
    },
  ]);
  first(raw.candidateIndexes).projections = raw.tables.boundaries.map(
    (boundary, boundaryReference) => ({
      boundary: boundaryReference,
      canonicalRoot: boundary.ordinal === 0 ? "packages/app" : "packages/other",
      control: 0,
      lexicalRoot: boundary.ordinal === 0 ? "packages/app" : "packages/other",
      lstats: [0, 1],
      packageScopes: [0],
      probes: [0, 1],
      proofKind:
        boundary.ordinal === 0
          ? GeneratedFacadeProjectionProofKindV3.FACADE_PACKAGE_EXPORT
          : GeneratedFacadeProjectionProofKindV3.UNMAPPED_EXTERNAL,
      realpaths: [0],
      status: boundary.ordinal === 0 ? "candidate" : "disjoint",
    })
  );
  raw.classifierBindings = sourceNames.map((source, index) => ({
    bindingHash: hash("placeholder"),
    boundaries: [index * 2, index * 2 + 1],
    boundaryHash: hash("placeholder"),
    candidateIndex: 0,
    candidateIndexHash: hash("placeholder"),
    decision: "facade-present",
    mode: "filtered",
    requests: [
      {
        boundary: index * 2,
        frontier: 0,
        from: source,
        resolutionMode: "import",
        specifier: "@app/generated",
      },
    ],
    source,
    sourceHash: hash(source),
    unknownBoundaries: [],
  }));
  raw.providerClosures = sourceNames.map((source) => ({
    ambientTypeFileLimit: 1,
    closureHash: hash("placeholder"),
    declarationHash: hash("placeholder"),
    declarations: [2],
    libHash: hash("placeholder"),
    libs: [5],
    providerBudgetExceeded: false,
    providerRootLimit: 1,
    providers: [
      {
        declarationHash: hash("placeholder"),
        declarations: [2],
        hash: hash("placeholder"),
        kind: "generated",
        resolutions: [
          {
            frontier: semanticFrontier,
            from: source,
            specifier: "@app/generated",
          },
        ],
        root: "packages/app",
      },
    ],
    source,
  }));
  raw.sources = sourceNames.map((source) => ({
    classifierBindingHash: hash("placeholder"),
    file: source,
    hash: hash(source),
    owner: "tsconfig.json",
    providerClosureHash: hash("placeholder"),
    verdict: "accepted",
  }));
  first(raw.projects).rootFiles = sourceNames;
  return raw;
}

function productionCardinalityFixtureInput(): IntlCheckReceiptV3 {
  const input = rawFixture();
  const candidateCount = 343;
  const facadeCount = 80;
  input.tables.boundaries = Array.from(
    { length: candidateCount },
    (_, ordinal) => ({
      kind: "import" as const,
      observationOrdinal: ordinal,
      ordinal,
      resolutionMode: "import" as const,
      source: "src/main.ts",
      specifier: `./candidate-${ordinal.toString().padStart(3, "0")}`,
    })
  );
  first(input.candidateIndexes).projections = input.tables.boundaries.map(
    (_, boundary) => ({
      boundary,
      canonicalRoot: "packages/app",
      control: 0,
      lexicalRoot: "packages/app",
      lstats: [0, 1],
      packageScopes: [0],
      probes: [0, 1],
      proofKind: GeneratedFacadeProjectionProofKindV3.RELATIVE_DIRECT,
      realpaths: [0],
      status: "candidate" as const,
    })
  );
  const binding = first(input.classifierBindings);
  binding.boundaries = Array.from(
    { length: candidateCount },
    (_, index) => index
  );
  const classifierFrontier = at(
    input.tables.frontiers,
    first(binding.requests).frontier
  );
  const semanticResolution = first(
    first(first(input.providerClosures).providers).resolutions
  );
  const semanticFrontier = at(
    input.tables.frontiers,
    semanticResolution.frontier
  );
  const disjointFrontier = {
    control: 0,
    frontierHash: hash("disjoint-frontier-placeholder"),
    lstats: [0, 1],
    optionsHash: classifierFrontier.optionsHash,
    packageName: null,
    packageVersion: null,
    probes: [0, 1],
    realpaths: [0],
    resolutionMode: "import" as const,
    resolvedFile: null,
  };
  input.tables.frontiers = [
    classifierFrontier,
    semanticFrontier,
    disjointFrontier,
  ].toSorted((left, right) =>
    compareText(left.frontierHash, right.frontierHash)
  );
  const classifierFrontierReference =
    input.tables.frontiers.indexOf(classifierFrontier);
  const semanticFrontierReference =
    input.tables.frontiers.indexOf(semanticFrontier);
  const disjointFrontierReference =
    input.tables.frontiers.indexOf(disjointFrontier);
  semanticResolution.frontier = semanticFrontierReference;
  binding.requests = Array.from({ length: candidateCount }, (_, boundary) => ({
    boundary,
    frontier:
      boundary < facadeCount
        ? classifierFrontierReference
        : disjointFrontierReference,
    from: "src/main.ts",
    resolutionMode: "import" as const,
    specifier: input.tables.boundaries[boundary]?.specifier ?? "./missing",
  })).toSorted((left, right) =>
    compareText(
      canonicalJson([
        left.boundary,
        left.from,
        left.specifier,
        left.resolutionMode,
        input.tables.frontiers[left.frontier]?.frontierHash,
      ]),
      canonicalJson([
        right.boundary,
        right.from,
        right.specifier,
        right.resolutionMode,
        input.tables.frontiers[right.frontier]?.frontierHash,
      ])
    )
  );
  first(first(first(input.providerClosures).providers).resolutions).specifier =
    first(input.tables.boundaries).specifier;
  return input;
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

describe("authorization snapshot V3", () => {
  it("builds, parses, canonicalizes, and discriminates a normalized V3 receipt", () => {
    const receipt = fixture();
    const bytes = canonicalIntlCheckReceiptV3Bytes(receipt);

    expect(parseIntlCheckReceiptV3(receipt)).toEqual(receipt);
    expect(parseIntlCheckReceipt(receipt).schemaVersion).toBe(3);
    expect(parseCanonicalIntlCheckReceiptV3(bytes)).toEqual(receipt);
    expect(parseCanonicalIntlCheckReceipt(bytes).schemaVersion).toBe(3);
  });

  it("binds validated classifier authority into deterministic dormant V3 identity", () => {
    const input = rawFixture();
    const receipt = buildIntlCheckReceiptV3(input);
    const authority = classifierAuthorityFixture(receipt);
    const firstBinding = buildIntlCheckReceiptV3ClassifierAuthorityBinding(
      input,
      [authority]
    );
    const second = buildIntlCheckReceiptV3ClassifierAuthorityBinding(
      mutableClone(input),
      [mutableClone(authority)]
    );

    expect(firstBinding.receiptBytes).toBe(
      canonicalIntlCheckReceiptV3Bytes(receipt)
    );
    expect(second.receiptBytes).toBe(firstBinding.receiptBytes);
    expect(second.authorityBytes).toBe(firstBinding.authorityBytes);
    expect(second.authorityHash).toBe(firstBinding.authorityHash);
    expect(second.receiptHash).toBe(firstBinding.receiptHash);
    expect(second.inputIdentityHash).toBe(firstBinding.inputIdentityHash);
    expect(firstBinding.authorityHash).toBe(
      sha256(firstBinding.authorityBytes)
    );
    expect(firstBinding.receiptHash).toBe(sha256(firstBinding.receiptBytes));
    const persistedAuthority = first(
      parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
        firstBinding.authorityBytes
      ).authorities
    );
    expect(firstBinding.authorityHashes).toEqual([
      {
        artifactHash: persistedAuthority.artifactHash,
        checkpointAHash: persistedAuthority.checkpointAHash,
        indexHash: persistedAuthority.indexHash,
        optimizedRequiresProgramVectorHash:
          persistedAuthority.optimizedRequiresProgramVectorHash,
        referenceRequiresProgramVectorHash:
          persistedAuthority.referenceRequiresProgramVectorHash,
      },
    ]);

    const authorityChanged = buildIntlCheckReceiptV3ClassifierAuthorityBinding(
      input,
      [
        mutateRehashedAuthority(authority, (value) => {
          value.inputHash = hash("changed-classifier-input");
        }),
      ]
    );
    const receiptInputChanged = mutableClone(input);
    receiptInputChanged.generationReceiptHash = hash("changed-generation");
    const receiptChanged = buildIntlCheckReceiptV3ClassifierAuthorityBinding(
      receiptInputChanged,
      [authority]
    );

    expect(authorityChanged.authorityBytes).toBe(firstBinding.authorityBytes);
    expect(authorityChanged.inputIdentityHash).toBe(
      firstBinding.inputIdentityHash
    );
    expect(receiptChanged.receiptBytes).not.toBe(firstBinding.receiptBytes);
    expect(receiptChanged.inputIdentityHash).not.toBe(
      firstBinding.inputIdentityHash
    );
  });

  it("projects classifier and semantic provider evidence into independent V3 frontiers", () => {
    const fixtureReceipt = fixture();
    const receiptV2 = v2FixtureFromV3(fixtureReceipt);
    const evidence = classifierProjectionFixture(fixtureReceipt);
    const expectedInput = mutableClone(fixtureReceipt);
    for (const index of expectedInput.candidateIndexes) {
      for (const projection of index.projections) {
        projection.lstats = [];
        projection.packageScopes = [];
        projection.probes = [];
        projection.realpaths = [];
      }
    }
    const expected = buildIntlCheckReceiptV3(expectedInput);
    const before = canonicalIntlCheckReceiptV2Bytes(receiptV2);

    const result = buildIntlCheckReceiptV3FromClassifierProjections(receiptV2, [
      evidence,
    ]);

    expect(result.receipt.classifierBindings).toEqual(
      expected.classifierBindings
    );
    const providerResolution = first(
      first(first(result.receipt.providerClosures).providers).resolutions
    );
    expect(providerResolution).not.toHaveProperty("boundary");
    expect(
      result.receipt.tables.frontiers[providerResolution.frontier]
    ).toMatchObject({ resolutionMode: "default", resolvedFile: null });
    expect(parseCanonicalIntlCheckReceiptV3(result.receiptBytes)).toEqual(
      result.receipt
    );
    expect(canonicalIntlCheckReceiptV2Bytes(receiptV2)).toBe(before);
  });

  it("preserves canonical ABI across independently allocated projection graphs", () => {
    const fixtureReceipt = fixture();
    const receiptV2 = v2FixtureFromV3(fixtureReceipt);
    const evidence = classifierProjectionFixture(fixtureReceipt);
    const before = canonicalIntlCheckReceiptV2Bytes(receiptV2);

    const result = buildIntlCheckReceiptV3FromClassifierProjections(receiptV2, [
      evidence,
    ]);
    const repeated = buildIntlCheckReceiptV3FromClassifierProjections(
      mutableClone(receiptV2),
      [mutableClone(evidence)]
    );

    expect(result.receipt.tables.frontiers).toHaveLength(2);
    expect(repeated.receiptBytes).toBe(result.receiptBytes);
    expect(parseCanonicalIntlCheckReceiptV3(result.receiptBytes)).toEqual(
      result.receipt
    );
    expect(canonicalIntlCheckReceiptV2Bytes(receiptV2)).toBe(before);
  });

  it("assembles native V3 with complete lexical authority and no invented semantic closure", () => {
    const input = rawFixture();
    const binding = first(input.classifierBindings);
    binding.decision = "facade-absent";
    binding.requests = [];
    input.providerClosures = [];
    input.tables.frontiers = [];
    first(input.sources).providerClosureHash = null;
    for (const projection of first(input.candidateIndexes).projections) {
      projection.canonicalRoot = "packages/other";
      projection.lexicalRoot = "packages/other";
      projection.status = "disjoint";
    }
    const candidateIndex = first(input.candidateIndexes);
    candidateIndex.probes = [0];
    candidateIndex.facade.probes = [0];
    for (const projection of candidateIndex.projections) {
      projection.probes = [0];
    }
    const expected = buildIntlCheckReceiptV3(input);
    const nativeInput = mutableClone(nativeInputFromV3(expected));
    const canonicalManifestHash = hash("canonical-application-manifest");
    const manifestPath = nativeInput.application.packageManifest.path;
    nativeInput.application.packageManifest.hash = canonicalManifestHash;
    const result = buildIntlCheckReceiptV3FromNativeInputs(nativeInput, [
      classifierProjectionFixture(expected),
    ]);

    expect(result.receipt.sources).toEqual([
      expect.objectContaining({ providerClosureHash: null }),
    ]);
    expect(result.receipt.providerClosures).toEqual([]);
    const resultScope = first(result.receipt.tables.packageScopes);
    expect(result.receipt.tables.probes[resultScope.manifestProbe]).toEqual({
      kind: "file",
      path: manifestPath,
      present: true,
    });
    expect(
      result.receipt.tables.files[result.receipt.application.packageManifest]
    ).toEqual({ hash: canonicalManifestHash, path: manifestPath });
    expect(
      result.receipt.tables.files.filter((file) => file.path === manifestPath)
    ).toHaveLength(2);
    expect(result.receipt.counters).toMatchObject({
      classifierSourcesBound: 1,
      lexicalFilesClassified: 1,
      semanticFilesAnalyzed: 0,
      sourceFiles: 1,
    });
    expect(parseCanonicalIntlCheckReceiptV3(result.receiptBytes)).toEqual(
      result.receipt
    );
  });

  it("keeps native semantic frontiers distinct for owner resolver options", () => {
    const primary = fixture();
    const secondary = alternateOwnerFixture();
    const primaryInput = mutableClone(nativeInputFromV3(primary));
    const secondaryInput = mutableClone(nativeInputFromV3(secondary));
    const commonControlFiles = [
      primaryInput.application.packageManifest,
      primaryInput.application.workspaceLockfile,
    ];
    const primaryResolution = first(
      first(first(primaryInput.providerClosures).providers).resolutions
    );
    const secondaryResolution = first(
      first(first(secondaryInput.providerClosures).providers).resolutions
    );
    primaryResolution.controlFiles = commonControlFiles;
    secondaryResolution.controlFiles = commonControlFiles;
    const input: IntlCheckReceiptV3NativeInput = {
      ...primaryInput,
      compilerManifest: [
        ...primaryInput.compilerManifest,
        ...secondaryInput.compilerManifest,
      ].filter(
        (file, index, files) =>
          files.findIndex(
            (candidate) =>
              candidate.path === file.path && candidate.hash === file.hash
          ) === index
      ),
      observedCounters: {
        semanticAuthorizationRuns: 1,
        semanticFilesAnalyzed: 2,
      },
      projects: [...primaryInput.projects, ...secondaryInput.projects],
      providerClosures: [
        ...primaryInput.providerClosures,
        ...secondaryInput.providerClosures,
      ],
      sources: [...primaryInput.sources, ...secondaryInput.sources],
    };

    const result = buildIntlCheckReceiptV3FromNativeInputs(input, [
      classifierProjectionFixture(primary),
      classifierProjectionFixture(secondary),
    ]).receipt;
    const semanticFrontiers = result.providerClosures.map((closure) => {
      const resolution = first(first(closure.providers).resolutions);
      return at(result.tables.frontiers, resolution.frontier);
    });
    const [primaryFrontier, secondaryFrontier] = semanticFrontiers;
    if (primaryFrontier === undefined || secondaryFrontier === undefined) {
      throw new Error("Expected two semantic frontier identities");
    }
    expect(primaryFrontier.optionsHash).not.toBe(secondaryFrontier.optionsHash);
    expect(primaryFrontier.frontierHash).not.toBe(
      secondaryFrontier.frontierHash
    );
    expect({
      ...primaryFrontier,
      frontierHash: null,
      optionsHash: null,
    }).toEqual({ ...secondaryFrontier, frontierHash: null, optionsHash: null });
  });

  it("fails closed when classifier/program closure presence disagrees", () => {
    const present = fixture();
    const missingClosure = mutableClone(present);
    missingClosure.providerClosures = [];
    first(missingClosure.sources).providerClosureHash = null;
    expect(() => buildIntlCheckReceiptV3(missingClosure)).toThrow(
      /requires exactly one matching provider closure/u
    );

    const absentInput = rawFixture();
    const binding = first(absentInput.classifierBindings);
    binding.decision = "facade-absent";
    binding.requests = [];
    for (const projection of first(absentInput.candidateIndexes).projections) {
      projection.canonicalRoot = "packages/other";
      projection.lexicalRoot = "packages/other";
      projection.status = "disjoint";
    }
    expect(() => buildIntlCheckReceiptV3(absentInput)).toThrow(
      /must omit semantic provider closure evidence/u
    );
  });

  it("normalizes complete literal and unknown ledgers without losing byte evidence", () => {
    const { input, sourceBytes } = unknownFixtureInput();
    const verification = { readSourceBytes: () => sourceBytes };
    const expected = buildIntlCheckReceiptV3(
      input,
      createIntlCheckReceiptV3HashMetrics(),
      verification
    );
    const receiptV2 = v2FixtureFromV3(expected);
    const evidence = classifierProjectionFixture(expected);

    const result = buildIntlCheckReceiptV3FromClassifierProjections(
      receiptV2,
      [evidence],
      createIntlCheckReceiptV3HashMetrics(),
      verification
    );

    expect(result.receipt.tables.unknownBoundaries).toHaveLength(2);
    expect(result.receipt.classifierBindings).toMatchObject([
      {
        decision: "facade-unknown-active",
        unknownBoundaries: [0, 1],
      },
    ]);
  });

  it("produces root-independent V3 bytes from independently sealed projections", () => {
    const expected = fixture();
    const receiptV2 = v2FixtureFromV3(expected);
    const firstEvidence = classifierProjectionFixture(
      expected,
      classifierAuthorityFixture(expected, "/workspace-a"),
      "/workspace-a"
    );
    const secondEvidence = classifierProjectionFixture(
      expected,
      classifierAuthorityFixture(expected, "/clone/workspace-b"),
      "/clone/workspace-b"
    );

    const firstResult = buildIntlCheckReceiptV3FromClassifierProjections(
      receiptV2,
      [firstEvidence]
    );
    const secondResult = buildIntlCheckReceiptV3FromClassifierProjections(
      receiptV2,
      [secondEvidence]
    );

    expect(secondResult.receiptBytes).toBe(firstResult.receiptBytes);
    expect(secondResult.receiptHash).toBe(firstResult.receiptHash);
    expect(secondResult.authorityBytes).toBe(firstResult.authorityBytes);
    expect(secondResult.authorityHash).toBe(firstResult.authorityHash);
    expect(firstResult.authorityBytes).not.toContain("/workspace-a");
    expect(firstResult.authorityBytes).not.toContain("/clone/workspace-b");

    const envelope = parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
      firstResult.authorityBytes
    );
    const verified = buildIntlCheckReceiptV3PersistedAuthorityBinding(
      firstResult.receipt,
      envelope
    );
    expect(verified.authorityBytes).toBe(firstResult.authorityBytes);
    expect(verified.inputIdentityHash).toBe(firstResult.inputIdentityHash);
  });

  it("rejects stale and legacy absolute persisted authority envelopes", () => {
    const expected = fixture();
    const receiptV2 = v2FixtureFromV3(expected);
    const result = buildIntlCheckReceiptV3FromClassifierProjections(receiptV2, [
      classifierProjectionFixture(expected),
    ]);
    const envelope = parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
      result.authorityBytes
    );

    expect(() =>
      buildIntlCheckReceiptV3PersistedAuthorityBinding(expected, {
        ...envelope,
        receiptHash: hash("stale-receipt"),
      })
    ).toThrow(/does not exactly bind/u);
    expect(() =>
      buildIntlCheckReceiptV3PersistedAuthorityBinding(expected, {
        authorities: [classifierAuthorityFixture(expected)],
        receiptHash: result.receiptHash,
        schemaVersion: 3,
        sourceAuthorizationHash: expected.sourceAuthorizationHash,
      } as never)
    ).toThrow(/Cannot read properties of undefined|portable|persisted|owner/u);
  });

  it.each([
    [
      "generated facade hash",
      (evidence: ReturnType<typeof classifierProjectionFixture>) => ({
        ...evidence,
        projection: {
          ...evidence.projection,
          generatedFacadeHash: hash("hostile-generated-facade"),
        },
      }),
      /conflicts with an existing file identity|hash-bound classifier authority/u,
    ],
    [
      "projection hash",
      (evidence: ReturnType<typeof classifierProjectionFixture>) => {
        const projection = mutableClone(evidence.projection);
        projection.inputHash = hash("hostile-projection-input");
        return rebindProjectionFixture(evidence, projection);
      },
      /hash-bound classifier authority/u,
    ],
    [
      "source coverage",
      (evidence: ReturnType<typeof classifierProjectionFixture>) =>
        rebindProjectionFixture(evidence, {
          ...evidence.projection,
          sources: [],
        }),
      /source universe/u,
    ],
    [
      "owner identity",
      (evidence: ReturnType<typeof classifierProjectionFixture>) =>
        rebindProjectionFixture(evidence, {
          ...evidence.projection,
          owner: "other-tsconfig.json",
        }),
      /owner identity/u,
    ],
  ] as const)(
    "rejects incomplete or mismatched %s evidence",
    (_name, mutate, pattern) => {
      const expected = fixture();
      const receiptV2 = v2FixtureFromV3(expected);
      expect(() =>
        buildIntlCheckReceiptV3FromClassifierProjections(receiptV2, [
          mutate(classifierProjectionFixture(expected)),
        ])
      ).toThrow(pattern);
    }
  );

  it("rejects non-canonical literal-boundary ordering instead of changing meaning", () => {
    const expected = fixture();
    const receiptV2 = v2FixtureFromV3(expected);
    const evidence = classifierProjectionFixture(expected);
    const source = first(evidence.projection.sources);
    const projection = {
      ...evidence.projection,
      sources: [
        {
          ...source,
          boundaries: [...source.boundaries].toReversed(),
        },
      ],
    } as MiraiIntlClassifierReceiptProjectionV3;

    expect(() =>
      buildIntlCheckReceiptV3FromClassifierProjections(receiptV2, [
        rebindProjectionFixture(evidence, projection),
      ])
    ).toThrow(/non-contiguous literal boundary ordinal/u);
  });

  it("keeps the projection builder runtime import graph TypeScript-free", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../src/authorization-snapshot.ts", import.meta.url),
        "utf8"
      )
    );
    expect(source).toContain(
      'import type { MiraiIntlClassifierReceiptProjectionV3 } from "./classifier-candidate";'
    );
    expect(source).not.toMatch(
      /import(?:\s+type)?\s+.*from ["']typescript["']/u
    );
  });

  it.each([
    [
      "indexHash",
      (authority: MiraiIntlClassifierAuthorityV3) => {
        const { resultHash: _resultHash, ...binding } = mutableClone(authority);
        return rehashAuthority({
          ...binding,
          indexBinding: {
            ...(binding.indexBinding as Readonly<Record<string, unknown>>),
            owner: "other-tsconfig.json",
          },
        });
      },
    ],
    [
      "checkpointAHash",
      (authority: MiraiIntlClassifierAuthorityV3) => {
        const { resultHash: _resultHash, ...binding } = mutableClone(authority);
        const [source, _boundaryHash, decision, sourceHash] = first(
          binding.checkpointAInput
        );
        return rehashAuthority({
          ...binding,
          checkpointAInput: [
            [source, hash("mutated-boundary"), decision, sourceHash],
          ],
          sources: binding.sources.map((entry) => ({
            ...entry,
            boundaryHash: hash("mutated-boundary"),
          })),
        });
      },
    ],
    [
      "optimizedRequiresProgramVectorHash",
      (authority: MiraiIntlClassifierAuthorityV3) => {
        const { resultHash: _resultHash, ...binding } = mutableClone(authority);
        return rehashAuthority({
          ...binding,
          optimizedRequiresProgramVector: [
            [first(binding.sources).source, false],
          ],
        });
      },
    ],
    [
      "referenceRequiresProgramVectorHash",
      (authority: MiraiIntlClassifierAuthorityV3) => {
        const { resultHash: _resultHash, ...binding } = mutableClone(authority);
        return rehashAuthority({
          ...binding,
          referenceRequiresProgramVector: [
            [first(binding.sources).source, false],
          ],
        });
      },
    ],
    [
      "artifactHash",
      (authority: MiraiIntlClassifierAuthorityV3) => {
        const { resultHash: _resultHash, ...binding } = mutableClone(authority);
        const artifactBinding = binding.artifactBinding as Readonly<
          Record<string, unknown>
        >;
        return rehashAuthority({
          ...binding,
          artifactBinding: {
            ...artifactBinding,
            candidateRequests: Number(artifactBinding.candidateRequests) + 1,
          },
        });
      },
    ],
  ] as const)(
    "rejects recomputed %s authority mutation without fallback",
    (_name, mutate) => {
      const input = rawFixture();
      const receipt = buildIntlCheckReceiptV3(input);
      const authority = classifierAuthorityFixture(receipt);
      expect(() =>
        buildIntlCheckReceiptV3ClassifierAuthorityBinding(input, [
          mutate(authority),
        ])
      ).toThrow(/classifier|candidate|requiresProgram|artifact/u);
    }
  );

  it.each([
    [
      "active conditions",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const index = value.indexBinding as Record<string, unknown>;
          index.activeConditions = [
            ...(index.activeConditions as ReadonlyArray<string>),
            "browser",
          ];
        }),
      /candidate index activeConditions evidence does not match receipt/u,
    ],
    [
      "controls, lstats, probes, and realpaths",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const index = value.indexBinding as Record<string, unknown>;
          const controls = mutableClone(
            index.controls as Array<Record<string, unknown>>
          );
          first(controls).hash = hash("hostile-control");
          index.controls = controls;
        }),
      /candidate index controls evidence does not match receipt/u,
    ],
    [
      "package scopes",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const index = value.indexBinding as Record<string, unknown>;
          const packageScopes = mutableClone(
            index.packageScopes as Array<Record<string, unknown>>
          );
          first(packageScopes).canonicalRoot = "/workspace/packages/hostile";
          index.packageScopes = packageScopes;
        }),
      /candidate index packageScopes evidence does not match receipt/u,
    ],
    [
      "projections",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const index = value.indexBinding as Record<string, unknown>;
          const projections = mutableClone(
            index.projections as Array<Record<string, unknown>>
          );
          first(projections).canonicalRoot = "/workspace/packages/hostile";
          index.projections = projections;
        }),
      /candidate index projections evidence does not match receipt/u,
    ],
    [
      "bare-package proofs",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const index = value.indexBinding as Record<string, unknown>;
          const proofs = mutableClone(
            index.barePackageProofs as Array<Record<string, unknown>>
          );
          first(proofs).packageName = "@hostile/generated";
          index.barePackageProofs = proofs;
        }),
      /bare-package resolution evidence does not match receipt/u,
    ],
    [
      "resolver frontier and hash",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const index = value.indexBinding as Record<string, unknown>;
          const resolverFrontier = {
            ...(index.resolverFrontier as Readonly<Record<string, unknown>>),
            specifier: "*hostile-global*",
          };
          const resolverFrontierHash = sha256(
            canonicalJson([
              "mirai-intl",
              "classifier-transaction-resolver-frontier",
              3,
              resolverFrontier,
            ])
          );
          index.resolverFrontier = resolverFrontier;
          index.barePackageProofs = (
            index.barePackageProofs as Array<Record<string, unknown>>
          ).map((proof) => ({ ...proof, resolverFrontierHash }));
        }),
      /candidate index resolverFrontier evidence does not match receipt/u,
    ],
    [
      "source hash",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const sources = mutableClone(
            value.sources as Array<Record<string, unknown>>
          );
          const checkpointAInput = mutableClone(
            value.checkpointAInput as Array<Array<unknown>>
          );
          const hostileSourceHash = hash("hostile-source");
          first(sources).sourceHash = hostileSourceHash;
          first(checkpointAInput)[3] = hostileSourceHash;
          value.sources = sources;
          value.checkpointAInput = checkpointAInput;
        }),
      /source decisions do not match normalized classifier bindings/u,
    ],
    [
      "artifact candidate set",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const artifact = value.artifactBinding as Record<string, unknown>;
          artifact.candidateSet = [];
        }),
      /artifact embedded authority evidence does not match/u,
    ],
    [
      "artifact facade set",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const artifact = value.artifactBinding as Record<string, unknown>;
          artifact.optimizedFacadeSet = [];
          artifact.referenceFacadeSet = [];
        }),
      /artifact embedded authority evidence does not match/u,
    ],
    [
      "artifact resolver counters",
      (authority: MiraiIntlClassifierAuthorityV3) =>
        mutateRehashedAuthority(authority, (value) => {
          const artifact = value.artifactBinding as Record<string, unknown>;
          artifact.resolverCounters = {
            ...(artifact.resolverCounters as Readonly<Record<string, unknown>>),
            resolverCalls: 3,
          };
        }),
      /artifact embedded authority evidence does not match/u,
    ],
  ] as const)(
    "rejects rehashed hostile %s evidence at the receipt projection boundary",
    (_name, mutate, expectedError) => {
      const input = rawFixture();
      const receipt = buildIntlCheckReceiptV3(input);
      const authority = classifierAuthorityFixture(receipt);

      expect(() =>
        buildIntlCheckReceiptV3ClassifierAuthorityBinding(input, [
          mutate(authority),
        ])
      ).toThrow(expectedError);
    }
  );

  it("uses optimized-minus-reference facade parity for production cardinalities", () => {
    const input = productionCardinalityFixtureInput();
    const receipt = buildIntlCheckReceiptV3(input);
    const authority = classifierAuthorityFixture(receipt);
    const artifact = authority.artifactBinding as Readonly<
      Record<string, unknown>
    >;

    expect(artifact.candidateSet).toHaveLength(343);
    expect(artifact.optimizedFacadeSet).toHaveLength(80);
    expect(artifact.referenceFacadeSet).toHaveLength(80);
    expect(artifact.falsePositives).toBe(0);
    expect(() =>
      buildIntlCheckReceiptV3ClassifierAuthorityBinding(input, [authority])
    ).not.toThrow();
  });

  it("keeps traversed package topology envelope-only beside one projected scope", () => {
    const input = rawFixture();
    const receipt = buildIntlCheckReceiptV3(input);
    const baseAuthority = classifierAuthorityFixture(receipt);
    const authority = mutateRehashedAuthority(baseAuthority, (value) => {
      const index = value.indexBinding as Record<string, unknown>;
      const packageTopology = mutableClone(
        index.packageTopology as Array<Record<string, unknown>>
      );
      for (let depth = 1; depth < 6; depth += 1) {
        const root = `/workspace/packages/app/nested-${depth}`;
        packageTopology.push({
          canonicalRoot: root,
          manifest: {
            kind: "absent",
            linkTargetBase64: null,
            linkTargetHash: null,
            path: `${root}/package.json`,
          },
          root: {
            kind: "directory",
            linkTargetBase64: null,
            linkTargetHash: null,
            path: root,
          },
        });
      }
      index.packageTopology = packageTopology;
    });
    const binding = buildIntlCheckReceiptV3ClassifierAuthorityBinding(input, [
      authority,
    ]);
    const index = authority.indexBinding as Readonly<Record<string, unknown>>;

    expect(index.packageTopology).toHaveLength(6);
    expect(index.packageScopes).toHaveLength(1);

    const topologyChanged = mutateRehashedAuthority(authority, (value) => {
      const changedIndex = value.indexBinding as Record<string, unknown>;
      const packageTopology = mutableClone(
        changedIndex.packageTopology as Array<Record<string, unknown>>
      );
      const manifest = first(packageTopology).manifest as Record<
        string,
        unknown
      >;
      manifest.kind = "symlink";
      manifest.linkTargetBase64 = "Li4vcGFja2FnZS5qc29u";
      manifest.linkTargetHash = hash("topology-link");
      changedIndex.packageTopology = packageTopology;
    });
    const changedBinding = buildIntlCheckReceiptV3ClassifierAuthorityBinding(
      input,
      [topologyChanged]
    );

    expect(changedBinding.authorityHash).toBe(binding.authorityHash);
    expect(changedBinding.receiptHash).toBe(binding.receiptHash);
    expect(changedBinding.inputIdentityHash).toBe(binding.inputIdentityHash);
  });

  it("cross-binds non-projectable per-projection evidence assignments through receipt bytes", () => {
    const input = rawFixture();
    const receipt = buildIntlCheckReceiptV3(input);
    const authority = classifierAuthorityFixture(receipt);
    const base = buildIntlCheckReceiptV3ClassifierAuthorityBinding(input, [
      authority,
    ]);
    const reassigned = mutableClone(input);
    reassigned.tables.controls.push({ files: [0, 1] });
    const projection = first(first(reassigned.candidateIndexes).projections);
    projection.control = 1;
    projection.lstats = [0];
    projection.packageScopes = [];
    projection.probes = [0];
    projection.realpaths = [];
    const changed = buildIntlCheckReceiptV3ClassifierAuthorityBinding(
      reassigned,
      [authority]
    );

    expect(changed.authorityHash).not.toBe(base.authorityHash);
    expect(changed.receiptHash).not.toBe(base.receiptHash);
    expect(changed.inputIdentityHash).not.toBe(base.inputIdentityHash);
  });

  it("rejects missing/extra fields, bad refs, reordering, and named-hash mutations", () => {
    const receipt = fixture();
    const extra = mutableClone(receipt) as IntlCheckReceiptV3 & {
      extra?: boolean;
    };
    extra.extra = true;
    expect(() => parseIntlCheckReceiptV3(extra)).toThrow(
      /unexpected or missing fields/u
    );

    const missing = mutableClone(receipt) as Record<string, unknown>;
    delete missing.tables;
    expect(() => parseIntlCheckReceiptV3(missing)).toThrow(
      /unexpected or missing fields/u
    );

    const outOfRange = mutableClone(receipt);
    outOfRange.application.packageManifest = 99;
    expect(() => parseIntlCheckReceiptV3(outOfRange)).toThrow(
      /out of range|table/u
    );

    const reordered = mutableClone(receipt);
    reordered.tables.files.reverse();
    expect(() => parseIntlCheckReceiptV3(reordered)).toThrow(
      /canonically sorted/u
    );

    const mutatedHash = mutableClone(receipt);
    first(mutatedHash.classifierBindings).bindingHash = hash("wrong");
    expect(() => parseIntlCheckReceiptV3(mutatedHash)).toThrow(
      /bindingHash.*does not bind/u
    );
  });

  it("rejects a mutation of every named V3 hash", () => {
    const mutations: ReadonlyArray<
      readonly [string, (receipt: MutableIntlCheckReceiptV3) => void]
    > = [
      [
        "compilerManifestHash",
        (value) => (value.compilerManifestHash = hash("x")),
      ],
      ["exceptionsHash", (value) => (value.exceptionsHash = hash("x"))],
      ["typescript.libHash", (value) => (value.typescript.libHash = hash("x"))],
      [
        "frontierHash",
        (value) => (first(value.tables.frontiers).frontierHash = hash("x")),
      ],
      [
        "configManifestHash",
        (value) => (first(value.projects).configManifestHash = hash("x")),
      ],
      [
        "normalizedOptionsHash",
        (value) => (first(value.projects).normalizedOptionsHash = hash("x")),
      ],
      [
        "indexHash",
        (value) => (first(value.candidateIndexes).indexHash = hash("x")),
      ],
      [
        "provider.declarationHash",
        (value) =>
          (first(first(value.providerClosures).providers).declarationHash =
            hash("x")),
      ],
      [
        "provider.hash",
        (value) =>
          (first(first(value.providerClosures).providers).hash = hash("x")),
      ],
      [
        "closure.declarationHash",
        (value) => (first(value.providerClosures).declarationHash = hash("x")),
      ],
      [
        "closure.libHash",
        (value) => (first(value.providerClosures).libHash = hash("x")),
      ],
      [
        "closureHash",
        (value) => (first(value.providerClosures).closureHash = hash("x")),
      ],
      [
        "boundaryHash",
        (value) => (first(value.classifierBindings).boundaryHash = hash("x")),
      ],
      [
        "candidateIndexHash",
        (value) =>
          (first(value.classifierBindings).candidateIndexHash = hash("x")),
      ],
      [
        "bindingHash",
        (value) => (first(value.classifierBindings).bindingHash = hash("x")),
      ],
      [
        "sourceAuthorizationHash",
        (value) => (value.sourceAuthorizationHash = hash("x")),
      ],
    ];
    for (const [name, mutate] of mutations) {
      const changed = mutableClone(fixture());
      mutate(changed);
      expect(
        () => parseIntlCheckReceiptV3(changed),
        `${name} must fail closed`
      ).toThrow(/bind|match|sorted/u);
    }
  });

  it("rejects nonportable lstat fields and malformed raw symlink identities", () => {
    const receipt = fixture();
    const withInode = mutableClone(receipt) as unknown as {
      tables: { lstats: Array<Record<string, unknown>> };
    };
    first(withInode.tables.lstats).ino = 42;
    expect(() => parseIntlCheckReceiptV3(withInode)).toThrow(
      /unexpected or missing fields/u
    );

    const raw = rawFixture();
    raw.tables.lstats[0] = {
      kind: "symlink",
      linkTargetBase64: Buffer.from("../app").toString("base64"),
      linkTargetHash: hash("not-raw-bytes"),
      path: "packages/app",
    };
    expect(() => buildIntlCheckReceiptV3(raw)).toThrow(
      /does not bind raw symlink target bytes/u
    );
  });

  it("fails hard on malformed V3 and rejects unknown schemas", () => {
    expect(() => parseIntlCheckReceipt({ schemaVersion: 3 })).toThrow(
      /unexpected or missing fields/u
    );
    expect(() => parseIntlCheckReceipt({ schemaVersion: 4 })).toThrow(
      /expected 2 or 3/u
    );
  });

  it("memoizes repeated expanded hash domains and yields smaller normalized bytes", () => {
    const metrics = createIntlCheckReceiptV3HashMetrics();
    const receipt = buildIntlCheckReceiptV3(repeatedFixtureInput(16), metrics);
    const normalized = canonicalIntlCheckReceiptV3Bytes(receipt);
    const expanded = canonicalExpandedIntlCheckReceiptV3Bytes(receipt);

    expect(normalized.length).toBeLessThan(expanded.length);
    expect(metrics.memoizedHashReuses).toBeGreaterThan(0);
    expect(metrics.expansionSerializations["physical-frontier"]).toBe(2);
    expect(metrics.expansionSerializations["provider-declarations"]).toBe(1);
    expect(metrics.expansionSerializations["typescript-libs"]).toBe(1);
    expect(
      Object.values(metrics.expansionSerializations).every(
        (count) => Number.isSafeInteger(count) && count > 0
      )
    ).toBe(true);
  });

  it("records Checkpoint A size, time, memoization, and RSS for a repeated graph", () => {
    const warmupReceipt = buildIntlCheckReceiptV3(repeatedFixtureInput(64));
    const warmupNormalized = canonicalIntlCheckReceiptV3Bytes(warmupReceipt);
    canonicalExpandedIntlCheckReceiptV3Bytes(warmupReceipt);
    parseCanonicalIntlCheckReceiptV3(warmupNormalized);

    const sourceCount = 64;
    const input = repeatedFixtureInput(sourceCount);
    const metrics = createIntlCheckReceiptV3HashMetrics();
    const initialMemory = process.memoryUsage();
    const memorySamples = [
      {
        heapUsed: initialMemory.heapUsed,
        rss: initialMemory.rss,
        stage: "input",
      },
    ];
    const hashStart = performance.now();
    const receipt = buildIntlCheckReceiptV3(input, metrics);
    const hashMs = performance.now() - hashStart;
    const afterHash = process.memoryUsage();
    memorySamples.push({
      heapUsed: afterHash.heapUsed,
      rss: afterHash.rss,
      stage: "hash",
    });
    const canonicalStart = performance.now();
    const normalized = canonicalIntlCheckReceiptV3Bytes(receipt);
    const expanded = canonicalExpandedIntlCheckReceiptV3Bytes(receipt);
    const canonicalizeMs = performance.now() - canonicalStart;
    const afterCanonicalize = process.memoryUsage();
    memorySamples.push({
      heapUsed: afterCanonicalize.heapUsed,
      rss: afterCanonicalize.rss,
      stage: "canonicalize",
    });
    const parseStart = performance.now();
    parseCanonicalIntlCheckReceiptV3(normalized);
    const parseMs = performance.now() - parseStart;
    const afterParse = process.memoryUsage();
    memorySamples.push({
      heapUsed: afterParse.heapUsed,
      rss: afterParse.rss,
      stage: "parse",
    });
    const sampledPeakRssBytes = Math.max(
      ...memorySamples.map((sample) => sample.rss)
    );

    const checkpoint = {
      canonicalExpandedV3Bytes: Buffer.byteLength(expanded),
      canonicalV3Bytes: Buffer.byteLength(normalized),
      hashExpansions: metrics.expansionSerializations,
      hashMs,
      memorySamples,
      memoizedHashReuses: metrics.memoizedHashReuses,
      parseMs,
      retainedHeapDeltaBytes: afterParse.heapUsed - initialMemory.heapUsed,
      sampledPeakRssBytes,
      sourceCount,
      canonicalizeMs,
      timingBasis: "monotonic-wall",
    };
    // eslint-disable-next-line no-console -- emits the required Checkpoint A evidence.
    console.info(`V3_CHECKPOINT_A ${JSON.stringify(checkpoint)}`);

    expect(checkpoint.canonicalV3Bytes).toBeLessThan(
      checkpoint.canonicalExpandedV3Bytes
    );
    expect(hashMs + canonicalizeMs + parseMs).toBeGreaterThan(0);
    // This test runs inside Vitest's parallel worker pool; the dedicated
    // evaluator owns the strict wall-clock gate. Keep a generous local bound
    // that still catches accidental superlinear receipt expansion.
    expect(hashMs + canonicalizeMs + parseMs).toBeLessThanOrEqual(5_000);
    expect(sampledPeakRssBytes).toBeLessThanOrEqual(2 * 1024 * 1024 * 1024);
    expect(metrics.expansionSerializations["physical-frontier"]).toBe(2);
    expect(metrics.expansionSerializations["provider-declarations"]).toBe(1);
  });

  it("requires exact candidate aggregate unions and portable values across copies", () => {
    const receipt = fixture();
    expect(parseIntlCheckReceiptV3(mutableClone(receipt))).toEqual(receipt);

    const unusedAggregate = mutableClone(receipt);
    first(unusedAggregate.candidateIndexes).probes = [0];
    expect(() => parseIntlCheckReceiptV3(unusedAggregate)).toThrow(
      /exact sorted aggregate evidence union/u
    );
  });

  it("rejects missing or ambiguous projection evidence", () => {
    const missing = rawFixture();
    first(missing.candidateIndexes).projections = first(
      missing.candidateIndexes
    ).projections.filter((projection) => projection.boundary !== 1);
    expect(() => buildIntlCheckReceiptV3(missing)).toThrow(
      /projection evidence for every source boundary/u
    );

    for (const candidateRoot of ["packages/aaa", "packages/zzz"]) {
      const mixed = rawFixture();
      const index = first(mixed.candidateIndexes);
      const disjoint = index.projections.find(
        (projection) => projection.boundary === 1
      );
      if (disjoint === undefined) {
        throw new Error("Expected repeated fixture projection");
      }
      index.projections = [
        ...index.projections,
        {
          ...disjoint,
          canonicalRoot: candidateRoot,
          lexicalRoot: candidateRoot,
          status: "candidate" as const,
        },
      ].toSorted((left, right) => {
        const leftBoundary = mixed.tables.boundaries[left.boundary];
        const rightBoundary = mixed.tables.boundaries[right.boundary];
        return (
          (leftBoundary?.ordinal ?? 0) - (rightBoundary?.ordinal ?? 0) ||
          compareText(left.lexicalRoot, right.lexicalRoot) ||
          compareText(left.canonicalRoot, right.canonicalRoot) ||
          compareText(left.status, right.status)
        );
      });
      first(mixed.classifierBindings).requests = [
        ...first(mixed.classifierBindings).requests,
        {
          boundary: 1,
          frontier: 0,
          from: "src/main.ts",
          resolutionMode: "import" as const,
          specifier: "@other/value",
        },
      ].toSorted((left, right) => compareText(left.specifier, right.specifier));
      expect(() => buildIntlCheckReceiptV3(mixed)).toThrow(
        /one unambiguous proof group per source boundary/u
      );
    }
  });

  it("rejects classifier frontier options that differ from index/project options", () => {
    const mismatched = rawFixture();
    const original = first(mismatched.tables.frontiers);
    mismatched.tables.frontiers = [
      original,
      {
        ...original,
        frontierHash: hash("other-frontier-placeholder"),
        optionsHash: hash("other-options"),
      },
    ].toSorted((left, right) =>
      left.frontierHash.localeCompare(right.frontierHash)
    );
    const badReference = mismatched.tables.frontiers.findIndex(
      (frontier) => frontier.optionsHash === hash("other-options")
    );
    first(first(mismatched.classifierBindings).requests).frontier =
      badReference;
    expect(() => buildIntlCheckReceiptV3(mismatched)).toThrow(
      /candidate-index and owner-project resolver options/u
    );
  });

  it("rejects mixed classifier modes for one owner", () => {
    const mixed = rawFixture();
    const filtered = first(mixed.candidateIndexes);
    mixed.candidateIndexes = [
      filtered,
      {
        ...mutableClone(filtered),
        facade: {
          ...mutableClone(filtered.facade),
          canonicalRoot: "packages/app-alt",
          lexicalRoot: "packages/app-alt",
        },
        indexHash: hash("fallback-index"),
        mode: "owner-fallback",
        reasons: ["preserve-symlinks"],
      },
    ];
    expect(() => buildIntlCheckReceiptV3(mixed)).toThrow(
      /freeze one owner-wide classifier mode/u
    );
  });

  it("preserves a hash-bound pnpm symlink package scope", () => {
    const input = rawFixture();
    const lexicalRoot = "node_modules/@openmirai/intl";
    const canonicalRoot =
      "node_modules/.pnpm/@openmirai+intl@0.3.3/node_modules/@openmirai/intl";
    const manifestPath = `${lexicalRoot}/package.json`;
    const linkTarget =
      "../.pnpm/@openmirai+intl@0.3.3/node_modules/@openmirai/intl";
    const scope = first(input.tables.packageScopes);
    scope.canonicalRoot = canonicalRoot;
    scope.lexicalRoot = lexicalRoot;
    first(input.tables.files).path = manifestPath;
    input.tables.probes[0] = {
      kind: "directory",
      path: lexicalRoot,
      present: true,
    };
    input.tables.probes[scope.manifestProbe] = {
      kind: "file",
      path: manifestPath,
      present: true,
    };
    input.tables.lstats[scope.rootLstat] = {
      kind: "symlink",
      linkTargetBase64: Buffer.from(linkTarget).toString("base64"),
      linkTargetHash: sha256(Buffer.from(linkTarget)),
      path: lexicalRoot,
    };
    input.tables.lstats[scope.manifestLstat] = {
      kind: "file",
      linkTargetBase64: null,
      linkTargetHash: null,
      path: manifestPath,
    };
    input.tables.realpaths[scope.realpath] = {
      path: lexicalRoot,
      target: canonicalRoot,
    };

    const receipt = buildIntlCheckReceiptV3(input);
    const parsed = parseCanonicalIntlCheckReceiptV3(
      canonicalIntlCheckReceiptV3Bytes(receipt)
    );

    expect(first(parsed.tables.packageScopes)).toMatchObject({
      canonicalRoot,
      lexicalRoot,
      manifestProbe: scope.manifestProbe,
    });
  });

  it("rejects unrelated or contradictory package-scope evidence", () => {
    const mutations: ReadonlyArray<
      readonly [string, (receipt: MutableIntlCheckReceiptV3) => void]
    > = [
      [
        "manifest probe reference",
        (value) => (first(value.tables.packageScopes).manifestProbe = 0),
      ],
      [
        "manifest probe path",
        (value) =>
          (value.tables.probes[1] = {
            ...at(value.tables.probes, 1),
            path: "packages/app/zzz",
          }),
      ],
      [
        "manifest probe kind",
        (value) =>
          (value.tables.probes[1] = {
            ...at(value.tables.probes, 1),
            kind: "directory",
          }),
      ],
      [
        "manifest lstat reference",
        (value) => (first(value.tables.packageScopes).manifestLstat = 0),
      ],
      [
        "manifest lstat path",
        (value) =>
          (value.tables.lstats[1] = {
            ...at(value.tables.lstats, 1),
            path: "packages/app/zzz",
          }),
      ],
      [
        "manifest lstat kind",
        (value) =>
          (value.tables.lstats[1] = {
            ...at(value.tables.lstats, 1),
            kind: "absent",
          }),
      ],
      [
        "root lstat reference",
        (value) => (first(value.tables.packageScopes).rootLstat = 1),
      ],
      [
        "root lstat path",
        (value) =>
          (value.tables.lstats[0] = {
            ...at(value.tables.lstats, 0),
            path: "packages/aaa",
          }),
      ],
      [
        "root lstat kind",
        (value) =>
          (value.tables.lstats[0] = {
            ...at(value.tables.lstats, 0),
            kind: "file",
          }),
      ],
      [
        "realpath lexical path",
        (value) =>
          (value.tables.realpaths[0] = {
            path: "packages/other",
            target: "packages/app",
          }),
      ],
      [
        "realpath canonical target",
        (value) =>
          (value.tables.realpaths[0] = {
            path: "packages/app",
            target: "packages/other",
          }),
      ],
      [
        "manifest file path",
        (value) => (first(value.tables.packageScopes).manifest = 4),
      ],
      [
        "manifest control omission",
        (value) => (first(value.tables.controls).files = [1, 4]),
      ],
      [
        "present manifest absent probe",
        (value) =>
          (value.tables.probes[1] = {
            ...at(value.tables.probes, 1),
            present: false,
          }),
      ],
      [
        "absent manifest present evidence",
        (value) => (first(value.tables.packageScopes).manifest = null),
      ],
    ];
    for (const [name, mutate] of mutations) {
      const changed = rawFixture();
      mutate(changed);
      expect(
        () => buildIntlCheckReceiptV3(changed),
        `${name} must fail closed`
      ).toThrow(/manifest|package root|lexicalRoot|canonicalRoot/u);
    }
  });

  it("rejects fully hashed physical frontiers unused by any resolution binding", () => {
    const unused = rawFixture();
    const classifierRequest = first(first(unused.classifierBindings).requests);
    const providerResolution = first(
      first(first(unused.providerClosures).providers).resolutions
    );
    const classifierFrontier = at(
      unused.tables.frontiers,
      classifierRequest.frontier
    );
    const semanticFrontier = at(
      unused.tables.frontiers,
      providerResolution.frontier
    );
    const extraFrontier = {
      ...mutableClone(classifierFrontier),
      frontierHash: hash("unused-frontier"),
      packageVersion: "2.0.0",
    };
    unused.tables.frontiers = [
      classifierFrontier,
      semanticFrontier,
      extraFrontier,
    ].toSorted((left, right) =>
      compareText(left.frontierHash, right.frontierHash)
    );
    classifierRequest.frontier =
      unused.tables.frontiers.indexOf(classifierFrontier);
    providerResolution.frontier =
      unused.tables.frontiers.indexOf(semanticFrontier);
    expect(() => buildIntlCheckReceiptV3(unused)).toThrow(
      /exactly the physical frontiers referenced/u
    );
  });

  it("verifies multibyte unknown-boundary byte evidence and reads a source once", () => {
    const { input, sourceBytes } = unknownFixtureInput();
    let reads = 0;
    const receipt = buildIntlCheckReceiptV3(
      input,
      createIntlCheckReceiptV3HashMetrics(),
      {
        readSourceBytes: (source) => {
          expect(source).toBe("src/main.ts");
          reads += 1;
          return sourceBytes;
        },
      }
    );
    expect(reads).toBe(1);
    expect(first(receipt.classifierBindings)).toMatchObject({
      decision: "facade-unknown-active",
      requests: [],
      unknownBoundaries: [0, 1],
    });
    expect(receipt.counters).toMatchObject({
      unknownActiveSources: 1,
      unknownBoundaryIdentities: 2,
    });
  });

  it("does not count mixed literal-present sources as unknown-active", () => {
    const { input, sourceBytes } = unknownFixtureInput();
    const binding = first(input.classifierBindings);
    const facadeProjection = first(first(input.candidateIndexes).projections);
    const providerResolution = first(
      first(first(input.providerClosures).providers).resolutions
    );
    const semanticFrontier = at(
      input.tables.frontiers,
      providerResolution.frontier
    );
    const classifierFrontier = {
      ...mutableClone(semanticFrontier),
      frontierHash: hash("mixed-classifier-frontier-placeholder"),
      lstats: [0, 1],
      optionsHash: first(input.projects).normalizedOptionsHash,
      resolutionMode: "import" as const,
      resolvedFile: 2,
    };
    input.tables.frontiers = [classifierFrontier, semanticFrontier].toSorted(
      (left, right) => compareText(left.frontierHash, right.frontierHash)
    );
    providerResolution.frontier =
      input.tables.frontiers.indexOf(semanticFrontier);
    binding.decision = "facade-present";
    binding.requests = [
      {
        boundary: 0,
        frontier: input.tables.frontiers.indexOf(classifierFrontier),
        from: binding.source,
        resolutionMode: "import",
        specifier: "@app/generated",
      },
    ];
    facadeProjection.canonicalRoot = "packages/app";
    facadeProjection.lexicalRoot = "packages/app";
    facadeProjection.status = "candidate";

    const receipt = buildIntlCheckReceiptV3(
      input,
      createIntlCheckReceiptV3HashMetrics(),
      { readSourceBytes: () => sourceBytes }
    );

    expect(first(receipt.classifierBindings)).toMatchObject({
      decision: "facade-present",
      unknownBoundaries: [0, 1],
    });
    expect(receipt.counters).toMatchObject({
      unknownActiveSources: 0,
      unknownBoundaryIdentities: 2,
    });
  });

  it("rejects malformed unknown ranges, UTF-8 slices, evidence, ordering, and refs", () => {
    const mutations: ReadonlyArray<
      readonly [string, (receipt: MutableIntlCheckReceiptV3) => void]
    > = [
      [
        "out-of-range byte end",
        (value) =>
          (first(value.tables.unknownBoundaries).byteEnd =
            Number.MAX_SAFE_INTEGER),
      ],
      [
        "zero-length byte range",
        (value) => {
          const boundary = first(value.tables.unknownBoundaries);
          boundary.byteEnd = boundary.byteStart;
        },
      ],
      [
        "reversed byte range",
        (value) => {
          const boundary = first(value.tables.unknownBoundaries);
          boundary.byteEnd = boundary.byteStart - 1;
        },
      ],
      [
        "negative byte range",
        (value) => (first(value.tables.unknownBoundaries).byteStart = -1),
      ],
      [
        "unsafe-integer byte range",
        (value) =>
          (first(value.tables.unknownBoundaries).byteEnd =
            Number.MAX_SAFE_INTEGER + 1),
      ],
      [
        "slice hash",
        (value) =>
          (first(value.tables.unknownBoundaries).sourceSliceHash =
            hash("wrong-slice")),
      ],
      [
        "node hash",
        (value) =>
          (first(value.tables.unknownBoundaries).nodeHash = hash("wrong-node")),
      ],
      [
        "reason substitution",
        (value) =>
          (first(value.tables.unknownBoundaries).reason =
            "unsupported-boundary-shape"),
      ],
      [
        "source substitution",
        (value) =>
          (first(value.tables.unknownBoundaries).source = "src/other.ts"),
      ],
      [
        "duplicate unknown-table entry",
        (value) =>
          value.tables.unknownBoundaries.splice(
            1,
            0,
            mutableClone(first(value.tables.unknownBoundaries))
          ),
      ],
      [
        "observation gap",
        (value) =>
          (first(value.tables.unknownBoundaries).observationOrdinal = 9),
      ],
      [
        "unknown table order",
        (value) => value.tables.unknownBoundaries.reverse(),
      ],
      [
        "missing binding ref",
        (value) => (first(value.classifierBindings).unknownBoundaries = [0]),
      ],
      [
        "wrong decision",
        (value) => (first(value.classifierBindings).decision = "facade-absent"),
      ],
    ];
    for (const [name, mutate] of mutations) {
      const { input, sourceBytes } = unknownFixtureInput();
      mutate(input);
      expect(
        () =>
          buildIntlCheckReceiptV3(
            input,
            createIntlCheckReceiptV3HashMetrics(),
            { readSourceBytes: () => sourceBytes }
          ),
        `${name} must fail closed`
      ).toThrow(/./u);
    }

    const split = unknownFixtureInput();
    const piByteStart = split.sourceBytes.indexOf(Buffer.from("π"));
    first(split.input.tables.unknownBoundaries).byteStart = piByteStart + 1;
    first(split.input.tables.unknownBoundaries).byteEnd = piByteStart + 2;
    first(split.input.tables.unknownBoundaries).sourceSliceHash = sha256(
      split.sourceBytes.subarray(piByteStart + 1, piByteStart + 2)
    );
    expect(() =>
      buildIntlCheckReceiptV3(
        split.input,
        createIntlCheckReceiptV3HashMetrics(),
        { readSourceBytes: () => split.sourceBytes }
      )
    ).toThrow(/valid UTF-8/u);
  });

  it("keeps repeated-graph hash work near-linear when the graph doubles", () => {
    const measure = (size: number) => {
      const metrics = createIntlCheckReceiptV3HashMetrics();
      buildIntlCheckReceiptV3(repeatedFixtureInput(size), metrics);
      return {
        computations: metrics.canonicalHashComputations,
        serializations: Object.values(metrics.expansionSerializations).reduce(
          (total, count) => total + count,
          0
        ),
      };
    };
    measure(8);
    const small = measure(8);
    const large = measure(16);
    expect(large.computations).toBeLessThanOrEqual(small.computations * 2.2);
    expect(large.serializations).toBeLessThanOrEqual(
      small.serializations * 2.2
    );
  });
});
