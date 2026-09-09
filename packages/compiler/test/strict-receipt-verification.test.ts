import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type * as Compile from "../src/compile";
import type * as Emit from "../src/emit";
import type * as FileSystem from "node:fs/promises";

const work = vi.hoisted(() => ({ compile: 0, emit: 0 }));
const mutation = vi.hoisted(() => ({
  skipGenerationReads: 0,
  afterGenerationRead: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof FileSystem>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const bytes = await actual.readFile(...args);
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
  mutation.afterGenerationRead = undefined;
  mutation.skipGenerationReads = 0;
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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "intl-strict-verify-"));
  roots.push(root);
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
