import { spawn } from "node:child_process";
import type * as IcuParser from "@formatjs/icu-messageformat-parser";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

const parserCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock("@formatjs/icu-messageformat-parser", async (original) => {
  const actual = await original<typeof IcuParser>();
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      parserCalls.count += 1;
      return actual.parse(...args);
    },
  };
});
import { loadConventionCatalog } from "../src/catalog";
import { createMessageSemanticsSession } from "../src/message-semantics";
import {
  createMessageSemanticsTransfer,
  messageSemanticsCompilerIdentity,
  MESSAGE_SEMANTICS_PARENT_ENV,
  MESSAGE_SEMANTICS_SESSION_ENV,
  sendMessageSemanticsFrame,
} from "../src/message-semantics-channel";
import type { MessageSemanticsTransfer } from "../src/message-semantics-channel";

const roots: Array<string> = [];
const sourceRoot = resolve(import.meta.dirname, "../src");
const cli = join(sourceRoot, "cli.ts");
const tsx = import.meta.resolve("tsx");
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});
async function json(path: string, value: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "intl-shared-process-"));
  roots.push(root);
  await writeFile(
    join(root, "pnpm-workspace.yaml"),
    "packages:\n  - packages/*\n  - apps/*\n"
  );
  const shared = join(root, "packages/i18n");
  const apps = Array.from({ length: 4 }, (_, i) => join(root, `apps/app${i}`));
  for (const [index, directory] of [shared, ...apps].entries()) {
    await json(join(directory, "package.json"), {
      name: index === 0 ? "@fixture/i18n" : `@fixture/app${index}`,
      version: "1.0.0",
      dependencies: {
        vite: "8.1.4",
        ...(index ? { "@fixture/i18n": "workspace:*" } : {}),
      },
    });
    await json(join(directory, "tsconfig.json"), { include: ["src/**/*.ts"] });
    await json(join(directory, "src/locales/en.json"), {
      greeting: "Hello {name}",
    });
    await json(join(directory, "src/locales/th.json"), {
      greeting: "สวัสดี {name}",
    });
    await writeFile(join(directory, "src/page.ts"), "export const page = 1;\n");
    if (index) {
      await mkdir(join(directory, "node_modules/@fixture"), {
        recursive: true,
      });
      await symlink(shared, join(directory, "node_modules/@fixture/i18n"));
      await json(join(directory, "mirai-intl.config.json"), {
        sources: [
          { from: "@fixture/i18n", path: "src/locales", mount: "shared.ui" },
        ],
      });
    }
  }
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    `lockfileVersion: '9.0'\nimporters:\n${[
      "packages/i18n",
      ...apps.map((_, i) => `apps/app${i}`),
    ]
      .map((path) => `  ${path}:\n    dependencies: {}\n`)
      .join("")}`
  );
  return { root, shared, catalogs: [shared, ...apps] };
}

async function child(
  root: string,
  args: Array<string>,
  transfer?: MessageSemanticsTransfer
) {
  const childProcess = spawn(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", tsx, ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        MIRAI_INTL_WORKSPACE_CHILD: "1",
        [MESSAGE_SEMANTICS_SESSION_ENV]: transfer?.session,
        [MESSAGE_SEMANTICS_PARENT_ENV]: transfer
          ? String(process.pid)
          : undefined,
      },
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    }
  );
  let stdout = "",
    stderr = "";
  if (!childProcess.stdout || !childProcess.stderr) {
    throw new Error("Missing child output pipes");
  }
  childProcess.stdout.setEncoding("utf8").on("data", (part: string) => {
    stdout += part;
  });
  childProcess.stderr.setEncoding("utf8").on("data", (part: string) => {
    stderr += part;
  });
  const channel = childProcess.stdio[3];
  const delivery =
    transfer && channel && "write" in channel
      ? sendMessageSemanticsFrame(channel, transfer)
      : Promise.resolve();
  const status = await new Promise<number | null>((res, rej) => {
    childProcess.once("error", rej);
    childProcess.once("exit", res);
  });
  await delivery;
  return { status, stdout, stderr, pid: childProcess.pid };
}
const moduleUrl = (name: string) =>
  JSON.stringify(pathToFileURL(join(sourceRoot, name)).href);
