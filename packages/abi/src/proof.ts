import type { RuntimeAbi, Sha256 } from "./descriptor";

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
