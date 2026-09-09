import { execFile } from "node:child_process";
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
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, expect, it } from "vitest";
import { create, extract } from "tar";

import { proveConventionCatalog } from "../src/proof";
import {
  exportAuthorityBundle,
  importAuthorityBundle,
  verifyConventionBuildReceipt,
} from "../src/verify";

const temporaryRoots: Array<string> = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function workspaceFixture() {
  const directory = await mkdtemp(join(tmpdir(), "intl-transfer-test-"));
  temporaryRoots.push(directory);
  const root = join(directory, "producer");
  const app = join(root, "apps/app");
  await mkdir(join(app, "src/locales"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n\n  apps/app:\n    dependencies: {}\n"
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
}, 60_000);
