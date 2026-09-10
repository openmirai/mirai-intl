import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  fingerprintInputs,
  parseArgs,
  parseProcessTable,
  parseTime,
  runBenchmark,
  selectTree,
  statistics,
  validateOptions,
} from "./ci-operation.mjs";

const exec = promisify(execFile);
const harness = fileURLToPath(new URL("ci-operation.mjs", import.meta.url));
const base = {
  label: "unit fixture",
  samples: 1,
  timeoutMs: 2000,
  totalTimeoutMs: 15000,
  pollMs: 100,
};
const options = (code, extra = {}) => ({
  ...base,
  command: [process.execPath, "-e", code],
  ...extra,
});
async function temporary(t) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "intl-ci-operation-test-")
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
const worker = `
const readline = require('node:readline');
let count = 0;
console.log(JSON.stringify({type:'ready',protocol:'ci-operation-v1'}));
readline.createInterface({input:process.stdin}).on('line',line=>{
 const request = JSON.parse(line);
 if(request.type==='shutdown') { process.exit(count === 3 ? 0 : 9); }
 else {
  count++;
  if(request.id !== count || request.warmup !== (count === 1)) process.exit(8);
  console.log(JSON.stringify({type:'result',id:request.id,ok:true}));
 }
});
`;

test("statistics use conventional median, nearest-rank p95 and sample dispersion", () => {
  const s = statistics([4, 1, 3, 2]);
  assert.equal(s.median, 2.5);
  assert.equal(s.mean, 2.5);
  assert.equal(s.p95, 4);
  assert.equal(s.sampleVariance, 5 / 3);
  assert.equal(s.sampleSd, Math.sqrt(5 / 3));
  assert.equal(s.populationVariance, 1.25);
  assert.equal(s.min, 1);
  assert.equal(s.max, 4);
  assert.equal(
    statistics(Array.from({ length: 100 }, (_, n) => n + 1)).p95,
    95
  );
  assert.equal(statistics([2]).sampleVariance, null);
  assert.equal(statistics([]).median, null);
  assert.throws(() => statistics([NaN]), /finite/);
});

test("bounds and CLI reject ambiguous or unbounded execution", () => {
  for (const extra of [
    { samples: 0 },
    { samples: 101 },
    { samples: 1.5 },
    { timeoutMs: Infinity },
    { totalTimeoutMs: 3600001 },
    { pollMs: 0 },
    { mode: "disk-cold" },
    { warmups: 1 },
  ]) {
    assert.throws(() => validateOptions(options("", extra)));
  }
  assert.throws(() =>
    parseArgs(["--label", "x", "--samples", "1e2", "--", "node"])
  );
  assert.throws(
    () => parseArgs(["--label", "x", "--label", "y", "--", "node"]),
    /Duplicate/
  );
  assert.throws(
    () => parseArgs(["--label", "x", "--unknown", "yes", "--", "node"]),
    /Unknown/
  );
  const parsed = parseArgs([
    "--label",
    "literal",
    "--samples",
    "2",
    "--",
    "node",
    "a;touch nope",
    "$(false)",
  ]);
  assert.deepEqual(parsed.command, ["node", "a;touch nope", "$(false)"]);
});

test("time output preserves platform RSS units without a tree-peak claim", () => {
  assert.deepEqual(
    parseTime("CI_OPERATION_TIME_V1\t1.2\t0.3\t2048\n", "linux"),
    {
      userCpuMs: 1200,
      systemCpuMs: 300,
      reportedMaxRssBytes: 2097152,
      raw: "CI_OPERATION_TIME_V1\t1.2\t0.3\t2048",
    }
  );
  const mac = parseTime(
    " 1.00 real 0.50 user 0.20 sys\n 4096 maximum resident set size\n",
    "darwin"
  );
  assert.equal(mac.reportedMaxRssBytes, 4096);
  assert.equal(mac.userCpuMs, 500);
  assert.equal(parseTime("time: unavailable", "darwin"), null);
});

test("tree selection includes descendants and orphaned group members, not unrelated jobs", () => {
  const rows = parseProcessTable(
    "10 1 10 100 0:01.25\n11 10 10 200 00:00:02\n12 1 10 300 1-01:02:03\n13 1 13 999 00:01:00\n14 11 14 50 0:00.01\n"
  );
  const selected = selectTree(rows, 10);
  assert.deepEqual(
    selected.map((r) => r.pid),
    [10, 11, 12, 14]
  );
  assert.equal(rows[0].cpuMs, 1250);
  assert.equal(rows[2].cpuMs, 90123000);
  assert.equal(
    selected.reduce((s, r) => s + r.rssBytes, 0),
    650 * 1024
  );
});

test("input content identity detects changes and rejects unbound symlinks", async (t) => {
  const directory = await temporary(t),
    file = path.join(directory, "input.txt");
  await writeFile(file, "before");
  const before = await fingerprintInputs([file], directory);
  await writeFile(file, "after");
  assert.notEqual(
    before[0].contentSha256,
    (await fingerprintInputs([file], directory))[0].contentSha256
  );
  await symlink(file, path.join(directory, "link"));
  await assert.rejects(
    fingerprintInputs([path.join(directory, "link")], directory),
    /symlink/
  );
});

