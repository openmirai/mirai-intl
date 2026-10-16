import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type * as IntegrityIdentity from "../src/integrity-identity";
import { afterEach, describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ compilerChanged: false }));

// A compiler upgrade changes the hash of a compiler module; every reader of
// the immutable identity sees the same change.
vi.mock("../src/integrity-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof IntegrityIdentity>();
  const { canonicalHash } = await import("../src/canonical");
  const perturb = (
    value: IntegrityIdentity.ImmutableIntegrityIdentity
  ): IntegrityIdentity.ImmutableIntegrityIdentity => {
    if (!identity.compilerChanged) {
      return value;
    }
    const [first, ...rest] = value.compiler.modules.entries;
    if (!first) {
      throw new Error("compiler identity has no modules");
    }
    const entries = [
      { ...first, hash: `sha256:${"0".repeat(64)}` as const },
      ...rest,
    ];
    const modules = actual.createIntegrityManifest(entries);
    return {
      ...value,
      compiler: { hash: canonicalHash({ modulesHash: modules.hash }), modules },
    };
  };
  return {
    ...actual,
    async computeImmutableIntegrityIdentity() {
      return perturb(await actual.computeImmutableIntegrityIdentity());
    },
    async getImmutableIntegrityIdentity() {
      return perturb(await actual.getImmutableIntegrityIdentity());
    },
  };
});

import { conventionCheckReceiptSelectorPath } from "../src/check-receipt";
import { SEMANTIC_ENGINE_ENVIRONMENT } from "../src/semantic-providers";
import { authorizeWorkspaceConventionCatalog } from "../src/proof";

const RECORD = ".mirai-intl/authorization-reuse.v1.json";

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const compilerOptions = { module: "esnext", moduleResolution: "bundler" };

const page = (key: string) =>
  [
    'import "./i18n/generated";',
    'import type { GreetingKey } from "@example/shared";',
    'import { useTranslations } from "./runtime";',
    'const { t } = useTranslations("pages");',
    `declare const key: ${key};`,
    "export const label = t(key);",
    "",
  ].join("\n");

/**
 * One catalog in a pnpm workspace. Its page imports the generated facade, so
 * it is semantically analysed, and takes its key type from a module outside
 * the catalog.
 */
async function fixture(): Promise<
  Readonly<{ app: string; workspace: string }>
