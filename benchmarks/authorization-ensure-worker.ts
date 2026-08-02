import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

type Request = Readonly<{
  contextId: string;
  expectedFixtureHash: string;
  id: number;
  kind: "bootstrap" | "measure" | "warmup";
  root: string;
}>;

async function files(root: string, directory = root): Promise<Array<string>> {
  const result: Array<string> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".benchmark", ".mirai-intl", "generated"].includes(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await files(root, path)));
    } else if (entry.isFile()) {
      result.push(relative(root, path).split("\\").join("/"));
    }
  }
  return result;
}

async function hashFixture(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of (await files(root)).toSorted()) {
    hash.update(path);
    hash.update(await readFile(join(root, path)));
  }
  return `sha256:${hash.digest("hex")}`;
}

async function lifecyclePath(cli: string): Promise<string> {
  const directory = dirname(cli);
  const path = (await readdir(directory))
    .filter((name) => /^lifecycle-.*\.js$/u.test(name))
    .toSorted()[0];
  if (!path) {
    throw new Error(`No lifecycle implementation beside ${cli}`);
  }
  return join(directory, path);
}

const cli = process.env.MIRAI_INTL_BENCHMARK_CLI;
const contextId = process.env.MIRAI_INTL_BENCHMARK_CONTEXT;
if (!cli || !contextId) {
  throw new Error("Worker engine CLI and context identity are required");
}
const lifecycle = await lifecyclePath(resolve(cli));
const implementationHash = `sha256:${createHash("sha256")
  .update(await readFile(lifecycle))
  .digest("hex")}`;
const imported = (await import(lifecycle)) as Readonly<Record<string, unknown>>;
const ensure = imported.t;
if (typeof ensure !== "function") {
  throw new Error(
    `Regular ensure export is missing from ${basename(lifecycle)}`
  );
}

process.send?.({
  contextId,
  implementationHash,
  lifecycle: basename(lifecycle),
  pid: process.pid,
  type: "ready",
});

process.on("message", (value: unknown) => {
  void (async () => {
    const request = value as Request;
    if (request.contextId !== contextId) {
      throw new Error("Worker context identity changed");
    }
    const beforeHash = await hashFixture(request.root);
    if (beforeHash !== request.expectedFixtureHash) {
      throw new Error("Fixture bytes changed before ensure");
    }
    const started = performance.now();
    const result = (await ensure({ root: request.root })) as Readonly<{
      changed?: boolean;
    }>;
    const milliseconds = performance.now() - started;
    const afterHash = await hashFixture(request.root);
    if (afterHash !== beforeHash) {
      throw new Error("Fixture bytes changed during ensure");
    }
    const expectedChanged = request.kind === "bootstrap";
    if (result.changed !== expectedChanged) {
      throw new Error(
        `${request.kind} ensure must report changed=${String(expectedChanged)}`
      );
    }
    process.send?.({
      afterHash,
      beforeHash,
      changed: result.changed,
      contextId,
      id: request.id,
      kind: request.kind,
      milliseconds,
      peakRssBytes:
        process.resourceUsage().maxRSS *
        (process.platform === "darwin" ? 1 : 1024),
      pid: process.pid,
      type: "result",
    });
  })().catch((error: unknown) => {
    process.send?.({
      message: error instanceof Error ? error.message : String(error),
      type: "fatal",
    });
    process.exitCode = 1;
    process.disconnect?.();
  });
});