const harness = `
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const { mock } = await import("node:test");
  const parserPath = createRequire(${moduleUrl("parser.ts")}).resolve("@formatjs/icu-messageformat-parser");
  const parser = await import(pathToFileURL(parserPath).href);
  let parseCalls = 0;
  mock.module(parserPath, { namedExports: { ...parser, parse: (...args) => { parseCalls++; return parser.parse(...args); } } });
  const { receiveInheritedMessageSemanticsSession } = await import(${moduleUrl("message-semantics-channel.ts")});
  const { createMessageSemanticsSession } = await import(${moduleUrl("message-semantics.ts")});
  const { loadConventionCatalog } = await import(${moduleUrl("catalog.ts")});
  const { compileCatalog } = await import(${moduleUrl("compile.ts")});
  const { emitArtifacts } = await import(${moduleUrl("emit.ts")});
  const session = await receiveInheritedMessageSemanticsSession() ?? createMessageSemanticsSession();
  const outputs = await session.run(async () => {
    const loaded = await loadConventionCatalog(process.cwd());
    const compiled = compileCatalog(loaded.source);
    return { catalog: compiled.catalog, descriptors: compiled.descriptors, artifacts: emitArtifacts(compiled, "precompiled", { compact: true }) };
  });
  console.log(JSON.stringify({ outputs, parseCalls, stats: session.stats() }));
`;

it("preloads once and reuses exact semantics in five real child processes with byte parity", async () => {
  const { shared, catalogs } = await fixture();
  const preload = createMessageSemanticsSession();
  parserCalls.count = 0;
  await preload.run(() => loadConventionCatalog(shared));
  expect(parserCalls.count).toBe(2);
  expect(preload.stats().misses).toBeGreaterThan(0);
  const transfer = createMessageSemanticsTransfer(
    preload.serialize(),
    await messageSemanticsCompilerIdentity()
  );
  for (const root of catalogs) {
    const baseline = await child(root, [
      "--input-type=module",
      "--eval",
      harness,
    ]);
    const reused = await child(
      root,
      ["--input-type=module", "--eval", harness],
      transfer
    );
    expect({
      status: baseline.status,
      failure: baseline.status === 0 ? undefined : baseline.stderr,
    }).toEqual({ status: 0, failure: undefined });
    expect({
      status: reused.status,
      failure: reused.status === 0 ? undefined : reused.stderr,
    }).toEqual({ status: 0, failure: undefined });
    const control = JSON.parse(baseline.stdout);
    const candidate = JSON.parse(reused.stdout);
    expect(candidate.outputs).toEqual(control.outputs);
    expect(candidate.parseCalls).toBe(0);
    expect(control.parseCalls).toBeGreaterThan(0);
    expect(candidate.stats).toMatchObject({ misses: 0, skipped: 0 });
    expect(candidate.stats.hits).toBeGreaterThan(0);
    expect(control.stats.misses).toBeGreaterThan(0);
  }
}, 60_000);

it("keeps workspace CLI reports and full authorization, including invalid preloads", async () => {
  const { root, shared } = await fixture();
  const valid = await child(root, [
    cli,
    "check",
    "--workspace",
    "--format=json",
  ]);
  expect({
    status: valid.status,
    failure: valid.status === 0 ? undefined : valid.stderr + valid.stdout,
  }).toEqual({ status: 0, failure: undefined });
  const report = JSON.parse(valid.stdout);
  expect(report.success).toBe(true);
  await json(join(shared, "src/locales/th.json"), { greeting: "" });
  const invalid = await child(root, [
    cli,
    "check",
    "--workspace",
    "--format=json",
  ]);
  expect(invalid.status).not.toBe(0);
  expect(JSON.parse(invalid.stdout).success).toBe(false);
}, 60_000);

