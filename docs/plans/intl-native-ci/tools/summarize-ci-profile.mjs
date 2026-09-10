import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { statistics } from "../../../../benchmarks/ci-operation.mjs";

// Run only on an independently digest-verified, safely extracted CI artifact.
// Original absolute runner paths are metadata, never local paths to open.
const [directory, sampleArgument = "10", ...extra] = process.argv.slice(2);
assert.ok(
  directory && !extra.length,
  "Expected report directory and optional sample count"
);
const samples = Number(sampleArgument);
assert.ok(
  Number.isSafeInteger(samples) &&
    samples >= 2 &&
    samples <= 20 &&
    samples % 2 === 0
);
const root = resolve(directory);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = async (name, digest) => {
  assert.match(name, /^[a-z0-9-]+\.(?:json|jsonl)$/u);
  if (name !== "result.json") {
    assert.ok(
      typeof digest === "string" && /^[a-f0-9]{64}$/u.test(digest),
      `Required artifact member SHA-256: ${name}`
    );
  }
  const file = join(root, name),
    stat = await lstat(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.size <= 128 * 1024 ** 2
  );
  const bytes = await readFile(file);
  if (name !== "result.json") {
    assert.equal(sha(bytes), digest, `Artifact member digest: ${name}`);
  }
  return { bytes, sha256: sha(bytes) };
};
const manifestFile = await read("result.json");
const manifest = JSON.parse(manifestFile.bytes);
assert.equal(
  manifest.status,
  "passed",
  "Incomplete profiles are not comparisons"
);
assert.equal(manifest.options.samples, samples);
const profile = manifest.options.profile ?? "all";
const workspace = Boolean(manifest.scope);
let cells;
if (workspace) {
  assert.ok(
    ["all", "verify", "reuse", "reuse-cold", "reuse-warm"].includes(profile),
    "Unknown workspace profile"
  );
  const operation = profile.startsWith("reuse-") ? "reuse" : profile;
  const operations = operation === "all" ? ["verify", "reuse"] : [operation];
  const modes = ["cold", "warm"].filter(
    (mode) => !profile.startsWith("reuse-") || profile === `reuse-${mode}`
  );
  cells = modes.flatMap((mode) =>
    operations.flatMap((op) =>
      ["node", "rust"].map((engine) => `${op}-${mode}-${engine}`)
    )
  );
} else {
  const preparationCells = {
    paired: ["candidate-node-full", "candidate-rust-full"],
    context: ["published-node-full", "candidate-rust-reuse"],
    all: [
      "published-node-full",
      "candidate-node-full",
      "candidate-rust-full",
      "candidate-rust-reuse",
    ],
  };
  assert.ok(
    Object.hasOwn(preparationCells, profile),
    "Unknown preparation profile"
  );
  cells = preparationCells[profile];
}
const labels = [
  ...cells.map((x) => `${x}-0`),
  ...cells.toReversed().map((x) => `${x}-1`),
];
assert.deepEqual(
  manifest.results.map((x) => x.label),
  labels,
  "Missing, repeated or reordered blocks"
);
const reports = [];
for (const entry of manifest.results) {
  const member = await read(
    `${entry.label}.json`,
    workspace ? entry.reportSha256 : entry.sha256
  );
  const report = JSON.parse(member.bytes);
  assert.equal(report.status, "success");
  assert.equal(report.options.label, entry.label);
  const mode = workspace ? entry.label.split("-")[1] : "cold";
  const warmups = mode === "warm" ? 1 : 0;
  assert.equal(report.options.mode, mode, "Report mode contradicts cell");
  assert.equal(report.options.samples, samples / 2, "Report sample option");
  assert.equal(report.options.warmups, warmups, "Report warmup option");
  assert.ok(Array.isArray(report.samples), "Missing measured samples");
  assert.equal(report.samples.length, samples / 2);
  assert.ok(report.samples.every((x) => x.success === true));
  assert.ok(
    report.samples.every(
      (row) =>
        row.warmup === false ||
        (mode === "cold" && !Object.hasOwn(row, "warmup"))
    ),
    "Measured samples must exclude warmups and have valid classification"
  );
  assert.ok(Array.isArray(report.warmups), "Missing warmup samples");
  assert.equal(report.warmups.length, warmups, "Incomplete report warmups");
  assert.ok(
    report.warmups.every((row) => row.warmup === true && row.success === true),
    "Invalid report warmup classification"
  );
  if (workspace) {
    const raw = await read(`${entry.label}.jsonl`, entry.rawSha256);
    const rows = raw.bytes.toString("utf8").trim().split("\n").map(JSON.parse);
    assert.ok(
      rows.every((row) => typeof row.warmup === "boolean"),
      "Raw observations require boolean warmup classification"
    );
    assert.equal(rows.length, samples / 2 + warmups, "Raw observation count");
    assert.equal(
      rows.filter((row) => row.warmup === true).length,
      warmups,
      "Raw warmup count"
    );
    const measured = rows.filter((x) => x.warmup === false);
    assert.equal(measured.length, samples / 2);
  }
  reports.push({ label: entry.label, sha256: member.sha256, report });
}
const measurement = (value, name) => {
  assert.ok(
    typeof value === "number" && Number.isFinite(value) && value >= 0,
    `Invalid ${name}: expected a finite nonnegative number`
  );
  return value;
};
const optionalMeasurement = (value, name) =>
  value == null ? null : measurement(value, name);
