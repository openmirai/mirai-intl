import { lstat, readFile, readlink, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type ts from "typescript";

import { canonicalJson, compareCanonicalStrings, sha256 } from "./canonical";
import {
  buildMiraiIntlClassifierAuthorityV3,
  deepFreezeMiraiIntlClassifierValue,
  validateMiraiIntlClassifierAuthorityV3,
} from "./classifier-authority";
import type { MiraiIntlClassifierAuthorityV3 } from "./classifier-authority";
import { buildMiraiIntlCandidateCheckpointShadow } from "./classifier-candidate-shadow";
import type {
  MiraiIntlCandidateCheckpointShadow,
  MiraiIntlCandidateShadowSource,
  MiraiIntlGeneratedFacadeCandidateIndexShadow,
  MiraiIntlPortableLstatShadow,
} from "./classifier-candidate-shadow";

export { validateMiraiIntlClassifierAuthorityV3 } from "./classifier-authority";
export type {
  MiraiIntlClassifierAuthoritySourceV3,
  MiraiIntlClassifierAuthorityV3,
} from "./classifier-authority";

type Sha256 = `sha256:${string}`;

export type MiraiIntlClassifierReceiptProjectionV3 = Readonly<{
  checkpoint: Omit<MiraiIntlCandidateCheckpointShadow, "sources" | "timings">;
  generatedFacadeHash: Sha256;
  generatedFacadePath: string;
  inputHash: Sha256;
  owner: string;
  sources: MiraiIntlCandidateCheckpointShadow["sources"];
  workspaceRoot: string;
}>;

export type MiraiIntlClassifierAuthorityInputV3 = Readonly<{
  generatedFacadePath: string;
  options: ts.CompilerOptions;
  owner: string;
  projectControls?: ReadonlyArray<Readonly<{ hash: Sha256; path: string }>>;
  sources: ReadonlyArray<MiraiIntlCandidateShadowSource>;
  /** @internal Test/benchmark observation only; never enters authority hashes. */
  sourceObserver?: ((mode: "parsed" | "prepared") => void) | undefined;
  workspaceRoot: string;
}>;

function classifierSourceIdentityPath(id: string): string {
  if (
    id.startsWith("\0") ||
    (/^[a-z][a-z\d+.-]*:/iu.test(id) && !/^[a-z]:[\\/]/iu.test(id))
  ) {
    return id;
  }
  return resolve(id);
}

function sealAuthorityInput(
  input: MiraiIntlClassifierAuthorityInputV3
): MiraiIntlClassifierAuthorityInputV3 {
  return deepFreezeMiraiIntlClassifierValue({
    generatedFacadePath: input.generatedFacadePath,
    options: structuredClone(input.options),
    owner: input.owner,
    ...(input.projectControls
      ? {
          projectControls: input.projectControls
            .map(({ hash, path }) => ({ hash, path: resolve(path) }))
            .toSorted((left, right) =>
              compareCanonicalStrings(left.path, right.path)
            ),
        }
      : {}),
    sources: input.sources.map(({ id, source }) => ({ id, source })),
    workspaceRoot: input.workspaceRoot,
  });
}

async function authorityInputIdentity(
  input: MiraiIntlClassifierAuthorityInputV3
): Promise<
  Readonly<{
    generatedFacadeHash: Sha256;
    inputHash: Sha256;
    scopeHash: Sha256;
  }>
> {
  const workspaceRoot = await realpath(resolve(input.workspaceRoot));
  const lexicalGeneratedFacadePath = resolve(input.generatedFacadePath);
  const generatedFacadePath = await realpath(lexicalGeneratedFacadePath);
  const sourcePaths = input.sources.map(({ id }) =>
    classifierSourceIdentityPath(id)
  );
  if (new Set(sourcePaths).size !== sourcePaths.length) {
    throw new Error("Duplicate Mirai Intl classifier source path");
  }
  const sourceBindings = (
    await Promise.all(
      input.sources.map(async ({ id, source }) => {
        const path = classifierSourceIdentityPath(id);
        const hash = sha256(source);
        if (path === resolve(id) && sha256(await readFile(path)) !== hash) {
          throw new Error(
            `Mirai Intl classifier source mutated: ${JSON.stringify(path)}`
          );
        }
        return { hash, path };
      })
    )
  ).toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
  const projectControls = (
    await Promise.all(
      (input.projectControls ?? []).map(async ({ hash, path: inputPath }) => {
        const path = resolve(inputPath);
        if (sha256(await readFile(path)) !== hash) {
          throw new Error(
            `Mirai Intl classifier project control mutated: ${JSON.stringify(path)}`
          );
        }
        return { hash, path };
      })
    )
  ).toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
  if (
    new Set(projectControls.map(({ path }) => path)).size !==
    projectControls.length
  ) {
    throw new Error("Duplicate Mirai Intl classifier project control path");
  }
  const scopeBinding = {
    generatedFacadePath: lexicalGeneratedFacadePath,
    options: input.options,
    owner: input.owner,
    projectControls,
    workspaceRoot,
  };
  const generatedFacadeHash = sha256(await readFile(generatedFacadePath));
  return {
    generatedFacadeHash,
    inputHash: sha256(
      canonicalJson([
        "mirai-intl",
        "classifier-production-input",
        3,
        {
          ...scopeBinding,
          canonicalGeneratedFacadePath: generatedFacadePath,
          generatedFacadeHash,
          sources: sourceBindings,
        },
      ])
    ),
    scopeHash: sha256(
      canonicalJson([
        "mirai-intl",
        "classifier-production-scope",
        3,
        scopeBinding,
      ])
    ),
  };
}

async function buildAuthority(
  input: MiraiIntlClassifierAuthorityInputV3,
  generatedFacadeHash: Sha256,
  inputHash: Sha256,
  workspaceRoot: string,
  preparedSourceFiles: ReadonlyMap<string, ts.SourceFile>,
  sourceObserver?: (mode: "parsed" | "prepared") => void
): Promise<
  Readonly<{
    authority: MiraiIntlClassifierAuthorityV3;
    projection: MiraiIntlClassifierReceiptProjectionV3;
  }>
> {
  const checkpoint = await buildMiraiIntlCandidateCheckpointShadow({
    ...input,
    executionMode: "production-proof",
    sourceObserver,
    sources: input.sources
      .toSorted((left, right) =>
        compareCanonicalStrings(resolve(left.id), resolve(right.id))
      )
      .map((source) => {
        const preparedSourceFile = preparedSourceFiles.get(source.id);
        return preparedSourceFile ? { ...source, preparedSourceFile } : source;
      }),
  });
  if (process.env.MIRAI_INTL_INTERNAL_CLASSIFIER_PROFILE === "1") {
    process.stderr.write(
      `MIRAI_INTL_CLASSIFIER_PROFILE=${JSON.stringify(checkpoint.timings)}\n`
    );
  }
  const { indexHash, ...indexBinding } = checkpoint.index;
  const {
    artifactHash,
    sources: checkpointSources,
    timings: _timings,
    ...artifactBinding
  } = checkpoint;
  const {
    sources: projectionSources,
    timings: _projectionTimings,
    ...projectionCheckpoint
  } = checkpoint;
  const projection = deepFreezeMiraiIntlClassifierValue({
    checkpoint: projectionCheckpoint,
    generatedFacadeHash,
    generatedFacadePath: await realpath(resolve(input.generatedFacadePath)),
    inputHash,
    owner: input.owner,
    sources: projectionSources.toSorted((left, right) =>
      compareCanonicalStrings(left.source, right.source)
    ),
    workspaceRoot,
  } satisfies MiraiIntlClassifierReceiptProjectionV3);
  const receiptProjectionHash =
    hashMiraiIntlClassifierReceiptProjectionV3(projection);
  const binding = {
    artifactBinding,
    artifactHash,
    checkpointAHash: checkpoint.checkpointAHash,
    checkpointAInput: checkpointSources
      .map(
        ({ boundaryHash, decision, source, sourceHash }) =>
          [source, boundaryHash, decision, sourceHash] as const
      )
      .toSorted(([leftSource], [rightSource]) =>
        compareCanonicalStrings(leftSource, rightSource)
      ),
    indexBinding,
    indexHash,
    inputHash,
    optimizedRequiresProgramVector: checkpoint.optimizedRequiresProgramVector,
    optimizedRequiresProgramVectorHash:
      checkpoint.optimizedRequiresProgramVectorHash,
    referenceRequiresProgramVector: checkpoint.referenceRequiresProgramVector,
    referenceRequiresProgramVectorHash:
      checkpoint.referenceRequiresProgramVectorHash,
    receiptProjectionHash,
    sources: checkpointSources
      .map(
        ({ boundaryHash, decision, requiresProgram, source, sourceHash }) => ({
          boundaryHash,
          decision,
          requiresProgram,
          source,
          sourceHash,
        })
      )
      .toSorted((left, right) =>
        compareCanonicalStrings(left.source, right.source)
      ),
    workspaceRoot,
  };
  return deepFreezeMiraiIntlClassifierValue({
    authority: validateMiraiIntlClassifierAuthorityV3(
      buildMiraiIntlClassifierAuthorityV3(binding),
      inputHash
    ),
    projection,
  });
}

export function hashMiraiIntlClassifierReceiptProjectionV3(
  projection: MiraiIntlClassifierReceiptProjectionV3
): Sha256 {
  return sha256(
    canonicalJson([
      "mirai-intl",
      "classifier-receipt-projection",
      3,
      projection,
    ])
  );
}

export type MiraiIntlClassifierWorkspaceTransactionV3 = Readonly<{
  authorize(
    input: MiraiIntlClassifierAuthorityInputV3
  ): Promise<MiraiIntlClassifierAuthorityV3>;
  finalize(): Promise<MiraiIntlClassifierFinalizedTransactionV3>;
  workspaceRoot: string;
}>;

export type MiraiIntlClassifierFinalizedTransactionV3 = Readonly<{
  authorities: ReadonlyArray<MiraiIntlClassifierAuthorityV3>;
  receiptProjections: ReadonlyArray<MiraiIntlClassifierReceiptProjectionV3>;
}>;

type CompletedAuthority = Readonly<{
  authority: MiraiIntlClassifierAuthorityV3;
  input: MiraiIntlClassifierAuthorityInputV3;
  projection: MiraiIntlClassifierReceiptProjectionV3;
}>;

type BuiltAuthority = Omit<CompletedAuthority, "input">;

interface TransactionState {
  activeAuthorizations: number;
  canonicalWorkspaceRoot: string;
  completed: Map<Sha256, CompletedAuthority>;
  completedByAuthority: WeakMap<
    MiraiIntlClassifierAuthorityV3,
    CompletedAuthority
  >;
  failure?: Error;
  finalizePromise?: Promise<MiraiIntlClassifierFinalizedTransactionV3>;
  finalized?: MiraiIntlClassifierFinalizedTransactionV3;
  phase: "finalized" | "finalizing" | "open" | "poisoned";
  revalidationPromise?: Promise<void>;
  waiters: Array<() => void>;
}

const transactionStates = new WeakMap<
  MiraiIntlClassifierWorkspaceTransactionV3,
  TransactionState
>();
const finalizedTransactionStates = new WeakMap<
  MiraiIntlClassifierFinalizedTransactionV3,
  TransactionState
>();

async function currentPortableLstat(
  expected: MiraiIntlPortableLstatShadow
): Promise<MiraiIntlPortableLstatShadow> {
  try {
    const value = await lstat(expected.path);
    if (value.isSymbolicLink()) {
      const target = Buffer.from(await readlink(expected.path));
      return {
        kind: "symlink",
        linkTargetBase64: target.toString("base64"),
        linkTargetHash: sha256(target),
        path: expected.path,
      };
    }
    let kind: MiraiIntlPortableLstatShadow["kind"] = "other";
    if (value.isDirectory()) {
      kind = "directory";
    } else if (value.isFile()) {
      kind = "file";
    }
    return {
      kind,
      linkTargetBase64: null,
      linkTargetHash: null,
      path: expected.path,
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {
        kind: "absent",
        linkTargetBase64: null,
        linkTargetHash: null,
        path: expected.path,
      };
    }
    throw error;
  }
}

async function assertControlFiles(
  controls: ReadonlyArray<Readonly<{ hash: Sha256; path: string }>>
): Promise<void> {
  for (const control of controls) {
    if (sha256(await readFile(control.path)) !== control.hash) {
      throw new Error("Mirai Intl classifier proof frontier mutated");
    }
  }
}

async function assertProbes(
  probes: MiraiIntlGeneratedFacadeCandidateIndexShadow["probes"]
): Promise<void> {
  for (const probe of probes) {
    let present = false;
    try {
      const value = await stat(probe.path);
      present =
        probe.kind === "directory" ? value.isDirectory() : value.isFile();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    if (present !== probe.present) {
      throw new Error("Mirai Intl classifier proof frontier mutated");
    }
  }
}

async function assertRealpaths(
  realpaths: MiraiIntlGeneratedFacadeCandidateIndexShadow["realpaths"]
): Promise<void> {
  for (const entry of realpaths) {
    if ((await realpath(entry.path)) !== entry.target) {
      throw new Error("Mirai Intl classifier proof frontier mutated");
    }
  }
}

async function assertIndexStillCurrent(
  index: MiraiIntlGeneratedFacadeCandidateIndexShadow
): Promise<void> {
  await assertControlFiles(index.controls);
  await assertProbes(index.probes);
  await assertRealpaths(index.realpaths);
  for (const expected of index.lstats) {
    if (
      canonicalJson(await currentPortableLstat(expected)) !==
      canonicalJson(expected)
    ) {
      throw new Error("Mirai Intl classifier proof frontier mutated");
    }
  }
  for (const scope of index.packageScopes) {
    if (
      sha256(await readFile(scope.manifestPath)) !== scope.manifestHash ||
      (await realpath(scope.lexicalRoot)) !== scope.canonicalRoot
    ) {
      throw new Error("Mirai Intl classifier package scope mutated");
    }
  }
  for (const topology of index.packageTopology) {
    if (
      canonicalJson(await currentPortableLstat(topology.root)) !==
        canonicalJson(topology.root) ||
      canonicalJson(await currentPortableLstat(topology.manifest)) !==
        canonicalJson(topology.manifest) ||
      (topology.manifestHash !== null &&
        sha256(await readFile(topology.manifest.path)) !==
          topology.manifestHash) ||
      (topology.root.kind !== "absent" &&
        (await realpath(topology.root.path)) !== topology.canonicalRoot)
    ) {
      throw new Error("Mirai Intl classifier package topology mutated");
    }
  }
  await assertControlFiles(index.resolverFrontier.controlFiles);
  await assertProbes(index.resolverFrontier.probes);
  await assertRealpaths(index.resolverFrontier.realpaths);
  for (const proof of index.barePackageProofs) {
    await assertControlFiles(proof.controlFiles);
  }
}

async function assertProjectionStillCurrent(
  projection: MiraiIntlClassifierReceiptProjectionV3
): Promise<void> {
  if (
    sha256(await readFile(projection.generatedFacadePath)) !==
    projection.generatedFacadeHash
  ) {
    throw new Error("Mirai Intl classifier generated facade mutated");
  }
  await assertIndexStillCurrent(projection.checkpoint.index);
}

function transactionState(
  transaction: MiraiIntlClassifierWorkspaceTransactionV3
): TransactionState {
  const state = transactionStates.get(transaction);
  if (!state) {
    throw new Error(
      "Unapproved Mirai Intl classifier workspace transaction capability"
    );
  }
  return state;
}

function poisonTransaction(state: TransactionState, error: unknown): Error {
  state.failure ??= error instanceof Error ? error : new Error(String(error));
  state.phase = "poisoned";
  return state.failure;
}

function assertOpenTransaction(state: TransactionState): void {
  if (state.failure) {
    throw state.failure;
  }
  if (state.phase !== "open") {
    throw new Error("Mirai Intl classifier transaction is closed");
  }
}

async function validateFinalizedTransactionState(
  state: TransactionState,
  finalized?: MiraiIntlClassifierFinalizedTransactionV3
): Promise<ReadonlyArray<CompletedAuthority>> {
  const values = [...state.completed.values()].toSorted((left, right) =>
    compareCanonicalStrings(left.authority.inputHash, right.authority.inputHash)
  );
  const owners = values.map(({ projection }) => projection.owner);
  const inputHashes = values.map(({ authority }) => authority.inputHash);
  if (
    new Set(owners).size !== owners.length ||
    new Set(inputHashes).size !== inputHashes.length
  ) {
    throw new Error("Invalid Mirai Intl classifier finalized owner coverage");
  }
  if (
    finalized &&
    (finalized.authorities.length !== values.length ||
      finalized.receiptProjections.length !== values.length ||
      values.some(
        (value, index) =>
          finalized.authorities[index] !== value.authority ||
          finalized.receiptProjections[index] !== value.projection
      ))
  ) {
    throw new Error("Invalid Mirai Intl classifier finalized exact arrays");
  }
  for (const value of values) {
    const identity = await authorityInputIdentity(value.input);
    if (
      identity.inputHash !== value.authority.inputHash ||
      identity.generatedFacadeHash !== value.projection.generatedFacadeHash ||
      value.projection.inputHash !== value.authority.inputHash ||
      value.projection.workspaceRoot !== state.canonicalWorkspaceRoot ||
      value.authority.workspaceRoot !== state.canonicalWorkspaceRoot ||
      value.authority.receiptProjectionHash !==
        hashMiraiIntlClassifierReceiptProjectionV3(value.projection)
    ) {
      throw new Error(
        "Invalid Mirai Intl classifier finalized authority binding"
      );
    }
    validateMiraiIntlClassifierAuthorityV3(value.authority, identity.inputHash);
    await assertProjectionStillCurrent(value.projection);
  }
  return values;
}

/** @internal Commit-last live revalidation; every non-concurrent call is fresh. */
export function revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(
  finalized: MiraiIntlClassifierFinalizedTransactionV3
): Promise<void> {
  const state = finalizedTransactionStates.get(finalized);
  if (!state) {
    return Promise.reject(
      new Error("Unapproved Mirai Intl classifier finalized transaction")
    );
  }
  if (state.failure) {
    return Promise.reject(state.failure);
  }
  if (state.phase !== "finalized" || state.finalized !== finalized) {
    return Promise.reject(
      poisonTransaction(
        state,
        new Error("Invalid Mirai Intl classifier finalized transaction state")
      )
    );
  }
  if (state.revalidationPromise) {
    return state.revalidationPromise;
  }
  const pending = (async () => {
    try {
      await validateFinalizedTransactionState(state, finalized);
    } catch (error) {
      throw poisonTransaction(state, error);
    } finally {
      delete state.revalidationPromise;
    }
  })();
  state.revalidationPromise = pending;
  return pending;
}

export async function assertMiraiIntlClassifierWorkspaceTransactionV3(
  transaction: MiraiIntlClassifierWorkspaceTransactionV3,
  expectedWorkspaceRoot: string
): Promise<void> {
  const state = transactionState(transaction);
  try {
    assertOpenTransaction(state);
    if (
      (await realpath(resolve(expectedWorkspaceRoot))) !==
      state.canonicalWorkspaceRoot
    ) {
      throw new Error("Mirai Intl classifier authority workspace mismatch");
    }
  } catch (error) {
    throw poisonTransaction(state, error);
  }
}

export async function assertMiraiIntlClassifierTransactionAuthorityV3(
  transaction: MiraiIntlClassifierWorkspaceTransactionV3,
  _input: MiraiIntlClassifierAuthorityInputV3,
  authority: MiraiIntlClassifierAuthorityV3
): Promise<void> {
  const state = transactionState(transaction);
  try {
    assertOpenTransaction(state);
    if (state.completedByAuthority.get(authority)?.authority !== authority) {
      throw new Error("Invalid Mirai Intl classifier transaction authority");
    }
  } catch (error) {
    throw poisonTransaction(state, error);
  }
}

/** In-memory transaction only. Exact scope mutation is rejected, never refreshed. */
export async function createMiraiIntlClassifierWorkspaceTransactionV3(
  workspaceRoot: string
): Promise<MiraiIntlClassifierWorkspaceTransactionV3> {
  const canonicalWorkspaceRoot = await realpath(resolve(workspaceRoot));
  const byInput = new Map<Sha256, Promise<BuiltAuthority>>();
  const inputByScope = new Map<Sha256, Sha256>();
  const completed = new Map<Sha256, CompletedAuthority>();
  const state: TransactionState = {
    activeAuthorizations: 0,
    canonicalWorkspaceRoot,
    completed,
    completedByAuthority: new WeakMap(),
    phase: "open",
    waiters: [],
  };
  const waitForAuthorizations = async (): Promise<void> => {
    if (state.activeAuthorizations === 0) {
      return;
    }
    await new Promise<void>((resolveWaiter) => {
      state.waiters.push(resolveWaiter);
    });
  };
  const transaction: MiraiIntlClassifierWorkspaceTransactionV3 = {
    async authorize(input) {
      assertOpenTransaction(state);
      state.activeAuthorizations += 1;
      try {
        const preparedSourceFiles = new Map(
          input.sources.flatMap(({ id, preparedSourceFile }) =>
            preparedSourceFile ? [[id, preparedSourceFile] as const] : []
          )
        );
        const { sourceObserver } = input;
        const sealedInput = sealAuthorityInput(input);
        const requestedWorkspaceRoot = await realpath(
          resolve(sealedInput.workspaceRoot)
        );
        if (requestedWorkspaceRoot !== canonicalWorkspaceRoot) {
          throw new Error("Mirai Intl classifier authority workspace mismatch");
        }
        const identity = await authorityInputIdentity(sealedInput);
        const priorInput = inputByScope.get(identity.scopeHash);
        if (priorInput && priorInput !== identity.inputHash) {
          throw new Error(
            "Mirai Intl classifier authority input mutated in transaction"
          );
        }
        inputByScope.set(identity.scopeHash, identity.inputHash);
        let pending = byInput.get(identity.inputHash);
        if (!pending) {
          pending = buildAuthority(
            sealedInput,
            identity.generatedFacadeHash,
            identity.inputHash,
            canonicalWorkspaceRoot,
            preparedSourceFiles,
            sourceObserver
          ).then(async (result) => {
            await assertProjectionStillCurrent(result.projection);
            return result;
          });
          byInput.set(identity.inputHash, pending);
        }
        const result = await pending;
        const verifiedIdentity = await authorityInputIdentity(input);
        if (verifiedIdentity.inputHash !== identity.inputHash) {
          throw new Error(
            "Mirai Intl classifier authority input mutated while building"
          );
        }
        await assertProjectionStillCurrent(result.projection);
        if (
          result.authority.receiptProjectionHash !==
          hashMiraiIntlClassifierReceiptProjectionV3(result.projection)
        ) {
          throw new Error("Mirai Intl classifier receipt projection mutated");
        }
        const completedAuthority = { ...result, input: sealedInput };
        completed.set(identity.inputHash, completedAuthority);
        state.completedByAuthority.set(result.authority, completedAuthority);
        return validateMiraiIntlClassifierAuthorityV3(
          result.authority,
          identity.inputHash
        );
      } catch (error) {
        throw poisonTransaction(state, error);
      } finally {
        state.activeAuthorizations -= 1;
        if (state.activeAuthorizations === 0) {
          for (const resolveWaiter of state.waiters.splice(0)) {
            resolveWaiter();
          }
        }
      }
    },
    finalize() {
      if (state.failure) {
        return Promise.reject(state.failure);
      }
      if (state.finalized) {
        return Promise.resolve(state.finalized);
      }
      if (state.finalizePromise) {
        return state.finalizePromise;
      }
      state.phase = "finalizing";
      state.finalizePromise = (async () => {
        try {
          await waitForAuthorizations();
          if (state.failure) {
            throw state.failure;
          }
          const values = await validateFinalizedTransactionState(state);
          const finalized = deepFreezeMiraiIntlClassifierValue({
            authorities: values.map(({ authority }) => authority),
            receiptProjections: values.map(({ projection }) => projection),
          });
          state.finalized = finalized;
          state.phase = "finalized";
          finalizedTransactionStates.set(finalized, state);
          return finalized;
        } catch (error) {
          throw poisonTransaction(state, error);
        }
      })();
      return state.finalizePromise;
    },
    workspaceRoot: canonicalWorkspaceRoot,
  };
  deepFreezeMiraiIntlClassifierValue(transaction);
  transactionStates.set(transaction, state);
  return transaction;
}
