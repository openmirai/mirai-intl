import type NodeFsPromises from "node:fs/promises";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as AnalyzeSources from "../src/analyze-sources";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => ({
  enabled: false,
  matchedReads: 0,
  pattern: undefined as RegExp | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();
  return {
    ...actual,
    async readFile(...arguments_: Parameters<typeof actual.readFile>) {
      const result = await Reflect.apply(actual.readFile, actual, arguments_);
      const path = String(arguments_[0]).replaceAll("\\", "/");
      if (mutation.enabled && mutation.pattern?.test(path)) {
        mutation.matchedReads += 1;
        return typeof result === "string"
          ? `${result}\n/* authorization mutation */`
          : Buffer.concat([
              result as Buffer,
              Buffer.from("\n/* authorization mutation */"),
            ]);
      }
      return result;
    },
  };
});

vi.mock("../src/analyze-sources", async (importOriginal) => {
  const actual = await importOriginal<typeof AnalyzeSources>();
  return {
    ...actual,
    async analyzeConventionSourceFiles(
      ...arguments_: Parameters<typeof actual.analyzeConventionSourceFiles>
    ) {
      const result = await actual.analyzeConventionSourceFiles(...arguments_);
      mutation.enabled = true;
      return result;
    },
  };
});

import {
  authorizeConventionCatalog,
  conventionCheckReceiptPath,
} from "../src/proof";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-integrity-barrier-"));
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/integrity-barrier",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี",
  });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/page.ts"), "export const page = 1;\n");
  await writeJson(join(root, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

beforeEach(() => {
  mutation.enabled = false;
  mutation.matchedReads = 0;
  mutation.pattern = undefined;
});

describe("complete authorization integrity mutation barrier", () => {
  it.each([
    ["compiler module", /\/packages\/compiler\/src\/proof\.ts$/u],
    [
      "TypeScript non-entry package file",
      /\/node_modules\/typescript\/lib\/_tsserver\.js$/u,
    ],
    ["TypeScript lib declaration", /\/typescript\/lib\/lib\.es5\.d\.ts$/u],
    [
      "ICU parser non-entry package file",
      /\/@formatjs\/icu-messageformat-parser\/manipulator\.js$/u,
    ],
  ] as const)(
    "rejects a mid-analysis %s mutation",
    async (_label, pattern) => {
      const root = await fixture();
      mutation.pattern = pattern;
      try {
        await expect(
          authorizeConventionCatalog(root, { collectEnvironment: false })
        ).rejects.toThrow(
          "Mirai Intl compiler dependency inputs changed while source analysis ran"
        );
        expect(mutation.matchedReads).toBeGreaterThan(0);
        await expect(
          readFile(conventionCheckReceiptPath(root), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        mutation.enabled = false;
        await rm(root, { force: true, recursive: true });
      }
    },
    60_000
  );
});
