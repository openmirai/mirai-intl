import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

interface TypeScriptFixtureVersion {
  readonly alias: string;
  readonly version: string;
}

interface PackageMetadata {
  readonly bin?: Readonly<Record<string, string>>;
  readonly version?: string;
}

interface FixtureResult {
  readonly diagnostics: Readonly<Record<string, number | string>>;
  readonly passed: boolean;
  readonly version: string;
  readonly wallMilliseconds: number;
}

interface EditorProxyResult {
  readonly completionColdMilliseconds: number;
  readonly completionEntries: number;
  readonly completionWarmMilliseconds: number;
  readonly invalidDiagnosticCount: number;
  readonly invalidDiagnosticsMilliseconds: number;
  readonly quickInfoColdMilliseconds: number;
  readonly quickInfoWarmMilliseconds: number;
  readonly rssBytes: number;
  readonly status: "measured";
  readonly version: string;
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureProject = resolve(workspaceRoot, "fixtures/types/tsconfig.json");
const compilerOutputLimit = 4 * 1024 * 1024;
const compilerTimeoutMilliseconds = 120_000;
const versions = [
  { alias: "typescript-5-9", version: "5.9.3" },
  { alias: "typescript-6", version: "6.0.3" },
  { alias: "typescript-7", version: "7.0.2" },
] as const satisfies ReadonlyArray<TypeScriptFixtureVersion>;
const results: Array<FixtureResult> = [];

function parseExtendedDiagnostics(
  output: string
): Readonly<Record<string, number | string>> {
  const diagnostics: Record<string, number | string> = {};
  for (const line of output.split("\n")) {
    const match = /^(?<name>[^:]+):\s+(?<value>.+)$/u.exec(line.trim());
    const name = match?.groups?.name;
    const rawValue = match?.groups?.value;
    if (!name || !rawValue) {
      continue;
    }
    const normalizedName = name.trim().replaceAll(/\s+/gu, "_").toLowerCase();
    const numeric = /^(?<value>[\d.]+)(?<unit>k|s)?$/iu.exec(rawValue);
    if (!numeric?.groups?.value) {
      diagnostics[normalizedName] = rawValue;
      continue;
    }
    const value = Number(numeric.groups.value);
    const unit = numeric.groups.unit?.toLowerCase();
    if (unit === "k") {
      diagnostics[normalizedName] = value * 1024;
    } else if (unit === "s") {
      diagnostics[normalizedName] = value * 1000;
    } else {
      diagnostics[normalizedName] = value;
    }
  }
  return diagnostics;
}

function elapsed<Result>(operation: () => Result): Readonly<{
  milliseconds: number;
  result: Result;
}> {
  const startedAt = performance.now();
  const result = operation();
  return { milliseconds: performance.now() - startedAt, result };
}

async function measureEditorProxy(
  fixture: TypeScriptFixtureVersion
): Promise<
  EditorProxyResult | Readonly<{ status: "unavailable"; version: string }>
> {
  const packageJsonPath = resolve(
    workspaceRoot,
    "node_modules",
    fixture.alias,
    "package.json"
  );
  const metadata = JSON.parse(
    readFileSync(packageJsonPath, "utf8")
  ) as PackageMetadata;
  if (!metadata.bin?.tsserver) {
    return { status: "unavailable", version: fixture.version };
  }

  const ts = await import(fixture.alias);
  const fixtureRoot = resolve(workspaceRoot, "fixtures", "types");
  const descriptorFile = resolve(fixtureRoot, "descriptors.ts");
  const editorFile = resolve(fixtureRoot, "editor-proxy.ts");
  let content = [
    'import { greetingText, intl } from "./descriptors";',
    'intl.t(greetingText, { count: 1, name: "Ada" });',
    "",
  ].join("\n");
  let version = 0;
  const host = {
    directoryExists: ts.sys.directoryExists,
    fileExists: ts.sys.fileExists,
    getCompilationSettings: () => ({
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: false,
      strict: true,
      target: ts.ScriptTarget.ES2024,
    }),
    getCurrentDirectory: () => fixtureRoot,
    getDefaultLibFileName: (options: unknown) =>
      ts.getDefaultLibFilePath(options),
    getDirectories: ts.sys.getDirectories,
    getNewLine: () => "\n",
    getScriptFileNames: () => [descriptorFile, editorFile],
    getScriptSnapshot(fileName: string) {
      if (fileName === editorFile) {
        return ts.ScriptSnapshot.fromString(content);
      }
      const source = ts.sys.readFile(fileName);
      return source === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(source);
    },
    getScriptVersion: (fileName: string) =>
      fileName === editorFile ? String(version) : "0",
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile,
  };
  const service = ts.createLanguageService(host);
  const quickInfoPosition = content.indexOf(
    "greetingText",
    content.indexOf("intl.t")
  );
  const completionPosition = content.indexOf("intl.t") + "intl.".length;
  const quickInfoCold = elapsed(() =>
    service.getQuickInfoAtPosition(editorFile, quickInfoPosition)
  );
  const quickInfoWarm = elapsed(() =>
    service.getQuickInfoAtPosition(editorFile, quickInfoPosition)
  );
  const completionCold = elapsed(() =>
    service.getCompletionsAtPosition(editorFile, completionPosition, {})
  );
  const completionWarm = elapsed(() =>
    service.getCompletionsAtPosition(editorFile, completionPosition, {})
  );

  content = content.replace('count: 1, name: "Ada"', "count: 1");
  version += 1;
  const invalidDiagnostics = elapsed(() =>
    service.getSemanticDiagnostics(editorFile)
  );
  service.dispose();

  return {
    completionColdMilliseconds: completionCold.milliseconds,
    completionEntries: completionCold.result?.entries.length ?? 0,
    completionWarmMilliseconds: completionWarm.milliseconds,
    invalidDiagnosticCount: invalidDiagnostics.result.length,
    invalidDiagnosticsMilliseconds: invalidDiagnostics.milliseconds,
    quickInfoColdMilliseconds: quickInfoCold.milliseconds,
    quickInfoWarmMilliseconds: quickInfoWarm.milliseconds,
    rssBytes: process.memoryUsage().rss,
    status: "measured",
    version: fixture.version,
  };
}

let failed = false;

for (const fixture of versions) {
  const packageRoot = resolve(workspaceRoot, "node_modules", fixture.alias);
  const packageJsonPath = resolve(packageRoot, "package.json");
  const metadata = JSON.parse(
    readFileSync(packageJsonPath, "utf8")
  ) as PackageMetadata;

  if (metadata.version !== fixture.version) {
    process.stderr.write(
      `[type-fixtures] ${fixture.alias} resolved ${metadata.version ?? "unknown"}; expected ${fixture.version}\n`
    );
    failed = true;
    continue;
  }

  const relativeCompilerPath = metadata.bin?.tsc;
  if (!relativeCompilerPath) {
    process.stderr.write(
      `[type-fixtures] ${fixture.alias} does not expose a tsc binary\n`
    );
    failed = true;
    continue;
  }

  const startedAt = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      resolve(packageRoot, relativeCompilerPath),
      "--project",
      fixtureProject,
      "--pretty",
      "false",
      "--extendedDiagnostics",
    ],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      killSignal: "SIGKILL",
      maxBuffer: compilerOutputLimit,
      shell: false,
      timeout: compilerTimeoutMilliseconds,
      windowsHide: true,
    }
  );
  const errorCode = result.error ? Reflect.get(result.error, "code") : null;
  const timedOut = errorCode === "ETIMEDOUT";
  const passed =
    result.error === undefined && result.status === 0 && result.signal === null;
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  results.push({
    diagnostics: parseExtendedDiagnostics(output),
    passed,
    version: fixture.version,
    wallMilliseconds: performance.now() - startedAt,
  });

  if (!passed) {
    process.stderr.write(
      [
        `[type-fixtures] TypeScript ${fixture.version} failed`,
        `timeoutMilliseconds=${compilerTimeoutMilliseconds}`,
        `maxOutputBytes=${compilerOutputLimit}`,
        `timedOut=${String(timedOut)}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `errorCode=${typeof errorCode === "string" ? errorCode : "(none)"}`,
        `error=${result.error?.message ?? "(none)"}`,
        output || "(empty output)",
        "",
      ].join("\n")
    );
    failed = true;
    continue;
  }

  process.stdout.write(
    `[type-fixtures] TypeScript ${fixture.version} passed\n`
  );
}

const outputRoot = resolve(workspaceRoot, ".tmp", "type-fixtures");
const editorProxy = [];
for (const fixture of versions) {
  editorProxy.push(await measureEditorProxy(fixture));
}
mkdirSync(outputRoot, { recursive: true });
writeFileSync(
  resolve(outputRoot, "results.json"),
  `${JSON.stringify(
    {
      fixtureProject: "fixtures/types/tsconfig.json",
      editorProxy,
      results,
      schemaVersion: 1,
      tsserverNote:
        "The proxy uses the same TypeScript language-service engine as tsserver. TypeScript 7.0.2 has no tsserver binary, so only compiler fixtures are available for that lane.",
    },
    null,
    2
  )}\n`,
  "utf8"
);

if (failed) {
  process.exitCode = 1;
}
