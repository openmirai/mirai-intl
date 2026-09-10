#!/usr/bin/env node
/**
 * Dependency-free, bounded benchmark supervisor (Node >=24; macOS/Linux).
 * node benchmarks/ci-operation.mjs --label baseline --input archive.tar \
 *   --samples 10 --timeout-ms 120000 --output /tmp/baseline.json -- node worker.mjs
 *
 * Cold = one fresh child/process group per sample, NEVER cleared OS/disk cache.
 * Warm requires --mode warm and a cooperating JSON-lines worker on stdin/stdout:
 *   worker -> {"type":"ready","protocol":"ci-operation-v1"}
 *   parent -> {"type":"run","id":1,"warmup":true|false}
 *   worker -> {"type":"result","id":1,"ok":true}
 *   parent -> {"type":"shutdown"}; worker must exit zero.
 * stdout is exclusively protocol in warm mode; diagnostics belong on stderr.
 * Warm wall time includes request/response IPC, excludes startup and warmups.
 * No protocol capability => failure, not an invented warm measurement.
 *
 * /usr/bin/time CPU includes OS-accounted waited descendants; its RSS is NOT a
 * simultaneous tree peak. Warm time(1) numbers apply to the whole session only.
 * ps snapshots sum current RSS of live group members/descendants at each poll;
 * their maximum is a SAMPLED tree RSS peak, never a sum of individual peaks.
 * Shared pages may be counted twice; short-lived/escaped processes can be missed.
 * CPU polling sums per-PID own CPU increments, not waited-child CPU or CPU %.
 * It is an estimate with ps resolution, PID reuse and sampling gaps, not exact.
 * Existing cgroup evidence is shared/lifetime context, never child attribution.
 *
 * Sources: https://www.gnu.org/software/time/manual/time.html
 * https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/getrusage.2.html
 * https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html
 * https://nodejs.org/docs/latest-v24.x/api/child_process.html
 */
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import {
  access,
  lstat,
  readdir,
  readFile,
  realpath,
  statfs,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const PROTOCOL = "ci-operation-v1";
const LIMITS = Object.freeze({
  samples: 100,
  warmups: 20,
  timeoutMs: 600_000,
  totalTimeoutMs: 3_600_000,
  outputBytes: 64 * 1024 * 1024,
  inputBytes: 1024 ** 3,
  inputEntries: 50_000,
});

export function statistics(values) {
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new Error("Statistics require finite numbers");
  }
  if (!values.length) {
    return {
      n: 0,
      mean: null,
      median: null,
      p95: null,
      min: null,
      max: null,
      sampleVariance: null,
      sampleSd: null,
      populationVariance: null,
      populationSd: null,
    };
  }
  const sorted = [...values].toSorted((a, b) => a - b),
    n = sorted.length;
  const mean = values.reduce((a, v) => a + v, 0) / n;
  const sumSquares = values.reduce((a, v) => a + (v - mean) ** 2, 0);
  return {
    n,
    mean,
    median:
      n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    p95: sorted[Math.ceil(n * 0.95) - 1],
    min: sorted[0],
    max: sorted.at(-1),
    sampleVariance: n > 1 ? sumSquares / (n - 1) : null,
    sampleSd: n > 1 ? Math.sqrt(sumSquares / (n - 1)) : null,
    populationVariance: sumSquares / n,
    populationSd: Math.sqrt(sumSquares / n),
  };
}

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

