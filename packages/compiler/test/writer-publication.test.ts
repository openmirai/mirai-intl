import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  compileCatalog,
  emitArtifacts,
  verifyArtifactSet,
  writeArtifactSet,
} from "@openmirai/intl-compiler/internal";
import type { PublicationState } from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const states: ReadonlyArray<PublicationState> = [
  "PREPARED",
  "STAGED_DURABLE",
  "PAYLOAD_INSTALLED",
  "SELECTORS_INSTALLED",
  "RECEIPT_INSTALLED",
  "POINTER_COMMITTED",
  "VALIDATED",
];

function fixtureArtifacts() {
  return emitArtifacts(compileCatalog(catalogFixtureSource), "constants");
}

describe("crash-safe catalog publication", () => {
  it.each(states)(
    "resumes an exact interrupted %s publication",
    async (state) => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
      const artifacts = fixtureArtifacts();
      let injected = false;
      try {
        await expect(
          writeArtifactSet(root, artifacts, undefined, {
            publicationHooks: {
              afterState(observed) {
                if (!injected && observed === state) {
                  injected = true;
                  throw new Error(`Injected ${state} interruption`);
                }
              },
            },
          })
        ).rejects.toThrowError(`Injected ${state} interruption`);

        const recovered = await writeArtifactSet(root, artifacts);
        await expect(verifyArtifactSet(root, artifacts)).resolves.toEqual({
          ...recovered,
          changed: false,
        });
        await expect(
          readdir(join(root, ".catalog-publication"))
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  );

  it("recovers after the exact previous payload was removed before journal cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
    try {
      const previousArtifacts = fixtureArtifacts();
      const nextArtifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "precompiled"
      );
      const previous = await writeArtifactSet(root, previousArtifacts);
      let interrupted = false;
      await expect(
        writeArtifactSet(root, nextArtifacts, undefined, {
          publicationHooks: {
            afterPreviousPayloadRemoval() {
              if (!interrupted) {
                interrupted = true;
                throw new Error("Injected post-removal interruption");
              }
            },
          },
        })
      ).rejects.toThrowError("Injected post-removal interruption");
      await expect(readdir(join(root, "builds"))).resolves.not.toContain(
        basename(previous.directory)
      );

      const recovered = await writeArtifactSet(root, nextArtifacts);
      await expect(verifyArtifactSet(root, nextArtifacts)).resolves.toEqual({
        ...recovered,
        changed: false,
      });
      await expect(
        readdir(join(root, ".catalog-publication"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a traversal previousDirectory in an otherwise canonical journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
    try {
      const previousArtifacts = fixtureArtifacts();
      const nextArtifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "precompiled"
      );
      await writeArtifactSet(root, previousArtifacts);
      await expect(
        writeArtifactSet(root, nextArtifacts, undefined, {
          publicationHooks: {
            afterState(state) {
              if (state === "VALIDATED") {
                throw new Error("Injected validated interruption");
              }
            },
          },
        })
      ).rejects.toThrowError("Injected validated interruption");
      const journalPath = join(root, ".catalog-publication", "journal.v1.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(
        journalPath,
        `${JSON.stringify({
          ...journal,
          previousDirectory: "builds/../outside",
        })}\n`,
        "utf8"
      );

      await expect(writeArtifactSet(root, nextArtifacts)).rejects.toThrowError(
        /journal|confined|malformed/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects a changed snapshot at the pre-install mutation barrier", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
    try {
      const artifacts = fixtureArtifacts();
      await expect(
        writeArtifactSet(root, artifacts, undefined, {
          beforePayloadInstall(snapshot) {
            return {
              ...snapshot,
              generationInputHash:
                "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            };
          },
        })
      ).rejects.toThrowError(/inconsistent|changed/u);
      await expect(readFile(join(root, "current.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("publishes a canonical receipt whose manifest contains payload files only", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
    try {
      const artifacts = fixtureArtifacts();
      const written = await writeArtifactSet(root, artifacts);
      const receiptSource = await readFile(
        join(root, "catalog-generation-receipt.v1.json"),
        "utf8"
      );
      const receipt = JSON.parse(receiptSource) as {
        abi: { artifactAbi: string; runtimeAbi: string };
        compilerHash: string;
        generationInputHash: string;
        icuHash: string;
        payload: {
          directory: string;
          manifest: {
            entries: ReadonlyArray<{
              hash: string;
              mode: number | null;
              path: string;
              size: number;
            }>;
          };
          manifestHash: string;
        };
        catalogLockHash: string;
        schemaVersion: number;
        stableFacadeHash: string;
      };
      const pointer = JSON.parse(
        await readFile(join(root, "current.json"), "utf8")
      ) as {
        generationReceiptHash: string;
        schemaVersion: number;
      };
      const lock = JSON.parse(
        await readFile(join(root, "catalog.lock.json"), "utf8")
      ) as typeof pointer;

      expect(receipt).toMatchObject({
        payload: {
          directory: `builds/${written.contentHash.slice(7)}`,
        },
        schemaVersion: 1,
      });
      expect(receipt.payload.manifest.entries.map(({ path }) => path)).toEqual(
        Object.keys(artifacts).toSorted()
      );
      expect(
        receipt.payload.manifest.entries.map(({ path }) => path)
      ).not.toEqual(
        expect.arrayContaining([
          "catalog-generation-receipt.v1.json",
          "catalog.lock.json",
          "current.json",
          "index.ts",
        ])
      );
      expect(receipt.payload.manifest.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mode: null,
            size: expect.any(Number),
          }),
        ])
      );
      expect(pointer).toMatchObject({
        generationReceiptHash: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
        schemaVersion: 2,
      });
      expect(lock).toMatchObject({
        contentHash: written.contentHash,
        directory: `builds/${written.contentHash.slice(7)}`,
        schemaVersion: 2,
      });
      expect(lock).not.toHaveProperty("generationReceiptHash");
      expect(receipt.catalogLockHash).toMatch(/^sha256:[\da-f]{64}$/u);
      expect(receipt.stableFacadeHash).toMatch(/^sha256:[\da-f]{64}$/u);
      expect(
        (await readFile(join(root, "index.ts"), "utf8")).split("\n")[0]
      ).not.toContain("generationReceiptHash");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(["missing", "malformed"] as const)(
    "reconstructs an independently reproducible %s receipt",
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
      try {
        const artifacts = fixtureArtifacts();
        const first = await writeArtifactSet(root, artifacts);
        const receiptPath = join(root, "catalog-generation-receipt.v1.json");
        if (kind === "missing") {
          await rm(receiptPath);
        } else {
          await writeFile(receiptPath, "{truncated", "utf8");
        }
        await expect(writeArtifactSet(root, artifacts)).resolves.toEqual({
          ...first,
          changed: true,
        });
        await expect(verifyArtifactSet(root, artifacts)).resolves.toMatchObject(
          { changed: false }
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  );

  it.each(["corrupt", "missing", "extra", "symlink"] as const)(
    "hard-fails without healing %s selected payload state",
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
      const external = await mkdtemp(join(tmpdir(), "mirai-intl-external-"));
      try {
        const artifacts = fixtureArtifacts();
        const written = await writeArtifactSet(root, artifacts);
        const target = join(written.directory, "catalog.contract.gen.json");
        if (kind === "corrupt") {
          await writeFile(target, "corrupt\n", "utf8");
        } else if (kind === "missing") {
          await rm(target);
        } else if (kind === "extra") {
          await writeFile(join(written.directory, "unexpected.txt"), "x");
        } else {
          await rm(target);
          const outside = join(external, "outside.txt");
          await writeFile(outside, artifacts["catalog.contract.gen.json"]);
          await symlink(outside, target, "file");
        }
        await expect(writeArtifactSet(root, artifacts)).rejects.toThrowError(
          /does not match|symbolic link/u
        );
      } finally {
        await rm(root, { force: true, recursive: true });
        await rm(external, { force: true, recursive: true });
      }
    }
  );

  it("rejects unexplained payload, staging, journal, and selector state", async () => {
    const artifacts = fixtureArtifacts();
    for (const corruption of [
      "payload",
      "staging",
      "journal",
      "selector",
    ] as const) {
      const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
      try {
        const written = await writeArtifactSet(root, artifacts);
        if (corruption === "payload") {
          await mkdir(join(root, "builds", "unexplained"));
        } else if (corruption === "staging") {
          await mkdir(join(root, ".catalog-publication"));
          await mkdir(join(root, ".catalog-publication", "unknown-stage"));
        } else if (corruption === "journal") {
          await mkdir(join(root, ".catalog-publication"));
          await writeFile(
            join(root, ".catalog-publication", "journal.v1.json"),
            "{bad",
            "utf8"
          );
        } else {
          await writeFile(join(root, "index.ts"), "tampered\n", "utf8");
        }
        await expect(writeArtifactSet(root, artifacts)).rejects.toThrowError(
          /./u
        );
        expect(await readdir(join(root, "builds"))).toContain(
          basename(written.directory)
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });
});
