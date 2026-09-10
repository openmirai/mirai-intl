import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type * as Integrity from "../src/integrity-identity";

const work = vi.hoisted(() => ({ immutable: 0 }));
vi.mock("../src/integrity-identity", async (original) => {
  const actual = await original<typeof Integrity>();
  return {
    ...actual,
    computeImmutableIntegrityIdentity: async (
      ...args: Parameters<typeof actual.computeImmutableIntegrityIdentity>
    ) => {
      work.immutable++;
      return actual.computeImmutableIntegrityIdentity(...args);
    },
  };
});
import { proveConventionCatalog } from "../src/proof";
import { verifyTransferredConventionBuildReceiptBatch } from "../src/check-receipt";

const roots: Array<string> = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it("shares compiler identity only between the initial and final transfer barriers", async () => {
  const root = await mkdtemp(join(tmpdir(), "intl-transfer-batch-"));
  roots.push(root);
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  // Canonical archive order differs from localeCompare discovery order.
  const packages = ["B", "a"].map((name) => join(root, "apps", name));
  for (const path of packages) {
    await mkdir(join(path, "src/locales"), { recursive: true });
    await writeFile(
      join(path, "package.json"),
      '{"name":"transfer-fixture","version":"1.0.0","dependencies":{"vite":"8.1.4"}}'
    );
    await writeFile(join(path, "tsconfig.json"), '{"include":["src/**/*.ts"]}');
    await writeFile(join(path, "src/page.ts"), "export const answer = 42;\n");
    await writeFile(join(path, "src/locales/en.json"), '{"hello":"Hello"}');
    await writeFile(join(path, "src/locales/th.json"), '{"hello":"สวัสดี"}');
    await proveConventionCatalog(path);
  }
  const entries = packages.map((packageRoot) => ({
    packageRoot,
    transferredPackageRoot: packageRoot,
  }));
  work.immutable = 0;
  const result = await verifyTransferredConventionBuildReceiptBatch(
    entries,
    root
  );
  expect(result.map((value) => value.verifiedCatalogs)).toEqual([1, 1]);
  expect(work.immutable).toBe(2);
  const second = packages[1];
  if (!second) {
    throw new Error("Missing second fixture catalog");
  }
  await writeFile(join(second, "src/page.ts"), "export const answer = 43;\n");
  await expect(
    verifyTransferredConventionBuildReceiptBatch(entries, root)
  ).rejects.toThrow(/stale|transfer verification failed/u);
});
