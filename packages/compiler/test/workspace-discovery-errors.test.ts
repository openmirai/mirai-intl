import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type * as FileSystem from "node:fs/promises";

const fault = vi.hoisted(() => ({ path: "" }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof FileSystem>();
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (String(args[0]) === fault.path) {
        throw Object.assign(new Error("unreadable discovery input"), {
          code: "EACCES",
        });
      }
      return actual.lstat(...args);
    },
  };
});
import {
  discoverWorkspaceCatalogs,
  nearestWorkspaceRoot,
} from "../src/workspace-catalogs";

const roots: Array<string> = [];
// This suite injects Node filesystem faults. Native syscall parity is covered
// by native/test/integration.test.mjs using actual filesystem permissions.
beforeEach(() => vi.stubEnv("MIRAI_INTL_ENGINE", "node"));
afterEach(async () => {
  vi.unstubAllEnvs();
  fault.path = "";
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

it.each(["mirai-intl.config.json", "src/locales", "locales"])(
  "does not silently omit a catalog after a failed %s probe",
  async (probe) => {
    const root = await mkdtemp(join(tmpdir(), "intl-discovery-error-"));
    roots.push(root);
    await mkdir(join(root, "apps/a"), { recursive: true });
    await mkdir(join(root, "apps/b/src/locales"), { recursive: true });
    fault.path = join(root, "apps/a", probe);
    await expect(discoverWorkspaceCatalogs(root)).rejects.toMatchObject({
      code: "EACCES",
    });
  }
);

it("does not confuse an unreadable workspace marker with absence", async () => {
  const root = await mkdtemp(join(tmpdir(), "intl-workspace-error-"));
  roots.push(root);
  fault.path = join(root, "pnpm-workspace.yaml");
  await writeFile(fault.path, "packages: []\n");
  await expect(nearestWorkspaceRoot(root)).rejects.toMatchObject({
    code: "EACCES",
  });
});
