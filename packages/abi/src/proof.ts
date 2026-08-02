import type { RuntimeAbi, Sha256 } from "./descriptor";
import type { JsonPrimitive } from "./json";

/** Stable owner/checker declaration for exhaustive source authority. */
export type IntlCheckProjectV1 = Readonly<{
  path: string;
  role: "checker" | "owner";
}>;

/** Exact, reviewable exception; globs and inline suppressions are forbidden. */
export type IntlCheckExceptionV1 = Readonly<{
  file: string;
  nodeHash: Sha256;
  reason: string;
  rule: string;
}>;

export type IntlSourceLedgerEntryV1 = Readonly<{
  file: string;
  hash: Sha256;
  owner: string;
  verdict: "accepted" | "exception" | "rejected";
}>;

/** Deterministic proof that source analysis covered one catalog input set. */
export type IntlCheckReceiptV1 = Readonly<{
  artifactAbi: string;
  authorityHash: Sha256;
  catalogHash: Sha256;
  compilerHash: Sha256;
  exceptions: ReadonlyArray<IntlCheckExceptionV1>;
  exceptionsHash: Sha256;
  projects: ReadonlyArray<IntlCheckProjectV1>;
  runtimeAbi: RuntimeAbi;
  schemaVersion: 1;
  sources: ReadonlyArray<IntlSourceLedgerEntryV1>;
  typescriptHash: Sha256;
}>;

/** Canonical identity for one file participating in authorization. */
export type IntlCheckFileIdentityV2 = Readonly<{
  hash: Sha256;
  path: string;
}>;

/** Application package and workspace lock inputs bound by authorization. */
export type IntlCheckApplicationIdentityV2 = Readonly<{
  packageManifest: IntlCheckFileIdentityV2;
  workspaceLockfile: IntlCheckFileIdentityV2;
}>;

/** Deep-readonly JSON object used for canonical parsed configuration options. */
export interface IntlCheckCanonicalJsonObjectV2 {
  readonly [key: string]: IntlCheckCanonicalJsonV2;
}

/** Deep-readonly JSON used for canonical parsed configuration options. */
export type IntlCheckCanonicalJsonV2 =
  | JsonPrimitive
  | ReadonlyArray<IntlCheckCanonicalJsonV2>
  | IntlCheckCanonicalJsonObjectV2;

/** Resolved package identity. `packageHash` binds the installed package bytes. */
export type IntlCheckPackageIdentityV2 = Readonly<{
  name: string;
  packageHash: Sha256;
  packageManifestHash: Sha256;
  version: string;
}>;

/**
 * One tsconfig file in a project's complete extends/project-reference graph.
 * Paths are workspace-relative and arrays are canonically sorted.
 */
export type IntlCheckTsconfigFileV2 = Readonly<{
  extends: ReadonlyArray<string>;
  hash: Sha256;
  path: string;
  references: ReadonlyArray<string>;
}>;

/**
 * Exact parsed TypeScript configuration for an owner or checker project.
 * `rootFiles` records config expansion; `normalizedOptions` records the
 * canonical JSON representation of the parsed options that affect semantics.
 */
export type IntlCheckProjectV2 = Readonly<{
  configManifest: ReadonlyArray<IntlCheckTsconfigFileV2>;
  configManifestHash: Sha256;
  normalizedOptions: Readonly<Record<string, IntlCheckCanonicalJsonV2>>;
  normalizedOptionsHash: Sha256;
  path: string;
  role: "checker" | "owner";
  rootFiles: ReadonlyArray<string>;
}>;

export type IntlCheckProviderKindV2 =
  | "ambient"
  | "external"
  | "generated"
  | "workspace";

export type IntlCheckProviderResolutionV2 = Readonly<{
  controlFiles: ReadonlyArray<IntlCheckFileIdentityV2>;
  from: string;
  optionsHash: Sha256;
  packageName: string | null;
  packageVersion: string | null;
  probes: ReadonlyArray<
    Readonly<{
      kind: "directory" | "file";
      path: string;
      present: boolean;
    }>
  >;
  realpaths: ReadonlyArray<
    Readonly<{
      path: string;
      target: string;
    }>
  >;
  specifier: string;
}>;