export function validateOptions(input) {
  const options = {
    mode: "cold",
    samples: 10,
    warmups: 0,
    timeoutMs: 120_000,
    totalTimeoutMs: 1_800_000,
    pollMs: 50,
    maxOutputBytes: 8 * 1024 * 1024,
    cwd: process.cwd(),
    inputs: [],
    ...input,
  };
  if (!["cold", "warm"].includes(options.mode)) {
    throw new Error("mode must be cold or warm");
  }
  if (
    typeof options.label !== "string" ||
    !options.label.trim() ||
    options.label.length > 512
  ) {
    throw new Error("A nonempty label (<=512 characters) is required");
  }
  if (
    !Array.isArray(options.command) ||
    !options.command.length ||
    options.command.some((v) => typeof v !== "string" || v.includes("\0")) ||
    !options.command[0]
  ) {
    throw new Error("command must be a nonempty argv array without NUL bytes");
  }
  if (
    !Array.isArray(options.inputs) ||
    options.inputs.length > 100 ||
    options.inputs.some((v) => typeof v !== "string" || !v)
  ) {
    throw new Error("inputs must contain at most 100 nonempty paths");
  }
  integer(options.samples, "samples", 1, LIMITS.samples);
  integer(options.warmups, "warmups", 0, LIMITS.warmups);
  integer(options.timeoutMs, "timeoutMs", 50, LIMITS.timeoutMs);
  integer(options.totalTimeoutMs, "totalTimeoutMs", 50, LIMITS.totalTimeoutMs);
  integer(options.pollMs, "pollMs", 10, 1000);
  integer(options.maxOutputBytes, "maxOutputBytes", 1024, LIMITS.outputBytes);
  if (options.mode === "cold" && options.warmups !== 0) {
    throw new Error("warmups require explicit warm mode");
  }
  options.cwd = path.resolve(options.cwd);
  return options;
}

async function executable(command, cwd) {
  const candidates = command.includes("/")
    ? [path.resolve(cwd, command)]
    : (process.env.PATH ?? "")
        .split(path.delimiter)
        .map((p) => path.resolve(cwd, p, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await lstat(await realpath(candidate))).isFile()) {
        return await realpath(candidate);
      }
    } catch {
      /* Try the next PATH entry. */
    }
  }
  throw new Error(`Executable not found: ${command}`);
}

async function fileHash(file, check = () => {}) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    check();
    digest.update(chunk);
  }
  return digest.digest("hex");
}

export async function fingerprintInputs(inputs, cwd, check = () => {}) {
  let bytes = 0,
    count = 0;
  const results = [];
  for (const input of inputs) {
    const root = path.resolve(cwd, input),
      entries = [];
    async function walk(file, relative) {
      check();
      if (++count > LIMITS.inputEntries) {
        throw new Error("Input entry limit exceeded");
      }
      const info = await lstat(file);
      if (info.isSymbolicLink()) {
        throw new Error(
          `Input symlink is not immutable content: ${file}; use an archive or resolved file`
        );
      }
      if (info.isDirectory()) {
        entries.push({ path: relative, type: "directory" });
        for (const name of (await readdir(file)).toSorted()) {
          await walk(
            path.join(file, name),
            relative ? `${relative}/${name}` : name
          );
        }
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > LIMITS.inputBytes) {
          throw new Error(
            "Input hashing limit is 1 GiB; supply bounded input archives"
          );
        }
        entries.push({
          path: relative,
          type: "file",
          bytes: info.size,
          sha256: await fileHash(file, check),
        });
      } else {
        throw new Error(`Unsupported input file type: ${file}`);
      }
    }
    await walk(root, "");
    results.push({
      path: root,
      contentSha256: hash(JSON.stringify(entries)),
      entries,
    });
  }
  return results;
}

async function safeRead(file) {
  try {
    const value = await readFile(file, "utf8");
    return {
      file,
      value: value.slice(0, 65536),
      truncated: value.length > 65536,
    };
  } catch (error) {
    return { file, unavailable: error.code ?? error.message };
  }
}