test("cold mode really uses separate fresh processes and literal argv", async (t) => {
  const directory = await temporary(t),
    pids = path.join(directory, "pids.txt");
  const code =
    "require('node:fs').appendFileSync(process.argv[1],process.pid+'\\n'); if(process.argv[2] !== '$(touch sentinel); nope') process.exit(9)";
  const report = await runBenchmark({
    ...base,
    samples: 2,
    command: [process.execPath, "-e", code, pids, "$(touch sentinel); nope"],
    cwd: directory,
  });
  assert.equal(report.status, "success");
  assert.equal(report.samples.length, 2);
  assert.equal(
    new Set((await readFile(pids, "utf8")).trim().split("\n")).size,
    2
  );
  assert.equal(report.summary.wallMs.n, 2);
  assert.equal(
    report.identity.executableSha256,
    report.identity.executableSha256After
  );
  assert(report.semantics.cold.includes("NOT cleared"));
  for (const sample of report.samples) {
    assert(sample.tree.snapshots || sample.tree.gaps.length);
    if (report.timeTool.available) {
      assert(sample.officialTime.reportedMaxRssBytes > 0);
    }
    if (sample.tree.snapshots) {
      assert.equal(
        sample.tree.sampledTreePeakRssBytes,
        Math.max(...sample.tree.rawSnapshots.map((s) => s.rssBytes))
      );
    }
  }
});

test("warm handshake and sequential ids retain one worker across warmups and samples", async () => {
  const report = await runBenchmark(
    options(worker, { mode: "warm", warmups: 1, samples: 2 })
  );
  assert.equal(report.warmups.length, 1);
  assert.equal(report.samples.length, 2);
  assert(report.samples.every((s) => s.officialTime === null));
  assert.equal(report.summary.officialCpuMs.n, 0);
  assert.equal(report.status, "success");
});

test("ordinary commands cannot silently claim warm support", async () => {
  await assert.rejects(
    runBenchmark(options("console.log('ordinary output')", { mode: "warm" })),
    /protocol/
  );
});

test("wrong protocol ids and explicit operation failures abort warm mode", async () => {
  const prefix =
    "console.log(JSON.stringify({type:'ready',protocol:'ci-operation-v1'}));process.stdin.once('data',()=>";
  for (const message of [
    { type: "result", id: 99, ok: true },
    { type: "result", id: 1, ok: false },
  ]) {
    await assert.rejects(
      runBenchmark(
        options(
          `${prefix}console.log(${JSON.stringify(JSON.stringify(message))}));`,
          { mode: "warm" }
        )
      ),
      /current request/
    );
  }
});

test("command failure fails the run and never starts the remaining repetitions", async () => {
  await assert.rejects(
    runBenchmark(options("process.exit(7)", { samples: 3 })),
    (error) => {
      assert.equal(error.report.status, "failed");
      assert.equal(error.report.samples.length, 1);
      assert.equal(error.report.samples[0].exit.code, 7);
      assert.equal(error.report.summary.wallMs.n, 0);
      return true;
    }
  );
});

test("command timeout is bounded", async () => {
  const started = performance.now();
  await assert.rejects(
    runBenchmark(options("setInterval(()=>{},1000)", { timeoutMs: 100 })),
    /timed out/
  );
  assert(performance.now() - started < 7000);
});

test("warm handshake and shutdown have bounded deadlines", async () => {
  await assert.rejects(
    runBenchmark(
      options("setInterval(()=>{},1000)", { mode: "warm", timeoutMs: 100 })
    ),
    /Warm handshake timed out/
  );
  const noShutdown =
    "console.log(JSON.stringify({type:'ready',protocol:'ci-operation-v1'}));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.type==='run')console.log(JSON.stringify({type:'result',id:m.id,ok:true}));});setInterval(()=>{},1000)";
  await assert.rejects(
    runBenchmark(options(noShutdown, { mode: "warm", timeoutMs: 150 })),
    /Warm shutdown timed out/
  );
});

test("output limits abort a noisy child", async () => {
  await assert.rejects(
    runBenchmark(
      options(
        "process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000)",
        { maxOutputBytes: 1024 }
      )
    ),
    /output exceeded/
  );
});

test("mutated declared inputs invalidate otherwise successful samples", async (t) => {
  const directory = await temporary(t),
    file = path.join(directory, "input");
  await writeFile(file, "before");
  await assert.rejects(
    runBenchmark({
      ...base,
      inputs: [file],
      command: [
        process.execPath,
        "-e",
        "require('node:fs').writeFileSync(process.argv[1],'after')",
        file,
      ],
    }),
    /inputs changed/
  );
});

test("CLI exits nonzero and retains structured failure JSON", async (t) => {
  const directory = await temporary(t),
    output = path.join(directory, "failure.json");
  await assert.rejects(
    exec(
      process.execPath,
      [
        harness,
        "--label",
        "failure",
        "--samples",
        "1",
        "--output",
        output,
        "--",
        process.execPath,
        "-e",
        "process.exit(5)",
      ],
      { timeout: 10000 }
    ),
    (error) => error.code === 1
  );
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(report.status, "failed");
  assert.equal(report.samples[0].exit.code, 5);
});