/** One finite provider root and the declarations admitted from that root. */
export type IntlCheckProviderV2 = Readonly<{
  declarationHash: Sha256;
  declarations: ReadonlyArray<IntlCheckFileIdentityV2>;
  hash: Sha256;
  kind: IntlCheckProviderKindV2;
  resolutions: ReadonlyArray<IntlCheckProviderResolutionV2>;
  root: string;
}>;

/**
 * File-scoped finite provider/declaration closure used by the semantic check.
 * A production receipt can only represent an authorization within its budgets.
 */
export type IntlCheckProviderClosureV2 = Readonly<{
  ambientTypeFileLimit: number;
  closureHash: Sha256;
  declarationHash: Sha256;
  declarations: ReadonlyArray<IntlCheckFileIdentityV2>;
  libHash: Sha256;
  libs: ReadonlyArray<IntlCheckFileIdentityV2>;
  providerBudgetExceeded: false;
  providerRootLimit: number;
  providers: ReadonlyArray<IntlCheckProviderV2>;
  source: string;
}>;

export type IntlSourceLedgerEntryV2 = Readonly<{
  file: string;
  hash: Sha256;
  owner: string;
  providerClosureHash: Sha256;
  verdict: "accepted" | "exception";
}>;

/** Exact TypeScript package and loaded standard-library declaration identity. */
export type IntlCheckTypeScriptIdentityV2 = Readonly<{
  libHash: Sha256;
  libs: ReadonlyArray<IntlCheckFileIdentityV2>;
  package: IntlCheckPackageIdentityV2;
}>;

/** Canonical completeness counters independently checked against manifests. */
export type IntlCheckReceiptCountersV2 = Readonly<{
  checkerProjects: number;
  declarationFiles: number;
  exceptions: number;
  loadedLibFiles: number;
  ownerProjects: number;
  providerClosures: number;
  providerRoots: number;
  semanticAuthorizationRuns: 1;
  semanticFilesAnalyzed: number;
  sourceFiles: number;
  typescriptLibFiles: number;
}>;

/** Runtime-observed semantic work required to authorize a source ledger. */
export type IntlSemanticAuthorizationObservationV2 = Readonly<{
  semanticAuthorizationRuns: number;
  semanticFilesAnalyzed: number;
}>;

/**
 * Runtime-observed build verification work.
 *
 * Canonical validators require `buildReceiptVerifications >= 1` and
 * `buildSemanticAnalysisRuns === 0`.
 */
export type IntlBuildVerificationCountersV2 = Readonly<{
  buildReceiptVerifications: number;
  buildSemanticAnalysisRuns: 0;
}>;

/**
 * Complete, non-interchangeable source authorization receipt.
 *
 * Canonical arrays are sorted by their path/source/root identity before
 * hashing. `sourceAuthorizationHash` binds every other authorization input,
 * including the generation receipt, source/config/provider ledgers, toolchain,
 * exceptions, and ABI fields.
 */
export type IntlCheckReceiptV2 = Readonly<{
  application: IntlCheckApplicationIdentityV2;
  artifactAbi: string;
  compilerManifest: ReadonlyArray<IntlCheckFileIdentityV2>;
  compilerManifestHash: Sha256;
  counters: IntlCheckReceiptCountersV2;
  exceptions: ReadonlyArray<IntlCheckExceptionV1>;
  exceptionsHash: Sha256;
  generationReceiptHash: Sha256;
  icu: IntlCheckPackageIdentityV2;
  projects: ReadonlyArray<IntlCheckProjectV2>;
  providerClosures: ReadonlyArray<IntlCheckProviderClosureV2>;
  runtimeAbi: RuntimeAbi;
  schemaVersion: 2;
  sourceAuthorizationHash: Sha256;
  sources: ReadonlyArray<IntlSourceLedgerEntryV2>;
  typescript: IntlCheckTypeScriptIdentityV2;
}>;

/** Numeric reference into a canonical V3 receipt table. */
export type Ref = number;

/** Exact TypeScript resolution mode for one canonical module boundary. */
export type IntlCheckResolutionModeV3 = "default" | "import" | "require";

