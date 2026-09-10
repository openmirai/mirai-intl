import { expect, it } from "vitest";
import {
  VerificationReadScope,
  settleVerificationChecks,
} from "../src/verification-reads";

it("shares the observed hash, never an expected-hash verdict, within one phase", async () => {
  let reads = 0;
  const read = async () => {
    reads++;
    return "sha256:observed" as const;
  };
  const scope = new VerificationReadScope(read, 2);
  const hashes = await Promise.all([
    scope.hash("a"),
    scope.hash("a"),
    scope.hash("a"),
  ]);
  expect(reads).toBe(1);
  expect(hashes).toEqual(Array(3).fill("sha256:observed"));
  await new VerificationReadScope(read, 2).hash("a");
  expect(reads).toBe(2);
});

it("bounds active reads and drains failures before rejecting the phase", async () => {
  let active = 0;
  let peak = 0;
  let completed = 0;
  const scope = new VerificationReadScope(async (path) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    completed++;
    if (path === "0") {
      throw new Error("unreadable");
    }
    return "sha256:observed";
  }, 2);
  await expect(
    settleVerificationChecks(
      Array.from({ length: 9 }, (_, i) => scope.hash(String(i)))
    )
  ).rejects.toThrow(/unreadable/u);
  expect({ active, peak, completed }).toEqual({
    active: 0,
    peak: 2,
    completed: 9,
  });
});

it("rejects invalid concurrency limits", () => {
  for (const limit of [0, -1, 1.5, Infinity, NaN, 65]) {
    expect(
      () => new VerificationReadScope(async () => "sha256:observed", limit)
    ).toThrow(/limit/u);
  }
});

it("retains stale and filesystem failures instead of downgrading the latter", async () => {
  const stale = new Error("source hash is stale");
  const denied = Object.assign(new Error("read denied"), { code: "EACCES" });
  const scope = new VerificationReadScope(async (path) => {
    throw path === "stale.ts" ? stale : denied;
  }, 1);
  const failure = await settleVerificationChecks([
    scope.hash("stale.ts"),
    scope.hash("unreadable.ts"),
  ]).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) {
    throw new Error("Both failures must survive the observation barrier");
  }
  expect(failure.errors).toEqual([stale, denied]);
  expect(failure.errors[1]).toBe(denied);
});

it("drains queued and nested observations before exposing mixed failures", async () => {
  const stale = new Error("classifier probe is stale");
  const io = Object.assign(new Error("filesystem read failed"), {
    code: "EIO",
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completed: Array<string> = [];
  const scope = new VerificationReadScope(async (path) => {
    if (path === "slow") {
      await gate;
      completed.push(path);
      throw io;
    }
    completed.push(path);
    return "sha256:observed";
  }, 1);
  let settled = false;
  const result = settleVerificationChecks([
    Promise.reject(stale),
    settleVerificationChecks([scope.hash("slow"), scope.hash("queued")]),
  ]).catch((error: unknown) => {
    settled = true;
    return error;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    expect(completed).toEqual([]);
  } finally {
    release();
  }
  const failure = await result;
  expect(completed).toEqual(["slow", "queued"]);
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) {
    throw new Error("Nested filesystem failures must remain observable");
  }
  expect(failure.errors).toEqual([stale, io]);
});
