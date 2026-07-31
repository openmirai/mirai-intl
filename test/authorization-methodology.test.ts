import { createHash as createNodeHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EnsureWorker } from "../benchmarks/authorization-ensure-client";
import {
  GATE_25_CHILD_ENVIRONMENT,
  gate25AttemptSchedule,
  gate25EngineConfiguration,
  gate25ExactParity,
  gate25PoolSequence,
} from "../benchmarks/authorization-gate25";
import {
  GATE_25_SEMANTIC_PROJECTION_EXCLUSIONS,
  gate25CanonicalHash,
  gate25CompilerIdentity,
  gate25SemanticEvidence,
  gate25SemanticProjection,
  verifyGate25ReceiptIdentity,
} from "../benchmarks/authorization-gate25-parity";
import {
  cloneInstalledWorkspace,
  dependencyTopologyIdentity,
  GATE_25_TOPOLOGY_PROBES,
  gate25WorkerGroups,
} from "../benchmarks/authorization-gate25-workspace";
import type {
  Gate25Sample,
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
  gate25PoolAssessment,
  measurementTimeoutMilliseconds,
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
  smallestPassingGate25Pool,
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

function requiredFirst<T>(values: ReadonlyArray<T>, context: string): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error(`${context} fixture must contain one entry`);
  }
  return value;
}