export type IntlCheckFileIdentityV3 = IntlCheckFileIdentityV2;
export type IntlCheckPackageIdentityV3 = IntlCheckPackageIdentityV2;
export type IntlCheckExceptionV3 = IntlCheckExceptionV1;
export type IntlCheckProviderKindV3 = IntlCheckProviderKindV2;

export type IntlCheckProbeV3 = Readonly<{
  kind: "directory" | "file";
  path: string;
  present: boolean;
}>;

export type IntlCheckRealpathV3 = Readonly<{
  path: string;
  target: string;
}>;

/** Portable no-follow filesystem identity used by V3 receipts. */
export type IntlCheckLstatV3 = Readonly<{
  kind: "absent" | "directory" | "file" | "other" | "symlink";
  linkTargetBase64: string | null;
  linkTargetHash: Sha256 | null;
  path: string;
}>;

export type IntlCheckControlSetV3 = Readonly<{
  files: ReadonlyArray<Ref>;
}>;

export type IntlCheckModuleBoundaryV3 = Readonly<{
  kind:
    | "dynamic-import"
    | "export"
    | "import"
    | "import-equals"
    | "import-type"
    | "module-declaration"
    | "require";
  observationOrdinal: number;
  ordinal: number;
  resolutionMode: IntlCheckResolutionModeV3;
  source: string;
  specifier: string;
}>;

export type IntlCheckUnknownModuleBoundaryV3 = Readonly<{
  byteEnd: number;
  byteStart: number;
  kind: IntlCheckModuleBoundaryV3["kind"];
  nodeHash: Sha256;
  nodeKind: string;
  observationOrdinal: number;
  reason:
    | "nonliteral-specifier"
    | "unknown-resolution-mode"
    | "unsupported-boundary-shape";
  source: string;
  sourceSliceHash: Sha256;
}>;

export type IntlCheckPackageScopeV3 = Readonly<{
  canonicalRoot: string;
  control: Ref;
  lexicalRoot: string;
  manifest: Ref | null;
  manifestLstat: Ref;
  manifestProbe: Ref;
  realpath: Ref;
  rootLstat: Ref;
}>;

/** Source-independent filesystem and resolver evidence shared by bindings. */
export type IntlCheckPhysicalFrontierV3 = Readonly<{
  control: Ref;
  frontierHash: Sha256;
  lstats: ReadonlyArray<Ref>;
  optionsHash: Sha256;
  packageName: string | null;
  packageVersion: string | null;
  probes: ReadonlyArray<Ref>;
  realpaths: ReadonlyArray<Ref>;
  resolutionMode: IntlCheckResolutionModeV3;
  resolvedFile: Ref | null;
}>;

/** Source-specific request bound to a canonical boundary and frontier. */
export type IntlCheckResolutionBindingV3 = Readonly<{
  boundary: Ref;
  frontier: Ref;
  from: string;
  resolutionMode: IntlCheckResolutionModeV3;
  specifier: string;
}>;

/** Semantic provider request; it is not a classifier source boundary. */
export type IntlCheckProviderResolutionV3 = Readonly<{
  frontier: Ref;
  from: string;
  specifier: string;
}>;

export type GeneratedFacadeRootEvidenceV3 = Readonly<{
  canonicalRoot: string;
  control: Ref;
  file: Ref;
  lexicalRoot: string;
  lstats: ReadonlyArray<Ref>;
  packageScopes: ReadonlyArray<Ref>;
  probes: ReadonlyArray<Ref>;
  realpaths: ReadonlyArray<Ref>;
}>;

/** Conservative proof used to classify one generated-facade projection. */
export enum GeneratedFacadeProjectionProofKindV3 {
  ABSOLUTE_DIRECT = "absolute-direct",
  FACADE_PACKAGE_EXPORT = "facade-package-export",
  PACKAGE_IMPORTS = "package-imports",
  RELATIVE_DIRECT = "relative-direct",
  RELATIVE_ROOT_DIRS = "relative-root-dirs",
  TSCONFIG_PATHS = "tsconfig-paths",
  TSCONFIG_BASE_URL = "tsconfig-base-url",
  UNMAPPED_EXTERNAL = "unmapped-external",
}