export async function captureEnvironment(cwd) {
  const cpus = os.cpus();
  const evidence = {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    node: process.version,
    nodeExecutable: process.execPath,
    cpu: {
      logicalCount: cpus.length,
      availableParallelism: os.availableParallelism(),
      models: [...new Set(cpus.map((c) => c.model))],
    },
    memory: { hostTotalBytes: os.totalmem(), hostFreeBytes: os.freemem() },
    loadAverage: os.loadavg(),
    storage: null,
    cgroup: null,
    gaps: [
      "Host memory/CPU inventory is not a container allocation or benchmark CPU consumption",
      "Filesystem capacity is not disk model, throughput, IOPS or observed workload I/O",
    ],
  };
  try {
    const s = await statfs(cwd, { bigint: true });
    evidence.storage = {
      path: cwd,
      filesystemType: String(s.type),
      blockSize: String(s.bsize),
      totalBytes: String(s.blocks * s.bsize),
      freeBytes: String(s.bfree * s.bsize),
      availableBytes: String(s.bavail * s.bsize),
      source: "fs.statfs; byte values are decimal strings",
    };
  } catch (error) {
    evidence.gaps.push(`statfs unavailable: ${error.code}`);
  }
  if (process.platform === "linux") {
    const membership = await safeRead("/proc/self/cgroup"),
      mounts = await safeRead("/proc/self/mountinfo");
    const line = membership.value?.split("\n").find((v) => v.startsWith("0::"));
    const mount = mounts.value
      ?.split("\n")
      .find((v) => v.includes(" - cgroup2 "));
    evidence.cgroup = {
      membership,
      version: line && mount ? 2 : null,
      limits: [],
      scope:
        "Existing shared cgroup/ancestors; lifetime counters include harness and other processes. No cgroup writes/resets.",
    };
    if (line && mount) {
      const unescape = (v) =>
        v.replace(/\\([0-7]{3})/g, (_, n) =>
          String.fromCharCode(Number.parseInt(n, 8))
        );
      const fields = mount.split(" "),
        mountRoot = unescape(fields[3]),
        mountPoint = unescape(fields[4]);
      const groupPath = line.slice(3);
      const relative =
        mountRoot !== "/" &&
        (groupPath === mountRoot || groupPath.startsWith(`${mountRoot}/`))
          ? groupPath.slice(mountRoot.length)
          : groupPath;
      let current = path.resolve(mountPoint, `.${relative}`);
      if (current === mountPoint || current.startsWith(`${mountPoint}/`)) {
        for (let depth = 0; depth < 64; depth++) {
          const files = await Promise.all(
            [
              "cpu.max",
              "cpuset.cpus.effective",
              "memory.max",
              "memory.high",
              "cpu.stat",
              "memory.current",
              "memory.peak",
              "io.max",
            ].map((name) => safeRead(path.join(current, name)))
          );
          evidence.cgroup.limits.push({ directory: current, files });
          if (current === mountPoint) {
            break;
          }
          current = path.dirname(current);
        }
      } else {
        evidence.gaps.push(
          "cgroup namespace path could not be resolved within its mount"
        );
      }
    } else {
      evidence.gaps.push(
        "cgroup v2 not resolved; cgroup v1 allocations are unavailable"
      );
    }
    evidence.gaps.push(
      "Cgroup namespaces may hide additional ancestor limits; no dedicated per-command cgroup was created"
    );
    const status = await safeRead("/proc/self/status");
    evidence.cpu.affinity =
      status.value
        ?.split("\n")
        .filter((v) => /^(Cpus_allowed_list|Mems_allowed_list):/.test(v)) ??
      null;
  } else {
    evidence.gaps.push("Linux cgroup limits are not applicable on macOS");
  }
  return evidence;
}

