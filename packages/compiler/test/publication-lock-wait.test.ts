import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import type * as FileSystemPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  compileCatalog,
  emitArtifacts,
} from "@openmirai/intl-compiler/internal";
import { beforeEach, expect, it, vi } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";
import {
  verifyArtifactSet,
  writeArtifactSet,
} from "./non-authoritative-writer";

const lockCandidates = vi.hoisted(() => ({ opened: 0 }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof FileSystemPromises>();
  return {
    ...original,
    async open(...arguments_: Parameters<typeof original.open>) {
      if (
        /\.publish\.lock\.[\da-f-]+\.candidate$/u.test(String(arguments_[0]))
      ) {
        lockCandidates.opened += 1;
      }
      return original.open(...arguments_);
    },
  };
});

const constants = emitArtifacts(
  compileCatalog(catalogFixtureSource),
  "constants"
);
const precompiled = emitArtifacts(
  compileCatalog(catalogFixtureSource),
  "precompiled"
);

beforeEach(() => {
  lockCandidates.opened = 0;
});

it("lets publications in one process take turns instead of retrying the file lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-lock-wait-"));
  try {
    const artifactSets = Array.from({ length: 6 }, (_, index) =>
      index % 2 === 0 ? constants : precompiled
    );
    // A publication takes its turn after its own output-root checks, so
    // concurrent calls reach the queue in whatever order those checks finish,
    // not in call order. Each one finishes within its turn, so the order they
    // finish in is the turn order, and the last turn's build is the one left.
    const finished: Array<number> = [];
    const writes = await Promise.all(
      artifactSets.map(async (artifacts, index) => {
        const result = await writeArtifactSet(root, artifacts);
        finished.push(index);
        return result;
      })
    );

    // One lock candidate per publication: a waiting publication never writes,
    // fsyncs and links a candidate while another one holds the lock.
    expect(lockCandidates.opened).toBe(writes.length);
    expect(writes[0]?.contentHash).not.toBe(writes[1]?.contentHash);
    const lastTurn = finished.at(-1);
    const last = lastTurn === undefined ? undefined : writes[lastTurn];
    const lastArtifacts =
      lastTurn === undefined ? undefined : artifactSets[lastTurn];
    if (finished.length !== writes.length || !last || !lastArtifacts) {
      throw new Error("Concurrent writer evidence is incomplete");
    }
    await expect(readdir(join(root, "builds"))).resolves.toEqual([
      last.contentHash.slice(7),
    ]);
    await expect(verifyArtifactSet(root, lastArtifacts)).resolves.toMatchObject(
      {
        changed: false,
        contentHash: last.contentHash,
      }
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}, 60_000);

it("waits for another process's live lock without writing lock candidates", async () => {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-lock-wait-"));
  const lockPath = join(root, ".publish.lock");
  let pending: ReturnType<typeof writeArtifactSet> | undefined;
  try {
    await writeFile(
      lockPath,
      `${JSON.stringify({
        acquiredAtMs: Date.now(),
        ownerToken: randomUUID(),
        pid: process.ppid,
        processStartedAtMs: 0,
        schemaVersion: 1,
      })}\n`
    );
    pending = writeArtifactSet(root, constants);
    await delay(300);

    expect(lockCandidates.opened).toBe(0);

    await rm(lockPath);
    const written = await pending;
    expect(lockCandidates.opened).toBe(1);
    await expect(verifyArtifactSet(root, constants)).resolves.toMatchObject({
      changed: false,
      contentHash: written.contentHash,
    });
  } finally {
    await rm(lockPath, { force: true });
    await pending?.catch(() => undefined);
    await rm(root, { force: true, recursive: true });
  }
}, 60_000);
