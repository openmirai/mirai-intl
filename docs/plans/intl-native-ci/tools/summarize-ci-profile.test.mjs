import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const script = fileURLToPath(
  new URL("./summarize-ci-profile.mjs", import.meta.url)
);
const execute = promisify(execFile);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// JSON permits exponent overflow; exercise the parsed nonfinite number rather
// than letting JSON.stringify silently turn Infinity into null.
const encode = (value) =>
  JSON.stringify(value, (_, item) => {
    if (item === Infinity) {
      return "__positive_infinity__";
    }
    if (item === -Infinity) {
      return "__negative_infinity__";
    }
    return item;
  })
    .replaceAll('"__positive_infinity__"', "1e999")
    .replaceAll('"__negative_infinity__"', "-1e999");

const workspaceCells = {
  verify: [
    "verify-cold-node",
    "verify-cold-rust",
    "verify-warm-node",
    "verify-warm-rust",
  ],
  reuse: [
    "reuse-cold-node",
    "reuse-cold-rust",
    "reuse-warm-node",
    "reuse-warm-rust",
  ],
  "reuse-cold": ["reuse-cold-node", "reuse-cold-rust"],
  "reuse-warm": ["reuse-warm-node", "reuse-warm-rust"],
  all: [
    "verify-cold-node",
    "verify-cold-rust",
    "reuse-cold-node",
    "reuse-cold-rust",
    "verify-warm-node",
    "verify-warm-rust",
    "reuse-warm-node",
    "reuse-warm-rust",
  ],
};
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

