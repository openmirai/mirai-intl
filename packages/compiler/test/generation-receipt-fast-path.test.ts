import {
  cp,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type * as Compile from "../src/compile";
import type * as Emit from "../src/emit";
import type * as Writer from "../src/writer";
import type ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const instrumentation = vi.hoisted(() => ({
  compileCalls: 0,
  emitCalls: 0,
  mutateAfterPointerCommit: undefined as undefined | (() => Promise<void>),
  mutateBeforeInstall: undefined as undefined | (() => Promise<void>),
  programs: 0,
}));

vi.mock("typescript", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const compiler = Reflect.get(actual, "default") as typeof ts;
  const instrumented = Object.create(compiler) as typeof compiler;
  Object.defineProperty(instrumented, "createProgram", {
    value: (...arguments_: Parameters<typeof compiler.createProgram>) => {
      instrumentation.programs += 1;
      return compiler.createProgram(...arguments_);
    },
  });
  return { ...actual, default: instrumented };
});

vi.mock("../src/compile", async (importOriginal) => {
  const actual = await importOriginal<typeof Compile>();
  return {
    ...actual,
    compileCatalog: (
      ...arguments_: Parameters<typeof actual.compileCatalog>
    ) => {
      instrumentation.compileCalls += 1;
      return actual.compileCatalog(...arguments_);
    },
  };
});

vi.mock("../src/emit", async (importOriginal) => {
  const actual = await importOriginal<typeof Emit>();
  return {
    ...actual,
    emitArtifacts: (...arguments_: Parameters<typeof actual.emitArtifacts>) => {
      instrumentation.emitCalls += 1;
      return actual.emitArtifacts(...arguments_);
    },
  };
});

vi.mock("../src/writer", async (importOriginal) => {
  const actual = await importOriginal<typeof Writer>();
  return {
    ...actual,
    writeArtifactSet: (
      ...[root, artifacts, facade, options]: Parameters<
        typeof actual.writeArtifactSet
      >
    ) =>
      actual.writeArtifactSet(root, artifacts, facade, {
        ...options,
        afterPointerCommit: async (snapshot) => {
          await instrumentation.mutateAfterPointerCommit?.();
          return (await options?.afterPointerCommit?.(snapshot)) ?? snapshot;
        },
        beforePayloadInstall: async (snapshot) => {
          await instrumentation.mutateBeforeInstall?.();
          return (await options?.beforePayloadInstall?.(snapshot)) ?? snapshot;
        },
      }),
  };
});

import { compileCatalog } from "../src/compile";
import { emitArtifacts } from "../src/emit";
import { ensureMiraiIntlCatalog } from "../src/lifecycle";
import { writeArtifactSet } from "./non-authoritative-writer";

const dashboardFixture = resolve(
  import.meta.dirname,
  "../../../fixtures/convention/dashboard"
);

async function conventionApp(): Promise<{
  container: string;
  root: string;
}> {
  const container = await mkdtemp(join(tmpdir(), "mirai-intl-generation-"));
  const root = join(container, "dashboard");
  await cp(dashboardFixture, root, { recursive: true });
  return { container, root };
}

describe("catalog generation receipt fast path", () => {
  beforeEach(() => {
    instrumentation.compileCalls = 0;
    instrumentation.emitCalls = 0;
    instrumentation.mutateAfterPointerCommit = undefined;
    instrumentation.mutateBeforeInstall = undefined;
    instrumentation.programs = 0;
  });

  it("reuses a valid unchanged receipt without compiling or emitting", async () => {
    const { container, root } = await conventionApp();
    try {
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
      expect(instrumentation.compileCalls).toBe(1);
      expect(instrumentation.emitCalls).toBe(1);

      instrumentation.compileCalls = 0;
      instrumentation.emitCalls = 0;
      instrumentation.programs = 0;
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: false,
      });
      expect(instrumentation.compileCalls).toBe(0);
      expect(instrumentation.emitCalls).toBe(0);
      expect(instrumentation.programs).toBe(0);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects source mutation at the writer mutation barrier", async () => {
    const { container, root } = await conventionApp();
    try {
      instrumentation.mutateBeforeInstall = async () => {
        const locale = join(root, "src/locales/global/en.json");
        const value = JSON.parse(await readFile(locale, "utf8")) as Record<
          string,
          unknown
        >;
        await writeFile(
          locale,
          `${JSON.stringify(
            { ...value, appName: "Mutated {edition}" },
            null,
            2
          )}\n`,
          "utf8"
        );
        instrumentation.mutateBeforeInstall = undefined;
      };

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
        "Catalog generation inputs changed before payload installation"
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("fails closed when generation inputs mutate after pointer commit", async () => {
    const { container, root } = await conventionApp();
    try {
      instrumentation.mutateAfterPointerCommit = async () => {
        const locale = join(root, "src/locales/global/en.json");
        const value = JSON.parse(await readFile(locale, "utf8")) as Record<
          string,
          unknown
        >;
        await writeFile(
          locale,
          `${JSON.stringify(
            { ...value, appName: "Late mutation {edition}" },
            null,
            2
          )}\n`,
          "utf8"
        );
        instrumentation.mutateAfterPointerCommit = undefined;
      };

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
        "Catalog generation inputs changed after pointer commit"
      );
      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(/./u);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects generated roots reached through an ancestor symlink", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      const i18n = join(root, "src/i18n");
      const relocated = join(root, "relocated-i18n");
      await rename(i18n, relocated);
      await symlink(relocated, i18n, "dir");

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
        /symbolic-link ancestors/u
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects absolute generated-directory overrides", async () => {
    const { container, root } = await conventionApp();
    try {
      expect(() =>
        ensureMiraiIntlCatalog({
          generatedDirectory: join(container, "outside"),
          root,
        })
      ).toThrow("Generated catalog directory must be relative");
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rejects a valid receipt loaded from a different configured output root", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      await cp(
        join(root, "src/i18n/generated"),
        join(root, "src/i18n/alternate"),
        { recursive: true }
      );

      await expect(
        ensureMiraiIntlCatalog({
          generatedDirectory: "src/i18n/alternate",
          root,
        })
      ).rejects.toThrow(
        "Generated catalog root does not match the loaded catalog output root"
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("never accepts a non-authoritative test receipt for lifecycle reuse", async () => {
    const { container, root } = await conventionApp();
    try {
      await writeArtifactSet(
        join(root, "src/i18n/generated"),
        emitArtifacts(compileCatalog(catalogFixtureSource), "constants")
      );

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
        "Non-authoritative test generation receipt cannot be reused in production"
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("hard-fails corrupt output instead of regenerating changed inputs", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      await writeFile(
        join(root, "src/i18n/generated/index.ts"),
        "export {};\n",
        "utf8"
      );
      await writeFile(
        join(root, "src/locales/global/en.json"),
        `${JSON.stringify({ appName: "Changed" })}\n`,
        "utf8"
      );

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
        "Generated stable facade is corrupt"
      );
      expect(instrumentation.compileCalls).toBe(1);
      expect(instrumentation.emitCalls).toBe(1);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);
});
