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
import type {
  CatalogGenerationIdentity,
  PublicationState,
} from "@openmirai/intl-compiler/internal";
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

const identity: CatalogGenerationIdentity = Object.freeze({
  artifactAbi: "artifact-abi:test",
  compilerHash:
    "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  generationInputHash:
    "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  icuHash:
    "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  runtimeAbi: "runtime-abi:test",
});

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
            generationIdentity: identity,
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

        const recovered = await writeArtifactSet(root, artifacts, undefined, {
          generationIdentity: identity,
        });
        await expect(
          verifyArtifactSet(root, artifacts, undefined, {
            generationIdentity: identity,
          })
        ).resolves.toEqual({ ...recovered, changed: false });
        await expect(
          readdir(join(root, ".catalog-publication"))
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  );

  it("publishes a canonical receipt whose manifest contains payload files only", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-publication-"));
    try {
      const artifacts = fixtureArtifacts();
      const written = await writeArtifactSet(root, artifacts, undefined, {
        generationIdentity: identity,
      });
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
          manifest: ReadonlyArray<{ hash: string; path: string }>;
          manifestHash: string;
        };
        schemaVersion: number;
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
        abi: {
          artifactAbi: identity.artifactAbi,
          runtimeAbi: identity.runtimeAbi,
        },
        compilerHash: identity.compilerHash,
        generationInputHash: identity.generationInputHash,
        icuHash: identity.icuHash,
        payload: {
          directory: `builds/${written.contentHash.slice(7)}`,
        },
        schemaVersion: 1,
      });
      expect(receipt.payload.manifest.map(({ path }) => path)).toEqual(
        Object.keys(artifacts).toSorted()
      );
      expect(receipt.payload.manifest.map(({ path }) => path)).not.toEqual(
        expect.arrayContaining([
          "catalog-generation-receipt.v1.json",
          "catalog.lock.json",
          "current.json",
          "index.ts",
        ])
      );
      expect(pointer).toMatchObject({
        generationReceiptHash: expect.stringMatching(/^sha256:[\da-f]{64}$/u),
        schemaVersion: 2,
      });
      expect(lock).toMatchObject(pointer);
      expect(
        (await readFile(join(root, "index.ts"), "utf8")).split("\n")[0]
      ).toContain(pointer.generationReceiptHash);
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
        const first = await writeArtifactSet(root, artifacts, undefined, {
          generationIdentity: identity,
        });
        const receiptPath = join(root, "catalog-generation-receipt.v1.json");
        if (kind === "missing") {
          await rm(receiptPath);
        } else {
          await writeFile(receiptPath, "{truncated", "utf8");
        }
        await expect(
          writeArtifactSet(root, artifacts, undefined, {
            generationIdentity: identity,
          })
        ).resolves.toEqual({ ...first, changed: true });
        await expect(
          verifyArtifactSet(root, artifacts, undefined, {
            generationIdentity: identity,
          })
        ).resolves.toMatchObject({ changed: false });
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
        const written = await writeArtifactSet(root, artifacts, undefined, {
          generationIdentity: identity,
        });
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
        await expect(
          writeArtifactSet(root, artifacts, undefined, {
            generationIdentity: identity,
          })
        ).rejects.toThrowError(/does not match|symbolic link/u);
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
        const written = await writeArtifactSet(root, artifacts, undefined, {
          generationIdentity: identity,
        });
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
        await expect(
          writeArtifactSet(root, artifacts, undefined, {
            generationIdentity: identity,
          })
        ).rejects.toThrowError(/./u);
        expect(await readdir(join(root, "builds"))).toContain(
          basename(written.directory)
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  });
});