export type GeneratedFacadeProjectedRootV3 = Readonly<{
  boundary: Ref;
  canonicalRoot: string;
  control: Ref;
  lexicalRoot: string;
  lstats: ReadonlyArray<Ref>;
  packageScopes: ReadonlyArray<Ref>;
  probes: ReadonlyArray<Ref>;
  proofKind: GeneratedFacadeProjectionProofKindV3;
  realpaths: ReadonlyArray<Ref>;
  status: "candidate" | "disjoint";
}>;

export type GeneratedFacadeCandidateIndexV3 = Readonly<{
  analyzerAbi: string;
  control: Ref;
  facade: GeneratedFacadeRootEvidenceV3;
  indexHash: Sha256;
  lstats: ReadonlyArray<Ref>;
  mode: "filtered" | "owner-fallback";
  optionsHash: Sha256;
  owner: string;
  packageScopes: ReadonlyArray<Ref>;
  probes: ReadonlyArray<Ref>;
  projections: ReadonlyArray<GeneratedFacadeProjectedRootV3>;
  realpaths: ReadonlyArray<Ref>;
  reasons: ReadonlyArray<
    | "custom-conditions-ambiguous"
    | "package-imports-ambiguous"
    | "package-exports-ambiguous"
    | "path-projection-ambiguous"
    | "preserve-symlinks"
    | "resolution-mode-ambiguous"
    | "root-dirs-ambiguous"
    | "symlink-boundary-ambiguous"
    | "unsupported-module-resolution"
  >;
}>;

export type IntlSourceClassifierBindingV3 = Readonly<{
  bindingHash: Sha256;
  boundaries: ReadonlyArray<Ref>;
  boundaryHash: Sha256;
  candidateIndex: Ref;
  candidateIndexHash: Sha256;
  decision: "facade-absent" | "facade-present" | "facade-unknown-active";
  mode: "filtered" | "owner-fallback";
  requests: ReadonlyArray<IntlCheckResolutionBindingV3>;
  source: string;
  sourceHash: Sha256;
  unknownBoundaries: ReadonlyArray<Ref>;
}>;

export type IntlCheckApplicationIdentityV3 = Readonly<{
  packageManifest: Ref;
  workspaceLockfile: Ref;
}>;

export type IntlCheckTsconfigFileV3 = Readonly<{
  extends: ReadonlyArray<string>;
  file: Ref;
  path: string;
  references: ReadonlyArray<string>;
}>;

export type IntlCheckProjectV3 = Readonly<{
  configManifest: ReadonlyArray<IntlCheckTsconfigFileV3>;
  configManifestHash: Sha256;
  normalizedOptions: Readonly<Record<string, IntlCheckCanonicalJsonV2>>;
  normalizedOptionsHash: Sha256;
  path: string;
  /** Exact semantic resolver-options identity carried by V2 provider evidence. */
  resolverOptionsHash: Sha256;
  role: "checker" | "owner";
  rootFiles: ReadonlyArray<string>;
}>;

export type IntlCheckProviderV3 = Readonly<{
  declarationHash: Sha256;
  declarations: ReadonlyArray<Ref>;
  hash: Sha256;
  kind: IntlCheckProviderKindV3;
  resolutions: ReadonlyArray<IntlCheckProviderResolutionV3>;
  root: string;
}>;

export type IntlCheckProviderClosureV3 = Readonly<{
  ambientTypeFileLimit: number;
  closureHash: Sha256;
  declarationHash: Sha256;
  declarations: ReadonlyArray<Ref>;
  libHash: Sha256;
  libs: ReadonlyArray<Ref>;
  providerBudgetExceeded: false;
  providerRootLimit: number;
  providers: ReadonlyArray<IntlCheckProviderV3>;
  source: string;
}>;

export type IntlCheckTypeScriptIdentityV3 = Readonly<{
  libHash: Sha256;
  libs: ReadonlyArray<Ref>;
  package: IntlCheckPackageIdentityV3;
}>;

