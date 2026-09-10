import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  readdir,
  symlink,
  rename,
  truncate,
  realpath,
  lstat,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type * as FileSystem from "node:fs/promises";
import { create, extract } from "tar";

import { proveConventionCatalog } from "../src/proof";
import { sha256 } from "../src/canonical";
import {
  readConventionCheckReceipt,
  conventionPackageAuthoritySetPath,
  parseCanonicalPackageAuthoritySetV1,
} from "../src/check-receipt";
import { parseCanonicalCatalogGenerationReceipt } from "../src/generation-snapshot";
import {
  buildWorkspaceAuthorityV1,
  canonicalWorkspaceAuthorityV1Bytes,
  workspaceAuthorityManifestPath,
  canonicalWorkspaceAuthorityRootPointerV1Bytes,
  buildWorkspaceAuthorityRootPointerV1,
} from "../src/workspace-authority";
import {
  exportAuthorityBundle,
  importAuthorityBundle,
  reuseAuthorityBundle,
  verifyConventionBuildReceipt,
} from "../src/verify";

const temporaryRoots: Array<string> = [];

const faults = vi.hoisted(() => ({
  source: "",
  archive: "",
  root: "",
  denySource: false,
  sourceProbesBeforeFailure: 0,
  denyArchive: false,
  mutateAfterInstall: false,
  failRollback: false,
  failCleanup: false,
}));

const transactionFault = vi.hoisted(() => ({
  active: false,
  path: "",
  boundary: "",
  pending: false,
  fired: false,
  rollbackPath: "",
  rollbackOperation: "",
  rollbackFired: false,
  events: [] as Array<{ operation: string; path: string }>,
}));

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof FileSystem>();
  const ioError = () =>
    Object.assign(new Error("Injected filesystem failure"), { code: "EACCES" });
  // A completed rename must resolve normally so the real transaction records
  // it. Fail the next actual I/O, not a fictional rejected-but-completed rename.
  const failPending = () => {
    if (transactionFault.active && transactionFault.pending) {
      transactionFault.pending = false;
      transactionFault.fired = true;
      throw ioError();
    }
  };
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      failPending();
      return actual.mkdir(...args);
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      failPending();
      return actual.readdir(...args);
    },
    stat: async (...args: Parameters<typeof actual.stat>) => {
      failPending();
      return actual.stat(...args);
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      failPending();
      if (faults.denySource && String(args[0]) === faults.source) {
        if (faults.sourceProbesBeforeFailure > 0) {
          faults.sourceProbesBeforeFailure--;
          return actual.lstat(...args);
        }
        throw ioError();
      }
      return actual.lstat(...args);
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      failPending();
      if (
        faults.denySource &&
        faults.sourceProbesBeforeFailure === 0 &&
        String(args[0]) === faults.source
      ) {
        throw ioError();
      }
      return actual.readFile(...args);
    },
    open: async (...args: Parameters<typeof actual.open>) => {
      failPending();
      if (faults.denyArchive && String(args[0]).endsWith("/bundle.tar")) {
        throw ioError();
      }
      return actual.open(...args);
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      failPending();
      const from = String(args[0]);
      const to = String(args[1]);
      let operation: string | undefined;
      if (to.includes("/backup/")) {
        operation = "backup";
      } else if (from.includes("/stage/")) {
        operation = "install";
      } else if (from.includes("/backup/")) {
        operation = "restore";
      }
      const target = operation === "backup" ? from : to;
      const path = target.slice(faults.root.length + 1);
      const observed =
        transactionFault.active && target.startsWith(`${faults.root}/`);
      if (
        observed &&
        !transactionFault.fired &&
        operation === "backup" &&
        transactionFault.boundary === "before-backup" &&
        transactionFault.path === path
      ) {
        transactionFault.fired = true;
        throw ioError();
      }
      if (
        observed &&
        operation === "restore" &&
        transactionFault.rollbackOperation === "restore" &&
        transactionFault.rollbackPath === path
      ) {
        transactionFault.rollbackFired = true;
        throw ioError();
      }
      if (faults.failRollback && String(args[0]).includes("/backup/")) {
        throw ioError();
      }
      await actual.rename(...args);
      if (observed && operation) {
        transactionFault.events.push({ operation, path });
        if (
          !transactionFault.fired &&
          transactionFault.path === path &&
          transactionFault.boundary === `after-${operation}`
        ) {
          transactionFault.pending = true;
        }
      }
      if (
        faults.mutateAfterInstall &&
        String(args[0]).includes("/stage/") &&
        String(args[1]) === `${faults.root}/apps/app/.mirai-intl`
      ) {
        faults.mutateAfterInstall = false;
        await actual.writeFile(
          faults.source,
          "export const changedDuringInstall = true;\n"
        );
      }
    },
    rm: async (...args: Parameters<typeof actual.rm>) => {
      failPending();
      const target = String(args[0]);
      const path = target.slice(faults.root.length + 1);
      const observed =
        transactionFault.active &&
        transactionFault.fired &&
        target.startsWith(`${faults.root}/`) &&
        !path.startsWith(".mirai-intl-transfer-") &&
        !path.endsWith("authority-transfer.lock");
      if (
        observed &&
        transactionFault.rollbackOperation === "remove" &&
        transactionFault.rollbackPath === path
      ) {
        transactionFault.rollbackFired = true;
        throw ioError();
      }
      if (
        faults.failCleanup &&
        String(args[0]).startsWith(`${faults.root}/.mirai-intl-transfer-`)
      ) {
        throw ioError();
      }
      await actual.rm(...args);
      if (observed) {
        transactionFault.events.push({ operation: "remove", path });
      }
    },
  };
});

