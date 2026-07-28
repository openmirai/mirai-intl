import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EnsureWorker } from "../benchmarks/authorization-ensure-client";
import type {
  RawBlock,
  WorkloadIdentity,
} from "../benchmarks/authorization-methodology";
import {
  acceptanceEligibility,
  assertDistinctReferenceRoles,
  assertFrozenProductionCandidate,
  assertTimedWorkflowShape,
  assertWorkloadEquivalent,
  blockDeltaPercent,
  childArgumentVector,
  completeContractPass,
  engineOrder,
  EVALUATOR_SOURCE_PATHS,
  FROZEN_PRODUCTION_CANDIDATE,
  pairedBlockStatistics,
  PERFORMANCE_REFERENCE,
  performanceGate,
  productionCandidateIdentity,
  rawStatistics,
  releaseAcceptance,
  rssPairOrder,
  rssSamplingSchedule,
  rssWorkflowPeak,
  SEMANTIC_REFERENCE,
} from "../benchmarks/authorization-methodology";

const temporary: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

function workload(overrides: Partial<WorkloadIdentity> = {}): WorkloadIdentity {
  return {
    checkerProjects: 0,
    eligibleSourceLedgerHash: "source-ledger",
    eligibleSources: 2,
    fixtureHash: "fixture",
    operation: "ensure",
    outcome: { changed: false, diagnosticsHash: "diagnostics", success: true },
    ownerProjects: 1,
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: 2,
    ...overrides,
  };
}

function block(
  index: number,
  reference: [number, number],
  candidate: [number, number]
): RawBlock {
  const order = engineOrder(index);
  const queues = {
    candidate: [...candidate],
    reference: [...reference],
  };
  const next = (engine: (typeof order)[number]): number => {
    const value = queues[engine].shift();
    if (value === undefined) {
      throw new Error(`Missing ${engine} block timing`);
    }
    return value;
  };
  return {
    cells: order.map((engine) => ({
      engine,
      milliseconds: next(engine),
    })) as unknown as RawBlock["cells"],
    index,
    order: index % 2 === 0 ? "ABBA" : "BAAB",
  };
}