const optionalResource = (value, name) => {
  assert.ok(
    value == null || (typeof value === "object" && !Array.isArray(value)),
    `Invalid ${name} resource object`
  );
  return value;
};
const selectors = {
  wallMs: (row) => measurement(row.wallMs, "wallMs"),
  officialCpuMs: (row) => {
    const resource = optionalResource(row.officialTime, "officialTime");
    return resource == null
      ? null
      : measurement(
          measurement(resource.userCpuMs, "userCpuMs") +
            measurement(resource.systemCpuMs, "systemCpuMs"),
          "officialCpuMs"
        );
  },
  officialMaxRssBytes: (row) =>
    optionalMeasurement(
      optionalResource(row.officialTime, "officialTime")?.reportedMaxRssBytes,
      "officialMaxRssBytes"
    ),
  sampledTreeCpuMs: (row) =>
    optionalMeasurement(
      optionalResource(row.tree, "tree")?.sampledTreeCpuMs,
      "sampledTreeCpuMs"
    ),
  sampledTreePeakRssBytes: (row) =>
    optionalMeasurement(
      optionalResource(row.tree, "tree")?.sampledTreePeakRssBytes,
      "sampledTreePeakRssBytes"
    ),
};
const summarize = (rows) =>
  Object.fromEntries(
    Object.entries(selectors).map(([name, select]) => {
      const values = rows.map(select).filter((x) => x !== null);
      return [name, { ...statistics(values), totalSamples: rows.length }];
    })
  );
const results = Object.fromEntries(
  cells.map((cell) => {
    const blocks = reports.filter(
      (x) => x.label === `${cell}-0` || x.label === `${cell}-1`
    );
    const rows = blocks.flatMap((x) => x.report.samples);
    assert.equal(rows.length, samples);
    return [
      cell,
      {
        summary: summarize(rows),
        blocks: blocks.map((x) => ({
          label: x.label,
          sha256: x.sha256,
          summary: summarize(x.report.samples),
        })),
      },
    ];
  })
);
const environments = reports.map((x) => ({
  label: x.label,
  environment: x.report.environmentBefore,
  gaps: x.report.gaps,
}));
process.stdout.write(
  `${JSON.stringify(
    {
      profile,
      samplesPerCell: samples,
      manifestSha256: manifestFile.sha256,
      status: "complete-input-summary",
      results,
      environments,
      scope: manifest.scope ?? manifest.comparisonScope,
      semantics: reports[0].report.semantics,
      limitations: [
        "Artifact authenticity, CI run/source identity and actual workload acceptance require separate verification.",
        "Cold means fresh process; OS caches were not cleared.",
        "Warm official CPU/maxRSS is unavailable per operation; sampled process-tree counters are estimates.",
        "Sample variance uses n-1; p95 uses nearest rank and equals max at n10.",
        "Do not average block p95 values; reported full-cell statistics pool raw observations.",
        "Only the corrected candidate Node/Rust cells support equal-coverage engine comparisons.",
      ],
    },
    null,
    2
  )}\n`
);
