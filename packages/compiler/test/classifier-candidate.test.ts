import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/canonical";
import {
  buildMiraiIntlClassifierAuthorityEnvelopeV3,
  buildMiraiIntlPersistedClassifierAuthorityV3,
  canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes,
  deepFreezeMiraiIntlClassifierValue,
  hashMiraiIntlClassifierAuthorityEnvelopeV3,
  parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3,
} from "../src/classifier-authority";
import type { MiraiIntlPersistedClassifierAuthorityV3 } from "../src/classifier-authority";
import {
  assertMiraiIntlClassifierTransactionAuthorityV3,
  createMiraiIntlClassifierWorkspaceTransactionV3,
  hashMiraiIntlClassifierReceiptProjectionV3,
  revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3,
  validateMiraiIntlClassifierAuthorityV3,
} from "../src/classifier-candidate";
import { createMiraiIntlPreparedCandidateSourceFile } from "../src/classifier-candidate-shadow";
import type { MiraiIntlGeneratedFacadeCandidateIndexShadow } from "../src/classifier-candidate-shadow";

async function write(path: string, value: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value, "utf8");
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing classifier test fixture ${label}`);
  }
  return value;
}

function persistedAuthorityFixture(
  owner = "tsconfig.json",
  source = "src/source.ts",
  decision: "facade-absent" | "facade-present" = "facade-absent",
  requiresProgram = false
): MiraiIntlPersistedClassifierAuthorityV3 {
  const vectorHash = sha256("requires-program-vector");
  return buildMiraiIntlPersistedClassifierAuthorityV3({
    artifactHash: sha256("artifact"),
    checkpointAHash: sha256("checkpoint-a"),
    indexHash: sha256("index"),
    inputHash: sha256("input"),
    optimizedRequiresProgramVectorHash: vectorHash,
    owner,
    receiptProjectionHash: sha256("projection"),
    referenceRequiresProgramVectorHash: vectorHash,
    sources: [
      [
        source,
        sha256("source"),
        sha256("boundaries"),
        decision,
        requiresProgram,
      ],
    ],
  });
}

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "mirai-intl-classifier-authority-"))
  );
  const facade = join(root, "generated/index.ts");
  await write(join(root, "package.json"), '{"name":"authority-test"}\n');
  await write(facade, "export declare function t(key: string): string;\n");
  await write(join(root, "other.ts"), "export const other = 1;\n");
  const sources = [
    {
      id: join(root, "absent.ts"),
      source: 'import "./other";\n',
    },
    {
      id: join(root, "present.ts"),
      source: 'import { t } from "./generated";\nt("key");\n',
    },
    {
      id: join(root, "unknown.ts"),
      source: "declare const target: string;\nimport(target);\n",
    },
  ];
  await Promise.all(sources.map(({ id, source }) => write(id, source)));
  return {
    facade,
    input: {
      generatedFacadePath: facade,
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      owner: "tsconfig.json",
      sources,
      workspaceRoot: root,
    },
    root,
  } as const;
}

describe("classifier production authority V3", () => {
  it("recursively freezes nested values beneath an externally frozen root", () => {
    const nested = { value: ["arbitrary-string"] };
    const root = Object.freeze({ nested });

    expect(deepFreezeMiraiIntlClassifierValue(root)).toBe(root);
    expect(Object.isFrozen(nested)).toBe(true);
    expect(Object.isFrozen(nested.value)).toBe(true);
    expect(() => nested.value.push("mutation")).toThrow(/extensible/u);
  });

  it("preserves prepared-source capabilities outside the sealed authority input", async () => {
    const value = await fixture();
    const observations: Array<string> = [];
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await transaction.authorize({
      ...value.input,
      sourceObserver: (mode) => observations.push(mode),
      sources: value.input.sources.map((source) => ({
        ...source,
        preparedSourceFile: createMiraiIntlPreparedCandidateSourceFile(
          source.id,
          source.source,
          value.input.options
        ),
      })),
    });

    expect(observations).toEqual(["prepared", "prepared", "prepared"]);
    await expect(transaction.finalize()).resolves.toEqual(
      expect.objectContaining({ authorities: [expect.any(Object)] })
    );
  });

  it("binds the five M3 hashes and exact program vector", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    const authority = await transaction.authorize(value.input);

    expect(validateMiraiIntlClassifierAuthorityV3(authority)).toBe(authority);
    expect(() =>
      validateMiraiIntlClassifierAuthorityV3(authority, sha256("other-input"))
    ).toThrow("Invalid Mirai Intl classifier production authority");
    expect(authority.indexHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(authority.checkpointAHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(authority.optimizedRequiresProgramVectorHash).toBe(
      authority.referenceRequiresProgramVectorHash
    );
    expect(authority.artifactHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(
      authority.sources.map(({ source, sourceHash }) => ({
        source,
        sourceHash,
      }))
    ).toEqual(
      value.input.sources
        .map(({ id, source }) => ({ source: id, sourceHash: sha256(source) }))
        .toSorted((left, right) => left.source.localeCompare(right.source))
    );
    expect(
      authority.sources.map(({ decision, requiresProgram }) => ({
        decision,
        requiresProgram,
      }))
    ).toEqual([
      { decision: "facade-absent", requiresProgram: false },
      { decision: "facade-present", requiresProgram: true },
      { decision: "facade-unknown-active", requiresProgram: true },
    ]);
  });

  it("keeps fallback decisions while forcing the complete owner into Programs", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    const authority = await transaction.authorize({
      ...value.input,
      options: {
        ...value.input.options,
        moduleResolution: ts.ModuleResolutionKind.Node10,
      },
    });

    expect((authority.indexBinding as Readonly<{ mode: string }>).mode).toBe(
      "owner-fallback"
    );
    expect(
      authority.sources.map(({ decision, requiresProgram }) => ({
        decision,
        requiresProgram,
      }))
    ).toEqual([
      { decision: "facade-absent", requiresProgram: true },
      { decision: "facade-present", requiresProgram: true },
      { decision: "facade-unknown-active", requiresProgram: true },
    ]);
  });

  it("reuses one order-independent workspace transaction", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    const first = await transaction.authorize(value.input);
    const second = await transaction.authorize({
      ...value.input,
      sources: value.input.sources.toReversed(),
    });
    const independent = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    const reversed = await independent.authorize({
      ...value.input,
      sources: value.input.sources.toReversed(),
    });

    expect(second).toBe(first);
    expect(reversed.resultHash).toBe(first.resultHash);
    expect(reversed.artifactHash).toBe(first.artifactHash);
    const finalized = await transaction.finalize();
    expect(finalized.authorities).toEqual([first]);
    expect(Object.isFrozen(finalized.authorities)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sources)).toBe(true);
    expect(Object.isFrozen(first.sources[0])).toBe(true);
    const [projection] = finalized.receiptProjections;
    expect(projection).toBeDefined();
    expect(Object.isFrozen(finalized.receiptProjections)).toBe(true);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection?.sources[0]?.ledger)).toBe(true);
    expect(projection?.generatedFacadeHash).toBe(
      sha256("export declare function t(key: string): string;\n")
    );
    expect(
      projection && hashMiraiIntlClassifierReceiptProjectionV3(projection)
    ).toBe(first.receiptProjectionHash);
    expect(await transaction.finalize()).toBe(finalized);
    const firstRevalidation =
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(finalized);
    const concurrentRevalidation =
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(finalized);
    expect(concurrentRevalidation).toBe(firstRevalidation);
    await firstRevalidation;
    await expect(
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(finalized)
    ).resolves.toBeUndefined();
    await expect(transaction.authorize(value.input)).rejects.toThrow(
      "transaction is closed"
    );
  });

  it("rejects authority mutation and in-transaction input mutation", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    const authority = await transaction.authorize(value.input);
    expect(() =>
      validateMiraiIntlClassifierAuthorityV3({
        ...authority,
        resultHash: "sha256:deadbeef",
      })
    ).toThrow("Invalid Mirai Intl classifier production authority");
    for (const field of [
      "artifactHash",
      "checkpointAHash",
      "indexHash",
      "optimizedRequiresProgramVectorHash",
      "referenceRequiresProgramVectorHash",
    ] as const) {
      expect(() =>
        validateMiraiIntlClassifierAuthorityV3({
          ...authority,
          [field]: "sha256:deadbeef",
        })
      ).toThrow("Invalid Mirai Intl classifier production authority");
    }

    await expect(
      transaction.authorize({
        ...value.input,
        sources: value.input.sources.map((source, index) =>
          index === 0 ? { ...source, source: `${source.source}\n` } : source
        ),
      })
    ).rejects.toThrow(/input mutated in transaction|source mutated/u);

    const fresh = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await fresh.authorize(value.input);
    await write(value.facade, "export declare const changed: true;\n");
    await expect(fresh.authorize(value.input)).rejects.toThrow(
      "input mutated in transaction"
    );
  });

  it("rejects a mismatched workspace", async () => {
    const value = await fixture();
    const other = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await expect(
      transaction.authorize({
        ...value.input,
        workspaceRoot: other.root,
      })
    ).rejects.toThrow("workspace mismatch");
  });

  it("rejects counterfeit capabilities, duplicate coverage, and sidecar swaps", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    const authority = await transaction.authorize(value.input);
    const counterfeit = {
      authorize: async () => authority,
      finalize: () => transaction.finalize(),
      workspaceRoot: value.root,
    };
    await expect(
      assertMiraiIntlClassifierTransactionAuthorityV3(
        counterfeit,
        value.input,
        authority
      )
    ).rejects.toThrow("Unapproved");

    const duplicateCheckpoint = {
      ...authority,
      checkpointAInput: authority.checkpointAInput.map((entry, index) =>
        index === 1
          ? required(authority.checkpointAInput[0], "checkpoint source")
          : entry
      ),
    };
    expect(() =>
      validateMiraiIntlClassifierAuthorityV3(duplicateCheckpoint)
    ).toThrow("checkpoint source coverage");

    const missingVector = {
      ...authority,
      optimizedRequiresProgramVector:
        authority.optimizedRequiresProgramVector.slice(0, -1),
    };
    expect(() => validateMiraiIntlClassifierAuthorityV3(missingVector)).toThrow(
      "exact source coverage"
    );

    const duplicateSources = {
      ...authority,
      sources: authority.sources.map((source, index) =>
        index === 1
          ? required(authority.sources[0], "authority source")
          : source
      ),
    };
    expect(() =>
      validateMiraiIntlClassifierAuthorityV3(duplicateSources)
    ).toThrow("authority source coverage");

    const other = await fixture();
    const otherTransaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(other.root);
    const otherAuthority = await otherTransaction.authorize(other.input);
    await expect(
      assertMiraiIntlClassifierTransactionAuthorityV3(
        transaction,
        value.input,
        otherAuthority
      )
    ).rejects.toThrow("Invalid Mirai Intl classifier transaction authority");

    const projectionTransaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(value.root);
    await projectionTransaction.authorize(value.input);
    const projection = required(
      (await projectionTransaction.finalize()).receiptProjections[0],
      "receipt projection"
    );
    expect(() => {
      (
        required(projection.sources[0], "projection source")
          .ledger as Array<unknown>
      ).push({});
    }).toThrow(/extensible|frozen|read only/u);
  });

  it("rejects live proof-frontier mutation instead of refreshing", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await transaction.authorize(value.input);
    await write(
      join(value.root, "package.json"),
      '{"name":"authority-test","imports":{"#x":"./other.ts"}}\n'
    );
    await expect(transaction.finalize()).rejects.toThrow(
      /proof frontier mutated|package scope mutated|package topology mutated/u
    );
    await expect(transaction.finalize()).rejects.toThrow(/mutated/u);
    await expect(transaction.authorize(value.input)).rejects.toThrow(
      /mutated/u
    );
  });

  it("rejects live source-byte mutation during finalization and poisons", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await transaction.authorize(value.input);
    await write(
      required(value.input.sources[0], "source mutation target").id,
      'import "./changed";\n'
    );
    await expect(transaction.finalize()).rejects.toThrow("source mutated");
    await expect(transaction.finalize()).rejects.toThrow("source mutated");
    await expect(transaction.authorize(value.input)).rejects.toThrow(
      "source mutated"
    );
  });

  it("asserts an authorized capability by O(1) brand identity without duplicate I/O", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    const authority = await transaction.authorize(value.input);
    await write(
      required(value.input.sources[0], "source mutation target").id,
      'import "./changed";\n'
    );

    await expect(
      assertMiraiIntlClassifierTransactionAuthorityV3(
        transaction,
        value.input,
        authority
      )
    ).resolves.toBeUndefined();
    await expect(transaction.finalize()).rejects.toThrow(/mutated/u);
  });

  it("poisons commit revalidation after post-finalize live mutation", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await transaction.authorize(value.input);
    const finalized = await transaction.finalize();
    await write(
      required(value.input.sources[0], "commit source mutation target").id,
      'import "./changed-after-finalize";\n'
    );
    await expect(
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(finalized)
    ).rejects.toThrow("source mutated");
    await expect(transaction.finalize()).rejects.toThrow("source mutated");
    await expect(
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(finalized)
    ).rejects.toThrow("source mutated");
  });

  it("rejects counterfeit finalized values without weakening the brand", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await transaction.authorize(value.input);
    const finalized = await transaction.finalize();
    await expect(
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(
        structuredClone(finalized)
      )
    ).rejects.toThrow("Unapproved");
    await expect(
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(finalized)
    ).resolves.toBeUndefined();
  });

  it("rejects absent lockfile and nearer-manifest creation", async () => {
    for (const relativePath of ["pnpm-lock.yaml", "generated/package.json"]) {
      const value = await fixture();
      const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
        value.root
      );
      await transaction.authorize(value.input);
      await write(join(value.root, relativePath), "{}\n");
      await expect(transaction.finalize()).rejects.toThrow(
        /proof frontier mutated|package topology mutated/u
      );
    }
  });

  it("rejects resolver probe and realpath mutation", async () => {
    const probeValue = await fixture();
    const probeTransaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(probeValue.root);
    const probeAuthority = await probeTransaction.authorize(probeValue.input);
    const probeIndex = probeAuthority.indexBinding as Omit<
      MiraiIntlGeneratedFacadeCandidateIndexShadow,
      "indexHash"
    >;
    const absentFileProbe = probeIndex.resolverFrontier.probes.find(
      ({ kind, present }) => kind === "file" && !present
    );
    expect(absentFileProbe).toBeDefined();
    await write(
      required(absentFileProbe, "absent resolver probe").path,
      "export {};\n"
    );
    await expect(probeTransaction.finalize()).rejects.toThrow(
      "proof frontier mutated"
    );

    const realpathValue = await fixture();
    const realpathTransaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(realpathValue.root);
    const realpathAuthority = await realpathTransaction.authorize(
      realpathValue.input
    );
    const otherPath = realpathValue.facade;
    const realpathIndex = realpathAuthority.indexBinding as Omit<
      MiraiIntlGeneratedFacadeCandidateIndexShadow,
      "indexHash"
    >;
    const boundRealpath = realpathIndex.realpaths.find(
      ({ path }) => path === otherPath
    );
    expect(boundRealpath).toBeDefined();
    await write(
      join(realpathValue.root, "replacement.ts"),
      "export declare function t(key: string): string;\n"
    );
    await rm(otherPath);
    await symlink(join(realpathValue.root, "replacement.ts"), otherPath);
    await expect(realpathTransaction.finalize()).rejects.toThrow(
      /finalized authority binding|input mutated in transaction|proof frontier mutated/u
    );
  });

  it("rejects a symlink target swap in the same lexical scope", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-classifier-symlink-swap-"))
    );
    await write(join(root, "package.json"), '{"name":"symlink-test"}\n');
    for (const target of ["generated-a", "generated-b"]) {
      await write(
        join(root, target, "index.ts"),
        "export declare function t(key: string): string;\n"
      );
    }
    const generated = join(root, "generated");
    await symlink(join(root, "generated-a"), generated, "dir");
    const input = {
      generatedFacadePath: join(generated, "index.ts"),
      options: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      owner: "tsconfig.json",
      sources: [
        { id: join(root, "source.ts"), source: 'import "./generated";\n' },
      ],
      workspaceRoot: root,
    } as const;
    await write(input.sources[0].id, input.sources[0].source);
    const transaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(root);
    await transaction.authorize(input);
    await rm(generated);
    await symlink(join(root, "generated-b"), generated, "dir");
    await expect(transaction.finalize()).rejects.toThrow(
      /finalized authority binding|input mutated in transaction|proof frontier mutated/u
    );
  });

  it("rejects duplicate source paths before classification", async () => {
    const value = await fixture();
    const transaction = await createMiraiIntlClassifierWorkspaceTransactionV3(
      value.root
    );
    await expect(
      transaction.authorize({
        ...value.input,
        sources: [
          ...value.input.sources,
          required(value.input.sources[0], "duplicate source"),
        ],
      })
    ).rejects.toThrow("Duplicate Mirai Intl classifier source path");
  });

  it("parses only canonical portable receipt-bound authority bytes", () => {
    const authority = persistedAuthorityFixture();
    const envelope = buildMiraiIntlClassifierAuthorityEnvelopeV3({
      authorities: [authority],
      receiptHash: sha256("receipt"),
      sourceAuthorizationHash: sha256("source-authorization"),
    });
    const bytes =
      canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(envelope);

    expect(parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(bytes)).toEqual(
      envelope
    );
    expect(hashMiraiIntlClassifierAuthorityEnvelopeV3(envelope)).toBe(
      sha256(bytes)
    );
    const mutableEnvelope = {
      authorities: [authority],
      receiptHash: sha256("mutable-receipt"),
      schemaVersion: 3 as const,
      sourceAuthorizationHash: sha256("source-authorization"),
    };
    const mutableBytes =
      canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(mutableEnvelope);
    mutableEnvelope.receiptHash = sha256("mutated-receipt");
    expect(
      canonicalMiraiIntlClassifierAuthorityEnvelopeV3Bytes(mutableEnvelope)
    ).not.toBe(mutableBytes);
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes.slice(0, -1)).not.toContain("\n");
    expect(() =>
      parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
        JSON.stringify(envelope, null, 2)
      )
    ).toThrow("canonical JSON bytes");
    expect(() =>
      parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
        `${JSON.stringify({ authorities: [{}], schemaVersion: 3 })}\n`
      )
    ).toThrow("canonical fields");
    expect(() =>
      parseCanonicalMiraiIntlClassifierAuthorityEnvelopeV3(
        `${canonicalJson({
          ...envelope,
          authorities: envelope.authorities.map((entry, index) =>
            index === 0
              ? {
                  ...entry,
                  sources: entry.sources.map((source, sourceIndex) =>
                    sourceIndex === 0
                      ? [source[0], sha256("mutated"), ...source.slice(2)]
                      : source
                  ),
                }
              : entry
          ),
        })}\n`
      )
    ).toThrow("Invalid Mirai Intl persisted classifier authority");
  });

  it("accepts persisted fallback-shaped absent sources but rejects unsafe non-absent sources", () => {
    expect(
      persistedAuthorityFixture(
        "tsconfig.json",
        "src/source.ts",
        "facade-absent",
        true
      ).sources[0]?.[4]
    ).toBe(true);
    expect(() =>
      persistedAuthorityFixture(
        "tsconfig.json",
        "src/source.ts",
        "facade-present",
        false
      )
    ).toThrow("Invalid Mirai Intl persisted classifier source");
  });

  it.each(["", "/absolute", "../escape", "a/../escape", "a\\b", "e\u0301"])(
    "rejects non-portable persisted authority path %j",
    (path) => {
      expect(() => persistedAuthorityFixture(path)).toThrow(
        "portable workspace-relative path"
      );
      expect(() => persistedAuthorityFixture("tsconfig.json", path)).toThrow(
        "portable workspace-relative path"
      );
    }
  );

  it("accepts dot as the portable workspace root and rejects duplicate owners", () => {
    const rootAuthority = persistedAuthorityFixture(".", ".");
    expect(rootAuthority.owner).toBe(".");
    expect(() =>
      buildMiraiIntlClassifierAuthorityEnvelopeV3({
        authorities: [rootAuthority, rootAuthority],
        receiptHash: sha256("receipt"),
        sourceAuthorizationHash: sha256("source-authorization"),
      })
    ).toThrow("persisted owner coverage");
  });
});