export function parseTime(text, platform) {
  if (platform === "linux") {
    const match = [
      ...text.matchAll(/^CI_OPERATION_TIME_V1\t([\d.]+)\t([\d.]+)\t(\d+)$/gm),
    ].at(-1);
    return match
      ? {
          userCpuMs: Number(match[1]) * 1000,
          systemCpuMs: Number(match[2]) * 1000,
          reportedMaxRssBytes: Number(match[3]) * 1024,
          raw: match[0],
        }
      : null;
  }
  const cpu = [
    ...text.matchAll(/^\s*([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys\s*$/gm),
  ].at(-1);
  const rss = [
    ...text.matchAll(/^\s*(\d+)\s+maximum resident set size\s*$/gm),
  ].at(-1);
  return cpu && rss
    ? {
        userCpuMs: Number(cpu[2]) * 1000,
        systemCpuMs: Number(cpu[3]) * 1000,
        reportedMaxRssBytes: Number(rss[1]),
        raw: `${cpu[0].trim()}\n${rss[0].trim()}`,
      }
    : null;
}

async function probeTime() {
  const args =
    process.platform === "darwin"
      ? ["-l"]
      : ["-f", "CI_OPERATION_TIME_V1\t%U\t%S\t%M"];
  try {
    const result = await exec(
      "/usr/bin/time",
      [...args, process.execPath, "-e", ""],
      { timeout: 3000, maxBuffer: 65536, env: { ...process.env, LC_ALL: "C" } }
    );
    if (!parseTime(result.stderr, process.platform)) {
      throw new Error("Unrecognized time output");
    }
    return {
      available: true,
      executable: "/usr/bin/time",
      args,
      scope:
        "OS-accounted command and waited descendants CPU; maxRSS is an OS resource-usage high-water statistic, NOT simultaneous tree RSS",
    };
  } catch {
    return {
      available: false,
      gap: "/usr/bin/time preflight failed or its resource format is unsupported; workload is not retried",
    };
  }
}

export function parseProcessTable(text) {
  return text
    .trim()
    .split("\n")
    .flatMap((line) => {
      const m = line
        .trim()
        .match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(?:(\d+)-)?([\d:.]+)$/);
      if (!m) {
        return [];
      }
      const clock = m[6].split(":").map(Number);
      if (clock.some((v) => !Number.isFinite(v))) {
        return [];
      }
      return [
        {
          pid: Number(m[1]),
          ppid: Number(m[2]),
          pgid: Number(m[3]),
          rssBytes: Number(m[4]) * 1024,
          cpuMs:
            (Number(m[5] ?? 0) * 86400 +
              clock.reduce((s, n) => s * 60 + n, 0)) *
            1000,
        },
      ];
    });
}

export function selectTree(rows, root) {
  const selected = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (
        !selected.has(row.pid) &&
        (row.pgid === root || selected.has(row.ppid))
      ) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => selected.has(row.pid));
}

async function processTable() {
  const result = await exec(
    "/bin/ps",
    ["-axo", "pid=,ppid=,pgid=,rss=,time="],
    {
      timeout: 2000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    }
  );
  return parseProcessTable(result.stdout);
}

