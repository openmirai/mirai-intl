import { mkdtemp, readdir, rm } from "node:fs/promises";
import type * as FileSystemPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
  verifyArtifactSet,
  writeArtifactSet,
} from "@openmirai/intl-compiler/internal";
import { expect, it, vi } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const injectedFailure = vi.hoisted(() => ({ nextStagingWrite: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystemPromises>();
  return {
    ...original,
    async writeFile(
      path: Parameters<typeof original.writeFile>[0],
      data: Parameters<typeof original.writeFile>[1],
      options?: Parameters<typeof original.writeFile>[2]
    ) {
      const normalizedPath = String(path).replaceAll("\\", "/");
      if (
        injectedFailure.nextStagingWrite &&
        normalizedPath.includes("/builds/.") &&
        normalizedPath.includes(".tmp/")
      ) {
        injectedFailure.nextStagingWrite = false;
        throw Object.assign(new Error("Injected staging write failure"), {
          code: "EIO",
        });
      }
      return original.writeFile(path, data, options);
    },
  };
});

it("removes failed staging builds without disturbing the selected catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-writer-failure-"));
  try {
    const selectedArtifacts = emitArtifacts(
      compileCatalog(catalogFixtureSource),
      "constants"
    );
    const nextArtifacts = emitArtifacts(
      compileCatalog(catalogFixtureSource),
      "precompiled"
    );
    const selected = await writeArtifactSet(root, selectedArtifacts);

    injectedFailure.nextStagingWrite = true;
    await expect(writeArtifactSet(root, nextArtifacts)).rejects.toThrowError(
      "Injected staging write failure"
    );

    await expect(readdir(join(root, "builds"))).resolves.toEqual([
      selected.contentHash.slice(7),
    ]);
    await expect(verifyArtifactSet(root, selectedArtifacts)).resolves.toEqual({
      ...selected,
      changed: false,
    });

    const published = await writeArtifactSet(root, nextArtifacts);
    await expect(readdir(join(root, "builds"))).resolves.toEqual([
      published.contentHash.slice(7),
    ]);
    await expect(verifyArtifactSet(root, nextArtifacts)).resolves.toEqual({
      ...published,
      changed: false,
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