async function fixture(t, profile = "verify", workspace = true) {
  const root = await mkdtemp(join(tmpdir(), "intl-summary-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cells = (workspace ? workspaceCells : preparationCells)[profile];
  const labels = [
    ...cells.map((cell) => `${cell}-0`),
    ...cells.toReversed().map((cell) => `${cell}-1`),
  ];
  const manifest = {
    status: "passed",
    options: { samples: 10, profile },
    results: labels.map((label) => ({ label })),
  };
  if (workspace) {
    manifest.scope = { candidateOnly: true };
  } else {
    manifest.comparisonScope = { fixture: true };
  }
  const reports = labels.map((label) => {
    const mode = workspace && label.includes("-warm-") ? "warm" : "cold";
    const sample = (i) => ({
      success: true,
      index: i,
      ...(mode === "warm" ? { warmup: false } : {}),
      wallMs: i + 1 + (label.endsWith("-1") ? 5 : 0),
      officialTime:
        mode === "warm"
          ? null
          : { userCpuMs: i + 1, systemCpuMs: 2, reportedMaxRssBytes: 100 },
      tree: { sampledTreeCpuMs: 3, sampledTreePeakRssBytes: 200 },
    });
    return {
      status: "success",
      options: { label, mode, samples: 5, warmups: mode === "warm" ? 1 : 0 },
      samples: Array.from({ length: 5 }, (_, i) => sample(i)),
      warmups:
        mode === "warm"
          ? [{ ...sample(0), warmup: true, wallMs: 1_000_000 }]
          : [],
      environmentBefore: { fixture: true },
      gaps: [],
      semantics: { fixture: true },
    };
  });
  const raw = reports.map((report) =>
    [...report.warmups, ...report.samples].map((row, id) => ({
      id,
      ok: true,
      warmup: row.warmup === true,
    }))
  );
  const saveManifest = () =>
    writeFile(join(root, "result.json"), encode(manifest));
  const save = async () => {
    for (const [index, entry] of manifest.results.entries()) {
      const bytes = encode(reports[index]);
      await writeFile(join(root, `${entry.label}.json`), bytes);
      entry[workspace ? "reportSha256" : "sha256"] = digest(bytes);
      if (workspace) {
        const lines = `${raw[index].map(encode).join("\n")}\n`;
        await writeFile(join(root, `${entry.label}.jsonl`), lines);
        entry.rawSha256 = digest(lines);
      }
    }
    await saveManifest();
  };
  const run = async () => {
    const { stdout } = await execute(process.execPath, [script, root], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  };
  await save();
  return { root, cells, manifest, reports, raw, save, saveManifest, run };
}

async function rejectsSummary(f, pattern) {
  await assert.rejects(f.run(), (error) => {
    assert.equal(error.code, 1);
    assert.equal(
      error.stdout,
      "",
      "Invalid evidence must never emit a complete summary"
    );
    assert.match(error.stderr, pattern);
    return true;
  });
}

for (const [workspace, profiles] of [
  [true, workspaceCells],
  [false, preparationCells],
]) {
  for (const profile of Object.keys(profiles)) {
    test(`${workspace ? "workspace" : "preparation"} ${profile} pools both reverse blocks without warmups`, async (t) => {
      const f = await fixture(t, profile, workspace);
      const result = await f.run();
      assert.equal(result.status, "complete-input-summary");
      assert.deepEqual(Object.keys(result.results), f.cells);
      for (const [cell, value] of Object.entries(result.results)) {
        assert.deepEqual(
          value.blocks.map((block) => block.label),
          [`${cell}-0`, `${cell}-1`]
        );
        assert.equal(value.summary.wallMs.n, 10);
        assert.equal(value.summary.wallMs.totalSamples, 10);
        assert.equal(value.summary.wallMs.mean, 5.5);
        assert.equal(value.summary.wallMs.p95, 10);
        assert.equal(value.summary.wallMs.sampleVariance, 82.5 / 9);
        if (cell.includes("-warm-")) {
          assert.equal(value.summary.officialCpuMs.n, 0);
          assert.equal(value.summary.officialCpuMs.mean, null);
          assert.equal(value.summary.officialMaxRssBytes.n, 0);
        }
      }
    });
  }
  test(`${workspace ? "workspace" : "preparation"} missing profile retains default all`, async (t) => {
    const f = await fixture(t, "all", workspace);
    delete f.manifest.options.profile;
    await f.saveManifest();
    assert.equal((await f.run()).profile, "all");
  });
}

const invalidNumbers = [
  ["missing", undefined],
  ["null", null],
  ["string", "5"],
  ["empty", ""],
  ["boolean", true],
  ["array", []],
  ["object", {}],
  ["negative", -1],
  ["infinite", Infinity],
  ["negative infinite", -Infinity],
  ["NaN string", "NaN"],
];
for (const [name, value] of invalidNumbers) {
  for (const field of ["wallMs", "userCpuMs", "systemCpuMs"]) {
    test(`rejects ${name} ${field} even with a matching member digest`, async (t) => {
      const f = await fixture(t, "paired", false);
      const row = f.reports[0].samples[0];
      if (field === "wallMs") {
        row.wallMs = value;
      } else {
        row.officialTime[field] = value;
      }
      await f.save();
      await rejectsSummary(f, new RegExp(`Invalid ${field}`));
    });
  }
}
test("rejects overflow of individually finite CPU components", async (t) => {
  const f = await fixture(t, "paired", false);
  Object.assign(f.reports[0].samples[0].officialTime, {
    userCpuMs: Number.MAX_VALUE,
    systemCpuMs: Number.MAX_VALUE,
  });
  await f.save();
  await rejectsSummary(f, /Invalid officialCpuMs/);
});

for (const [workspace, field] of [
  [false, "sha256"],
  [true, "reportSha256"],
  [true, "rawSha256"],
]) {
  for (const [name, value] of [
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["short", "a".repeat(63)],
    ["nonhex", "g".repeat(64)],
    ["uppercase", "A".repeat(64)],
    ["prefixed", `sha256:${"a".repeat(64)}`],
    ["number", 123],
    ["object", {}],
  ]) {
    test(`rejects ${name} required ${field}`, async (t) => {
      const f = await fixture(t, workspace ? "verify" : "paired", workspace);
      f.manifest.results[0][field] = value;
      // Another schema's field cannot disguise the missing required field.
      if (field === "reportSha256") {
        f.manifest.results[0].sha256 = "a".repeat(64);
      }
      await f.saveManifest();
      await rejectsSummary(f, /Required artifact member SHA-256/);
    });
  }
  test(`rejects mismatched ${field}`, async (t) => {
    const f = await fixture(t, workspace ? "verify" : "paired", workspace);
    f.manifest.results[0][field] = "a".repeat(64);
    await f.saveManifest();
    await rejectsSummary(f, /Artifact member digest/);
  });
}

for (const field of [
  "reportedMaxRssBytes",
  "sampledTreeCpuMs",
  "sampledTreePeakRssBytes",
]) {
  for (const [name, value] of invalidNumbers.filter(
    ([, candidate]) => candidate != null
  )) {
    test(`rejects malformed optional ${field}: ${name}`, async (t) => {
      const f = await fixture(t, "paired", false);
      const row = f.reports[0].samples[0];
      (field === "reportedMaxRssBytes" ? row.officialTime : row.tree)[field] =
        value;
      await f.save();
      await rejectsSummary(f, /expected a finite nonnegative number/);
    });
  }
}
test("explicitly unavailable optional resources stay unavailable and zero measurements remain valid", async (t) => {
  const f = await fixture(t, "reuse-warm");
  for (const report of f.reports) {
    for (const row of report.samples) {
      row.wallMs = 0;
      row.tree = { sampledTreeCpuMs: null, sampledTreePeakRssBytes: null };
    }
  }
  await f.save();
  for (const { summary } of Object.values((await f.run()).results)) {
    assert.equal(summary.wallMs.n, 10);
    assert.equal(summary.wallMs.mean, 0);
    for (const name of [
      "officialCpuMs",
      "officialMaxRssBytes",
      "sampledTreeCpuMs",
      "sampledTreePeakRssBytes",
    ]) {
      assert.equal(summary[name].n, 0);
      assert.equal(summary[name].mean, null);
      assert.equal(summary[name].totalSamples, 10);
    }
  }
});

for (const profile of ["reuse-cold", "reuse-warm"]) {
  for (const mode of [
    undefined,
    null,
    "other",
    profile === "reuse-cold" ? "warm" : "cold",
  ]) {
    test(`${profile} rejects contradictory mode ${mode}`, async (t) => {
      const f = await fixture(t, profile);
      f.reports[0].options.mode = mode;
      await f.save();
      await rejectsSummary(f, /Report mode contradicts cell/);
    });
  }
  for (const warmup of [
    true,
    null,
    "false",
    0,
    ...(profile === "reuse-warm" ? [undefined] : []),
  ]) {
    test(`${profile} rejects measured warmup classification ${warmup}`, async (t) => {
      const f = await fixture(t, profile);
      f.reports[0].samples[0].warmup = warmup;
      await f.save();
      await rejectsSummary(f, /Measured samples must exclude warmups/);
    });
  }
  for (const warmup of [undefined, null, "false", 0]) {
    test(`${profile} rejects malformed raw warmup classification ${warmup}`, async (t) => {
      const f = await fixture(t, profile);
      f.raw[0][0].warmup = warmup;
      await f.save();
      await rejectsSummary(f, /Raw observations require boolean/);
    });
  }
  test(`${profile} rejects raw warmup contamination with unchanged total count`, async (t) => {
    const f = await fixture(t, profile);
    f.raw[0][0].warmup = !f.raw[0][0].warmup;
    await f.save();
    await rejectsSummary(f, /Raw warmup count/);
  });
  for (const mutation of [
    "missing-block",
    "wrong-mode-cell",
    "wrong-engine",
    "reordered",
  ]) {
    test(`${profile} rejects ${mutation} schedule`, async (t) => {
      const f = await fixture(t, profile);
      if (mutation === "missing-block") {
        f.manifest.results.pop();
      }
      if (mutation === "wrong-mode-cell") {
        f.manifest.results[0].label =
          profile === "reuse-cold" ? "reuse-warm-node-0" : "reuse-cold-node-0";
      }
      if (mutation === "wrong-engine") {
        f.manifest.results[1].label = f.manifest.results[0].label;
      }
      if (mutation === "reordered") {
        f.manifest.results.reverse();
      }
      await f.saveManifest();
      await rejectsSummary(f, /Missing, repeated or reordered blocks/);
    });
  }
}

for (const [name, mutate] of [
  [
    "sample option",
    (f) => {
      f.reports[0].options.samples = 4;
    },
  ],
  [
    "warmup option",
    (f) => {
      f.reports[0].options.warmups = 0;
    },
  ],
  [
    "missing measured row",
    (f) => {
      f.reports[0].samples.pop();
    },
  ],
  [
    "failed measured row",
    (f) => {
      f.reports[0].samples[0].success = false;
    },
  ],
  [
    "missing report warmup",
    (f) => {
      f.reports[0].warmups = [];
    },
  ],
  [
    "misclassified report warmup",
    (f) => {
      f.reports[0].warmups[0].warmup = false;
    },
  ],
  [
    "extra raw row",
    (f) => {
      f.raw[0].push(f.raw[0][1]);
    },
  ],
]) {
  test(`rejects ${name}`, async (t) => {
    const f = await fixture(t, "reuse-warm");
    mutate(f);
    await f.save();
    await rejectsSummary(f, /AssertionError/);
  });
}
