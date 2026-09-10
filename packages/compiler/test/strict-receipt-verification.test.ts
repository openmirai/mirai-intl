import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type * as Catalog from "../src/catalog";
import type * as Compile from "../src/compile";
import type * as Emit from "../src/emit";
import type * as FileSystem from "node:fs/promises";

const work = vi.hoisted(() => ({ compile: 0, emit: 0 }));
const mutation = vi.hoisted(() => ({
  freshLoads: 0,
  skipGenerationReads: 0,
  afterGenerationRead: undefined as (() => Promise<void>) | undefined,
  afterRead: undefined as ((path: string) => Promise<void>) | undefined,
}));
vi.mock("../src/catalog", async (original) => {
  const actual = await original<typeof Catalog>();
  return {
    ...actual,
    loadFreshConventionCatalogGenerationInput: async (
      ...args: Parameters<
        typeof actual.loadFreshConventionCatalogGenerationInput
      >
    ) => {
      mutation.freshLoads++;
      return actual.loadFreshConventionCatalogGenerationInput(...args);
    },
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof FileSystem>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const bytes = await actual.readFile(...args);
      await mutation.afterRead?.(String(args[0]));
      if (
        String(args[0]).endsWith("/catalog-generation-receipt.v1.json") &&
        mutation.afterGenerationRead
      ) {
        if (mutation.skipGenerationReads > 0) {
          mutation.skipGenerationReads--;
          return bytes;
        }
        const change = mutation.afterGenerationRead;
        mutation.afterGenerationRead = undefined;
        await change();
      }
      return bytes;
    },
  };
});
vi.mock("../src/compile", async (original) => {
  const actual = await original<typeof Compile>();
  return {
    ...actual,
    compileCatalog: (...args: Parameters<typeof actual.compileCatalog>) => {
      work.compile++;
      return actual.compileCatalog(...args);
    },
  };
});
vi.mock("../src/emit", async (original) => {
  const actual = await original<typeof Emit>();
  return {
    ...actual,
    emitArtifacts: (...args: Parameters<typeof actual.emitArtifacts>) => {
      work.emit++;
      return actual.emitArtifacts(...args);
    },
  };
});

import { proveConventionCatalog } from "../src/proof";
import {
  verifyConventionBuildReceipt,
  verifyWorkspaceBuildReceipts,
} from "../src/verify";

const roots: Array<string> = [];
afterEach(async () => {
  mutation.freshLoads = 0;
  mutation.afterGenerationRead = undefined;
  mutation.skipGenerationReads = 0;
  mutation.afterRead = undefined;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it("rejects source edits interleaved after the initial source-hash pass", async () => {
  const root = await fixture();
  mutation.afterGenerationRead = () =>
    writeFile(join(root, "src/page.ts"), "export const answer = 43;\n");
  await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
    /stale|changed/u
  );
});

it("rejects a payload changed after its initial committed-snapshot validation", async () => {
  const root = await fixture();
  const generated = join(root, "src/i18n/generated");
  const receipt = JSON.parse(
    await readFile(
      join(generated, "catalog-generation-receipt.v1.json"),
      "utf8"
    )
  ) as {
    payload: {
      directory: string;
      manifest: { entries: Array<{ path: string }> };
    };
  };
  const first = receipt.payload.manifest.entries[0];
  if (!first) {
    throw new Error("fixture requires a generated payload");
  }
  mutation.skipGenerationReads = 2;
  mutation.afterGenerationRead = () =>
    writeFile(
      join(generated, receipt.payload.directory, first.path),
      "corrupt after validation"
    );
  await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
    /corrupt|manifest|payload|artifact/iu
  );
});

