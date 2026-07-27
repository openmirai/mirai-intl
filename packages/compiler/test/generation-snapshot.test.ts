import type { RuntimeAbi, Sha256 } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import { canonicalHash, canonicalJson, sha256 } from "../src/canonical";
import {
  buildCatalogGenerationInputIdentity,
  buildCatalogGenerationSnapshot,
  buildCatalogPayloadManifest,
  CATALOG_PUBLICATION_STATES,
  parseCanonicalCatalogCurrentPointer,
  parseCanonicalCatalogGenerationReceipt,
  parseCatalogCurrentPointer,
  parseCatalogGenerationInputIdentity,
  parseCatalogGenerationReceipt,
  parseCatalogGenerationSnapshot,
  parseCatalogPublicationJournal,
} from "../src/generation-snapshot";
import type {
  CatalogGenerationInputIdentityV1,
  CatalogGenerationSnapshot,
} from "../src/generation-snapshot";

function hash(label: string): Sha256 {
  return sha256(label);
}

function manifest(path: string) {
  const entries = [{ hash: hash(path), path, size: 1 }];
  return { entries, hash: canonicalHash(entries) };
}

function inputIdentity(withLock = true): CatalogGenerationInputIdentityV1 {
  const compilerModules = manifest("generation.ts");
  const packageFiles = manifest("index.js");
  const packageBase = {
    entry:
      packageFiles.entries[0] ??
      (() => {
        throw new Error("Expected one fixture package entry");
      })(),
    name: "@formatjs/icu-messageformat-parser",
    packageFiles,
    packageJsonHash: hash("icu-package-json"),
    version: "3.5.14",
  };
  const applicationBase = withLock
    ? {
        lock: { hash: hash("lock"), name: "pnpm-lock.yaml" },
        packageJsonHash: hash("application-package-json"),
      }
    : { packageJsonHash: hash("application-package-json") };
  return buildCatalogGenerationInputIdentity({
    application: { ...applicationBase, hash: canonicalHash(applicationBase) },
    artifactAbi: "mirai-intl-artifact-v2",
    compiler: {
      hash: canonicalHash({ modulesHash: compilerModules.hash }),
      modules: compilerModules,
    },
    config: manifest("mirai-intl.config.ts"),
    environment: { NODE_ENV: "production" },
    generationOptions: { declaration: true },
    icu: { ...packageBase, hash: canonicalHash(packageBase) },
    locales: manifest("locales/en.json"),
    runtimeAbi: "1.0.0" as RuntimeAbi,
  });
}

