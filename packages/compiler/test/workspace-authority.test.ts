import type { PackageAuthoritySetV1, Sha256 } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/canonical";
import {
  INTL_WORKSPACE_AUTHORITY_MANIFESTS_DIRECTORY,
  INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH,
  buildWorkspaceAuthorityRootPointerV1,
  buildWorkspaceAuthorityV1,
  canonicalWorkspaceAuthorityRootPointerV1Bytes,
  canonicalWorkspaceAuthorityV1Bytes,
  hashWorkspaceAuthorityV1,
  parseCanonicalWorkspaceAuthorityRootPointerV1,
  parseCanonicalWorkspaceAuthorityV1,
  validateWorkspaceAuthorityV1,
  workspaceAuthorityManifestPath,
} from "../src/workspace-authority";
import type {
  WorkspaceAuthorityInputV1,
  WorkspaceAuthorityV1,
} from "../src/workspace-authority";

function hash(label: string): Sha256 {
  return sha256(label);
}

function packageAt<T>(packages: ReadonlyArray<T>, index: number): T {
  const packageEntry = packages[index];
  if (!packageEntry) {
    throw new Error(`Missing package at index ${index}`);
  }
  return packageEntry;
}

function packageAuthoritySet(
  root: string,
  index: number,
  schemaVersion: 2 | 3 = 3
): PackageAuthoritySetV1 {
  return {
    classifierAuthority:
      schemaVersion === 3
        ? { hash: hash(`classifier-${index}`), schemaVersion: 3 }
        : null,
    package: {
      manifestHash: hash(`manifest-${index}`),
      name: `@openmirai/package-${index}`,
      root,
    },
    receipt: { hash: hash(`receipt-${index}`), schemaVersion },
    schemaVersion: 1,
  };
}

function authoritySetHash(authoritySet: PackageAuthoritySetV1): Sha256 {
  return sha256(`${canonicalJson(authoritySet)}\n`);
}

function input(): WorkspaceAuthorityInputV1 {
  const roots = [
    "packages/zeta",
    "apps/learner",
    "packages/alpha",
    "apps/admin",
    "apps/instructor",
  ];
  return {
    gitTreeHash: hash("git-tree"),
    packages: roots.map((root, index) => {
      const authoritySet = packageAuthoritySet(root, index);
      return {
        authoritySet,
        authoritySetHash: authoritySetHash(authoritySet),
        catalogContentHash: hash(`catalog-${index}`),
        generationReceiptHash: hash(`generation-${index}`),
        sourceAuthorizationHash: hash(`source-authorization-${index}`),
      };
    }),
    snapshotHash: hash("snapshot"),
    toolchainHash: hash("toolchain"),
    workspaceLock: { hash: hash("lock"), path: "pnpm-lock.yaml" },
  };
}

type Mutable<T> = T extends readonly []
  ? []
  : T extends readonly [unknown, ...Array<unknown>]
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T extends ReadonlyArray<infer Item>
      ? Array<Mutable<Item>>
      : T extends object
        ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
        : T;

function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>;
}