export type IntlClassifierCountersV3 = Readonly<{
  boundaryIdentities: number;
  classifierBoundaries: number;
  classifierCandidateRequests: number;
  classifierFacadeImports: number;
  classifierFilteredRequests: number;
  classifierFullResolverRequests: number;
  classifierOwnerFallbacks: number;
  classifierSourcesBound: number;
  controlSets: number;
  fileIdentities: number;
  packageScopeIdentities: number;
  physicalFrontiers: number;
  probeIdentities: number;
  realpathIdentities: number;
  resolutionBindings: number;
  lstatIdentities: number;
  unknownActiveSources: number;
  unknownBoundaryIdentities: number;
}>;

export type IntlCheckReceiptCountersV3 = Omit<
  IntlCheckReceiptCountersV2,
  "semanticFilesAnalyzed"
> &
  IntlClassifierCountersV3 &
  Readonly<{
    /** Complete source universe covered by lexical classifier authority. */
    lexicalFilesClassified: number;
    /** Sources for which a TypeScript Program supplied semantic evidence. */
    semanticFilesAnalyzed: number;
  }>;

export type IntlCheckTablesV3 = Readonly<{
  boundaries: ReadonlyArray<IntlCheckModuleBoundaryV3>;
  controls: ReadonlyArray<IntlCheckControlSetV3>;
  files: ReadonlyArray<IntlCheckFileIdentityV3>;
  frontiers: ReadonlyArray<IntlCheckPhysicalFrontierV3>;
  lstats: ReadonlyArray<IntlCheckLstatV3>;
  packageScopes: ReadonlyArray<IntlCheckPackageScopeV3>;
  probes: ReadonlyArray<IntlCheckProbeV3>;
  realpaths: ReadonlyArray<IntlCheckRealpathV3>;
  unknownBoundaries: ReadonlyArray<IntlCheckUnknownModuleBoundaryV3>;
}>;

export type IntlSourceLedgerEntryV3 = Readonly<{
  classifierBindingHash: Sha256;
  file: string;
  hash: Sha256;
  owner: string;
  providerClosureHash: Sha256 | null;
  verdict: "accepted" | "exception";
}>;

export type IntlRequiresProgramTupleV3 = readonly [
  source: string,
  requiresProgram: boolean,
];

/** Content-addressed classifier parity and feasibility evidence. */
export type IntlClassifierShadowArtifactV3 = Readonly<{
  analyzerAbi: string;
  boundaryCategories: Readonly<Record<string, number>>;
  candidateRequests: number;
  canonicalExpandedV3Bytes: number;
  canonicalV2Bytes: number;
  canonicalV3Bytes: number;
  catalogInputHash: Sha256;
  compilerHash: Sha256;
  facadeImports: 80;
  fallbackOwners: ReadonlyArray<
    Readonly<{ owner: string; reasons: ReadonlyArray<string> }>
  >;
  filteredRequests: number;
  inputHash: Sha256;
  lockfileHash: Sha256;
  optimizedRequiresProgramVector: ReadonlyArray<IntlRequiresProgramTupleV3>;
  optimizedRequiresProgramVectorHash: Sha256;
  ownerCount: number;
  ownerModes: ReadonlyArray<
    Readonly<{ mode: "filtered" | "owner-fallback"; owner: string }>
  >;
  peakRssBytes: number;
  projectInputsHash: Sha256;
  referenceLiteralBoundaryRequests: 10951;
  referenceRequiresProgramVector: ReadonlyArray<IntlRequiresProgramTupleV3>;
  referenceRequiresProgramVectorHash: Sha256;
  sourceUniverseHash: Sha256;
  timingsMs: Readonly<{
    canonicalize: number;
    hash: number;
    parse: number;
    shadowTotal: number;
  }>;
  typescriptHash: Sha256;
  unknownActiveSources: number;
  unknownBoundaryCount: number;
}>;