describe("authorization evaluator methodology", () => {
  it("separates immutable semantic and performance reference roles", () => {
    expect(() =>
      assertDistinctReferenceRoles(SEMANTIC_REFERENCE, PERFORMANCE_REFERENCE)
    ).not.toThrow();
    expect(() =>
      assertDistinctReferenceRoles(SEMANTIC_REFERENCE, {
        ...PERFORMANCE_REFERENCE,
        commit: SEMANTIC_REFERENCE.commit,
      })
    ).toThrow(/distinct/u);
  });

  it("accepts V1/V2 schema differences but rejects workload drift", () => {
    expect(() =>
      assertWorkloadEquivalent(workload(), workload())
    ).not.toThrow();
    expect(() =>
      assertWorkloadEquivalent(
        workload(),
        workload({ semanticFilesAnalyzed: 1 })
      )
    ).toThrow(/not equivalent/u);
    expect(() =>
      assertWorkloadEquivalent(
        workload(),
        workload({ operation: "authorization" })
      )
    ).toThrow(/not equivalent/u);
    expect(() =>
      assertWorkloadEquivalent(
        workload(),
        workload({ eligibleSourceLedgerHash: "different-ledger" })
      )
    ).toThrow(/not equivalent/u);
    expect(() =>
      assertWorkloadEquivalent(workload(), workload({ eligibleSources: 1 }))
    ).toThrow(/not equivalent/u);
  });

  it("retains four cells and uses the fixed two-cell median formula", () => {
    const sample = block(0, [100, 300], [50, 150]);
    expect(sample.cells).toHaveLength(4);
    expect(blockDeltaPercent(sample)).toBe(-50);
  });

  it("uses exactly one bootstrap delta per measured block", () => {
    const blocks = Array.from({ length: 30 }, (_, index) =>
      block(index, [100 + index, 102 + index], [50 + index, 52 + index])
    );
    const result = pairedBlockStatistics(blocks, 42);
    expect(result.bootstrapN).toBe(30);
    expect(result.rawBlocks).toHaveLength(30);
    expect(result.rawPairedDeltasPercent).toHaveLength(30);
  });

  it("uses raw untrimmed median p95 and CV without a relative-p95 gate", () => {
    const baseline = rawStatistics([100, 100, 100, 1_000]);
    const candidate = rawStatistics([20, 20, 20, 500]);
    const gate = performanceGate({
      absoluteMedianLimit: 400,
      absoluteP95Limit: 600,
      baseline,
      candidate,
      confidenceUpperPercent: -1,
      relativeMedianLimit: 0.3,
    });
    expect(candidate.p95Milliseconds).toBe(500);
    expect(gate).not.toHaveProperty("relativeP95Pass");
    expect(gate.pass).toBe(true);
  });

  it("recomposes the frozen schema-v5 evidence without relabeling it", async () => {
    const fixture = JSON.parse(
      await readFile(
        join(
          import.meta.dirname,
          "fixtures/authorization-schema-v5-acceptance.json"
        ),
        "utf8"
      )
    ) as Readonly<{
      reportSha256: string;
      scenarios: Readonly<
        Record<
          string,
          Readonly<{
            absoluteMedianLimit: number;
            absoluteP95Limit: number;
            baseline: ReturnType<typeof rawStatistics>;
            candidate: ReturnType<typeof rawStatistics>;
            confidenceUpperPercent: number;
            expectedContractPass: boolean;
            expectedLegacyCompositePass: boolean;
            expectedStabilityPass: boolean;
            relativeMedianLimit: number;
          }>
        >
      >;
    }>;
    expect(fixture.reportSha256).toBe(
      "sha256:4b9d3d01b71992ad701e0ad454b68528f33a2458900cae79d985341ca1a61dc1"
    );
    const before = JSON.stringify(fixture);
    for (const scenario of Object.values(fixture.scenarios)) {
      const gate = performanceGate({
        absoluteMedianLimit: scenario.absoluteMedianLimit,
        absoluteP95Limit: scenario.absoluteP95Limit,
        baseline: scenario.baseline,
        candidate: scenario.candidate,
        confidenceUpperPercent: scenario.confidenceUpperPercent,
        relativeMedianLimit: scenario.relativeMedianLimit,
      });
      expect(gate.pass).toBe(scenario.expectedLegacyCompositePass);
      expect(completeContractPass(gate)).toBe(scenario.expectedContractPass);
      expect(
        scenario.baseline.coefficientOfVariation <= 0.1 &&
          scenario.candidate.coefficientOfVariation <= 0.1
      ).toBe(scenario.expectedStabilityPass);
    }
    expect(JSON.stringify(fixture)).toBe(before);
    expect(fixture.scenarios["smoke-18"]?.expectedLegacyCompositePass).toBe(
      false
    );
    expect(
      fixture.scenarios["shared-workspace"]?.expectedLegacyCompositePass
    ).toBe(false);
  });

  it("makes every contract blocker fail acceptance while diagnostics cannot", () => {
    const passing = {
      auditProvenancePass: true,
      eligible: true,
      instrumentationParityPass: true,
      latencyPass: true,
      positiveSemanticParityPass: true,
      rssPass: true,
      scenarioCompleteContractPass: true,
      semanticIntegrityMatrixPass: true,
      unchangedEnsureLegacyCompositePass: true,
      workerCliEquivalencePass: true,
      workloadParityPass: true,
    } as const;
    expect(releaseAcceptance(passing)).toBe(true);
    for (const blocker of Object.keys(passing) as Array<keyof typeof passing>) {
      expect(releaseAcceptance({ ...passing, [blocker]: false })).toBe(false);
    }

    const failedLegacyMagnitudeGate = performanceGate({
      absoluteMedianLimit: 10_000,
      absoluteP95Limit: 20_000,
      baseline: rawStatistics([5_800]),
      candidate: rawStatistics([5_300]),
      confidenceUpperPercent: -1,
      relativeMedianLimit: 0.5,
    });
    expect(failedLegacyMagnitudeGate.pass).toBe(false);
    expect(completeContractPass(failedLegacyMagnitudeGate)).toBe(true);
    expect(
      releaseAcceptance({
        ...passing,
        scenarioCompleteContractPass: completeContractPass(
          failedLegacyMagnitudeGate
        ),
      })
    ).toBe(true);
  });

  it("pins the production source dist CLI and lockfile identity", async () => {
    const identity = await productionCandidateIdentity(
      resolve(import.meta.dirname, "..")
    );
    expect(identity).toEqual(FROZEN_PRODUCTION_CANDIDATE);
    expect(() => assertFrozenProductionCandidate(identity)).not.toThrow();
    expect(() =>
      assertFrozenProductionCandidate({
        ...identity,
        compilerCliHash: "sha256:changed",
      })
    ).toThrow(/identity changed/u);
  });

  it("keeps reduced smoke runs acceptance-ineligible", () => {
    expect(acceptanceEligibility(1, 0)).toBe(false);
    expect(acceptanceEligibility(29, 5)).toBe(false);
    expect(acceptanceEligibility(30, 5)).toBe(true);
  });

  it("separates exact timing TypeScript and RSS child argument vectors", () => {
    const base = {
      cli: "/tmp/cli.js",
      commandArguments: ["check", "--workspace"],
      node: "/tmp/node",
      profiler: "/tmp/profiler.mjs",
      reportPath: "/tmp/report.json",
      rssProbe: "/tmp/rss.mjs",
    } as const;
    const timing = childArgumentVector({ ...base, surface: "timing" });
    const typescript = childArgumentVector({
      ...base,
      surface: "typescript",
    });
    const rss = childArgumentVector({ ...base, surface: "rss" });
    expect(timing).toEqual([
      "/tmp/node",
      "/tmp/cli.js",
      "check",
      "--workspace",
      "--format=json",
      "--report-file=/tmp/report.json",
    ]);
    expect(typescript.slice(0, 4)).toEqual([
      "/tmp/node",
      "--import",
      "/tmp/profiler.mjs",
      "/tmp/cli.js",
    ]);
    expect(rss.slice(0, 4)).toEqual([
      "/tmp/node",
      "--import",
      "/tmp/rss.mjs",
      "/tmp/cli.js",
    ]);
    expect(timing).not.toContain("--import");
    expect(typescript).not.toContain("/tmp/rss.mjs");
    expect(rss).not.toContain("/tmp/profiler.mjs");
  });

  it("pins the complete nine-file evaluator identity", () => {
    expect(EVALUATOR_SOURCE_PATHS).toEqual([
      "benchmarks/authorization.ts",
      "benchmarks/authorization-methodology.ts",
      "benchmarks/authorization-ensure-client.ts",
      "benchmarks/authorization-ensure-worker.ts",
      "benchmarks/authorization-profiler.mjs",
      "benchmarks/authorization-profiler-loader.mjs",
      "benchmarks/authorization-typescript-shim.mjs",
      "benchmarks/authorization-mutation-fs-shim.mjs",
      "benchmarks/authorization-rss-probe.mjs",
    ]);
  });

  it("uses five alternating A/B RSS-only pairs per fixture", () => {
    expect(rssPairOrder(0)).toEqual(["reference", "candidate"]);
    expect(rssPairOrder(1)).toEqual(["candidate", "reference"]);
    const schedule = rssSamplingSchedule(["smoke", "admin", "shared"]);
    expect(schedule).toHaveLength(15);
    for (const fixture of ["smoke", "admin", "shared"]) {
      const entries = schedule.filter((entry) => entry.fixture === fixture);
      expect(entries.map(({ order }) => order)).toEqual([
        ["reference", "candidate"],
        ["candidate", "reference"],
        ["reference", "candidate"],
        ["candidate", "reference"],
        ["reference", "candidate"],
      ]);
    }
  });

  it("uses the maximum child RSS peak and rejects audit fields in timing", () => {
    expect(rssWorkflowPeak(100, 250)).toBe(250);
    expect(() =>
      assertTimedWorkflowShape({
        completeGateMilliseconds: 10,
        phaseTimings: {},
      })
    ).not.toThrow();
    expect(() =>
      assertTimedWorkflowShape({
        completeGateMilliseconds: 10,
        programCount: 1,
      })
    ).toThrow(/audit-only/u);
    expect(() =>
      assertTimedWorkflowShape({
        completeGateMilliseconds: 10,
        peakRssBytes: 100,
      })
    ).toThrow(/audit-only/u);
  });
});

