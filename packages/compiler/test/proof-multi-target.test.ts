import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  finalizeBuildProofTargets,
  proveConventionCatalog,
  verifyFinalizedBuildProof,
} from "../src/proof";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createConventionApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-proof-targets-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/proof-targets",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี",
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "page.ts"), "export const page = 1;\n");
  await writeJson(join(root, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  await proveConventionCatalog(root);
  return root;
}

async function createArtifact(
  root: string,
  directory: string,
  entry: string
): Promise<string> {
  const artifactRoot = join(root, directory);
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(join(artifactRoot, `${entry}.js`), "export {};\n");
  await writeFile(
    join(artifactRoot, `${entry}.js.map`),
    `${JSON.stringify({
      sources: [`${entry}.ts`],
      sourcesContent: ["export {};"],
      version: 3,
    })}\n`
  );
  return artifactRoot;
}

describe("multi-target build proof finalization", () => {
  it("verifies source authority once and directly finalizes every target", async () => {
    const root = await createConventionApp();
    try {
      const client = await createArtifact(root, "dist/client", "entry");
      const worker = await createArtifact(root, "dist/worker", "worker");
      const workerMaps = join(root, "dist/worker-maps");
      await mkdir(workerMaps, { recursive: true });
      await rename(
        join(worker, "worker.js.map"),
        join(workerMaps, "worker.js.map")
      );

      await expect(
        finalizeBuildProofTargets(root, [
          { artifactRoot: client, target: "client" },
          { artifactRoot: worker, mapRoot: workerMaps, target: "worker" },
        ])
      ).resolves.toMatchObject([
        { state: "finalized", target: "client" },
        { state: "finalized", target: "worker" },
      ]);

      await expect(
        readFile(
          join(root, ".mirai-intl/build-proofs/client.provisional.v1.json"),
          "utf8"
        )
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        verifyFinalizedBuildProof(root, client, "client", [
          { mapPath: "entry.js.map", path: "entry.js" },
        ])
      ).resolves.toMatchObject({ state: "finalized", target: "client" });
      await expect(
        verifyFinalizedBuildProof(
          root,
          worker,
          "worker",
          [{ mapPath: "worker.js.map", path: "worker.js" }],
          workerMaps
        )
      ).resolves.toMatchObject({ state: "finalized", target: "worker" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("writes no finalized proof when any target scan fails", async () => {
    const root = await createConventionApp();
    try {
      const client = await createArtifact(root, "dist/client", "entry");
      const emptyWorker = join(root, "dist/worker");
      await mkdir(emptyWorker, { recursive: true });

      await expect(
        finalizeBuildProofTargets(root, [
          { artifactRoot: client, target: "client" },
          { artifactRoot: emptyWorker, target: "worker" },
        ])
      ).rejects.toThrow(
        /Build proof requires at least one emitted JavaScript module/u
      );
      await expect(
        readFile(
          join(root, ".mirai-intl/build-proofs/client.finalized.v1.json"),
          "utf8"
        )
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects empty and duplicate target sets", async () => {
    const root = await createConventionApp();
    try {
      const client = await createArtifact(root, "dist/client", "entry");
      await expect(finalizeBuildProofTargets(root, [])).rejects.toThrow(
        /at least one target/u
      );
      await expect(
        finalizeBuildProofTargets(root, [
          { artifactRoot: client, target: "client" },
          { artifactRoot: client, target: "client" },
        ])
      ).rejects.toThrow(/targets must be unique/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