export type IntlCheckReceiptV3 = Readonly<{
  application: IntlCheckApplicationIdentityV3;
  artifactAbi: string;
  candidateIndexes: ReadonlyArray<GeneratedFacadeCandidateIndexV3>;
  classifierBindings: ReadonlyArray<IntlSourceClassifierBindingV3>;
  compilerManifest: ReadonlyArray<Ref>;
  compilerManifestHash: Sha256;
  counters: IntlCheckReceiptCountersV3;
  exceptions: ReadonlyArray<IntlCheckExceptionV3>;
  exceptionsHash: Sha256;
  generationReceiptHash: Sha256;
  icu: IntlCheckPackageIdentityV2;
  projects: ReadonlyArray<IntlCheckProjectV3>;
  providerClosures: ReadonlyArray<IntlCheckProviderClosureV3>;
  runtimeAbi: RuntimeAbi;
  schemaVersion: 3;
  sourceAuthorizationHash: Sha256;
  sources: ReadonlyArray<IntlSourceLedgerEntryV3>;
  tables: IntlCheckTablesV3;
  typescript: IntlCheckTypeScriptIdentityV3;
}>;

/** Receipt variants accepted by the discriminated V2/V3 reader. */
export type IntlCheckReceipt = IntlCheckReceiptV2 | IntlCheckReceiptV3;

/** Stable authorization directory and immutable receipt artifact names. */
export const INTL_CHECK_RECEIPT_DIRECTORY = ".mirai-intl" as const;
export const INTL_CHECK_RECEIPT_V2_NAME = "check-receipt.v2.json" as const;
export const INTL_CHECK_RECEIPT_V3_NAME = "check-receipt.v3.json" as const;
export const INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME =
  "classifier-authority.v3.json" as const;

/**
 * Atomic authorization activation point. Writers publish the selected receipt
 * artifact first and atomically replace this selector last.
 */
export const INTL_CHECK_RECEIPT_SELECTOR_NAME =
  "check-receipt.current.json" as const;

/** Fixed package-local content-addressed authority-store directories. */
export const INTL_PACKAGE_AUTHORITY_DIRECTORY = "authority" as const;
export const INTL_PACKAGE_AUTHORITY_RECEIPTS_DIRECTORY = "receipts" as const;
export const INTL_PACKAGE_AUTHORITY_CLASSIFIERS_DIRECTORY =
  "classifiers" as const;
export const INTL_PACKAGE_AUTHORITY_SETS_DIRECTORY = "sets" as const;

export type IntlCheckReceiptSelectorV1 =
  | Readonly<{
      receiptHash: Sha256;
      receiptName: typeof INTL_CHECK_RECEIPT_V2_NAME;
      receiptSchemaVersion: 2;
      schemaVersion: 1;
    }>
  | Readonly<{
      authorityHash: Sha256;
      authorityName: typeof INTL_CHECK_CLASSIFIER_AUTHORITY_V3_NAME;
      receiptHash: Sha256;
      receiptName: typeof INTL_CHECK_RECEIPT_V3_NAME;
      receiptSchemaVersion: 3;
      schemaVersion: 1;
    }>;

/** Immutable package authority selected by one schema-2 commit pointer. */
export type PackageAuthoritySetV1 = Readonly<{
  classifierAuthority: Readonly<{
    hash: Sha256;
    schemaVersion: 3;
  }> | null;
  package: Readonly<{
    manifestHash: Sha256;
    name: string;
    root: string;
  }>;
  receipt: Readonly<{
    hash: Sha256;
    schemaVersion: 2 | 3;
  }>;
  schemaVersion: 1;
}>;

/** Package-local selector for an immutable authority-set object. */
export type IntlCheckReceiptSelectorV2 = Readonly<{
  authoritySetHash: Sha256;
  schemaVersion: 2;
}>;

/** Selector variants accepted by the package-local authority reader. */
export type IntlCheckReceiptSelector =
  | IntlCheckReceiptSelectorV1
  | IntlCheckReceiptSelectorV2;

export type IntlBuildProofTargetV1 = "client" | "nitro" | "worker";

/** Provisional/finalized emitted-byte proof. Paths are workspace-relative. */
export type IntlBuildProofV1 = Readonly<{
  authorityHash: Sha256;
  deploymentReceiptHash: Sha256;
  emitted: ReadonlyArray<
    Readonly<{ hash: Sha256; mapHash?: Sha256; mapPath?: string; path: string }>
  >;
  graphHash: Sha256;
  schemaVersion: 1;
  state: "finalized" | "provisional";
  target: IntlBuildProofTargetV1;
}>;
