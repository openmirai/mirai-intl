import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
  generatedSourceHeader,
  recoverStalePublicationLock,
  verifyArtifactSet,
  writeArtifactSet,
} from "@openmirai/intl-compiler/internal";
import { describe, expect, it, vi } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

describe("generated artifact verification", () => {
  it("checks immutable files and keeps descriptors private in the stable facade", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
    try {
      const artifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "constants"
      );
      const written = await writeArtifactSet(root, artifacts);
      const relativeDirectory = written.directory.replace(`${root}/`, "");
      const expectedFacade = [
        `// @mirai-intl-selector ${JSON.stringify({ contentHash: written.contentHash, directory: relativeDirectory, schemaVersion: 1 })}`,
        generatedSourceHeader,
        'import { bindFormErrorTranslator, bindFormSchema, bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl-runtime";',
        'import type { ArgumentFreeTextKeysFor, NamespacePaths } from "@openmirai/intl-runtime";',
        `import type { CatalogContract as BoundCatalogContract } from "./${relativeDirectory}/catalog.schema.gen.js";`,
        `export type { CatalogContract } from "./${relativeDirectory}/catalog.schema.gen.js";`,
        `export type { CatalogLocale } from "./${relativeDirectory}/catalog.resources.gen.mjs";`,
        "export type TranslationNamespace = NamespacePaths<BoundCatalogContract>;",
        "export type TranslationKey<Namespace extends TranslationNamespace> = ArgumentFreeTextKeysFor<BoundCatalogContract, Namespace>;",
        "export const createTranslationKey = /* @__PURE__ */ bindTranslationKeyFactory<BoundCatalogContract>();",
        "export const parseTranslationKey = /* @__PURE__ */ bindTranslationKeyParser<BoundCatalogContract>();",
        "export const createFormErrorTranslator = /* @__PURE__ */ bindFormErrorTranslator<BoundCatalogContract>();",
        "export const createFormSchema = /* @__PURE__ */ bindFormSchema<BoundCatalogContract>();",
        `export { catalogManifest } from "./${relativeDirectory}/catalog.manifest.gen.mjs";`,
        `export { isCatalogLocale, loadCatalogResource } from "./${relativeDirectory}/catalog.resources.gen.mjs";`,
        "",
      ].join("\n");

      await expect(readFile(join(root, "index.ts"), "utf8")).resolves.toBe(
        expectedFacade
      );
      await expect(
        readFile(join(root, "index.mjs"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(join(root, "index.d.mts"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(expectedFacade).not.toMatch(
        /\bcatalogTree\b|\bm\d+\b|\br\d+\b|\bmessage_/u
      );
      await expect(verifyArtifactSet(root, artifacts)).resolves.toEqual({
        ...written,
        changed: false,
      });

      const runtimePath = join(written.directory, "catalog.runtime.gen.json");
      await writeFile(runtimePath, "corrupted\n", "utf8");
      await expect(verifyArtifactSet(root, artifacts)).rejects.toThrowError(
        /does not match its destination files/u
      );

      await writeFile(
        runtimePath,
        artifacts["catalog.runtime.gen.json"],
        "utf8"
      );
      await unlink(join(written.directory, "catalog.descriptors.gen.mjs"));
      await expect(verifyArtifactSet(root, artifacts)).rejects.toThrowError(
        /does not match its destination files/u
      );

      await writeFile(
        join(written.directory, "catalog.descriptors.gen.mjs"),
        artifacts["catalog.descriptors.gen.mjs"],
        "utf8"
      );
      await writeFile(
        join(root, "index.ts"),
        'export * from "./builds/tampered/catalog.descriptors.gen.mjs";\n',
        "utf8"
      );
      await expect(verifyArtifactSet(root, artifacts)).rejects.toThrowError(
        /stable facade/u
      );

      await writeFile(join(root, "index.mjs"), expectedFacade, "utf8");
      await expect(verifyArtifactSet(root, artifacts)).rejects.toThrowError(
        /stable facade/u
      );

      await writeFile(
        join(root, "current.json"),
        `${JSON.stringify({
          contentHash: written.contentHash,
          directory: "builds/tampered",
        })}\n`,
        "utf8"
      );
      const repaired = await writeArtifactSet(root, artifacts);
      expect(repaired.changed).toBe(true);
      await expect(
        readFile(join(root, "index.mjs"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(root, "current.json"), "utf8")).resolves.toBe(
        `${JSON.stringify({
          contentHash: written.contentHash,
          directory: relativeDirectory,
        })}\n`
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects descriptor aliases before creating the generated output", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
    const root = join(container, "generated");
    try {
      const artifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "constants"
      );
      await expect(
        writeArtifactSet(root, artifacts, {
          exports: [
            {
              descriptorExport: "message_greeting_morning",
              name: "greetingMorning",
            },
          ],
        })
      ).rejects.toThrowError(/descriptor exports are private/u);
      await expect(readdir(container)).resolves.toEqual([]);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rejects unsafe or accessor artifact entries before creating output", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
    try {
      const artifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "constants"
      );
      const traversalRoot = join(container, "traversal");
      await expect(
        writeArtifactSet(traversalRoot, {
          ...artifacts,
          "../escape.mjs": "unsafe\n",
        })
      ).rejects.toThrowError(/safe flat file name/u);
      await expect(readdir(container)).resolves.toEqual([]);

      const accessorRoot = join(container, "accessor");
      const accessorArtifacts = Object.defineProperty(
        { ...artifacts },
        "catalog.gen.mjs",
        {
          enumerable: true,
          get: () => "unsafe\n",
        }
      );
      await expect(
        writeArtifactSet(accessorRoot, accessorArtifacts)
      ).rejects.toThrowError(/string data property/u);
      await expect(readdir(container)).resolves.toEqual([]);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "rejects a builds-directory symlink before writing outside the output root",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
      const external = await mkdtemp(
        join(tmpdir(), "mirai-intl-writer-external-")
      );
      try {
        const artifacts = emitArtifacts(
          compileCatalog(catalogFixtureSource),
          "constants"
        );
        await symlink(external, join(root, "builds"), "dir");

        await expect(writeArtifactSet(root, artifacts)).rejects.toThrowError(
          /builds directory must not be a symbolic link/u
        );
        await expect(readdir(external)).resolves.toEqual([]);
      } finally {
        await rm(root, { force: true, recursive: true });
        await rm(external, { force: true, recursive: true });
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a content-addressed directory symlink during write and verify",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
      const external = await mkdtemp(
        join(tmpdir(), "mirai-intl-writer-external-")
      );
      try {
        const artifacts = emitArtifacts(
          compileCatalog(catalogFixtureSource),
          "constants"
        );
        const written = await writeArtifactSet(root, artifacts);
        const externalBuild = join(external, basename(written.directory));
        await rename(written.directory, externalBuild);
        await symlink(externalBuild, written.directory, "dir");

        await expect(verifyArtifactSet(root, artifacts)).rejects.toThrowError(
          /artifact directory must not be a symbolic link/u
        );
        await expect(writeArtifactSet(root, artifacts)).rejects.toThrowError(
          /artifact directory must not be a symbolic link/u
        );
      } finally {
        await rm(root, { force: true, recursive: true });
        await rm(external, { force: true, recursive: true });
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects symlinked output roots, pointers, and stable facades",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
      const external = await mkdtemp(
        join(tmpdir(), "mirai-intl-writer-external-")
      );
      const rootAlias = `${root}-alias`;
      try {
        const artifacts = emitArtifacts(
          compileCatalog(catalogFixtureSource),
          "constants"
        );
        await writeArtifactSet(root, artifacts);

        await symlink(root, rootAlias, "dir");
        await expect(
          verifyArtifactSet(rootAlias, artifacts)
        ).rejects.toThrowError(/output root must be a non-symlink directory/u);

        const currentPath = join(root, "current.json");
        const currentContent = await readFile(currentPath, "utf8");
        const externalCurrent = join(external, "current.json");
        await writeFile(externalCurrent, currentContent, "utf8");
        await unlink(currentPath);
        await symlink(externalCurrent, currentPath, "file");
        await expect(verifyArtifactSet(root, artifacts)).rejects.toThrowError(
          /current pointer must not be a symbolic link/u
        );
        await unlink(currentPath);
        await writeFile(currentPath, currentContent, "utf8");

        const facadePath = join(root, "index.ts");
        const facadeContent = await readFile(facadePath, "utf8");
        const externalFacade = join(external, "index.ts");
        await writeFile(externalFacade, facadeContent, "utf8");
        await unlink(facadePath);
        await symlink(externalFacade, facadePath, "file");
        await expect(verifyArtifactSet(root, artifacts)).rejects.toThrowError(
          /stable facade must not be a symbolic link/u
        );
      } finally {
        await rm(rootAlias, { force: true });
        await rm(root, { force: true, recursive: true });
        await rm(external, { force: true, recursive: true });
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects an output root whose parent is replaced by an external symlink",
    async () => {
      const container = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
      const external = await mkdtemp(
        join(tmpdir(), "mirai-intl-writer-external-")
      );
      const parent = join(container, "catalog");
      const root = join(parent, "generated");
      const externalParent = join(external, "catalog");
      try {
        const artifacts = emitArtifacts(
          compileCatalog(catalogFixtureSource),
          "constants"
        );
        await mkdir(parent);
        const expectedCanonicalRoot = join(await realpath(parent), "generated");
        await writeArtifactSet(root, artifacts, undefined, {
          expectedCanonicalRoot,
        });
        await rename(parent, externalParent);
        await symlink(externalParent, parent, "dir");

        await expect(
          verifyArtifactSet(root, artifacts, undefined, {
            expectedCanonicalRoot,
          })
        ).rejects.toThrowError(/canonical path changed/u);
        await expect(
          writeArtifactSet(root, artifacts, undefined, {
            expectedCanonicalRoot,
          })
        ).rejects.toThrowError(/canonical path changed/u);
      } finally {
        await rm(container, { force: true, recursive: true });
        await rm(external, { force: true, recursive: true });
      }
    }
  );

  it("recovers a crashed publisher lock without losing ownership safety", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
    try {
      const artifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "constants"
      );
      await writeFile(
        join(root, ".publish.lock"),
        `${JSON.stringify({
          acquiredAtMs: 0,
          ownerToken: "crashed-owner",
          pid: 999_999_999,
          processStartedAtMs: 0,
          schemaVersion: 1,
        })}\n`,
        "utf8"
      );

      const written = await writeArtifactSet(root, artifacts);
      await expect(verifyArtifactSet(root, artifacts)).resolves.toEqual({
        ...written,
        changed: false,
      });
      await expect(
        readFile(join(root, ".publish.lock"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("preserves an ABA replacement created after stale recovery is claimed", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
    const outputRoot = await realpath(root);
    const lockPath = join(outputRoot, ".publish.lock");
    const recoveryPath = `${lockPath}.recovering`;
    const stale = `${JSON.stringify({
      acquiredAtMs: 0,
      ownerToken: "crashed-owner",
      pid: 999_999_999,
      processStartedAtMs: 0,
      schemaVersion: 1,
    })}\n`;
    const replacement = `${JSON.stringify({
      acquiredAtMs: Date.now(),
      ownerToken: "replacement-owner",
      pid: process.pid,
      processStartedAtMs: 0,
      schemaVersion: 1,
    })}\n`;
    try {
      await writeFile(lockPath, stale, "utf8");

      await expect(
        recoverStalePublicationLock(outputRoot, lockPath, {
          async afterClaim() {
            await rm(lockPath);
            await writeFile(lockPath, replacement, "utf8");
          },
        })
      ).resolves.toBe(false);
      await expect(readFile(lockPath, "utf8")).resolves.toBe(replacement);
      await expect(readFile(recoveryPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(["before-main-removal", "after-main-removal"])(
    "recovers an abandoned recovery claim %s",
    async (crashPoint) => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
      const outputRoot = await realpath(root);
      const lockPath = join(outputRoot, ".publish.lock");
      const recoveryPath = `${lockPath}.recovering`;
      const stale = `${JSON.stringify({
        acquiredAtMs: 0,
        ownerToken: "crashed-owner",
        pid: 999_999_999,
        processStartedAtMs: 0,
        schemaVersion: 1,
      })}\n`;
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now + 10_000);
      try {
        await writeFile(lockPath, stale, "utf8");
        await link(lockPath, recoveryPath);
        if (crashPoint === "after-main-removal") {
          await rm(lockPath);
        }

        const artifacts = emitArtifacts(
          compileCatalog(catalogFixtureSource),
          "constants"
        );
        await expect(writeArtifactSet(root, artifacts)).resolves.toMatchObject({
          contentHash: expect.stringMatching(/^sha256:/u),
        });
        await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(readFile(recoveryPath, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
      } finally {
        clock.mockRestore();
        await rm(root, { force: true, recursive: true });
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a symlinked lock without writing to its outside target",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
      const external = await mkdtemp(
        join(tmpdir(), "mirai-intl-writer-external-")
      );
      const outsideLock = join(external, "outside.lock");
      try {
        const artifacts = emitArtifacts(
          compileCatalog(catalogFixtureSource),
          "constants"
        );
        await writeFile(outsideLock, "outside remains unchanged\n", "utf8");
        await symlink(outsideLock, join(root, ".publish.lock"), "file");

        await expect(writeArtifactSet(root, artifacts)).rejects.toThrowError(
          /publication lock must not be a symbolic link/u
        );
        await expect(readFile(outsideLock, "utf8")).resolves.toBe(
          "outside remains unchanged\n"
        );
      } finally {
        await rm(root, { force: true, recursive: true });
        await rm(external, { force: true, recursive: true });
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a symlinked recovery claim without writing to its outside target",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
      const external = await mkdtemp(
        join(tmpdir(), "mirai-intl-writer-external-")
      );
      const outsideClaim = join(external, "outside-recovery.lock");
      try {
        const artifacts = emitArtifacts(
          compileCatalog(catalogFixtureSource),
          "constants"
        );
        await writeFile(outsideClaim, "outside remains unchanged\n", "utf8");
        await symlink(
          outsideClaim,
          join(root, ".publish.lock.recovering"),
          "file"
        );

        await expect(writeArtifactSet(root, artifacts)).rejects.toThrowError(
          /publication recovery claim must not be a symbolic link/u
        );
        await expect(readFile(outsideClaim, "utf8")).resolves.toBe(
          "outside remains unchanged\n"
        );
      } finally {
        await rm(root, { force: true, recursive: true });
        await rm(external, { force: true, recursive: true });
      }
    }
  );

  it("keeps one complete authoritative build under repeated concurrent publication", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-"));
    try {
      const constants = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "constants"
      );
      const precompiled = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "precompiled"
      );
      const outcomes = await Promise.allSettled(
        Array.from({ length: 20 }, (_, index) =>
          writeArtifactSet(root, index % 2 === 0 ? constants : precompiled)
        )
      );
      const failures = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected"
      );
      expect(failures.map(({ reason }) => String(reason))).toEqual([]);
      const writes = outcomes
        .filter(
          (
            outcome
          ): outcome is PromiseFulfilledResult<
            Awaited<ReturnType<typeof writeArtifactSet>>
          > => outcome.status === "fulfilled"
        )
        .map(({ value }) => value);
      const constantsWrite = writes[0];
      const precompiledWrite = writes[1];
      expect(constantsWrite).toBeDefined();
      expect(precompiledWrite).toBeDefined();
      if (!constantsWrite || !precompiledWrite) {
        throw new Error("Concurrent writer evidence is incomplete");
      }
      const facade = await readFile(join(root, "index.ts"), "utf8");
      const prefix = "// @mirai-intl-selector ";
      const firstLine = facade.slice(0, facade.indexOf("\n"));
      expect(firstLine.startsWith(prefix)).toBe(true);
      const selector = JSON.parse(firstLine.slice(prefix.length)) as {
        contentHash: string;
        directory: string;
      };
      const selected =
        selector.contentHash === constantsWrite.contentHash
          ? { artifacts: constants, write: constantsWrite }
          : { artifacts: precompiled, write: precompiledWrite };

      expect(selector).toMatchObject({
        contentHash: selected.write.contentHash,
        directory: `builds/${selected.write.contentHash.slice(7)}`,
      });
      await expect(
        verifyArtifactSet(root, selected.artifacts)
      ).resolves.toMatchObject({
        changed: false,
        contentHash: selected.write.contentHash,
      });
      await expect(readdir(join(root, "builds"))).resolves.toEqual([
        selected.write.contentHash.slice(7),
      ]);
      expect(
        (await readdir(root)).filter((name) => name.startsWith(".publish"))
      ).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 30_000);
});