describe("workspace authority V1", () => {
  it("builds exactly five sorted V3 package bindings and round-trips canonical bytes", () => {
    const authority = buildWorkspaceAuthorityV1(input());
    const bytes = canonicalWorkspaceAuthorityV1Bytes(authority);

    expect(authority.packages.map((entry) => entry.package.root)).toEqual([
      "apps/admin",
      "apps/instructor",
      "apps/learner",
      "packages/alpha",
      "packages/zeta",
    ]);
    expect(authority.packages).toHaveLength(5);
    expect(parseCanonicalWorkspaceAuthorityV1(bytes)).toEqual(authority);
    expect(hashWorkspaceAuthorityV1(authority)).toBe(sha256(bytes));
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.isFrozen(authority.packages)).toBe(true);
  });

  it("derives immutable content-addressed paths and an exact root pointer", () => {
    const authority = buildWorkspaceAuthorityV1(input());
    const manifestHash = hashWorkspaceAuthorityV1(authority);
    const pointer = buildWorkspaceAuthorityRootPointerV1(manifestHash);
    const bytes = canonicalWorkspaceAuthorityRootPointerV1Bytes(pointer);

    expect(workspaceAuthorityManifestPath(manifestHash)).toBe(
      `${INTL_WORKSPACE_AUTHORITY_MANIFESTS_DIRECTORY}/${manifestHash.slice("sha256:".length)}.json`
    );
    expect(INTL_WORKSPACE_AUTHORITY_ROOT_POINTER_PATH).toBe(
      ".mirai-intl/workspace-authority/current.json"
    );
    expect(parseCanonicalWorkspaceAuthorityRootPointerV1(bytes)).toEqual(
      pointer
    );
    expect(JSON.parse(bytes)).toEqual({ manifestHash, schemaVersion: 1 });
  });

  it("binds every required package and workspace evidence hash", () => {
    const authority = buildWorkspaceAuthorityV1(input());
    const packageEntry = authority.packages[0];
    expect(packageEntry).toMatchObject({
      authoritySetHash: expect.stringMatching(/^sha256:/u),
      catalogContentHash: expect.stringMatching(/^sha256:/u),
      classifierAuthorityHash: expect.stringMatching(/^sha256:/u),
      generationReceiptHash: expect.stringMatching(/^sha256:/u),
      receiptHash: expect.stringMatching(/^sha256:/u),
      sourceAuthorizationHash: expect.stringMatching(/^sha256:/u),
    });
    expect(authority).toMatchObject({
      gitTreeHash: hash("git-tree"),
      snapshotHash: hash("snapshot"),
      toolchainHash: hash("toolchain"),
      workspaceLock: { hash: hash("lock"), path: "pnpm-lock.yaml" },
    });
  });

  it.each([
    [
      "git tree",
      (value: Mutable<WorkspaceAuthorityV1>) =>
        (value.gitTreeHash = hash("changed")),
    ],
    [
      "snapshot",
      (value: Mutable<WorkspaceAuthorityV1>) =>
        (value.snapshotHash = hash("changed")),
    ],
    [
      "toolchain",
      (value: Mutable<WorkspaceAuthorityV1>) =>
        (value.toolchainHash = hash("changed")),
    ],
    [
      "source evidence root",
      (value: Mutable<WorkspaceAuthorityV1>) =>
        (value.sourceEvidenceRoot = hash("changed")),
    ],
    [
      "package evidence",
      (value: Mutable<WorkspaceAuthorityV1>) =>
        (packageAt(value.packages, 0).catalogContentHash = hash("changed")),
    ],
  ] as const)("rejects %s tampering", (_name, mutate) => {
    const authority = mutableClone(buildWorkspaceAuthorityV1(input()));
    mutate(authority);
    if (_name === "git tree" || _name === "snapshot" || _name === "toolchain") {
      // oxlint-disable-next-line vitest/no-conditional-expect
      expect(validateWorkspaceAuthorityV1(authority)).toEqual(authority);
    } else {
      // oxlint-disable-next-line vitest/no-conditional-expect
      expect(() => validateWorkspaceAuthorityV1(authority)).toThrow(
        /sourceEvidenceRoot|package evidence/u
      );
    }
  });

  it("rejects V2, mixed, stale, duplicate, and non-canonical package sets", () => {
    const base = input();
    const v2Set = packageAuthoritySet("apps/admin", 10, 2);
    expect(() =>
      buildWorkspaceAuthorityV1({
        ...base,
        packages: [
          ...base.packages.slice(0, 4),
          {
            ...packageAt(base.packages, 4),
            authoritySet: v2Set,
            authoritySetHash: authoritySetHash(v2Set),
          },
        ],
      })
    ).toThrow(/V2 is forbidden|classifierAuthority/u);

    const stale = mutableClone(base);
    packageAt(stale.packages, 0).authoritySetHash = hash("stale");
    expect(() => buildWorkspaceAuthorityV1(stale)).toThrow(
      /does not bind canonical package authority-set bytes/u
    );

    const duplicate = mutableClone(base);
    packageAt(duplicate.packages, 1).authoritySet = packageAt(
      duplicate.packages,
      0
    ).authoritySet;
    packageAt(duplicate.packages, 1).authoritySetHash = packageAt(
      duplicate.packages,
      0
    ).authoritySetHash;
    expect(() => buildWorkspaceAuthorityV1(duplicate)).toThrow(
      /unique canonically sorted package roots/u
    );

    expect(() =>
      buildWorkspaceAuthorityV1({
        ...base,
        packages: base.packages.slice(0, 4),
      })
    ).toThrow(/exactly five/u);
  });

  it.each([
    "",
    "/absolute/package",
    "../escape",
    "packages/../escape",
    "packages\\windows",
    "packages//double",
    "packages/e\u0301",
    "C:",
    "C:escape",
    "packages/\0escape",
    "packages/line\nbreak",
    "packages/tab\tbreak",
  ])("rejects non-portable package root %j", (root) => {
    const value = mutableClone(input());
    const authoritySet = packageAuthoritySet(root, 99);
    value.packages[0] = {
      ...packageAt(value.packages, 0),
      authoritySet,
      authoritySetHash: authoritySetHash(authoritySet),
    };
    expect(() => buildWorkspaceAuthorityV1(value)).toThrow(
      /relative path|NFC|string/u
    );
  });

  it("rejects extra fields, reordered entries, and non-canonical bytes", () => {
    const authority = buildWorkspaceAuthorityV1(input());
    const extra = { ...authority, extra: true };
    expect(() => validateWorkspaceAuthorityV1(extra)).toThrow(
      /unexpected or missing fields/u
    );

    const reordered = {
      ...authority,
      packages: [...authority.packages].toReversed(),
    };
    expect(() => validateWorkspaceAuthorityV1(reordered)).toThrow(
      /canonically sorted/u
    );

    const bytes = canonicalWorkspaceAuthorityV1Bytes(authority);
    expect(() =>
      parseCanonicalWorkspaceAuthorityV1(
        `${JSON.stringify(authority, null, 2)}\n`
      )
    ).toThrow(/canonical JSON/u);
    expect(() => parseCanonicalWorkspaceAuthorityV1(bytes.trimEnd())).toThrow(
      /canonical JSON/u
    );
    expect(() => parseCanonicalWorkspaceAuthorityV1(`${bytes}\n`)).toThrow(
      /valid JSON|canonical JSON/u
    );
  });

  it("rejects malformed root pointers and hash path traversal", () => {
    const manifestHash = hash("manifest");
    expect(() =>
      workspaceAuthorityManifestPath("sha256:../escape" as Sha256)
    ).toThrow(/SHA-256/u);
    expect(() =>
      parseCanonicalWorkspaceAuthorityRootPointerV1(
        `${canonicalJson({ extra: true, manifestHash, schemaVersion: 1 })}\n`
      )
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      parseCanonicalWorkspaceAuthorityRootPointerV1(
        `${JSON.stringify({ manifestHash, schemaVersion: 1 }, null, 2)}\n`
      )
    ).toThrow(/canonical JSON/u);
  });
});