it("rejects a new catalog added during workspace verification", async () => {
  const { cp } = await import("node:fs/promises");
  const source = await fixture();
  const workspace = await mkdtemp(join(tmpdir(), "intl-verify-inventory-"));
  roots.push(workspace);
  await writeFile(
    join(workspace, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n"
  );
  const app = join(workspace, "apps/a");
  await cp(source, app, { recursive: true });
  await rm(join(app, ".mirai-intl"), { recursive: true });
  await rm(join(app, "src/i18n/generated"), { recursive: true });
  await proveConventionCatalog(app);
  mutation.afterGenerationRead = () =>
    cp(source, join(workspace, "apps/new"), { recursive: true });
  await expect(verifyWorkspaceBuildReceipts(workspace)).rejects.toThrow(
    /workspace verification failed/u
  );
});

async function fixture(inWorkspace = false, withLock = false) {
  const container = await mkdtemp(join(tmpdir(), "intl-strict-verify-"));
  roots.push(container);
  const root = inWorkspace ? join(container, "apps/a") : container;
  if (inWorkspace) {
    await writeFile(
      join(container, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n"
    );
  }
  await mkdir(join(root, "src/locales"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    '{"name":"strict-verify","version":"1.0.0","dependencies":{"vite":"8.1.4"}}'
  );
  await writeFile(join(root, "tsconfig.json"), '{"include":["src/**/*.ts"]}');
  await writeFile(join(root, "src/page.ts"), "export const answer = 42;\n");
  await writeFile(
    join(root, "src/locales/en.json"),
    '{"greeting":"Hello {name}"}'
  );
  await writeFile(
    join(root, "src/locales/th.json"),
    '{"greeting":"สวัสดี {name}"}'
  );
  if (withLock) {
    await writeFile(
      join(container, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\n"
    );
  }
  await proveConventionCatalog(root);
  return root;
}

it("verifies current V3 authority without compiling or emitting catalog artifacts", async () => {
  const root = await fixture();
  const before = await readFile(join(root, "src/i18n/generated/current.json"));
  work.compile = 0;
  work.emit = 0;
  await expect(verifyConventionBuildReceipt(root)).resolves.toMatchObject({
    catalogCompilations: 0,
    artifactEmissions: 0,
    verifiedCatalogs: 1,
    buildReceiptVerifications: 1,
    buildSemanticAnalysisRuns: 0,
  });
  expect(work).toEqual({ compile: 0, emit: 0 });
  expect(await readFile(join(root, "src/i18n/generated/current.json"))).toEqual(
    before
  );
  expect(await readdir(join(root, "src/i18n/generated/builds"))).toHaveLength(
    1
  );
});

it("verifies every catalog in a bounded workspace session and rejects stale members", async () => {
  const { cp } = await import("node:fs/promises");
  const source = await fixture();
  const workspace = await mkdtemp(join(tmpdir(), "intl-verify-workspace-"));
  roots.push(workspace);
  await writeFile(
    join(workspace, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n"
  );
  for (const name of ["a", "b"]) {
    const app = join(workspace, "apps", name);
    await cp(source, app, { recursive: true });
    await rm(join(app, ".mirai-intl"), { recursive: true });
    await rm(join(app, "src/i18n/generated"), { recursive: true });
    await proveConventionCatalog(app);
  }
  work.compile = 0;
  work.emit = 0;
  const verified = await verifyWorkspaceBuildReceipts(workspace);
  expect(verified).toHaveLength(2);
  expect(verified.map(({ verifiedCatalogs }) => verifiedCatalogs)).toEqual([
    1, 1,
  ]);
  expect(work).toEqual({ compile: 0, emit: 0 });
  await writeFile(join(workspace, "apps/b/src/locales/th.json"), "{}");
  await expect(verifyWorkspaceBuildReceipts(workspace)).rejects.toThrow(
    /workspace verification failed/u
  );
});

it("rereads a shared source when it changes between catalog final checks", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "intl-final-catalog-scope-"))
  );
  roots.push(workspace);
  await writeFile(
    join(workspace, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n"
  );
  const shared = join(workspace, "shared.ts");
  await writeFile(shared, "export const shared = 42;\n");
  for (const name of ["a", "b"]) {
    const app = join(workspace, "apps", name);
    await mkdir(join(app, "src/locales"), { recursive: true });
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({
        name: `final-scope-${name}`,
        version: "1.0.0",
        dependencies: { vite: "8.1.4" },
      })
    );
    await writeFile(
      join(app, "tsconfig.json"),
      '{"include":["src/**/*.ts","../../shared.ts"]}'
    );
    await writeFile(join(app, "src/page.ts"), "export const answer = 42;\n");
    await writeFile(join(app, "src/locales/en.json"), '{"hello":"Hello"}');
    await writeFile(join(app, "src/locales/th.json"), '{"hello":"สวัสดี"}');
    await proveConventionCatalog(app);
  }
  let lastCatalogInitialized = false;
  let changed = false;
  mutation.afterRead = async (path) => {
    if (
      path ===
      join(
        workspace,
        "apps/b/src/i18n/generated/catalog-generation-receipt.v1.json"
      )
    ) {
      lastCatalogInitialized = true;
    }
    if (path === shared && lastCatalogInitialized && !changed) {
      // The first final check receives the bytes it just read; the next catalog
      // must observe the edited file rather than reuse that earlier hash.
      changed = true;
      await writeFile(shared, "export const shared = 43;\n");
    }
  };
  const failure = await verifyWorkspaceBuildReceipts(workspace).catch(
    (error: unknown) => error
  );
  expect(changed).toBe(true);
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) {
    throw new Error("The later catalog must reject the shared-file edit");
  }
  expect(failure.errors).toHaveLength(1);
  expect(failure.errors[0]).toMatchObject({
    message: expect.stringContaining(join(workspace, "apps/b")),
  });
});

