import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type * as NodeFsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

const trackedReads = vi.hoisted(() => new Map<string, number>());

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    readFile: (...arguments_: Parameters<typeof actual.readFile>) => {
      const path = String(arguments_[0]);
      const count = trackedReads.get(path);
      if (count !== undefined) {
        trackedReads.set(path, count + 1);
      }
      return Reflect.apply(actual.readFile, actual, arguments_) as ReturnType<
        typeof actual.readFile
      >;
    },
  };
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createConventionApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-proof-scan-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/proof-scan",
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
  return root;
}

async function createArtifact(
  root: string,
  directory: string,
  entry: string
): Promise<string> {
  const artifactRoot = join(root, directory);
  const javascript = join(artifactRoot, `${entry}.js`);
  const sourceMap = `${javascript}.map`;
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(javascript, "export {};\n");
  await writeFile(
    sourceMap,
    `${JSON.stringify({
      sources: [`${entry}.ts`],
      sourcesContent: ["export {};"],
      version: 3,
    })}\n`
  );
  trackedReads.set(javascript, 0);
  trackedReads.set(sourceMap, 0);
  return artifactRoot;
}

describe("multi-target proof scanning", () => {
  it("reads each emitted JavaScript and source map exactly once", async () => {
    const { finalizeBuildProofTargets, proveConventionCatalog } =
      await import("../src/proof");
    const root = await createConventionApp();
    try {
      await proveConventionCatalog(root);
      const client = await createArtifact(root, "dist/client", "entry");
      const worker = await createArtifact(root, "dist/worker", "worker");

      await finalizeBuildProofTargets(root, [
        { artifactRoot: client, target: "client" },
        { artifactRoot: worker, target: "worker" },
      ]);

      expect(Object.fromEntries(trackedReads)).toEqual({
        [join(client, "entry.js")]: 1,
        [join(client, "entry.js.map")]: 1,
        [join(worker, "worker.js")]: 1,
        [join(worker, "worker.js.map")]: 1,
      });
    } finally {
      trackedReads.clear();
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
