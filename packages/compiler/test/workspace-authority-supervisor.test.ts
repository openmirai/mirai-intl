import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import type { PackageAuthoritySetV1, Sha256 } from "@openmirai/intl-abi";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/canonical";
import { publishWorkspaceAuthorityV1 } from "../src/workspace-authority-supervisor";
import type {
  WorkspaceAuthoritySupervisorBoundary,
  WorkspaceAuthoritySupervisorLease,
} from "../src/workspace-authority-supervisor";
import {
  buildWorkspaceAuthorityV1,
  canonicalWorkspaceAuthorityV1Bytes,
  hashWorkspaceAuthorityV1,
  workspaceAuthorityManifestPath,
} from "../src/workspace-authority";
import type {
  WorkspaceAuthorityInputV1,
  WorkspaceAuthorityV1,
} from "../src/workspace-authority";

const roots: Array<string> = [];
const leaseToken = "workspace-writer-token-0001";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

function hash(label: string): Sha256 {
  return sha256(label);
}

function packageAuthoritySet(
  root: string,
  index: number
): PackageAuthoritySetV1 {
  return {
    classifierAuthority: {
      hash: hash(`classifier-${index}`),
      schemaVersion: 3,
    },
    package: {
      manifestHash: hash(`manifest-${index}`),
      name: `@openmirai/package-${index}`,
      root,
    },
    receipt: { hash: hash(`receipt-${index}`), schemaVersion: 3 },
    schemaVersion: 1,
  };
}

function input(): WorkspaceAuthorityInputV1 {
  return {
    gitTreeHash: hash("git-tree"),
    packages: [
      "packages/zeta",
      "apps/learner",
      "packages/alpha",
      "apps/admin",
      "apps/instructor",
    ].map((root, index) => {
      const authoritySet = packageAuthoritySet(root, index);
      return {
        authoritySet,
        authoritySetHash: sha256(`${canonicalJson(authoritySet)}\n`),
        catalogContentHash: hash(`catalog-${index}`),
        generationReceiptHash: hash(`generation-${index}`),
        sourceAuthorizationHash: hash(`source-${index}`),
      };
    }),
    snapshotHash: hash("snapshot"),
    toolchainHash: hash("toolchain"),
    workspaceLock: { hash: hash("lock"), path: "pnpm-lock.yaml" },
  };
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), "mirai-intl-workspace-supervisor-")
  );
  roots.push(root);
  return root;
}

function hardLinkLease(root: string): WorkspaceAuthoritySupervisorLease {
  const withLease = async <Value>(
    operation: (token: string) => Promise<Value>
  ): Promise<Value> => {
    const directory = join(root, ".lease");
    await mkdir(directory, { recursive: true });
    const candidate = join(directory, `candidate-${Math.random()}`);
    const lock = join(directory, "writer.lock");
    const handle = await open(candidate, "wx", 0o600);
    let completed = false;
    let operationError: unknown;
    let owned = false;
    let ownershipChanged = false;
    let result: Value | undefined;
    try {
      await handle.writeFile(`${leaseToken}\n`, "utf8");
      await handle.datasync();
      const candidateIdentity = await handle.stat();
      try {
        await link(candidate, lock);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          throw new Error("Workspace authority writer lease is busy", {
            cause: error,
          });
        }
        throw error;
      }
      const lockIdentity = await lstat(lock);
      if (
        lockIdentity.dev !== candidateIdentity.dev ||
        lockIdentity.ino !== candidateIdentity.ino
      ) {
        throw new Error("Workspace authority writer lease identity changed");
      }
      owned = true;
      result = await operation(leaseToken);
      completed = true;
    } catch (error) {
      operationError = error;
    } finally {
      await handle.close();
      if (owned) {
        const current = await lstat(lock);
        const candidateIdentity = await lstat(candidate);
        ownershipChanged =
          current.dev !== candidateIdentity.dev ||
          current.ino !== candidateIdentity.ino;
        await rm(lock);
      }
      await rm(candidate, { force: true });
    }
    if (ownershipChanged) {
      throw new Error("Workspace authority writer lease ownership changed");
    }
    if (operationError !== undefined) {
      throw operationError;
    }
    if (!completed) {
      throw new Error("Workspace authority writer lease did not complete");
    }
    return result as Value;
  };
  return {
    withLease,
  };
}

function descriptor(authority: WorkspaceAuthorityV1) {
  return { authority, leaseToken } as const;
}

async function pointerBytes(root: string): Promise<string | undefined> {
  return readFile(
    join(root, ".mirai-intl/workspace-authority/current.json"),
    "utf8"
  ).catch(() => undefined);
}

