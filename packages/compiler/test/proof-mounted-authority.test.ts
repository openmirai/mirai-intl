import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  finalizeBuildProofTargets,
  proveConventionCatalog,
} from "../src/proof";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writePackage(
  root: string,
  name: string,
  dependencies: Readonly<Record<string, string>> = {}
): Promise<void> {
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4", ...dependencies },
    name,
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี",
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/owner.ts"), "export const owner = 1;\n");
  await writeJson(join(root, "tsconfig.intl.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.intl.json", role: "owner" }],
  });
}

describe("mounted catalog proof authority", () => {
  it("composes the mounted owner receipt into direct finalized proofs", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-mounted-proof-"));
    const dependencyRoot = join(root, "node_modules/@mirai/i18n");
    try {
      await writePackage(dependencyRoot, "@mirai/i18n");
      await writePackage(root, "@example/app", {
        "@mirai/i18n": "1.0.0",
      });
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkProjects: [{ path: "tsconfig.intl.json", role: "owner" }],
        sources: [
          {
            from: "@mirai/i18n",
            mount: "components.ui",
            path: "src/locales",
          },
        ],
      });
      await proveConventionCatalog(dependencyRoot);
      await proveConventionCatalog(root);

      const artifactRoot = join(root, "dist");
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(join(artifactRoot, "entry.js"), "export {};\n");
      await writeFile(
        join(artifactRoot, "entry.js.map"),
        '{"sources":["entry.ts"],"sourcesContent":["export {};"],"version":3}\n'
      );
      const [first] = await finalizeBuildProofTargets(root, [
        { artifactRoot, target: "client" },
      ]);

      await writeFile(
        join(dependencyRoot, "src/owner.ts"),
        "export const owner = 2;\n"
      );
      await proveConventionCatalog(dependencyRoot);
      const [second] = await finalizeBuildProofTargets(root, [
        { artifactRoot, target: "client" },
      ]);

      expect(second?.authorityHash).not.toBe(first?.authorityHash);
      expect(second?.deploymentReceiptHash).not.toBe(
        first?.deploymentReceiptHash
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