it("rejects public snapshot arguments instead of treating supplied IR as authority", async () => {
  const { shared } = await fixture();
  const result = await child(shared, [
    cli,
    "prove",
    "--message-semantics-snapshot={}",
  ]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("private compiler-coordinator state");
});

it("rereads changed shared bytes after preload and never accepts a now-invalid translation", async () => {
  const { shared, catalogs } = await fixture();
  const preload = createMessageSemanticsSession();
  await preload.run(() => loadConventionCatalog(shared));
  const transfer = createMessageSemanticsTransfer(
    preload.serialize(),
    await messageSemanticsCompilerIdentity()
  );
  const app = catalogs[1];
  if (!app) {
    throw new Error("Missing app fixture");
  }
  await json(join(shared, "src/locales/en.json"), {
    greeting: "Changed {name}",
  });
  const control = await child(app, ["--input-type=module", "--eval", harness]);
  const changed = await child(
    app,
    ["--input-type=module", "--eval", harness],
    transfer
  );
  expect({
    status: changed.status,
    failure: changed.status === 0 ? undefined : changed.stderr + changed.stdout,
  }).toEqual({ status: 0, failure: undefined });
  expect(JSON.parse(changed.stdout).outputs).toEqual(
    JSON.parse(control.stdout).outputs
  );
  expect(JSON.parse(changed.stdout).parseCalls).toBeGreaterThan(0);
  await json(join(shared, "src/locales/th.json"), { greeting: "" });
  const invalid = await child(
    app,
    ["--input-type=module", "--eval", harness],
    transfer
  );
  expect(invalid.status).not.toBe(0);
  expect(invalid.stderr).toContain("non-empty translation");
}, 30_000);

it("times out a stalled real inherited pipe and exits without a pending filesystem read", async () => {
  const session = "a".repeat(64);
  const program = `
    const { receiveInheritedMessageSemanticsSession } = await import(${moduleUrl("message-semantics-channel.ts")});
    try { await receiveInheritedMessageSemanticsSession(20); }
    catch (error) { console.error(error.message); process.exitCode = 2; }
  `;
  const worker = spawn(
    process.execPath,
    ["--import", tsx, "--input-type=module", "--eval", program],
    {
      env: {
        ...process.env,
        MIRAI_INTL_WORKSPACE_CHILD: "1",
        [MESSAGE_SEMANTICS_SESSION_ENV]: session,
        [MESSAGE_SEMANTICS_PARENT_ENV]: String(process.pid),
      },
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    }
  );
  let stderr = "";
  if (!worker.stderr) {
    throw new Error("Missing worker error pipe");
  }
  worker.stderr.setEncoding("utf8").on("data", (part: string) => {
    stderr += part;
  });
  let killed = false;
  const timeout = setTimeout(() => {
    killed = true;
    worker.kill("SIGKILL");
  }, 3000);
  try {
    const status = await new Promise<number | null>((res, rej) => {
      worker.once("error", rej);
      worker.once("close", res);
    });
    expect(killed).toBe(false);
    expect(status).toBe(2);
    expect(stderr).toContain("channel timed out");
  } finally {
    clearTimeout(timeout);
    worker.kill();
  }
}, 5000);

it("counts actual workspace coordinator ICU work separately from all five prove children", async () => {
  const { root, catalogs } = await fixture();
  const instrumentation = join(root, ".instrumentation");
  await mkdir(instrumentation);
  const preload = join(instrumentation, "count-icu.mjs");
  await writeFile(
    preload,
    `
    import { isMainThread } from "node:worker_threads";
    if (isMainThread) {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const { writeFileSync } = await import("node:fs");
      const { mock } = await import("node:test");
      const parserPath = createRequire(${moduleUrl("parser.ts")}).resolve("@formatjs/icu-messageformat-parser");
      const parser = await import(pathToFileURL(parserPath).href);
      let parseCalls = 0;
      mock.module(parserPath, { namedExports: { ...parser, parse: (...args) => { parseCalls++; return parser.parse(...args); } } });
      process.on("exit", () => writeFileSync(${JSON.stringify(instrumentation)} + "/" + process.pid + ".json", JSON.stringify({
        pid: process.pid, parent: process.ppid, root: process.cwd(), command: process.argv[2], parseCalls
      })));
    }
  `
  );
  const result = await child(root, [
    "--import",
    pathToFileURL(preload).href,
    cli,
    "check",
    "--workspace",
    "--format=json",
  ]);
  expect({
    status: result.status,
    failure: result.status === 0 ? undefined : result.stderr + result.stdout,
  }).toEqual({ status: 0, failure: undefined });
  expect(JSON.parse(result.stdout).success).toBe(true);
  const observations = await Promise.all(
    (await readdir(instrumentation))
      .filter((name) => name.endsWith(".json"))
      .map(
        async (name) =>
          JSON.parse(await readFile(join(instrumentation, name), "utf8")) as {
            pid: number;
            parent: number;
            root: string;
            command: string;
            parseCalls: number;
          }
      )
  );
  const parent = observations.filter(
    (observation) => observation.pid === result.pid
  );
  expect(parent).toHaveLength(1);
  expect(parent[0]).toMatchObject({ command: "check", parseCalls: 2 });
  const children = observations.filter(
    (observation) => observation.parent === result.pid
  );
  expect(children).toHaveLength(5);
  expect(children.map((entry) => entry.root).toSorted()).toEqual(
    (
      await Promise.all(catalogs.map((catalogRoot) => realpath(catalogRoot)))
    ).toSorted()
  );
  for (const observation of children) {
    expect(observation).toMatchObject({ command: "prove", parseCalls: 0 });
  }
  const evidencePath = process.env.MIRAI_INTL_TEST_COUNTER_EVIDENCE;
  if (evidencePath) {
    await writeFile(
      evidencePath,
      JSON.stringify({ coordinator: parent[0], children }, null, 2)
    );
  }
}, 60_000);

it("rejects a private capsule derived under different compiler bytes at the same version", async () => {
  const { shared } = await fixture();
  const preload = createMessageSemanticsSession();
  await preload.run(() => loadConventionCatalog(shared));
  const transfer = createMessageSemanticsTransfer(
    preload.serialize(),
    `sha256:${"0".repeat(64)}`
  );
  const result = await child(shared, [cli, "prove", "--format=json"], transfer);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("execution context mismatch");
});
