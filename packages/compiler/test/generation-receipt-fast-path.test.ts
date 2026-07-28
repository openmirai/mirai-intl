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
import type { PublicationState } from "../src/writer";
import type ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const instrumentation = vi.hoisted(() => ({
  compileCalls: 0,
  emitCalls: 0,
  interruptAfterState: undefined as PublicationState | undefined,
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
        publicationHooks: {
          ...options?.publicationHooks,
          async afterState(state) {
            await options?.publicationHooks?.afterState?.(state);
            if (instrumentation.interruptAfterState === state) {
              instrumentation.interruptAfterState = undefined;
              throw new Error(`Injected lifecycle ${state} interruption`);
            }
          },
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
    instrumentation.interruptAfterState = undefined;
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

  it("invalidates a cached receipt when a nearer workspace lock appears", async () => {
    const { container, root } = await conventionApp();
    try {
      await writeFile(
        join(container, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n",
        "utf8"
      );
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: false,
      });

      await writeFile(
        join(root, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\npackages: {}\n",
        "utf8"
      );
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: false,
      });
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it.each([
    "PREPARED",
    "STAGED_DURABLE",
    "PAYLOAD_INSTALLED",
    "SELECTORS_INSTALLED",
    "RECEIPT_INSTALLED",
    "POINTER_COMMITTED",
    "VALIDATED",
  ] satisfies ReadonlyArray<PublicationState>)(
    "delegates an exact interrupted %s journal to writer recovery",
    async (state) => {
      const { container, root } = await conventionApp();
      try {
        instrumentation.interruptAfterState = state;
        await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
          `Injected lifecycle ${state} interruption`
        );

        await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
          changed: true,
        });
        await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
          changed: false,
        });
      } finally {
        await rm(container, { force: true, recursive: true });
      }
    },
    60_000
  );

  it("hard-fails a malformed active publication journal", async () => {
    const { container, root } = await conventionApp();
    try {
      instrumentation.interruptAfterState = "PREPARED";
      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
        "Injected lifecycle PREPARED interruption"
      );
      await writeFile(
        join(root, "src/i18n/generated/.catalog-publication/journal.v1.json"),
        "{malformed",
        "utf8"
      );

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(/./u);
      await expect(
        readFile(join(root, "src/i18n/generated/current.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("reconstructs a missing receipt only from independently matching state", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      const generated = join(root, "src/i18n/generated");
      const receipt = join(generated, "catalog-generation-receipt.v1.json");
      const pointer = JSON.parse(
        await readFile(join(generated, "current.json"), "utf8")
      ) as { directory: string };
      const payload = join(generated, pointer.directory);
      const before = {
        facade: await readFile(join(generated, "index.ts"), "utf8"),
        lock: await readFile(join(generated, "catalog.lock.json"), "utf8"),
        payload: await readFile(
          join(payload, "catalog.contract.gen.json"),
          "utf8"
        ),
      };
      await rm(receipt);

      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
      await expect(readFile(receipt, "utf8")).resolves.toMatch(
        /"schemaVersion":1/u
      );
      await expect(readFile(join(generated, "index.ts"), "utf8")).resolves.toBe(
        before.facade
      );
      await expect(
        readFile(join(generated, "catalog.lock.json"), "utf8")
      ).resolves.toBe(before.lock);
      await expect(
        readFile(join(payload, "catalog.contract.gen.json"), "utf8")
      ).resolves.toBe(before.payload);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it.each(["payload", "selector", "input"] as const)(
    "refuses missing-receipt reconstruction after %s mismatch",
    async (kind) => {
      const { container, root } = await conventionApp();
      try {
        await ensureMiraiIntlCatalog({ root });
        const generated = join(root, "src/i18n/generated");
        const receipt = join(generated, "catalog-generation-receipt.v1.json");
        const pointer = JSON.parse(
          await readFile(join(generated, "current.json"), "utf8")
        ) as { directory: string };
        await rm(receipt);
        if (kind === "payload") {
          await writeFile(
            join(generated, pointer.directory, "catalog.contract.gen.json"),
            "tampered\n",
            "utf8"
          );
        } else if (kind === "selector") {
          await writeFile(join(generated, "index.ts"), "tampered\n", "utf8");
        } else {
          const locale = join(root, "src/locales/global/en.json");
          const value = JSON.parse(await readFile(locale, "utf8")) as Record<
            string,
            unknown
          >;
          await writeFile(
            locale,
            `${JSON.stringify(
              { ...value, appName: "Changed input {edition}" },
              null,
              2
            )}\n`,
            "utf8"
          );
        }

        await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(/./u);
        await expect(readFile(receipt, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        await rm(container, { force: true, recursive: true });
      }
    },
    60_000
  );

  it("reconstructs a completely missing selected payload from matching inputs", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      const generated = join(root, "src/i18n/generated");
      const pointer = JSON.parse(
        await readFile(join(generated, "current.json"), "utf8")
      ) as { directory: string };
      const payload = join(generated, pointer.directory);
      await rm(payload, { recursive: true });

      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
      await expect(
        readFile(join(payload, "catalog.contract.gen.json"), "utf8")
      ).resolves.toMatch(/"schemaVersion"/u);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("hard-fails a partially missing selected payload", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      const generated = join(root, "src/i18n/generated");
      const pointer = JSON.parse(
        await readFile(join(generated, "current.json"), "utf8")
      ) as { directory: string };
      const missingFile = join(
        generated,
        pointer.directory,
        "catalog.contract.gen.json"
      );
      await rm(missingFile);

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
        "Generated catalog payload does not match its manifest"
      );
      await expect(readFile(missingFile, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("does not reconstruct a missing selected payload from changed inputs", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      const generated = join(root, "src/i18n/generated");
      const pointer = JSON.parse(
        await readFile(join(generated, "current.json"), "utf8")
      ) as { directory: string };
      const payload = join(generated, pointer.directory);
      await rm(payload, { recursive: true });
      const locale = join(root, "src/locales/global/en.json");
      const value = JSON.parse(await readFile(locale, "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(
        locale,
        `${JSON.stringify(
          { ...value, appName: "Changed input {edition}" },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(/./u);
      await expect(readFile(payload, "utf8")).rejects.toMatchObject({
        code: expect.stringMatching(/EISDIR|ENOENT/u),
      });
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
      await expect(
        readFile(
          join(root, "src/i18n/generated/.catalog-publication/journal.v1.json"),
          "utf8"
        )
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: false,
      });
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
      await expect(
        readFile(join(root, "src/i18n/generated/current.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: false,
      });
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it("restores the previous committed generation after late input mutation", async () => {
    const { container, root } = await conventionApp();
    try {
      await ensureMiraiIntlCatalog({ root });
      const currentPath = join(root, "src/i18n/generated/current.json");
      const previousPointer = await readFile(currentPath, "utf8");
      const locale = join(root, "src/locales/global/en.json");
      const original = JSON.parse(await readFile(locale, "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(
        locale,
        `${JSON.stringify(
          { ...original, appName: "First change {edition}" },
          null,
          2
        )}\n`,
        "utf8"
      );
      instrumentation.mutateAfterPointerCommit = async () => {
        await writeFile(
          locale,
          `${JSON.stringify(
            { ...original, appName: "Second change {edition}" },
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
      await expect(readFile(currentPath, "utf8")).resolves.toBe(
        previousPointer
      );
      await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
        changed: true,
      });
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 60_000);

  it.each([
    "ROLLBACK_REQUIRED",
    "ROLLBACK_POINTER_REMOVED",
    "ROLLBACK_CONTROLS_RESTORED",
  ] satisfies ReadonlyArray<PublicationState>)(
    "resumes durable %s recovery after interruption",
    async (state) => {
      const { container, root } = await conventionApp();
      try {
        await ensureMiraiIntlCatalog({ root });
        const locale = join(root, "src/locales/global/en.json");
        const original = JSON.parse(await readFile(locale, "utf8")) as Record<
          string,
          unknown
        >;
        await writeFile(
          locale,
          `${JSON.stringify(
            { ...original, appName: "First change {edition}" },
            null,
            2
          )}\n`,
          "utf8"
        );
        instrumentation.mutateAfterPointerCommit = async () => {
          await writeFile(
            locale,
            `${JSON.stringify(
              { ...original, appName: "Second change {edition}" },
              null,
              2
            )}\n`,
            "utf8"
          );
          instrumentation.mutateAfterPointerCommit = undefined;
        };
        instrumentation.interruptAfterState = state;

        await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
          `Injected lifecycle ${state} interruption`
        );
        await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
          changed: true,
        });
        await expect(ensureMiraiIntlCatalog({ root })).resolves.toMatchObject({
          changed: false,
        });
      } finally {
        await rm(container, { force: true, recursive: true });
      }
    },
    60_000
  );

  it.each(["missing", "tampered"] as const)(
    "hard-fails a %s bound previous-control backup",
    async (kind) => {
      const { container, root } = await conventionApp();
      try {
        await ensureMiraiIntlCatalog({ root });
        const locale = join(root, "src/locales/global/en.json");
        const original = JSON.parse(await readFile(locale, "utf8")) as Record<
          string,
          unknown
        >;
        await writeFile(
          locale,
          `${JSON.stringify(
            { ...original, appName: "First change {edition}" },
            null,
            2
          )}\n`,
          "utf8"
        );
        instrumentation.mutateAfterPointerCommit = async () => {
          await writeFile(
            locale,
            `${JSON.stringify(
              { ...original, appName: "Second change {edition}" },
              null,
              2
            )}\n`,
            "utf8"
          );
          instrumentation.mutateAfterPointerCommit = undefined;
        };
        instrumentation.interruptAfterState = "ROLLBACK_REQUIRED";
        await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
          "Injected lifecycle ROLLBACK_REQUIRED interruption"
        );
        const publication = join(
          root,
          "src/i18n/generated/.catalog-publication"
        );
        const journal = JSON.parse(
          await readFile(join(publication, "journal.v1.json"), "utf8")
        ) as { stageDirectory: string };
        const backup = join(
          publication,
          journal.stageDirectory,
          "previous-controls/current.json"
        );
        if (kind === "missing") {
          await rm(backup);
        } else {
          await writeFile(backup, "tampered\n", "utf8");
        }

        await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
          /backup|missing|identity/u
        );
      } finally {
        await rm(container, { force: true, recursive: true });
      }
    },
    60_000
  );

  it.each(["missing", "tampered", "added"] as const)(
    "rejects a %s backup before restoring POINTER_REMOVED controls",
    async (kind) => {
      const { container, root } = await conventionApp();
      try {
        await ensureMiraiIntlCatalog({ root });
        const generated = join(root, "src/i18n/generated");
        const locale = join(root, "src/locales/global/en.json");
        const original = JSON.parse(await readFile(locale, "utf8")) as Record<
          string,
          unknown
        >;
        await writeFile(
          locale,
          `${JSON.stringify(
            { ...original, appName: "First change {edition}" },
            null,
            2
          )}\n`,
          "utf8"
        );
        instrumentation.mutateAfterPointerCommit = async () => {
          await writeFile(
            locale,
            `${JSON.stringify(
              { ...original, appName: "Second change {edition}" },
              null,
              2
            )}\n`,
            "utf8"
          );
          instrumentation.mutateAfterPointerCommit = undefined;
        };
        instrumentation.interruptAfterState = "ROLLBACK_POINTER_REMOVED";
        await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
          "Injected lifecycle ROLLBACK_POINTER_REMOVED interruption"
        );
        const publication = join(generated, ".catalog-publication");
        const journal = JSON.parse(
          await readFile(join(publication, "journal.v1.json"), "utf8")
        ) as { stageDirectory: string };
        const previousControls = join(
          publication,
          journal.stageDirectory,
          "previous-controls"
        );
        const before = {
          facade: await readFile(join(generated, "index.ts"), "utf8"),
          lock: await readFile(join(generated, "catalog.lock.json"), "utf8"),
          receipt: await readFile(
            join(generated, "catalog-generation-receipt.v1.json"),
            "utf8"
          ),
        };
        if (kind === "missing") {
          await rm(join(previousControls, "current.json"));
        } else if (kind === "tampered") {
          await writeFile(
            join(previousControls, "current.json"),
            "tampered\n",
            "utf8"
          );
        } else {
          await writeFile(
            join(previousControls, "unexpected.json"),
            "{}\n",
            "utf8"
          );
        }

        await expect(ensureMiraiIntlCatalog({ root })).rejects.toThrow(
          /backup|missing|identity|incomplete/u
        );
        await expect(
          readFile(join(generated, "current.json"), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
        await expect(
          readFile(join(generated, "index.ts"), "utf8")
        ).resolves.toBe(before.facade);
        await expect(
          readFile(join(generated, "catalog.lock.json"), "utf8")
        ).resolves.toBe(before.lock);
        await expect(
          readFile(
            join(generated, "catalog-generation-receipt.v1.json"),
            "utf8"
          )
        ).resolves.toBe(before.receipt);
      } finally {
        await rm(container, { force: true, recursive: true });
      }
    },
    60_000
  );

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
