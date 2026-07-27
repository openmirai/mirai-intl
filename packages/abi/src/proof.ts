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

/** One finite provider root and the declarations admitted from that root. */
export type IntlCheckProviderV2 = Readonly<{
  declarationHash: Sha256;
  declarations: ReadonlyArray<IntlCheckFileIdentityV2>;
  hash: Sha256;
  kind: IntlCheckProviderKindV2;
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
