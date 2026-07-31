import type NodeFsPromises from "node:fs/promises";
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

import type * as AnalyzeSources from "../src/analyze-sources";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => ({
  afterAnalysis: undefined as undefined | (() => Promise<void>),
  enabled: false,
  enableAfterAnalysis: true,
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
    async analyzeLoadedConventionSourceFiles(
      ...arguments_: Parameters<
        typeof actual.analyzeLoadedConventionSourceFiles
      >
    ) {
      const result = await actual.analyzeLoadedConventionSourceFiles(
        ...arguments_
      );
      await mutation.afterAnalysis?.();
      if (mutation.enableAfterAnalysis) {
        mutation.enabled = true;
      }
      return result;
    },
  };
});

import {
  authorizeConventionCatalog,
  conventionCheckReceiptPath,
  verifyConventionCheckReceipt,
} from "../src/proof";
import { conventionCheckReceiptSelectorPath } from "../src/check-receipt";

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
  await writeFile(join(root, "src/legacy.js"), "export const legacy = 1;\n");
  await writeJson(join(root, "tsconfig.a.json"), {
    compilerOptions: { allowJs: true },
  });
  await writeJson(join(root, "tsconfig.omit.json"), {
    compilerOptions: { strict: true },
  });
  await writeJson(join(root, "tsconfig.z.json"), {
    compilerOptions: { allowJs: false },
  });
  await writeJson(join(root, "tsconfig.json"), {
    extends: ["./tsconfig.z.json", "./tsconfig.a.json", "./tsconfig.omit.json"],
    include: ["src/**/*"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

beforeEach(() => {
  mutation.afterAnalysis = undefined;
  mutation.enabled = false;
  mutation.enableAfterAnalysis = true;
  mutation.matchedReads = 0;
  mutation.pattern = undefined;
});

describe("complete authorization integrity mutation barrier", () => {
  it("preserves the prior active receipt when publication is interrupted", async () => {
    const root = await fixture();
    try {
      const prior = await authorizeConventionCatalog(root, {
        collectEnvironment: false,
      });
      const receiptPath = conventionCheckReceiptSelectorPath(root);
      const before = await readFile(receiptPath);

      await expect(
        authorizeConventionCatalog(root, {
          beforePublicationBarrier() {
            throw new Error("simulated publication interruption");
          },
          collectEnvironment: false,
        })
      ).rejects.toThrow("simulated publication interruption");

      expect(await readFile(receiptPath)).toEqual(before);
      await expect(verifyConventionCheckReceipt(root)).resolves.toEqual(
        prior.receipt
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

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

  it.each([
    [
      "application manifest",
      async (root: string) => {
        await writeJson(join(root, "package.json"), {
          dependencies: { vite: "8.1.4" },
          name: "@example/integrity-barrier",
          version: "2.0.0",
        });
      },
    ],
    [
      "workspace lockfile",
      async (root: string) => {
        await writeFile(
          join(root, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\n# delayed mutation\n",
          "utf8"
        );
      },
    ],
  ] as const)(
    "rejects a delayed-publication %s mutation",
    async (label, mutate) => {
      const root = await fixture();
      if (label === "workspace lockfile") {
        await writeFile(
          join(root, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\n",
          "utf8"
        );
      }
      mutation.enableAfterAnalysis = false;
      try {
        await expect(
          authorizeConventionCatalog(root, {
            beforePublicationBarrier: () => mutate(root),
            collectEnvironment: false,
          })
        ).rejects.toThrow(
          label === "application manifest"
            ? "Mirai Intl package authority manifest is stale"
            : "publication fingerprint changed before receipt publication: application package identity"
        );
        await expect(
          readFile(conventionCheckReceiptPath(root), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    60_000
  );

  it("rejects a delayed-publication compiler identity mutation", async () => {
    const root = await fixture();
    mutation.enableAfterAnalysis = false;
    mutation.pattern = /\/packages\/compiler\/src\/proof\.ts$/u;
    try {
      await expect(
        authorizeConventionCatalog(root, {
          beforePublicationBarrier() {
            mutation.enabled = true;
          },
          collectEnvironment: false,
        })
      ).rejects.toThrow(
        "publication fingerprint changed before receipt publication: compiler dependency identity"
      );
      expect(mutation.matchedReads).toBeGreaterThan(0);
      await expect(
        readFile(conventionCheckReceiptPath(root), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      mutation.enabled = false;
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it.each([
    [
      "addition",
      async (root: string) => {
        await writeFile(
          join(root, "src/added.js"),
          "export const added = 1;\n"
        );
      },
    ],
    [
      "deletion",
      async (root: string) => {
        await rm(join(root, "src/legacy.js"));
      },
    ],
    [
      "rename",
      async (root: string) => {
        await rename(join(root, "src/legacy.js"), join(root, "src/renamed.js"));
      },
    ],
  ] as const)(
    "rejects a mid-analysis source %s",
    async (_label, mutate) => {
      const root = await fixture();
      mutation.afterAnalysis = () => mutate(root);
      try {
        await expect(
          authorizeConventionCatalog(root, { collectEnvironment: false })
        ).rejects.toThrow(
          "Mirai Intl source universe changed while source analysis ran"
        );
        await expect(
          readFile(conventionCheckReceiptPath(root), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        mutation.afterAnalysis = undefined;
        await rm(root, { force: true, recursive: true });
      }
    },
    60_000
  );
});