describe("workspace authority supervisor", () => {
  it.each([
    "manifest-installed",
    "pointer-staged",
    "before-live-revalidate",
  ] as const)(
    "activates nothing after a %s boundary crash",
    async (boundary) => {
      const root = await fixtureRoot();
      const authority = buildWorkspaceAuthorityV1(input());
      await expect(
        publishWorkspaceAuthorityV1(
          root,
          descriptor(authority),
          hardLinkLease(root),
          {
            commitReadyCutoff: performance.now() + 18_000,
            boundary(value) {
              if (value === boundary) {
                throw new Error(`crash:${boundary}`);
              }
            },
            liveRevalidate: async () => undefined,
          }
        )
      ).rejects.toThrow(`crash:${boundary}`);
      expect(await pointerBytes(root)).toBeUndefined();
    }
  );

  it("expires after live revalidation without activating the staged pointer", async () => {
    const root = await fixtureRoot();
    const authority = buildWorkspaceAuthorityV1(input());
    await expect(
      publishWorkspaceAuthorityV1(
        root,
        descriptor(authority),
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now() + 1,
          liveRevalidate: async () =>
            new Promise((resolve) => setTimeout(resolve, 10)),
        }
      )
    ).rejects.toThrow("deadline expired");
    expect(await pointerBytes(root)).toBeUndefined();
  });

  it("rejects an exact monotonic cutoff before any activation", async () => {
    const root = await fixtureRoot();
    await expect(
      publishWorkspaceAuthorityV1(
        root,
        descriptor(buildWorkspaceAuthorityV1(input())),
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now(),
          liveRevalidate: async () => undefined,
        }
      )
    ).rejects.toThrow("deadline expired");
    expect(await pointerBytes(root)).toBeUndefined();
  });

  it("activates nothing when live revalidation detects mutation", async () => {
    const root = await fixtureRoot();
    await expect(
      publishWorkspaceAuthorityV1(
        root,
        descriptor(buildWorkspaceAuthorityV1(input())),
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now() + 18_000,
          liveRevalidate: async () => {
            throw new Error("live descriptor mutated");
          },
        }
      )
    ).rejects.toThrow("live descriptor mutated");
    expect(await pointerBytes(root)).toBeUndefined();
  });

  it("rejects concurrent writers and a counterfeit sealed descriptor", async () => {
    const root = await fixtureRoot();
    const authority = buildWorkspaceAuthorityV1(input());
    let release: (() => void) | undefined;
    let signalReady: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => {
      signalReady = resolve;
    });
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = publishWorkspaceAuthorityV1(
      root,
      descriptor(authority),
      hardLinkLease(root),
      {
        boundary(boundary) {
          if (boundary === "before-live-revalidate") {
            signalReady?.();
          }
        },
        commitReadyCutoff: performance.now() + 18_000,
        liveRevalidate: async () => blocker,
      }
    );
    await ready;
    await expect(
      publishWorkspaceAuthorityV1(
        root,
        descriptor(authority),
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now() + 18_000,
          liveRevalidate: async () => undefined,
        }
      )
    ).rejects.toThrow("lease is busy");
    release?.();
    await expect(first).resolves.toMatchObject({ committed: true });

    await expect(
      publishWorkspaceAuthorityV1(
        root,
        { authority, leaseToken: "counterfeit-token-0000" },
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now() + 18_000,
          liveRevalidate: async () => undefined,
        }
      )
    ).rejects.toThrow("counterfeit");
  });

  it("rejects a corrupt existing immutable object", async () => {
    const root = await fixtureRoot();
    const authority = buildWorkspaceAuthorityV1(input());
    const manifestPath = join(
      root,
      workspaceAuthorityManifestPath(hashWorkspaceAuthorityV1(authority))
    );
    await mkdir(join(manifestPath, ".."), { recursive: true });
    await writeFile(manifestPath, "corrupt\n", "utf8");
    await expect(
      publishWorkspaceAuthorityV1(
        root,
        descriptor(authority),
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now() + 18_000,
          liveRevalidate: async () => undefined,
        }
      )
    ).rejects.toThrow("immutable manifest is corrupt");
    expect(await pointerBytes(root)).toBeUndefined();
  });

  it("uses byte-identical immutable and pointer no-ops", async () => {
    const root = await fixtureRoot();
    const authority = buildWorkspaceAuthorityV1(input());
    const first = await publishWorkspaceAuthorityV1(
      root,
      descriptor(authority),
      hardLinkLease(root),
      {
        commitReadyCutoff: performance.now() + 18_000,
        liveRevalidate: async () => undefined,
      }
    );
    const before = await stat(first.pointerPath);
    const second = await publishWorkspaceAuthorityV1(
      root,
      descriptor(authority),
      hardLinkLease(root),
      {
        commitReadyCutoff: performance.now() + 18_000,
        liveRevalidate: async () => undefined,
      }
    );
    const after = await stat(first.pointerPath);
    expect(second).toMatchObject({
      committed: false,
      noOp: true,
      pointerRenames: 0,
    });
    expect(after.ino).toBe(before.ino);
    expect(await readFile(first.manifestPath, "utf8")).toBe(
      canonicalWorkspaceAuthorityV1Bytes(authority)
    );
  });

  it("recovers committed success from postcommit observer and lease cleanup failure", async () => {
    const root = await fixtureRoot();
    const authority = buildWorkspaceAuthorityV1(input());
    const failingRelease: WorkspaceAuthoritySupervisorLease = {
      async withLease(operation) {
        await operation(leaseToken);
        throw new Error("release failed");
      },
    };
    const result = await publishWorkspaceAuthorityV1(
      root,
      descriptor(authority),
      failingRelease,
      {
        commitReadyCutoff: performance.now() + 18_000,
        boundary(boundary) {
          if (boundary === "pointer-committed") {
            throw new Error("observer failed");
          }
        },
        liveRevalidate: async () => undefined,
      }
    );
    expect(result).toMatchObject({
      committed: true,
      pointerRenames: 1,
      recoveredPostCommitFailure: true,
      warnings: ["post-commit-failure-recovered"],
    });
    expect(await pointerBytes(root)).toBeDefined();
  });

  it.each(["open", "fsync", "close"])(
    "recovers the committed current pointer from post-rename %s failure",
    async (failure) => {
      const root = await fixtureRoot();
      let renames = 0;
      const result = await publishWorkspaceAuthorityV1(
        root,
        descriptor(buildWorkspaceAuthorityV1(input())),
        hardLinkLease(root),
        {
          commitIo: {
            rename(stagedPath, pointerPath) {
              renames += 1;
              renameSync(stagedPath, pointerPath);
            },
            syncDirectory() {
              throw new Error(`${failure} failed after rename`);
            },
          },
          commitReadyCutoff: performance.now() + 18_000,
          liveRevalidate: async () => undefined,
        }
      );
      expect(renames).toBe(1);
      expect(result).toMatchObject({
        committed: true,
        pointerRenames: 1,
        recoveredPostCommitFailure: true,
        warnings: ["post-commit-failure-recovered"],
      });
      expect(await pointerBytes(root)).toBeDefined();
    }
  );

  it("publishes byte-identical authority roots independently with one rename each", async () => {
    const left = await fixtureRoot();
    const right = await fixtureRoot();
    const authority = buildWorkspaceAuthorityV1(input());
    const boundaries: Array<WorkspaceAuthoritySupervisorBoundary> = [];
    const publish = (root: string) =>
      publishWorkspaceAuthorityV1(
        root,
        descriptor(authority),
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now() + 18_000,
          boundary(value) {
            boundaries.push(value);
          },
          liveRevalidate: async () => undefined,
        }
      );
    const [leftResult, rightResult] = await Promise.all([
      publish(left),
      publish(right),
    ]);
    expect(leftResult.pointerRenames).toBe(1);
    expect(rightResult.pointerRenames).toBe(1);
    expect(await readFile(leftResult.manifestPath, "utf8")).toBe(
      await readFile(rightResult.manifestPath, "utf8")
    );
    expect(await pointerBytes(left)).toBe(await pointerBytes(right));
    expect(
      boundaries.filter((boundary) => boundary === "pointer-committed")
    ).toHaveLength(2);
    expect(
      (await readdir(join(left, ".mirai-intl/workspace-authority"))).filter(
        (name) => name.endsWith(".tmp")
      )
    ).toEqual([]);
  });

  it("rejects symlinked authority directories", async () => {
    const root = await fixtureRoot();
    const outside = await fixtureRoot();
    await mkdir(join(root, ".mirai-intl"));
    await symlink(outside, join(root, ".mirai-intl/workspace-authority"));
    await expect(
      publishWorkspaceAuthorityV1(
        root,
        descriptor(buildWorkspaceAuthorityV1(input())),
        hardLinkLease(root),
        {
          commitReadyCutoff: performance.now() + 18_000,
          liveRevalidate: async () => undefined,
        }
      )
    ).rejects.toThrow("non-symlink directory");
    expect(await readdir(outside)).toEqual([]);
  });
});