function monitor(pid, pollMs) {
  const last = new Map();
  let stopped = false,
    running = null,
    timer,
    peak = null,
    cpu = 0,
    snapshots = 0,
    gaps = [],
    raw = [];
  const poll = () => {
    if (running) {
      return running;
    }
    running = (async () => {
      try {
        const tree = selectTree(await processTable(), pid);
        if (tree.length) {
          snapshots++;
          const rss = tree.reduce((s, r) => s + r.rssBytes, 0);
          peak = Math.max(peak ?? 0, rss);
          for (const r of tree) {
            cpu += Math.max(0, r.cpuMs - (last.get(r.pid) ?? 0));
            last.set(r.pid, r.cpuMs);
          }
          if (raw.length < 20_000) {
            raw.push({
              atMs: performance.now(),
              rssBytes: rss,
              ownCpuMsByPid: tree.map((r) => [r.pid, r.cpuMs]),
              pids: tree.map((r) => r.pid),
            });
          }
        }
      } catch {
        gaps = [
          "Process-tree polling unavailable or denied; tree CPU/RSS metrics are null",
        ];
        stopped = true;
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };
  const tick = async () => {
    await poll();
    if (!stopped) {
      timer = setTimeout(tick, pollMs);
    }
  };
  void tick();
  return {
    async reset() {
      await poll();
      peak = null;
      cpu = 0;
      snapshots = 0;
      raw = [];
    },
    async finish(stop = true) {
      if (stop) {
        stopped = true;
        clearTimeout(timer);
      }
      await poll();
      return {
        sampledTreePeakRssBytes: peak,
        sampledTreeCpuMs: snapshots ? cpu : null,
        snapshots,
        rawSnapshots: raw,
        gaps: [
          ...gaps,
          ...(!snapshots && !gaps.length
            ? [
                "No live process-tree snapshot captured; command may be shorter than polling resolution",
              ]
            : []),
          "ps CPU is a coarse per-PID estimate; short-lived/reaped or escaped processes and PID reuse can invalidate completeness",
          "RSS sums live rows per snapshot (not atomic); shared pages can be double counted; maxima between polls are missed",
        ],
      };
    },
  };
}

function launch(command, options, timeTool, protocol = false) {
  const actual = timeTool.available
    ? [timeTool.executable, ...timeTool.args, ...command]
    : command;
  const child = spawn(actual[0], actual.slice(1), {
    cwd: options.cwd,
    shell: false,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C" },
  });
  let rejectFailure,
    failure,
    closed = false,
    tail = "",
    buffer = "",
    outputBytes = 0,
    stdoutBytes = 0,
    stderrBytes = 0,
    handler = null;
  const stdoutHash = createHash("sha256"),
    stderrHash = createHash("sha256");
  const failed = new Promise((_, reject) => {
    rejectFailure = reject;
  });
  failed.catch(() => {});
  const kill = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  };
  const abort = (error) => {
    if (!failure) {
      failure = error;
      rejectFailure(error);
    }
    kill();
  };
  child.on("error", abort);
  child.stdin.on("error", (error) => {
    if (!closed) {
      abort(error);
    }
  });
  const completion = new Promise((resolve) =>
    child.once("close", (code, signal) => {
      closed = true;
      resolve({ code, signal });
    })
  );
  for (const [stream, digest, name] of [
    [child.stdout, stdoutHash, "stdout"],
    [child.stderr, stderrHash, "stderr"],
  ]) {
    stream.on("data", (chunk) => {
      outputBytes += chunk.length;
      digest.update(chunk);
      if (name === "stdout") {
        stdoutBytes += chunk.length;
      } else {
        stderrBytes += chunk.length;
      }
      if (outputBytes > options.maxOutputBytes) {
        abort(new Error("Child output exceeded maxOutputBytes"));
        return;
      }
      if (name === "stderr") {
        tail = (tail + chunk.toString()).slice(-65536);
      }
      if (protocol && name === "stdout") {
        buffer += chunk.toString();
        if (buffer.length > 65536) {
          abort(new Error("Protocol line exceeds 64 KiB"));
          return;
        }
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            if (!handler) {
              throw new Error("Unsolicited protocol message");
            }
            handler(JSON.parse(line));
          } catch (error) {
            abort(new Error(`Invalid warm protocol: ${error.message}`));
          }
        }
      }
    });
  }
  return {
    child,
    completion,
    kill,
    abort,
    onMessage(fn) {
      handler = fn;
    },
    async wait(promise, ms, description, rejectExit = false) {
      let timer;
      try {
        return await Promise.race([
          promise,
          failed,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error(`${description} timed out`);
              abort(error);
              reject(error);
            }, ms);
          }),
          ...(rejectExit
            ? [
                completion.then(({ code, signal }) => {
                  throw new Error(
                    `Child exited before ${description}: code=${code} signal=${signal}`
                  );
                }),
              ]
            : []),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    output() {
      return {
        stdout: { bytes: stdoutBytes, sha256: stdoutHash.digest("hex") },
        stderr: { bytes: stderrBytes, sha256: stderrHash.digest("hex") },
        officialTime: timeTool.available
          ? parseTime(tail, process.platform)
          : null,
      };
    },
    async dispose() {
      kill();
      if (!closed) {
        let timer;
        try {
          await Promise.race([
            completion,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 500);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    },
  };
}

export async function runBenchmark(input) {
  const options = validateOptions(input);
  if (!["linux", "darwin"].includes(process.platform)) {
    throw new Error(
      "Only macOS and Linux process-group measurement is supported"
    );
  }
  const started = performance.now();
  const remaining = () => {
    const left = options.totalTimeoutMs - (performance.now() - started);
    if (left <= 0) {
      throw new Error("Total benchmark deadline exceeded");
    }
    return Math.min(options.timeoutMs, left);
  };
  const report = {
    schemaVersion: 1,
    status: "running",
    timestamp: new Date().toISOString(),
    options,
    semantics: {
      cold: "fresh child per sample; OS caches NOT cleared",
      warm: "one persistent cooperating protocol worker; wall includes IPC; no per-operation time(1) high-water attribution",
      statistics:
        "median averages the two middle values; p95 nearest rank; sample variance/SD use n-1, null for n<2; variances have squared metric units",
      resources:
        "time maxRSS is NOT tree peak; sampled tree RSS is max(sum of live RSS at each poll), not sum of per-process peaks",
      isolation:
        "No CPU pinning, cache clearing or isolated cgroup; escaped sessions may evade process-group cleanup",
      environment:
        "Inherited environment values are not recorded; LC_ALL=C is applied. Exact command argv is recorded: do not pass secrets as command arguments",
    },
    samples: [],
    warmups: [],
    gaps: [],
  };
  try {
    report.environmentBefore = await captureEnvironment(options.cwd);
    const command = [
      await executable(options.command[0], options.cwd),
      ...options.command.slice(1),
    ];
    report.identity = {
      label: options.label,
      argv: command,
      cwd: options.cwd,
      executableSha256: await fileHash(command[0], remaining),
      harnessSha256: await fileHash(fileURLToPath(import.meta.url), remaining),
      inputsBefore: await fingerprintInputs(
        options.inputs,
        options.cwd,
        remaining
      ),
    };
    report.identity.commandSha256 = hash(
      JSON.stringify({ argv: command, cwd: options.cwd })
    );
    report.identity.inputsSha256 = hash(
      JSON.stringify(report.identity.inputsBefore.map((i) => i.contentSha256))
    );
    if (!options.inputs.length) {
      report.gaps.push(
        "No input paths supplied; command/executable are hashed but workload input identity is unproven"
      );
    }
    const timeTool = await probeTime();
    report.timeTool = timeTool;
    if (!timeTool.available) {
      report.gaps.push(timeTool.gap);
    }
    if (options.mode === "cold") {
      for (let index = 0; index < options.samples; index++) {
        const timeout = remaining(),
          begin = performance.now();
        const worker = launch(command, options, timeTool),
          tree = monitor(worker.child.pid, options.pollMs);
        const sample = { index, success: false };
        try {
          worker.child.stdin.end();
          const exit = await worker.wait(worker.completion, timeout, "Command");
          sample.wallMs = performance.now() - begin;
          sample.exit = exit;
          if (exit.code !== 0 || exit.signal) {
            throw new Error(
              `Command failed: code=${exit.code} signal=${exit.signal}`
            );
          }
          sample.success = true;
        } catch (error) {
          sample.wallMs ??= performance.now() - begin;
          sample.error = error.message;
          throw error;
        } finally {
          await worker.dispose();
          sample.tree = await tree.finish();
          Object.assign(sample, worker.output());
          report.samples.push(sample);
        }
      }
    } else {
      const worker = launch(command, options, timeTool, true),
        tree = monitor(worker.child.pid, options.pollMs);
      let readyResolve,
        pending = null,
        ready = false;
      const readyPromise = new Promise((resolve) => {
        readyResolve = resolve;
      });
      worker.onMessage((message) => {
        if (!ready) {
          if (message?.type !== "ready" || message.protocol !== PROTOCOL) {
            throw new Error(`Expected ${PROTOCOL} ready handshake`);
          }
          ready = true;
          readyResolve();
          return;
        }
        if (
          !pending ||
          message?.type !== "result" ||
          message.id !== pending.id ||
          message.ok !== true
        ) {
          throw new Error(
            "Expected successful result for the current request id"
          );
        }
        const resolve = pending.resolve;
        pending = null;
        resolve();
      });
      try {
        await worker.wait(readyPromise, remaining(), "Warm handshake", true);
        for (
          let index = 0;
          index < options.warmups + options.samples;
          index++
        ) {
          await tree.reset();
          const id = index + 1,
            warmup = index < options.warmups;
          const result = new Promise((resolve) => {
            pending = { id, resolve };
          });
          const begin = performance.now(),
            sample = {
              id,
              index: warmup ? index : index - options.warmups,
              warmup,
              success: false,
            };
          try {
            const timeout = remaining();
            worker.send({ type: "run", id, warmup });
            await worker.wait(result, timeout, "Warm operation", true);
            sample.wallMs = performance.now() - begin;
            sample.success = true;
          } catch (error) {
            sample.wallMs = performance.now() - begin;
            sample.error = error.message;
            throw error;
          } finally {
            sample.tree = await tree.finish(false);
            sample.officialTime = null;
            sample.gaps = [
              "time(1) CPU/maxRSS is session-wide, unavailable per warm operation; sampled tree counters are estimates",
            ];
            (warmup ? report.warmups : report.samples).push(sample);
          }
        }
        worker.send({ type: "shutdown" });
        worker.child.stdin.end();
        const exit = await worker.wait(
          worker.completion,
          remaining(),
          "Warm shutdown"
        );
        if (exit.code !== 0 || exit.signal) {
          throw new Error(
            `Warm command failed: code=${exit.code} signal=${exit.signal}`
          );
        }
      } finally {
        await worker.dispose();
        await tree.finish();
        report.warmSession = worker.output();
      }
    }
    report.identity.inputsAfter = await fingerprintInputs(
      options.inputs,
      options.cwd,
      remaining
    );
    report.identity.executableSha256After = await fileHash(
      command[0],
      remaining
    );
    if (
      JSON.stringify(report.identity.inputsBefore) !==
        JSON.stringify(report.identity.inputsAfter) ||
      report.identity.executableSha256 !== report.identity.executableSha256After
    ) {
      throw new Error(
        "Command executable or declared inputs changed during benchmark"
      );
    }
    remaining();
    report.status = "success";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
  }
  report.durationMs = performance.now() - started;
  report.summary = Object.fromEntries(
    [
      ["wallMs", (s) => s.wallMs],
      [
        "officialCpuMs",
        (s) =>
          s.officialTime
            ? s.officialTime.userCpuMs + s.officialTime.systemCpuMs
            : null,
      ],
      ["officialMaxRssBytes", (s) => s.officialTime?.reportedMaxRssBytes],
      ["sampledTreeCpuMs", (s) => s.tree?.sampledTreeCpuMs],
      ["sampledTreePeakRssBytes", (s) => s.tree?.sampledTreePeakRssBytes],
    ].map(([name, select]) => [
      name,
      {
        ...statistics(
          report.samples
            .filter((s) => s.success)
            .map(select)
            .filter((v) => Number.isFinite(v))
        ),
        totalSamples: report.samples.length,
      },
    ])
  );
  if (report.status === "failed") {
    const error = new Error(report.error);
    error.report = report;
    throw error;
  }
  return report;
}

export function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0) {
    throw new Error(
      "Usage: --label NAME [--input PATH] [--mode cold|warm] [--samples N] [--warmups N] [--timeout-ms N] [--total-timeout-ms N] [--poll-ms N] [--max-output-bytes N] [--cwd DIR] [--output FILE] -- COMMAND [ARGS...]"
    );
  }
  const result = { command: argv.slice(separator + 1), inputs: [] },
    seen = new Set();
  const keys = {
    "--label": "label",
    "--mode": "mode",
    "--samples": "samples",
    "--warmups": "warmups",
    "--timeout-ms": "timeoutMs",
    "--total-timeout-ms": "totalTimeoutMs",
    "--poll-ms": "pollMs",
    "--max-output-bytes": "maxOutputBytes",
    "--cwd": "cwd",
    "--output": "output",
  };
  for (let i = 0; i < separator; i += 2) {
    const key = argv[i],
      value = argv[i + 1];
    if (i + 1 >= separator || (!keys[key] && key !== "--input")) {
      throw new Error(`Unknown or missing option: ${key}`);
    }
    if (key === "--input") {
      result.inputs.push(value);
    } else {
      if (seen.has(key)) {
        throw new Error(`Duplicate option: ${key}`);
      }
      seen.add(key);
      const numeric = [
        "samples",
        "warmups",
        "timeoutMs",
        "totalTimeoutMs",
        "pollMs",
        "maxOutputBytes",
      ].includes(keys[key]);
      let parsed = value;
      if (numeric) {
        parsed = /^\d+$/.test(value) ? Number(value) : NaN;
      }
      result[keys[key]] = parsed;
    }
  }
  return validateOptions(result);
}

async function main() {
  let options, report;
  try {
    options = parseArgs(process.argv.slice(2));
    report = await runBenchmark(options);
  } catch (error) {
    report = error.report ?? { status: "failed", error: error.message };
    process.exitCode = 1;
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options?.output) {
    try {
      await writeFile(options.output, json, { flag: "wx" });
    } catch (error) {
      process.stderr.write(`Cannot create output: ${error.message}\n`);
      process.exitCode = 1;
    }
  } else {
    process.stdout.write(json);
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