function snapshot(): CatalogGenerationSnapshot {
  const contentHash = hash("payload");
  return buildCatalogGenerationSnapshot({
    catalogLockHash: hash("catalog-lock"),
    generationInput: inputIdentity(),
    payloadContentHash: contentHash,
    payloadDirectory: `builds/${contentHash.slice(7)}`,
    payloadEntries: [
      { hash: hash("z"), mode: null, path: "z.json", size: 1 },
      { hash: hash("a"), mode: 0o644, path: "nested\\a.json", size: 2 },
    ],
    stableFacadeHash: hash("stable-facade"),
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function setAtPath(
  value: unknown,
  path: ReadonlyArray<string | number>,
  replacement: unknown
): void {
  let current = value as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) {
    current = current[key] as Record<string | number, unknown>;
  }
  const leaf = path.at(-1);
  if (leaf === undefined) {
    throw new Error("Mutation path must not be empty");
  }
  current[leaf] = replacement;
}

describe("catalog generation snapshot contracts", () => {
  it("canonically binds application identities with and without a lock", () => {
    const locked = inputIdentity();
    expect(locked.application.hash).toBe(
      canonicalHash({
        lock: locked.application.lock,
        packageJsonHash: locked.application.packageJsonHash,
      })
    );

    const unlocked = inputIdentity(false);
    expect(unlocked.application).not.toHaveProperty("lock");
    expect(unlocked.application.hash).toBe(
      canonicalHash({
        packageJsonHash: unlocked.application.packageJsonHash,
      })
    );
    expect(parseCatalogGenerationInputIdentity(unlocked)).toEqual(unlocked);
    expect(canonicalJson(unlocked)).toContain('"application"');

    expect(() =>
      parseCatalogGenerationInputIdentity({
        ...unlocked,
        application: { ...unlocked.application, lock: undefined },
      })
    ).toThrow("must be a plain object");

    const changedLock = structuredClone(locked);
    const currentLock = changedLock.application.lock;
    if (!currentLock) {
      throw new Error("Expected a lock fixture");
    }
    const mutated = {
      ...changedLock,
      application: {
        ...changedLock.application,
        lock: { ...currentLock, hash: hash("changed-lock") },
      },
    };
    expect(() => parseCatalogGenerationInputIdentity(mutated)).toThrow(
      "does not bind application inputs"
    );
  });

  it("normalizes and orders payloads while excluding the receipt", () => {
    const payload = buildCatalogPayloadManifest([
      { hash: hash("z"), mode: null, path: "z.json", size: 1 },
      { hash: hash("a"), mode: 0o644, path: "nested\\a.json", size: 2 },
    ]);
    expect(payload.entries.map((entry) => entry.path)).toEqual([
      "nested/a.json",
      "z.json",
    ]);
    expect(payload.hash).toBe(canonicalHash(payload.entries));

    expect(() =>
      buildCatalogPayloadManifest([
        {
          hash: hash("receipt"),
          mode: null,
          path: "catalog-generation-receipt.v1.json",
          size: 1,
        },
      ])
    ).toThrow("must exclude the generation receipt");
    expect(() =>
      buildCatalogPayloadManifest([
        { hash: hash("a"), mode: null, path: "a.json", size: 1 },
        { hash: hash("b"), mode: null, path: "a.json", size: 1 },
      ])
    ).toThrow("duplicate identity");
    expect(() =>
      buildCatalogPayloadManifest([
        { hash: hash("a"), mode: null, path: "../a.json", size: 1 },
      ])
    ).toThrow("confined canonical relative path");
  });

  it("binds complete inputs without receipt self-reference", () => {
    const value = snapshot();
    expect(value.generationReceipt).not.toHaveProperty("generationReceiptHash");
    expect(value.generationReceipt.payload.manifest.entries).not.toContainEqual(
      expect.objectContaining({
        path: "catalog-generation-receipt.v1.json",
      })
    );
    expect(value.generationReceiptHash).toBe(
      sha256(`${canonicalJson(value.generationReceipt)}\n`)
    );
    expect(value.pointer.generationReceiptHash).toBe(
      value.generationReceiptHash
    );

    const mutatedPointer = {
      ...value.pointer,
      generationReceiptHash: hash("different receipt"),
    };
    expect(parseCatalogCurrentPointer(mutatedPointer)).toEqual(mutatedPointer);
    expect(value.generationReceipt).toEqual(
      parseCatalogGenerationReceipt(value.generationReceipt)
    );
  });

  it("strictly reconstructs snapshots and rejects every inconsistent identity", () => {
    const value = snapshot();
    expect(parseCatalogGenerationSnapshot(value)).toEqual(value);

    for (const [path, replacement] of [
      [["generationInput", "environment", "NODE_ENV"], "development"],
      [
        ["generationInput", "compiler", "modules", "entries", 0, "hash"],
        hash("changed"),
      ],
      [["payload", "manifest", "entries", 0, "hash"], hash("changed")],
      [["generationReceipt", "stableFacadeHash"], hash("changed")],
      [["generationReceiptHash"], hash("changed")],
      [["pointer", "generationReceiptHash"], hash("changed")],
      [["unexpected"], true],
    ] satisfies ReadonlyArray<
      readonly [ReadonlyArray<string | number>, unknown]
    >) {
      const copy = clone(value);
      setAtPath(copy, path, replacement);
      expect(() => parseCatalogGenerationSnapshot(copy)).toThrow(/./u);
    }
  });

  it("requires canonical receipt and pointer bytes", () => {
    const value = snapshot();
    expect(
      parseCanonicalCatalogGenerationReceipt(
        `${canonicalJson(value.generationReceipt)}\n`
      )
    ).toEqual(value.generationReceipt);
    expect(
      parseCanonicalCatalogCurrentPointer(`${canonicalJson(value.pointer)}\n`)
    ).toEqual(value.pointer);
    expect(() =>
      parseCanonicalCatalogGenerationReceipt(
        JSON.stringify(value.generationReceipt)
      )
    ).toThrow("canonical JSON bytes");
  });

  it("models only the ordered publication states and exact journal keys", () => {
    for (const state of CATALOG_PUBLICATION_STATES) {
      expect(
        parseCatalogPublicationJournal({
          expectedPublicationHash: hash("publication"),
          ownerToken: "123e4567-e89b-12d3-a456-426614174000",
          previousDirectory: null,
          schemaVersion: 1,
          stageDirectory: "stage-123e4567-e89b-12d3-a456-426614174000",
          state,
        }).state
      ).toBe(state);
    }
    expect(() =>
      parseCatalogPublicationJournal({
        expectedPublicationHash: hash("publication"),
        ownerToken: "owner",
        previousDirectory: null,
        schemaVersion: 1,
        stageDirectory: "stage-owner",
        state: "UNKNOWN",
      })
    ).toThrow("invalid ownership or state");
    expect(() =>
      parseCatalogPublicationJournal({
        expectedPublicationHash: hash("publication"),
        extra: true,
        ownerToken: "owner",
        previousDirectory: null,
        schemaVersion: 1,
        stageDirectory: "stage-owner",
        state: "PREPARED",
      })
    ).toThrow("unexpected or missing fields");
  });
});