afterEach(async () => {
  transactionFault.active = false;
  transactionFault.pending = false;
  faults.denySource = false;
  faults.sourceProbesBeforeFailure = 0;
  faults.denyArchive = false;
  faults.mutateAfterInstall = false;
  faults.failRollback = false;
  faults.failCleanup = false;
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function workspaceFixture(catalogPath = "apps/app") {
  const directory = await mkdtemp(join(tmpdir(), "intl-transfer-test-"));
  temporaryRoots.push(directory);
  const root = join(directory, "producer");
  const app = join(root, catalogPath);
  await mkdir(join(app, "src/locales"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'\nimporters:\n\n  ${catalogPath}:\n    dependencies: {}\n`
  );
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({
      name: "@fixture/app",
      version: "1.0.0",
      dependencies: { vite: "8.1.4" },
    })
  );
  await writeFile(
    join(app, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { strict: true },
      include: ["src/**/*.ts"],
    })
  );
  await writeFile(join(app, "src/page.ts"), "export const answer = 42;\n");
  await writeFile(
    join(app, "src/locales/en.json"),
    JSON.stringify({ greeting: "Hello" })
  );
  await writeFile(
    join(app, "src/locales/th.json"),
    JSON.stringify({ greeting: "สวัสดี" })
  );
  const consumer = join(directory, "consumer");
  await cp(root, consumer, { recursive: true });
  await proveConventionCatalog(app);
  return { app, root, consumer, archive: join(directory, "authority.tar") };
}

it("transfers complete selected V3 authority into a clean relocated checkout", async () => {
  const { app, root, consumer, archive } = await workspaceFixture();
  const before = await verifyConventionBuildReceipt(app);
  const exported = await exportAuthorityBundle({ root, archive });
  expect(exported.catalogs).toEqual(["apps/app"]);
  const imported = await importAuthorityBundle({ root: consumer, archive });
  expect(imported.catalogs).toEqual(["apps/app"]);
  const after = await verifyConventionBuildReceipt(join(consumer, "apps/app"));
  expect(after.receipt).toEqual(before.receipt);
  expect(after.buildSemanticAnalysisRuns).toBe(0);
  expect(await readFile(join(consumer, "apps/app/src/page.ts"), "utf8")).toBe(
    "export const answer = 42;\n"
  );
}, 60_000);

it("reuses valid unchanged authority without generating or authorizing again", async () => {
  const { root, consumer, archive } = await workspaceFixture();
  await exportAuthorityBundle({ root, archive });
  const result = await reuseAuthorityBundle({ root: consumer, archive });
  expect(result).toMatchObject({
    status: "reused",
    bundle: { catalogs: ["apps/app"] },
  });
  const verified = await verifyConventionBuildReceipt(
    join(consumer, "apps/app")
  );
  expect(verified).toMatchObject({
    buildSemanticAnalysisRuns: 0,
    catalogCompilations: 0,
    artifactEmissions: 0,
  });
});

it.each(["missing", "malformed", "stale"])(
  "returns a safely cleaned reuse miss for a %s candidate",
  async (kind) => {
    const { root, consumer, archive } = await workspaceFixture();
    if (kind === "malformed") {
      await writeFile(archive, "truncated authority");
    } else if (kind === "stale") {
      await exportAuthorityBundle({ root, archive });
      await writeFile(
        join(consumer, "apps/app/src/page.ts"),
        "export const changed = 1;\n"
      );
    }
    expect(
      await reuseAuthorityBundle({ root: consumer, archive })
    ).toMatchObject({
      status: "miss",
      reason: kind === "missing" ? "missing" : "candidate-rejected",
      recoverySafe: true,
    });
    expect(
      (await readdir(consumer)).filter(
        (name) =>
          name.startsWith(".mirai-intl-transfer-") ||
          name.endsWith("authority-transfer.lock")
      )
    ).toEqual([]);
    await expect(
      readFile(
        join(consumer, "apps/app/.mirai-intl/check-receipt.current.json")
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    // A new independent authorization, rather than salvaged cached state, can
    // now grant authority to these valid current inputs.
    await proveConventionCatalog(join(consumer, "apps/app"));
    await expect(
      verifyConventionBuildReceipt(join(consumer, "apps/app"))
    ).resolves.toMatchObject({ verifiedCatalogs: 1 });
  }
);

it("a rejected cache cannot turn invalid current translations into authority", async () => {
  const { consumer, archive } = await workspaceFixture();
  await writeFile(archive, "bad archive");
  await writeFile(
    join(consumer, "apps/app/src/locales/th.json"),
    '{"greeting":""}'
  );
  expect(await reuseAuthorityBundle({ root: consumer, archive })).toMatchObject(
    { status: "miss" }
  );
  await expect(
    proveConventionCatalog(join(consumer, "apps/app"))
  ).rejects.toThrow(/./u);
});

it.each(["transfer lock", "publication recovery"])(
  "does not permit clean-audit fallback over existing %s state, even with a missing candidate",
  async (kind) => {
    const { consumer, archive } = await workspaceFixture();
    const path =
      kind === "transfer lock"
        ? join(consumer, ".mirai-intl-authority-transfer.lock")
        : join(consumer, "apps/app/src/i18n/generated/.catalog-publication");
    await mkdir(join(consumer, "apps/app/src/i18n/generated"), {
      recursive: true,
    });
    await writeFile(path, "preserve recovery evidence");
    await expect(
      reuseAuthorityBundle({ root: consumer, archive })
    ).rejects.toThrow(/./u);
    expect(await readFile(path, "utf8")).toBe("preserve recovery evidence");
  }
);

it.each(["archive", "source", "config", "cleanup"])(
  "does not classify %s filesystem failure as a recoverable cache miss",
  async (kind) => {
    const { root, consumer, archive } = await workspaceFixture();
    if (kind === "config") {
      for (const workspace of [root, consumer]) {
        await writeFile(
          join(workspace, "apps/app/mirai-intl.config.json"),
          JSON.stringify({
            checkProjects: [{ path: "tsconfig.json", role: "owner" }],
          })
        );
        await writeFile(
          join(workspace, "apps/app/tsconfig.json"),
          JSON.stringify({
            extends: "./tsconfig.base.json",
            include: ["src/**/*.ts"],
          })
        );
        await writeFile(
          join(workspace, "apps/app/tsconfig.base.json"),
          JSON.stringify({ compilerOptions: { strict: true } })
        );
      }
      await proveConventionCatalog(join(root, "apps/app"));
    }
    await exportAuthorityBundle({ root, archive });
    faults.root = await realpath(consumer);
    faults.source = join(
      faults.root,
      kind === "config" ? "apps/app/tsconfig.base.json" : "apps/app/src/page.ts"
    );
    faults.denySource = kind === "source" || kind === "config";
    // Resolve the distinct base config successfully, then fail its next lstat
    // in transitive manifest traversal, before any readFile can mask the bug.
    faults.sourceProbesBeforeFailure = kind === "config" ? 1 : 0;
    faults.denyArchive = kind === "archive";
    faults.failCleanup = kind === "cleanup";
    if (kind === "cleanup") {
      await writeFile(archive, "broken candidate");
    }
    await expect(
      reuseAuthorityBundle({ root: consumer, archive })
    ).rejects.toMatchObject({ code: "EACCES" });
  }
);

it.each([false, true])(
  "permits recovery only after successful rollback (failed rollback=%s)",
  async (failRollback) => {
    const { root, consumer, archive } = await workspaceFixture();
    await exportAuthorityBundle({ root, archive });
    await importAuthorityBundle({ root: consumer, archive });
    const pointer = join(consumer, "apps/app/src/i18n/generated/current.json");
    const selector = join(
      consumer,
      "apps/app/.mirai-intl/check-receipt.current.json"
    );
    const before = [await readFile(pointer), await readFile(selector)];
    faults.root = await realpath(consumer);
    faults.source = join(faults.root, "apps/app/src/page.ts");
    faults.mutateAfterInstall = true;
    faults.failRollback = failRollback;
    if (failRollback) {
      await expect(
        reuseAuthorityBundle({ root: consumer, archive })
      ).rejects.toThrow(/rollback failed/u);
      expect(
        await readFile(join(consumer, ".mirai-intl-authority-transfer.lock"))
      ).toBeDefined();
      expect(
        (await readdir(consumer)).filter((name) =>
          name.startsWith(".mirai-intl-transfer-")
        )
      ).toHaveLength(1);
    } else {
      await expect(
        reuseAuthorityBundle({ root: consumer, archive })
      ).resolves.toMatchObject({
        status: "miss",
        stage: "checkout",
        recoverySafe: true,
      });
      expect([await readFile(pointer), await readFile(selector)]).toEqual(
        before
      );
    }
  }
);

describe("transfer transaction boundary fault injection", () => {
  // Workspace authority requires exactly five packages. These independent
  // catalogs expose first, middle and final installs in both directory groups.
  const catalogs = ["apps/app", "apps/b", "apps/c", "apps/d", "apps/e"];
  const installPaths = [
    ...catalogs.map((catalog) => `${catalog}/src/i18n/generated`),
    ...catalogs.map((catalog) => `${catalog}/.mirai-intl`),
    ".mirai-intl/workspace-authority",
  ];
  let fixture: Awaited<ReturnType<typeof workspaceFixture>>;

  // Compare every file byte, directory and permission, rather than just the
  // selected pointers. Prior-only authority files and distinct generated modes
  // make a partial restore visible without invalidating the generated inventory.
  async function snapshotTree(root: string): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    async function visit(path: string): Promise<void> {
      const absolute = join(root, path);
      const entry = await lstat(absolute);
      if (entry.isDirectory()) {
        snapshot[path] = `directory:${entry.mode}`;
        for (const name of (await readdir(absolute)).toSorted()) {
          await visit(path ? `${path}/${name}` : name);
        }
      } else {
        expect(entry.isFile()).toBe(true);
        snapshot[path] =
          `file:${entry.mode}:${sha256(await readFile(absolute))}`;
      }
    }
    await visit("");
    return snapshot;
  }

  beforeAll(async () => {
    fixture = await workspaceFixture();
    // This shared immutable seed lives until this describe finishes; each case
    // gets its own copied receiving checkout and real import transaction.
    temporaryRoots.splice(
      temporaryRoots.indexOf(resolve(fixture.root, "..")),
      1
    );
    for (const catalog of catalogs.slice(1)) {
      await cp(
        join(fixture.consumer, "apps/app"),
        join(fixture.root, catalog),
        {
          recursive: true,
        }
      );
      await proveConventionCatalog(join(fixture.root, catalog));
    }
    const packages = await Promise.all(
      catalogs.map(async (catalog) => {
        const app = join(fixture.root, catalog);
        const selected = await readConventionCheckReceipt(app);
        if (
          !selected.authoritySetHash ||
          selected.receipt.schemaVersion !== 3
        ) {
          throw new Error("fixture requires V3 authority");
        }
        const authoritySet = parseCanonicalPackageAuthoritySetV1(
          await readFile(
            conventionPackageAuthoritySetPath(app, selected.authoritySetHash),
            "utf8"
          )
        );
        const generated = parseCanonicalCatalogGenerationReceipt(
          await readFile(
            join(app, "src/i18n/generated/catalog-generation-receipt.v1.json"),
            "utf8"
          )
        );
        return {
          authoritySet,
          authoritySetHash: selected.authoritySetHash,
          catalogContentHash: generated.payload.contentHash,
          generationReceiptHash: selected.receipt.generationReceiptHash,
          sourceAuthorizationHash: selected.receipt.sourceAuthorizationHash,
        };
      })
    );
    const bytes = canonicalWorkspaceAuthorityV1Bytes(
      buildWorkspaceAuthorityV1({
        packages,
        gitTreeHash: sha256("boundary fixture tree"),
        snapshotHash: sha256("boundary fixture snapshot"),
        toolchainHash: sha256("boundary fixture toolchain"),
        workspaceLock: {
          path: "pnpm-lock.yaml",
          hash: sha256(await readFile(join(fixture.root, "pnpm-lock.yaml"))),
        },
      })
    );
    const hash = sha256(bytes);
    const manifest = join(fixture.root, workspaceAuthorityManifestPath(hash));
    await mkdir(join(manifest, ".."), { recursive: true });
    await writeFile(manifest, bytes);
    await writeFile(
      join(fixture.root, ".mirai-intl/workspace-authority/current.json"),
      canonicalWorkspaceAuthorityRootPointerV1Bytes(
        buildWorkspaceAuthorityRootPointerV1(hash)
      )
    );
    assert.deepEqual((await exportAuthorityBundle(fixture)).catalogs, catalogs);
    // Copy authored inputs, then establish the prior state through the public
    // importer, including the workspace selector. Never mock publication itself.
    for (const catalog of catalogs.slice(1)) {
      await cp(
        join(fixture.consumer, "apps/app"),
        join(fixture.consumer, catalog),
        { recursive: true }
      );
    }
    await importAuthorityBundle({
      root: fixture.consumer,
      archive: fixture.archive,
    });
    for (const [index, path] of installPaths.entries()) {
      if (path.endsWith("/generated")) {
        // The generated inventory is closed, including unselected builds.
        // Readable prior permissions differ from the staged archive's defaults.
        await chmod(join(fixture.consumer, path), 0o700);
        await chmod(join(fixture.consumer, path, "index.ts"), 0o600);
      } else {
        await writeFile(
          join(fixture.consumer, path, `prior-only-${index}.txt`),
          `prior state ${path}\n`
        );
      }
    }
    for (const catalog of catalogs) {
      assert.equal(
        (await verifyConventionBuildReceipt(join(fixture.consumer, catalog)))
          .verifiedCatalogs,
        1
      );
    }
  }, 60_000);

  afterAll(async () => {
    transactionFault.active = false;
    if (fixture) {
      await rm(resolve(fixture.root, ".."), { recursive: true, force: true });
    }
  });

  const boundaries = installPaths.flatMap((path, index) =>
    ["before-backup", "after-backup", "after-install"].map((boundary) => ({
      path,
      index,
      boundary,
    }))
  );
  const rollbackBoundaries = installPaths.flatMap((rollbackPath) =>
    ["remove", "restore"].map((rollbackOperation) => ({
      rollbackPath,
      rollbackOperation,
    }))
  );

  async function receivingCheckout() {
    const directory = await mkdtemp(join(tmpdir(), "intl-transfer-boundary-"));
    temporaryRoots.push(directory);
    const root = join(directory, "consumer");
    await cp(fixture.consumer, root, { recursive: true });
    faults.root = await realpath(root);
    Object.assign(transactionFault, {
      active: false,
      pending: false,
      fired: false,
      rollbackFired: false,
      rollbackOperation: "",
      rollbackPath: "",
      events: [],
    });
    return { root, before: await snapshotTree(root), archive: fixture.archive };
  }

  it.each(boundaries)(
    "restores every prior byte after $boundary at $path",
    async ({ path, index, boundary }) => {
      const { root, before, archive } = await receivingCheckout();
      Object.assign(transactionFault, { active: true, path, boundary });
      await expect(
        reuseAuthorityBundle({ root, archive })
      ).rejects.toMatchObject({ code: "EACCES" });
      transactionFault.active = false;
      expect(transactionFault.fired).toBe(true);
      expect(transactionFault.pending).toBe(false);
      expect(
        transactionFault.events
          .filter((event) => event.operation === "install")
          .map((event) => event.path)
      ).toEqual(
        installPaths.slice(0, index + (boundary === "after-install" ? 1 : 0))
      );
      expect(
        transactionFault.events
          .filter((event) => event.operation === "backup")
          .map((event) => event.path)
      ).toEqual(
        installPaths.slice(0, index + (boundary === "before-backup" ? 0 : 1))
      );
      expect(await snapshotTree(root)).toEqual(before);
      expect(
        (await readdir(root)).filter(
          (name) =>
            name.startsWith(".mirai-intl-transfer-") ||
            name.endsWith("authority-transfer.lock")
        )
      ).toEqual([]);
      for (const catalog of catalogs) {
        await expect(
          verifyConventionBuildReceipt(join(root, catalog))
        ).resolves.toMatchObject({
          verifiedCatalogs: 1,
          catalogCompilations: 0,
          artifactEmissions: 0,
          buildSemanticAnalysisRuns: 0,
        });
      }
    },
    30_000
  );

  it.each(rollbackBoundaries)(
    "preserves explicit recovery when rollback $rollbackOperation fails at $rollbackPath",
    async ({ rollbackPath, rollbackOperation }) => {
      const { root, archive } = await receivingCheckout();
      const priorTrees = await Promise.all(
        installPaths.map((path) => snapshotTree(join(root, path)))
      );
      Object.assign(transactionFault, {
        active: true,
        path: installPaths.at(-1),
        boundary: "after-install",
        rollbackPath,
        rollbackOperation,
      });
      const outcome = await reuseAuthorityBundle({ root, archive }).then(
        (result) => ({ result, error: undefined }),
        (error: unknown) => ({ result: undefined, error })
      );
      transactionFault.active = false;
      expect(outcome.result).toBeUndefined();
      expect(outcome.error).toMatchObject({
        name: "AuthorityImportRecoveryError",
      });
      expect(outcome.error).not.toHaveProperty("recoverySafe", true);
      expect(transactionFault.fired).toBe(true);
      expect(transactionFault.rollbackFired).toBe(true);
      expect(
        transactionFault.events
          .filter((event) => event.operation === "install")
          .map((event) => event.path)
      ).toEqual(installPaths);
      const retained = (await readdir(root)).filter((name) =>
        name.startsWith(".mirai-intl-transfer-")
      );
      expect(retained).toHaveLength(1);
      const retainedDirectory = retained[0];
      if (!retainedDirectory) {
        throw new Error("Missing recovery directory");
      }
      const backup = join(root, retainedDirectory, "backup");
      expect(outcome.error).toMatchObject({
        message: expect.stringContaining(backup),
      });
      const lock = join(root, ".mirai-intl-authority-transfer.lock");
      expect((await lstat(lock)).isFile()).toBe(true);
      for (const [index, path] of installPaths.entries()) {
        // Each complete old tree must still exist either in backup or already
        // restored at its target, independent of the rollback's iteration order.
        const saved = join(backup, path);
        const present = await lstat(saved).catch((error: unknown) => {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ) {
            return undefined;
          }
          throw error;
        });
        expect(await snapshotTree(present ? saved : join(root, path))).toEqual(
          priorTrees[index]
        );
      }
      const recovery = await snapshotTree(root);
      await expect(
        reuseAuthorityBundle({ root, archive })
      ).rejects.toMatchObject({ code: "EEXIST" });
      expect(await snapshotTree(root)).toEqual(recovery);
    },
    30_000
  );
});

it.each(["receipts", "classifiers"])(
  "refuses export when selected %s are missing",
  async (kind) => {
    const { app, root, archive } = await workspaceFixture();
    await rm(join(app, ".mirai-intl/authority", kind), { recursive: true });
    await expect(exportAuthorityBundle({ root, archive })).rejects.toThrow(
      /missing/u
    );
    await expect(readFile(archive)).rejects.toMatchObject({ code: "ENOENT" });
  }
);

it.each([
  ["missing locale key", "src/locales/th.json", "{}"],
  ["empty translation", "src/locales/th.json", '{"greeting":""}'],
  ["changed source", "src/page.ts", "export const answer = 43;\n"],
  [
    "new source",
    "src/new.ts",
    'export const extra = "not previously authorized";\n',
  ],
  [
    "changed manifest",
    "package.json",
    '{"name":"@fixture/app","version":"1.0.1","dependencies":{"vite":"8.1.4"}}',
  ],
])(
  "rejects %s without publishing imported authority",
  async (_name, file, source) => {
    const { root, consumer, archive } = await workspaceFixture();
    await exportAuthorityBundle({ root, archive });
    await writeFile(join(consumer, "apps/app", file), source);
    await expect(
      importAuthorityBundle({ root: consumer, archive })
    ).rejects.toThrow(/./u);
    await expect(
      readFile(
        join(consumer, "apps/app/.mirai-intl/check-receipt.current.json")
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(consumer, "apps/app", file), "utf8")).toBe(
      source
    );
    await expect(
      readFile(join(consumer, "apps/app/src/i18n/generated/current.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
);

it("rejects an omitted catalog rather than trusting the bundle inventory", async () => {
  const { root, consumer, archive } = await workspaceFixture();
  await exportAuthorityBundle({ root, archive });
  await cp(join(consumer, "apps/app"), join(consumer, "apps/new-app"), {
    recursive: true,
  });
  await expect(
    importAuthorityBundle({ root: consumer, archive })
  ).rejects.toThrow(/catalog inventory/u);
});

it("includes root locales alongside src/locales and rejects newly omitted root-locales catalogs", async () => {
  const { root, consumer, archive } = await workspaceFixture();
  for (const workspace of [root, consumer]) {
    const legacy = join(workspace, "apps/root-locales");
    await cp(join(consumer, "apps/app"), legacy, { recursive: true });
    await rename(join(legacy, "src/locales"), join(legacy, "locales"));
  }
  await proveConventionCatalog(join(root, "apps/root-locales"));
  expect(await exportAuthorityBundle({ root, archive })).toMatchObject({
    catalogs: ["apps/app", "apps/root-locales"],
  });
  await expect(
    importAuthorityBundle({ root: consumer, archive })
  ).resolves.toMatchObject({ catalogs: ["apps/app", "apps/root-locales"] });
  await cp(
    join(consumer, "apps/root-locales"),
    join(consumer, "apps/omitted"),
    { recursive: true }
  );
  await expect(
    importAuthorityBundle({ root: consumer, archive })
  ).rejects.toThrow(/catalog inventory/u);
});

it("preserves previously imported state when new input validation fails", async () => {
  const { root, consumer, archive } = await workspaceFixture();
  await exportAuthorityBundle({ root, archive });
  await importAuthorityBundle({ root: consumer, archive });
  const selector = join(
    consumer,
    "apps/app/.mirai-intl/check-receipt.current.json"
  );
  const generated = join(consumer, "apps/app/src/i18n/generated/current.json");
  const previous = [await readFile(selector), await readFile(generated)];
  await writeFile(
    join(consumer, "apps/app/src/new.ts"),
    "export const added = 1;\n"
  );
  await expect(
    importAuthorityBundle({ root: consumer, archive })
  ).rejects.toThrow(/./u);
  expect([await readFile(selector), await readFile(generated)]).toEqual(
    previous
  );
});

it.each(["missing", "changed", "extra"])(
  "rejects %s archive members before import",
  async (kind) => {
    const { root, consumer, archive } = await workspaceFixture();
    await exportAuthorityBundle({ root, archive });
    const unpacked = join(root, ".archive-fixture");
    await mkdir(unpacked);
    await extract({ file: archive, cwd: unpacked });
    const file = "apps/app/.mirai-intl/check-receipt.current.json";
    if (kind === "missing") {
      await rm(join(unpacked, file));
    }
    if (kind === "changed") {
      await writeFile(join(unpacked, file), "{}\n");
    }
    if (kind === "extra") {
      await writeFile(join(unpacked, "unexpected.txt"), "unexpected\n");
    }
    const modified = `${archive}.modified`;
    const entries = await readdir(unpacked, {
      recursive: true,
      withFileTypes: true,
    });
    const files = entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        join(entry.parentPath, entry.name).slice(unpacked.length + 1)
      );
    await create({ file: modified, cwd: unpacked, noDirRecurse: true }, files);
    await expect(
      importAuthorityBundle({ root: consumer, archive: modified })
    ).rejects.toThrow(/./u);
    await expect(
      readFile(
        join(consumer, "apps/app/.mirai-intl/check-receipt.current.json")
      )
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
);

it("rejects symlink archive members before writing any checkout file", async () => {
  const { root, consumer, archive } = await workspaceFixture();
  const link = join(root, "escape");
  await symlink(consumer, link);
  await create({ cwd: root, file: archive }, ["escape"]);
  await expect(
    importAuthorityBundle({ root: consumer, archive })
  ).rejects.toThrow(/Invalid authority archive entry/u);
});

it("never overwrites an existing export destination", async () => {
  const { root, archive } = await workspaceFixture();
  await writeFile(archive, "keep me");
  await expect(exportAuthorityBundle({ root, archive })).rejects.toMatchObject({
    code: "EEXIST",
  });
  expect(await readFile(archive, "utf8")).toBe("keep me");
});

it.each([".publish.lock", ".publish.lock.recovering", ".catalog-publication"])(
  "preserves receiving publication recovery state %s",
  async (name) => {
    const { root, consumer, archive } = await workspaceFixture();
    await exportAuthorityBundle({ root, archive });
    const generated = join(consumer, "apps/app/src/i18n/generated");
    await mkdir(generated, { recursive: true });
    const evidence = join(generated, name);
    await writeFile(evidence, "recover me");
    await expect(
      importAuthorityBundle({ root: consumer, archive })
    ).rejects.toThrow(/publication recovery/u);
    expect(await readFile(evidence, "utf8")).toBe("recover me");
  }
);

it("rejects stale receiving workspace authority absent from the bundle", async () => {
  const { root, consumer, archive } = await workspaceFixture();
  await exportAuthorityBundle({ root, archive });
  const authority = join(consumer, ".mirai-intl/workspace-authority");
  await mkdir(authority, { recursive: true });
  await writeFile(join(authority, "current.json"), "old workspace authority");
  await expect(
    importAuthorityBundle({ root: consumer, archive })
  ).rejects.toThrow(/workspace authority/u);
  expect(await readFile(join(authority, "current.json"), "utf8")).toBe(
    "old workspace authority"
  );
});

it("transfers catalogs in scoped workspace directories as literal archive paths", async () => {
  const { root, consumer, archive } = await workspaceFixture("@scope/app");
  await exportAuthorityBundle({ root, archive });
  expect(
    await importAuthorityBundle({ root: consumer, archive })
  ).toMatchObject({ catalogs: ["@scope/app"] });
  await expect(
    verifyConventionBuildReceipt(join(consumer, "@scope/app"))
  ).resolves.toMatchObject({ buildReceiptVerifications: 1 });
});

it("allows bounded tar overhead above the selected-content byte limit", async () => {
  // Invalid archive framing is rejected before any catalog is needed.
  const consumer = await mkdtemp(join(tmpdir(), "intl-transfer-framing-"));
  temporaryRoots.push(consumer);
  const archive = join(consumer, "authority.tar");
  await writeFile(archive, "not a tar");
  await truncate(archive, 512 * 1024 * 1024 + 1024);
  await expect(
    importAuthorityBundle({ root: consumer, archive })
  ).rejects.toThrow(/uncompressed tar/u);
});

it.each([
  "valid",
  "generationReceiptHash",
  "sourceAuthorizationHash",
  "catalogContentHash",
] as const)(
  "validates workspace authority references: %s",
  async (kind) => {
    const { root, consumer, archive } = await workspaceFixture();
    const catalogRoots = ["apps/app", "apps/b", "apps/c", "apps/d", "apps/e"];
    for (const catalog of catalogRoots.slice(1)) {
      for (const workspace of [root, consumer]) {
        await cp(join(consumer, "apps/app"), join(workspace, catalog), {
          recursive: true,
        });
      }
      await proveConventionCatalog(join(root, catalog));
    }
    const packages = await Promise.all(
      catalogRoots.map(async (catalog) => {
        const app = join(root, catalog);
        const selected = await readConventionCheckReceipt(app);
        if (
          !selected.authoritySetHash ||
          selected.receipt.schemaVersion !== 3
        ) {
          throw new Error("fixture requires V3 authority");
        }
        const authoritySet = parseCanonicalPackageAuthoritySetV1(
          await readFile(
            conventionPackageAuthoritySetPath(app, selected.authoritySetHash),
            "utf8"
          )
        );
        const generated = parseCanonicalCatalogGenerationReceipt(
          await readFile(
            join(app, "src/i18n/generated/catalog-generation-receipt.v1.json"),
            "utf8"
          )
        );
        const entry = {
          authoritySet,
          authoritySetHash: selected.authoritySetHash,
          catalogContentHash: generated.payload.contentHash,
          generationReceiptHash: selected.receipt.generationReceiptHash,
          sourceAuthorizationHash: selected.receipt.sourceAuthorizationHash,
        };
        return kind !== "valid" && catalog === "apps/app"
          ? { ...entry, [kind]: sha256("invalid reference") }
          : entry;
      })
    );
    const authority = buildWorkspaceAuthorityV1({
      packages,
      gitTreeHash: sha256("producer tree"),
      snapshotHash: sha256("producer snapshot"),
      toolchainHash: sha256("producer toolchain"),
      workspaceLock: {
        path: "pnpm-lock.yaml",
        hash: sha256(await readFile(join(root, "pnpm-lock.yaml"))),
      },
    });
    const bytes = canonicalWorkspaceAuthorityV1Bytes(authority);
    const hash = sha256(bytes);
    const manifestPath = join(root, workspaceAuthorityManifestPath(hash));
    await mkdir(join(manifestPath, ".."), { recursive: true });
    await writeFile(manifestPath, bytes);
    await writeFile(
      join(root, ".mirai-intl/workspace-authority/current.json"),
      canonicalWorkspaceAuthorityRootPointerV1Bytes(
        buildWorkspaceAuthorityRootPointerV1(hash)
      )
    );
    const result = await (async () => {
      await exportAuthorityBundle({ root, archive });
      await importAuthorityBundle({ root: consumer, archive });
      return readFile(
        join(consumer, workspaceAuthorityManifestPath(hash)),
        "utf8"
      );
    })().catch((error: unknown) =>
      error instanceof Error ? error.message : String(error)
    );
    const expected =
      kind === "valid" ? bytes : expect.stringMatching(/Workspace authority/u);
    expect(result).toEqual(expected);
  },
  60_000
);

it("runs the documented workspace export/import CLI without private-path copying", async () => {
  const { root, consumer, archive } = await workspaceFixture();
  const cli = resolve("packages/compiler/src/cli.ts");
  const loader = import.meta.resolve("tsx");
  const run = async (cwd: string, args: Array<string>) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", loader, cli, ...args, "--format=json"],
      { cwd, maxBuffer: 1024 * 1024 }
    ).catch((error: unknown) => {
      if (error instanceof Error && "stdout" in error) {
        throw new Error(String(error.stdout), { cause: error });
      }
      throw error;
    });
    return JSON.parse(stdout) as {
      success: boolean;
      summary: {
        catalogCount?: number;
        buildReceiptVerifications?: number;
        buildSemanticAnalysisRuns?: number;
      };
    };
  };
  // The producer and consumer must use the same installed compiler identity.
  await run(root, ["check", "--workspace"]);
  expect(
    await run(root, ["authority", "export", "--workspace", "--out", archive])
  ).toMatchObject({ success: true, summary: { catalogCount: 1 } });
  expect(
    await run(consumer, [
      "authority",
      "import",
      "--workspace",
      "--from",
      archive,
    ])
  ).toMatchObject({ success: true, summary: { catalogCount: 1 } });
  expect(await run(consumer, ["verify", "--workspace"])).toMatchObject({
    success: true,
    summary: { buildReceiptVerifications: 1, buildSemanticAnalysisRuns: 0 },
  });
  expect(
    await run(consumer, [
      "authority",
      "reuse",
      "--workspace",
      "--from",
      archive,
    ])
  ).toMatchObject({
    success: true,
    summary: {
      reuseStatus: "reused",
      authorityAccepted: true,
      catalogs: [{ path: "apps/app" }],
    },
  });
}, 60_000);

it("reports a reuse miss with exit 2, never as accepted authority", async () => {
  const { consumer, archive } = await workspaceFixture();
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      import.meta.resolve("tsx"),
      resolve("packages/compiler/src/cli.ts"),
      "authority",
      "reuse",
      "--workspace",
      "--from",
      archive,
      "--format=json",
    ],
    { cwd: consumer }
  ).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && "stdout" in error) {
      return { code: error.code, stdout: String(error.stdout) };
    }
    throw error;
  });
  expect(result).toHaveProperty("code", 2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    success: false,
    summary: {
      operation: "reuse",
      reuseStatus: "miss",
      authorityAccepted: false,
      reason: "missing",
      recoverySafe: true,
    },
  });
});
