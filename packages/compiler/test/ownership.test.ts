import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveConventionSourceUniverse } from "../src/ownership";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("check-project ownership normalization", () => {
  it("keeps a root-level tsconfig pathsBasePath as a relative option", async () => {
    const workspaceRoot = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-ownership-paths-"))
    );
    try {
      await writeFile(
        join(workspaceRoot, "pnpm-workspace.yaml"),
        "packages: []\n",
        "utf8"
      );
      await writeJson(join(workspaceRoot, "package.json"), {
        name: "@example/paths-app",
        version: "1.0.0",
      });
      await mkdir(join(workspaceRoot, "src"), { recursive: true });
      await writeFile(
        join(workspaceRoot, "src/page.ts"),
        "export const page = 1;\n",
        "utf8"
      );
      await writeJson(join(workspaceRoot, "tsconfig.json"), {
        compilerOptions: {
          paths: { "@/*": ["./src/*"] },
        },
        include: ["src/**/*.ts"],
      });

      const universe = await resolveConventionSourceUniverse(
        workspaceRoot,
        [{ path: "tsconfig.json", role: "owner" }],
        "src/i18n/generated"
      );

      expect(universe.projects).toEqual([
        expect.objectContaining({
          normalizedOptions: expect.objectContaining({
            paths: { "@/*": ["./src/*"] },
            pathsBasePath: ".",
          }),
          path: "tsconfig.json",
        }),
      ]);
      expect(universe.files.map(({ file }) => file)).toEqual(["src/page.ts"]);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
});