describe("authorization evaluator methodology", () => {
  function gate25Sample(overrides: Partial<Gate25Sample> = {}): Gate25Sample {
    return {
      completeMilliseconds: 7_000,
      inputHash: "sha256:fixed",
      parityPass: true,
      peakRssBytes: 512 * 1024 * 1024,
      programCount: 5,
      semanticMilliseconds: 6_000,
      sourceCount: 3_809,
      ...overrides,
    };
  }

  it("selects the smallest complete parity-valid Gate 2.5 pool", () => {
    const pool1 = gate25PoolAssessment([
      gate25Sample({ completeMilliseconds: 9_000 }),
      gate25Sample({ completeMilliseconds: 9_500 }),
    ]);
    const pool2 = gate25PoolAssessment([
      gate25Sample(),
      gate25Sample({ completeMilliseconds: 7_500 }),
    ]);
    const pool3 = gate25PoolAssessment([
      gate25Sample({ completeMilliseconds: 6_000 }),
    ]);
    expect(pool1.pass).toBe(false);
    expect(pool2.pass).toBe(true);
    expect(
      smallestPassingGate25Pool([
        { assessment: pool1, poolSize: 1 },
        { assessment: pool3, poolSize: 3 },
        { assessment: pool2, poolSize: 2 },
      ])
    ).toBe(2);
  });

  it("fails Gate 2.5 on parity, input drift, or incomplete Programs", () => {
    const assessment = gate25PoolAssessment([
      gate25Sample(),
      gate25Sample({
        inputHash: "sha256:changed",
        parityPass: false,
        programCount: 0,
      }),
    ]);
    expect(assessment).toMatchObject({
      inputHashPass: false,
      parityPass: false,
      pass: false,
      programCountPass: false,
    });
  });

  it("uses each bounded pool once in ascending order without replacement", () => {
    expect(gate25PoolSequence(1)).toEqual([1, 2, 3, 4]);
    expect(gate25PoolSequence(3)).toEqual([3, 4]);
    expect(gate25PoolSequence(1, 1)).toEqual([1]);
    expect(gate25PoolSequence(2, 3)).toEqual([2, 3]);
    expect(Object.isFrozen(gate25PoolSequence(1))).toBe(true);
    expect(() => gate25PoolSequence(0)).toThrow(/pool bounds/u);
    expect(() => gate25PoolSequence(5)).toThrow(/pool bounds/u);
    expect(() => gate25PoolSequence(3, 2)).toThrow(/pool bounds/u);
  });

  it("keeps bounded pool diagnostics ineligible for authoritative acceptance", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../benchmarks/authorization-gate25.ts"),
      "utf8"
    );
    expect(source).toContain(
      "startPool === 1 &&\n    endPool === 4 &&\n    warmups === requiredWarmups &&\n    samples === requiredSamples"
    );
  });

  it("uses an immutable no-cache attempt schedule without retries or replacements", () => {
    const schedule = gate25AttemptSchedule(5, 10);
    expect(schedule).toEqual([
      "warmup",
      "warmup",
      "warmup",
      "warmup",
      "warmup",
      "reference",
      "candidate",
      "candidate",
      "candidate",
      "candidate",
      "candidate",
      "candidate",
      "candidate",
      "candidate",
      "candidate",
      "candidate",
    ]);
    expect(Object.isFrozen(schedule)).toBe(true);
    expect(GATE_25_CHILD_ENVIRONMENT).toEqual({
      CI: "1",
      FORCE_COLOR: "0",
      NODE_ENV: "production",
      TURBO_CACHE: "0",
      TURBO_REMOTE_ONLY: "false",
    });
    expect(Object.isFrozen(GATE_25_CHILD_ENVIRONMENT)).toBe(true);
    const engines = gate25EngineConfiguration("/frozen/compiler/cli.js");
    expect(engines.candidate.cliPath).toBe(engines.reference.cliPath);
    expect(engines.candidate.environment).toEqual({
      MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE: "owner-batch",
    });
    expect(engines.reference.environment).toEqual({
      MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE: "reference",
    });
    expect(Object.keys(engines.candidate.environment)).toEqual(
      Object.keys(engines.reference.environment)
    );
    expect(engines.candidate.environment).not.toEqual(
      engines.reference.environment
    );
    expect(Object.isFrozen(engines)).toBe(true);
    expect(Object.isFrozen(engines.candidate)).toBe(true);
    expect(Object.isFrozen(engines.reference)).toBe(true);
    expect(() => gate25AttemptSchedule(-1, 10)).toThrow(/attempt schedule/u);
    expect(() => gate25AttemptSchedule(5, 0)).toThrow(/attempt schedule/u);
  });

  it("excludes mandatory topology setup from the complete transaction timer", async () => {
    const source = await readFile(
      resolve(
        import.meta.dirname,
        "../benchmarks/authorization-gate25-child.ts"
      ),
      "utf8"
    );
    const materialized = source.indexOf(
      "const topology = await materializeColdWorkspace(seedRoot, runRoot);"
    );
    const workspaceReady = source.indexOf(
      'const workspace = join(runRoot, "workspace");',
      materialized
    );
    const setupRecorded = source.indexOf(
      "const setupMilliseconds = performance.now() - setupStarted;",
      workspaceReady
    );
    const transactionStarted = source.indexOf(
      "const completeStarted = performance.now();",
      setupRecorded
    );
    const generationStarted = source.indexOf(
      "const generationStarted = completeStarted;",
      transactionStarted
    );
    const coldEnsures = source.indexOf(
      "const ensures = await mapPool(",
      generationStarted
    );
    expect(materialized).toBeGreaterThan(-1);
    expect(workspaceReady).toBeGreaterThan(materialized);
    expect(setupRecorded).toBeGreaterThan(workspaceReady);
    expect(transactionStarted).toBeGreaterThan(setupRecorded);
    expect(generationStarted).toBeGreaterThan(transactionStarted);
    expect(coldEnsures).toBeGreaterThan(generationStarted);
    expect(source).toContain(
      "completeMilliseconds: performance.now() - completeStarted"
    );
    expect(source).not.toContain(
      "completeMilliseconds: performance.now() - childStarted"
    );
    expect(source).toContain(
      "childElapsedMilliseconds: performance.now() - childStarted"
    );
    expect(source).toContain(
      "setupMilliseconds: transactionSetupMilliseconds ?? null"
    );
  });

  it("requires exact catalog payload, semantic projection, and source universe parity", () => {
    const reference = {
      catalogPayloadHash: gate25CanonicalHash("catalog"),
      parityHash: gate25CanonicalHash("semantics"),
      sourceCount: 3_809,
    };
    expect(gate25ExactParity(reference, reference)).toBe(true);
    expect(
      gate25ExactParity(
        {
          ...reference,
          catalogPayloadHash: gate25CanonicalHash("changed catalog"),
        },
        reference
      )
    ).toBe(false);
    expect(
      gate25ExactParity(
        {
          ...reference,
          parityHash: gate25CanonicalHash("changed semantics"),
        },
        reference
      )
    ).toBe(false);
    expect(
      gate25ExactParity({ ...reference, sourceCount: 3_808 }, reference)
    ).toBe(false);
  });

  it("excludes exactly four recursive identity fields from semantic parity", () => {
    expect(GATE_25_SEMANTIC_PROJECTION_EXCLUSIONS).toEqual([
      "compilerManifest",
      "compilerManifestHash",
      "generationReceiptHash",
      "sourceAuthorizationHash",
    ]);
    const projected = gate25SemanticProjection({
      compilerHash: "kept",
      compilerManifest: ["excluded"],
      compilerManifestHash: "excluded",
      contracts: { hash: "kept" },
      discoveryPolicyHash: "kept",
      environment: { hash: "kept" },
      exceptionsHash: "kept",
      generationInputHash: "kept",
      generationReceiptHash: "excluded",
      nested: {
        compilerManifest: ["excluded"],
        sourceAuthorizationHash: "excluded",
      },
      sourceAuthorizationHash: "excluded",
    });
    expect(projected).toEqual({
      compilerHash: "kept",
      contracts: { hash: "kept" },
      discoveryPolicyHash: "kept",
      environment: { hash: "kept" },
      exceptionsHash: "kept",
      generationInputHash: "kept",
      nested: {},
    });
  });

  it("fails semantic parity on every source, closure, diagnostic, lowering, provider, facade, probe, universe, and input drift", () => {
    const hash = (label: string): string => gate25CanonicalHash(label);
    const receipt = {
      application: {
        packageManifest: { hash: hash("package"), path: "package.json" },
        workspaceLockfile: { hash: hash("lock"), path: "pnpm-lock.yaml" },
      },
      artifactAbi: "artifact",
      compilerManifest: [{ hash: hash("compiler"), path: "cli.js" }],
      compilerManifestHash: hash("compiler manifest"),
      counters: {
        semanticAuthorizationRuns: 1,
        semanticFilesAnalyzed: 1,
      },
      exceptions: [],
      exceptionsHash: hash("exceptions"),
      generationReceiptHash: hash("generation"),
      icu: { packageHash: hash("icu") },
      projects: [{ normalizedOptionsHash: hash("options"), path: "." }],
      providerClosures: [
        {
          closureHash: hash("closure"),
          facade: { hash: hash("facade"), specifier: "./generated" },
          lowering: { hash: hash("lowering"), replacements: 2 },
          providers: [
            {
              hash: hash("provider"),
              resolutions: [
                {
                  probes: [
                    {
                      kind: "file",
                      path: "node_modules/provider/index.d.ts",
                      present: true,
                    },
                  ],
                  specifier: "provider",
                },
              ],
            },
          ],
          source: "src/example.ts",
        },
      ],
      runtimeAbi: "runtime",
      schemaVersion: 2,
      sourceAuthorizationHash: hash("authorization"),
      sources: [
        {
          file: "src/example.ts",
          hash: hash("source"),
          owner: ".",
          providerClosureHash: hash("closure"),
          verdict: "accepted",
        },
      ],
      typescript: { libHash: hash("libs") },
    };
    const diagnostics: ReadonlyArray<unknown> = [];
    const baseline = gate25SemanticEvidence(receipt, diagnostics);
    const driftCases: ReadonlyArray<
      Readonly<{
        mutate: (copy: typeof receipt) => void;
        name: string;
      }>
    > = [
      {
        mutate: (copy) => {
          requiredFirst(copy.providerClosures, "provider closure").closureHash =
            hash("changed closure");
        },
        name: "closureHash",
      },
      {
        mutate: (copy) => {
          requiredFirst(copy.sources, "source").hash = hash("changed source");
        },
        name: "source hash",
      },
      {
        mutate: (copy) => {
          requiredFirst(
            copy.providerClosures,
            "provider closure"
          ).lowering.hash = hash("changed lowering");
        },
        name: "lowering",
      },
      {
        mutate: (copy) => {
          const closure = requiredFirst(
            copy.providerClosures,
            "provider closure"
          );
          requiredFirst(closure.providers, "provider").hash =
            hash("changed provider");
        },
        name: "provider",
      },
      {
        mutate: (copy) => {
          requiredFirst(copy.providerClosures, "provider closure").facade.hash =
            hash("changed facade");
        },
        name: "facade",
      },
      {
        mutate: (copy) => {
          const closure = requiredFirst(
            copy.providerClosures,
            "provider closure"
          );
          const provider = requiredFirst(closure.providers, "provider");
          const resolution = requiredFirst(
            provider.resolutions,
            "provider resolution"
          );
          requiredFirst(resolution.probes, "provider probe").present = false;
        },
        name: "probe",
      },
      {
        mutate: (copy) => {
          requiredFirst(copy.sources, "source").owner = "changed-owner";
        },
        name: "source universe",
      },
      {
        mutate: (copy) => {
          copy.application.packageManifest.hash = hash("changed input");
        },
        name: "input",
      },
    ];
    for (const { mutate, name } of driftCases) {
      const copy = structuredClone(receipt);
      mutate(copy);
      let detected = false;
      try {
        detected =
          JSON.stringify(gate25SemanticEvidence(copy, diagnostics)) !==
          JSON.stringify(baseline);
      } catch {
        detected = true;
      }
      expect({ detected, name }).toEqual({ detected: true, name });
    }
    expect(
      gate25SemanticEvidence(receipt, [
        { code: "INTL_DRIFT", message: "changed" },
      ])
    ).not.toEqual(baseline);
  });

  it("binds every semantic exclusion independently to compiler and receipt identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-gate25-identity-"));
    temporary.push(root);
    const compilerRoot = join(root, "dist");
    await mkdir(compilerRoot, { recursive: true });
    const cli = join(compilerRoot, "cli.js");
    await writeFile(cli, "export const cli = true;\n");
    await writeFile(
      join(compilerRoot, "semantic-b.js"),
      "export const semanticB = true;\n"
    );
    await writeFile(
      join(compilerRoot, "semantic-J.js"),
      "export const semanticJ = true;\n"
    );
    await writeFile(join(compilerRoot, "semantic.d.ts"), "export {};\n");
    const compiler = await gate25CompilerIdentity(cli);
    expect(compiler.receiptManifest.map(({ path }) => path)).toEqual([
      "cli.js",
      "semantic-J.js",
      "semantic-b.js",
    ]);
    const generationReceiptSource = `${JSON.stringify({
      compilerHash: compiler.compilerHash,
    })}\n`;
    const base = {
      application: {},
      compilerManifest: compiler.receiptManifest.map((entry) => ({ ...entry })),
      compilerManifestHash: compiler.receiptManifestHash,
      generationReceiptHash: gate25CanonicalHash("placeholder"),
      providerClosures: [],
      schemaVersion: 2,
      sources: [],
    };
    base.generationReceiptHash = `sha256:${createNodeHash("sha256")
      .update(generationReceiptSource)
      .digest("hex")}`;
    const receipt = {
      ...base,
      sourceAuthorizationHash: gate25CanonicalHash(base),
    };
    expect(
      verifyGate25ReceiptIdentity(receipt, generationReceiptSource, compiler)
    ).toMatchObject({
      compilerHash: compiler.compilerHash,
      compilerManifestHash: compiler.receiptManifestHash,
      generationReceiptHash: base.generationReceiptHash,
      sourceAuthorizationHash: receipt.sourceAuthorizationHash,
    });
    const mutations: ReadonlyArray<
      Readonly<{ mutate: (copy: typeof receipt) => void; name: string }>
    > = [
      {
        mutate: (copy) => {
          requiredFirst(copy.compilerManifest, "compiler manifest").hash =
            gate25CanonicalHash("mutated");
        },
        name: "compilerManifest",
      },
      {
        mutate: (copy) => {
          copy.compilerManifestHash = gate25CanonicalHash("mutated");
        },
        name: "compilerManifestHash",
      },
      {
        mutate: (copy) => {
          copy.generationReceiptHash = gate25CanonicalHash("mutated");
        },
        name: "generationReceiptHash",
      },
      {
        mutate: (copy) => {
          copy.sourceAuthorizationHash = gate25CanonicalHash("mutated");
        },
        name: "sourceAuthorizationHash",
      },
    ];
    for (const { mutate, name } of mutations) {
      const copy = structuredClone(receipt);
      mutate(copy);
      expect({
        name,
        projection: gate25SemanticProjection(copy),
      }).toEqual({
        name,
        projection: gate25SemanticProjection(receipt),
      });
      expect(() =>
        verifyGate25ReceiptIdentity(copy, generationReceiptSource, compiler)
      ).toThrow(/Gate 2\.5/u);
    }
  });

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
    expect(measurementTimeoutMilliseconds("timing")).toBe(180_000);
    expect(measurementTimeoutMilliseconds("typescript")).toBe(180_000);
    expect(measurementTimeoutMilliseconds("rss")).toBe(600_000);
  });

  it("pins the complete thirteen-file evaluator identity", () => {
    expect(EVALUATOR_SOURCE_PATHS).toEqual([
      "benchmarks/authorization.ts",
      "benchmarks/authorization-methodology.ts",
      "benchmarks/authorization-ensure-client.ts",
      "benchmarks/authorization-ensure-worker.ts",
      "benchmarks/authorization-gate25.ts",
      "benchmarks/authorization-gate25-child.ts",
      "benchmarks/authorization-gate25-parity.ts",
      "benchmarks/authorization-gate25-workspace.ts",
      "benchmarks/authorization-profiler.mjs",
      "benchmarks/authorization-profiler-loader.mjs",
      "benchmarks/authorization-typescript-shim.mjs",
      "benchmarks/authorization-mutation-fs-shim.mjs",
      "benchmarks/authorization-rss-probe.mjs",
    ]);
  });

  it("confines cloned dependency realpaths and preserves seed identity", async () => {
    const container = await mkdtemp(
      join(tmpdir(), "mirai-intl-topology-test-")
    );
    temporary.push(container);
    const seed = join(container, "seed");
    await mkdir(join(seed, "node_modules"), { recursive: true });
    await writeFile(join(seed, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(seed, "node_modules/.modules.yaml"),
      "virtualStoreDir: .pnpm\n"
    );
    for (const probe of GATE_25_TOPOLOGY_PROBES) {
      const name = probe.split("/").at(-1);
      if (!name) {
        throw new Error(`Invalid test probe ${probe}`);
      }
      const target = join(
        seed,
        "node_modules/.pnpm",
        probe.replaceAll("/", "+"),
        "node_modules",
        name
      );
      const link = join(seed, probe);
      await mkdir(target, { recursive: true });
      await mkdir(dirname(link), { recursive: true });
      await writeFile(join(target, "package.json"), `{"name":"${name}"}`);
      await symlink(relative(dirname(link), target), link);
    }

    const before = await dependencyTopologyIdentity(seed);
    const clone = join(container, "clone");
    cloneInstalledWorkspace(seed, clone);
    const cloned = await dependencyTopologyIdentity(clone);
    expect(cloned).toEqual(before);
    await rm(join(clone, GATE_25_TOPOLOGY_PROBES[0]), { force: true });
    expect(
      await readFile(
        join(seed, GATE_25_TOPOLOGY_PROBES[0], "package.json"),
        "utf8"
      )
    ).toContain("intl");
    expect(await dependencyTopologyIdentity(seed)).toEqual(before);

    const escaped = join(container, "escaped-react");
    await mkdir(escaped, { recursive: true });
    const escapedLink = join(seed, "apps/admin/node_modules/react");
    await rm(escapedLink, { force: true });
    await symlink(escaped, escapedLink);
    await expect(dependencyTopologyIdentity(seed)).rejects.toThrow(
      /escapes workspace root/u
    );
  });

  it("assigns every package to one immutable bounded worker group", () => {
    const groups = gate25WorkerGroups(2);
    expect(groups).toEqual([
      {
        packagePaths: ["apps/admin", "apps/instructor", "packages/i18n"],
        workerIndex: 0,
      },
      {
        packagePaths: ["apps/auth", "apps/learner"],
        workerIndex: 1,
      },
    ]);
    expect(
      groups.flatMap(({ packagePaths }) => packagePaths).toSorted()
    ).toEqual(
      [
        "apps/admin",
        "apps/auth",
        "apps/instructor",
        "apps/learner",
        "packages/i18n",
      ].toSorted()
    );
    expect(Object.isFrozen(groups)).toBe(true);
    expect(groups.every(Object.isFrozen)).toBe(true);
    expect(
      groups.every(({ packagePaths }) => Object.isFrozen(packagePaths))
    ).toBe(true);
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