it.each([
  ["missing translation", "src/locales/th.json", "{}"],
  ["empty translation", "src/locales/th.json", '{"greeting":""}'],
  ["invalid ICU", "src/locales/th.json", '{"greeting":"Hello {"}'],
  [
    "changed ICU parameters",
    "src/locales/th.json",
    '{"greeting":"Hello {other}"}',
  ],
  [
    "extra translation key",
    "src/locales/th.json",
    '{"greeting":"สวัสดี {name}","extra":"ใหม่"}',
  ],
  ["new locale", "src/locales/ja.json", '{"greeting":"Hello {name}"}'],
  ["changed source", "src/page.ts", "export const answer = 43;\n"],
  ["new source", "src/new.ts", "export const added = 1;\n"],
  ["changed config", "tsconfig.json", '{"include":["src/other/**/*.ts"]}'],
  ["new lockfile", "pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
  [
    "new publication lock",
    "src/i18n/generated/.publish.lock",
    "active publisher",
  ],
  [
    "unexplained generated state",
    "src/i18n/generated/unexpected.ts",
    "export const extra = 1;\n",
  ],
])(
  "rejects %s without repairing or authorizing it",
  async (_label, file, bytes) => {
    const root = await fixture();
    const pointer = join(root, "src/i18n/generated/current.json");
    const before = await readFile(pointer);
    await writeFile(join(root, file), bytes);
    await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(/./u);
    expect(await readFile(join(root, file), "utf8")).toBe(bytes);
    expect(await readFile(pointer)).toEqual(before);
  }
);

it("rejects an omitted source even when all remaining files are unchanged", async () => {
  const root = await fixture();
  await rm(join(root, "src/page.ts"));
  await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(/./u);
});

it("rejects extra generated builds without deleting them", async () => {
  const root = await fixture();
  const extra = join(root, "src/i18n/generated/builds/unexplained");
  await mkdir(extra);
  await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
    /unexplained/u
  );
  expect(await readdir(extra)).toEqual([]);
});

it.each(["standalone", "batch", "transfer"] as const)(
  "rejects a version-only mutation after final classifier checks (%s)",
  async (mode) => {
    const root = await fixture(true);
    const path = join(root, "package.json");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    let changed = false;
    mutation.freshLoads = 0;
    mutation.afterRead = async (readPath) => {
      if (
        mutation.freshLoads >= 2 &&
        readPath.endsWith("/catalog-generation-receipt.v1.json")
      ) {
        mutation.afterRead = undefined;
        await writeFile(
          path,
          JSON.stringify({ ...manifest, version: "1.0.1" })
        );
        changed = true;
      }
    };
    const verify = async () => {
      const {
        verifyConventionBuildReceiptBatch,
        verifyTransferredConventionBuildReceiptBatch,
      } = await import("../src/check-receipt");
      if (mode === "standalone") {
        return verifyConventionBuildReceipt(root);
      }
      if (mode === "transfer") {
        return verifyTransferredConventionBuildReceiptBatch(
          [{ packageRoot: root, transferredPackageRoot: root }],
          join(root, "../..")
        );
      }
      const results = await verifyConventionBuildReceiptBatch([root]);
      for (const result of results) {
        if (result.status === "rejected") {
          throw result.reason;
        }
      }
      return results;
    };
    await expect(verify()).rejects.toThrow(
      /application package.*changed|application package or lock.*stale/u
    );
    expect(changed).toBe(true);
  }
);

it("rejects raw manifest formatting changes after final classifier checks", async () => {
  const root = await fixture();
  const path = join(root, "package.json");
  const bytes = await readFile(path, "utf8");
  let changed = false;
  mutation.freshLoads = 0;
  mutation.afterRead = async (readPath) => {
    if (
      mutation.freshLoads >= 2 &&
      readPath.endsWith("/catalog-generation-receipt.v1.json")
    ) {
      mutation.afterRead = undefined;
      await writeFile(path, `${bytes}\n`);
      changed = true;
    }
  };
  await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
    /application package or lock identity is stale/u
  );
  expect(changed).toBe(true);
});

it("rereads raw lock bytes after the final full application identity capture", async () => {
  const root = await fixture(false, true);
  const path = join(root, "pnpm-lock.yaml");
  let armed = false;
  let capturedLock = false;
  let changed = false;
  mutation.freshLoads = 0;
  mutation.afterRead = async (readPath) => {
    if (
      mutation.freshLoads >= 2 &&
      readPath.endsWith("/catalog-generation-receipt.v1.json")
    ) {
      armed = true;
    }
    if (armed && readPath.endsWith("/pnpm-lock.yaml")) {
      capturedLock = true;
    }
    if (capturedLock && readPath.endsWith("/package.json")) {
      mutation.afterRead = undefined;
      await writeFile(
        path,
        "lockfileVersion: '9.0'\n# changed after identity read\n"
      );
      changed = true;
    }
  };
  await expect(verifyConventionBuildReceipt(root)).rejects.toThrow(
    /application package or lock identity is stale/u
  );
  expect(changed).toBe(true);
});