describe("stable ensure worker", () => {
  async function fixture(): Promise<{
    cli: string;
    expectedHash: string;
    root: string;
  }> {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-worker-test-"));
    temporary.push(root);
    const dist = join(root, "dist");
    const fixtureRoot = join(root, "fixture");
    await mkdir(join(fixtureRoot, "src"), { recursive: true });
    await mkdir(dist, { recursive: true });
    await writeFile(join(fixtureRoot, "src/input.txt"), "stable\n");
    await writeFile(join(dist, "cli.js"), "");
    await writeFile(
      join(dist, "lifecycle-test.js"),
      [
        'import { access, mkdir, writeFile } from "node:fs/promises";',
        'import { join } from "node:path";',
        "export async function t({ root }) {",
        '  const output = join(root, "generated", "catalog.json");',
        "  try { await access(output); return { changed: false }; }",
        '  catch { await mkdir(join(root, "generated"), { recursive: true }); await writeFile(output, "{}\\n"); return { changed: true }; }',
        "}",
      ].join("\n")
    );
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256");
    hash.update("src/input.txt");
    hash.update("stable\n");
    return {
      cli: join(dist, "cli.js"),
      expectedHash: `sha256:${hash.digest("hex")}`,
      root: fixtureRoot,
    };
  }

  it("keeps PID/context stable through bootstrap warmups and measurements", async () => {
    const test = await fixture();
    const worker = new EnsureWorker(test.cli, "fixture:candidate");
    const ready = await worker.ready();
    const results = [
      await worker.request("bootstrap", test.root, test.expectedHash),
    ];
    for (let index = 0; index < 5; index += 1) {
      results.push(
        await worker.request("warmup", test.root, test.expectedHash)
      );
    }
    results.push(await worker.request("measure", test.root, test.expectedHash));
    await worker.close();
    expect(results[0]?.changed).toBe(true);
    expect(results.slice(1).every(({ changed }) => changed === false)).toBe(
      true
    );
    expect(new Set(results.map(({ pid }) => pid))).toEqual(
      new Set([ready.pid])
    );
    expect(new Set(results.map(({ contextId }) => contextId))).toEqual(
      new Set(["fixture:candidate"])
    );
    expect(
      results.every(({ beforeHash, afterHash }) => beforeHash === afterHash)
    ).toBe(true);
  });

  it("fails an injected crash without retry or replacement", async () => {
    const test = await fixture();
    const worker = new EnsureWorker(test.cli, "fixture:reference");
    await worker.ready();
    worker.crashForTest();
    await expect(
      worker.request("measure", test.root, test.expectedHash)
    ).rejects.toThrow(/without replacement/u);
  });
});