> {
  const workspace = await mkdtemp(join(tmpdir(), "mirai-intl-reuse-"));
  const app = join(workspace, "apps/auth");
  await writeFile(
    join(workspace, "pnpm-workspace.yaml"),
    "packages:\n  - apps/*\n  - packages/*\n"
  );
  await writeFile(
    join(workspace, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n\n  apps/auth:\n    dependencies: {}\n"
  );
  // A workspace package outside the catalog, linked the way pnpm links it.
  await writeJson(join(workspace, "packages/shared/package.json"), {
    name: "@example/shared",
    types: "./src/keys.d.ts",
    version: "1.0.0",
  });
  await mkdir(join(workspace, "packages/shared/src"), { recursive: true });
  await writeFile(
    join(workspace, "packages/shared/src/keys.d.ts"),
    'export type GreetingKey = "greeting";\n'
  );
  await mkdir(join(app, "node_modules/@example"), { recursive: true });
  await symlink(
    "../../../../packages/shared",
    join(app, "node_modules/@example/shared"),
    "dir"
  );
  await writeJson(join(app, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/auth",
    version: "1.0.0",
  });
  await writeJson(join(app, "src/locales/global/en.json"), {
    pages: { farewell: "Bye", greeting: "Hello" },
  });
  await writeJson(join(app, "src/locales/global/th.json"), {
    pages: { farewell: "ลาก่อน", greeting: "สวัสดี" },
  });
  await writeJson(join(app, "tsconfig.json"), {
    compilerOptions,
    include: ["src/**/*.ts"],
  });
  await writeJson(join(app, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  await writeFile(
    join(app, "src/runtime.ts"),
    [
      "export function useTranslations(namespace: string) {",
      "  return { t: (key: string, values?: object) => `${key}${String(values)}` };",
      "}",
      "",
    ].join("\n")
  );
  await writeFile(join(app, "src/page.ts"), page("GreetingKey"));
  return { app, workspace };
}

type Outcome = Readonly<
  { message: string; outcome: "fail" } | { outcome: "pass"; reused: boolean }
>;

async function authorize(app: string): Promise<Outcome> {
  try {
    const { reused } = await authorizeWorkspaceConventionCatalog(app);
    return { outcome: "pass", reused };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      outcome: "fail",
    };
  }
}

type Expected =
  | Readonly<{ message: RegExp; outcome: "fail" }>
  | Readonly<{ outcome: "pass"; reused: false }>;

/**
 * The outcome in the shape of its expectation: a failure whose message
 * matches the expected pattern carries that pattern, else its message.
 */
function verdict(outcome: Outcome, expected: Expected): unknown {
  return outcome.outcome === "fail" &&
    expected.outcome === "fail" &&
    expected.message.test(outcome.message)
    ? { message: expected.message, outcome: "fail" }
    : outcome;
}

const workspaces: Array<string> = [];

async function authorizedFixture(): Promise<
  Readonly<{ app: string; workspace: string }>
> {
  const created = await fixture();
  workspaces.push(created.workspace);
  expect(await authorize(created.app)).toEqual({
    outcome: "pass",
    reused: false,
  });
  return created;
}

afterEach(async () => {
  identity.compilerChanged = false;
  Reflect.deleteProperty(process.env, SEMANTIC_ENGINE_ENVIRONMENT);
  await Promise.all(
    workspaces
      .splice(0)
      .map((workspace) => rm(workspace, { force: true, recursive: true }))
  );
});

describe("workspace authorization reuse", () => {
  it("reuses an unchanged catalog, including after its files are touched", async () => {
    const { app, workspace } = await authorizedFixture();
    expect(await authorize(app)).toEqual({ outcome: "pass", reused: true });

    const later = new Date(Date.now() + 60_000);
    for (const file of [
      "packages/shared/src/keys.d.ts",
      "apps/auth/src/page.ts",
      "apps/auth/src/locales/global/en.json",
      "apps/auth/tsconfig.json",
      "pnpm-lock.yaml",
    ]) {
      await utimes(join(workspace, file), later, later);
    }
    expect(await authorize(app)).toEqual({ outcome: "pass", reused: true });
  }, 120_000);

  it.each([
    {
      expected: { outcome: "pass", reused: false },
      mutate: ({ app }: Fixture) =>
        writeFile(
          join(app, "src/page.ts"),
          `// edited\n${page("GreetingKey")}`
        ),
      name: "a source edit",
    },
    {
      expected: {
        outcome: "fail",
        message: /Unknown translation path pages\.missing/u,
      },
      mutate: ({ app }: Fixture) =>
        writeFile(join(app, "src/page.ts"), page('"missing"')),
      name: "a source that uses an unknown key",
    },
    {
      expected: {
        outcome: "fail",
        message: /Unknown translation path pages\.missing/u,
      },
      mutate: ({ workspace }: Fixture) =>
        writeFile(
          join(workspace, "packages/shared/src/keys.d.ts"),
          'export type GreetingKey = "greeting" | "missing";\n'
        ),
      name: "a key type widened in a module outside the catalog",
    },
    {
      expected: {
        outcome: "fail",
        message: /hardcoded JSX text must use t\(\)/u,
      },
      mutate: async ({ app }: Fixture) => {
        await writeJson(join(app, "tsconfig.json"), {
          compilerOptions: { ...compilerOptions, jsx: "preserve" },
          include: ["src/**/*.ts", "src/**/*.tsx"],
        });
        await writeFile(
          join(app, "src/banner.tsx"),
          "export const Banner = () => <div>Hello world</div>;\n"
        );
      },
      name: "an owner-project change that adds an untranslated source",
    },
    {
      expected: {
        outcome: "fail",
        message: /must have exactly one owner; found 0/u,
      },
      mutate: async ({ app }: Fixture) => {
        await mkdir(join(app, "scripts"), { recursive: true });
        await writeFile(
          join(app, "scripts/seed.ts"),
          "export const seed = 1;\n"
        );
      },
      name: "a new package source outside every owner project",
    },
    {
      expected: { outcome: "pass", reused: false },
      mutate: ({ app }: Fixture) =>
        writeJson(join(app, "tsconfig.json"), {
          compilerOptions: { ...compilerOptions, strict: true },
          include: ["src/**/*.ts"],
        }),
      name: "a check-project compiler option",
    },
    {
      expected: { outcome: "fail", message: /th/u },
      mutate: ({ app }: Fixture) =>
        writeJson(join(app, "src/locales/global/th.json"), {
          pages: { greeting: "สวัสดี" },
        }),
      name: "a message removed from one locale",
    },
    {
      expected: { outcome: "pass", reused: false },
      mutate: ({ app }: Fixture) =>
        writeJson(join(app, "src/locales/global/th.json"), {
          pages: { farewell: "ลาก่อนนะ", greeting: "สวัสดี" },
        }),
      name: "a message text",
    },
    {
      expected: { outcome: "fail", message: /ja/u },
      mutate: ({ app }: Fixture) =>
        writeJson(join(app, "src/locales/global/ja.json"), {
          pages: { greeting: "こんにちは" },
        }),
      name: "a new locale",
    },
    {
      expected: { outcome: "fail", message: /ko/u },
      mutate: ({ app }: Fixture) =>
        writeJson(join(app, "mirai-intl.config.json"), {
          checkProjects: [{ path: "tsconfig.json", role: "owner" }],
          requiredLocales: ["en", "ko", "th"],
        }),
      name: "the catalog config",
    },
    {
      expected: { outcome: "pass", reused: false },
      mutate: ({ app }: Fixture) =>
        writeJson(join(app, "package.json"), {
          dependencies: { vite: "8.1.4" },
          name: "@example/auth",
          version: "1.0.1",
        }),
      name: "the package manifest",
    },
    {
      expected: { outcome: "pass", reused: false },
      mutate: ({ workspace }: Fixture) =>
        writeFile(
          join(workspace, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\nimporters:\n\n  apps/auth:\n    dependencies: {}\n\n  packages/shared:\n    dependencies: {}\n"
        ),
      name: "the workspace lockfile",
    },
    {
      expected: {
        outcome: "fail",
        message: /no pnpm-lock\.yaml exists at the package root/u,
      },
      mutate: ({ workspace }: Fixture) =>
        writeFile(
          join(workspace, "pnpm-workspace.yaml"),
          "packages:\n  - packages/*\n"
        ),
      name: "workspace membership",
    },
    {
      expected: { outcome: "pass", reused: false },
      mutate: () => {
        process.env[SEMANTIC_ENGINE_ENVIRONMENT] = "reference";
      },
      name: "the semantic engine selector",
    },
  ] satisfies ReadonlyArray<{
    expected: Expected;
    mutate: (fixture: Fixture) => Promise<unknown> | unknown;
    name: string;
  }>)(
    "re-authorizes in full after $name, with the verdict of a cold run",
    async ({ expected, mutate }) => {
      const created = await authorizedFixture();
      await mutate(created);
      expect(verdict(await authorize(created.app), expected)).toEqual(expected);
    },
    120_000
  );
});

type Fixture = Awaited<ReturnType<typeof fixture>>;

describe("workspace authorization reuse state", () => {
  it.each([
    {
      corrupt: ({ app }: Fixture) => rm(join(app, RECORD)),
      expected: { outcome: "pass", reused: false },
      name: "a missing record",
    },
    {
      corrupt: async ({ app }: Fixture) => {
        const bytes = await readFile(join(app, RECORD), "utf8");
        await writeFile(join(app, RECORD), bytes.slice(0, bytes.length / 2));
      },
      expected: { outcome: "pass", reused: false },
      name: "a partial record",
    },
    {
      corrupt: async ({ app }: Fixture) => {
        const record = JSON.parse(await readFile(join(app, RECORD), "utf8"));
        await writeFile(join(app, RECORD), JSON.stringify(record, null, 2));
      },
      expected: { outcome: "pass", reused: false },
      name: "a non-canonical record",
    },
    {
      corrupt: async ({ app }: Fixture) => {
        const bytes = await readFile(join(app, RECORD), "utf8");
        await writeFile(
          join(app, RECORD),
          bytes.replace(
            /"authoritySetHash":"sha256:[\da-f]{64}"/u,
            `"authoritySetHash":"sha256:${"1".repeat(64)}"`
          )
        );
      },
      expected: { outcome: "pass", reused: false },
      name: "a record for another authority set",
    },
    {
      corrupt: async ({ app }: Fixture) => {
        const bytes = await readFile(join(app, RECORD), "utf8");
        await writeFile(
          join(app, RECORD),
          bytes.replace(`"node":"${process.version}"`, '"node":"v0.0.0"')
        );
      },
      expected: { outcome: "pass", reused: false },
      name: "a record from another runtime",
    },
    {
      corrupt: async ({ app }: Fixture) => {
        const bytes = await readFile(join(app, RECORD), "utf8");
        await rm(join(app, RECORD));
        await writeFile(join(app, ".mirai-intl/elsewhere.json"), bytes);
        await symlink(
          join(app, ".mirai-intl/elsewhere.json"),
          join(app, RECORD)
        );
      },
      expected: { outcome: "pass", reused: false },
      name: "a record that is a symbolic link",
    },
    {
      corrupt: ({ app }: Fixture) =>
        writeFile(conventionCheckReceiptSelectorPath(app), "{}\n"),
      expected: { outcome: "pass", reused: false },
      name: "a corrupt authority selector",
    },
    {
      corrupt: async ({ app }: Fixture) => {
        const directory = join(app, ".mirai-intl/authority/classifiers/v3");
        const [name] = await readdir(directory);
        await writeFile(join(directory, name ?? ""), "{}\n");
      },
      expected: {
        message: /classifier authority V3 immutable object is corrupt/u,
        outcome: "fail",
      },
      name: "a corrupt classifier authority",
    },
  ] satisfies ReadonlyArray<{
    corrupt: (fixture: Fixture) => Promise<unknown> | unknown;
    expected: Expected;
    name: string;
  }>)(
    "never reuses $name",
    async ({ corrupt, expected }) => {
      const created = await authorizedFixture();
      await corrupt(created);
      expect(verdict(await authorize(created.app), expected)).toEqual(expected);
    },
    120_000
  );

  it("never reuses across a compiler change", async () => {
    const created = await authorizedFixture();
    // The selected receipt binds every compiler module by hash. The full run
    // that follows sees, in this one process, a half-changed compiler, so only
    // the refusal to reuse is asserted.
    identity.compilerChanged = true;
    expect(await authorize(created.app)).not.toEqual({
      outcome: "pass",
      reused: true,
    });
  }, 120_000);

  it("keeps one whole record when two checks authorize at once", async () => {
    const created = await fixture();
    workspaces.push(created.workspace);
    const records = new Set<string>();
    const reading = { active: true };
    const reader = (async () => {
      while (reading.active) {
        records.add(
          await readFile(join(created.app, RECORD), "utf8").catch(() => "")
        );
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    })();
    const outcomes = await Promise.all([
      authorize(created.app),
      authorize(created.app),
    ]);
    reading.active = false;
    await reader;
    expect(outcomes).toEqual([
      { outcome: "pass", reused: false },
      { outcome: "pass", reused: false },
    ]);
    const final = await readFile(join(created.app, RECORD), "utf8");
    records.delete("");
    expect([...records].every((record) => record === final)).toBe(true);
    expect(await authorize(created.app)).toEqual({
      outcome: "pass",
      reused: true,
    });
  }, 120_000);
});
