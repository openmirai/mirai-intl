import { mkdtemp, readdir, rm } from "node:fs/promises";
import type * as FileSystemPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
} from "@openmirai/intl-compiler/internal";
import { expect, it, vi } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";
import {
  verifyArtifactSet,
  writeArtifactSet,
} from "./non-authoritative-writer";

const injectedFailure = vi.hoisted(() => ({ nextStagingWrite: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystemPromises>();
  return {
    ...original,
    async open(...arguments_: Parameters<typeof original.open>) {
      const handle = await original.open(...arguments_);
      const path = arguments_[0];
      const normalizedPath = String(path).replaceAll("\\", "/");
      const stagingPayload =
        normalizedPath.includes("/.catalog-publication/stage-") &&
        normalizedPath.includes("/payload/");
      if (stagingPayload) {
        const writeFile = handle.writeFile.bind(handle);
        handle.writeFile = async (...writeArguments) => {
          if (injectedFailure.nextStagingWrite) {
            injectedFailure.nextStagingWrite = false;
            throw Object.assign(new Error("Injected staging write failure"), {
              code: "EIO",
            });
          }
          return writeFile(...writeArguments);
        };
      }
      return handle;
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
