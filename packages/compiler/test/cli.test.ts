import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import {
  discoverEmittedModules,
  finalizeBuildProof,
  verifyConventionCheckReceipt,
  verifyFinalizedBuildProof,
  writeProvisionalBuildProof,
} from "../src/proof";
import { colorEnabled } from "../src/reporter";

const cli = resolve(import.meta.dirname, "../src/cli.ts");
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const builtCli = join(repositoryRoot, "packages/compiler/dist/cli.js");
const tsx = resolve(
  import.meta.dirname,
  "../../../node_modules/tsx/dist/cli.mjs"
);

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createConventionApp(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-cli-"));
  await writeConventionApp(root);
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  return root;
}

async function writeConventionApp(root: string): Promise<void> {
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/cli-app",
    version: "1.0.0",
  });
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello {name}",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี {name}",
  });
  await writeJson(join(root, "tsconfig.json"), {
    include: ["src/**/*.ts", "src/**/*.tsx"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
}

function runCliWithEnvironment(
  root: string,
  environment: NodeJS.ProcessEnv,
  ...arguments_: ReadonlyArray<string>
) {
  return spawnSync(process.execPath, [tsx, cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    env: environment,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 30_000,
  });
}

function runCli(root: string, ...arguments_: ReadonlyArray<string>) {
  return runCliWithEnvironment(root, process.env, ...arguments_);
}

async function requireBuiltCli(): Promise<string> {
  await readFile(builtCli, "utf8").catch(() => {
    throw new Error(
      "Mirai Intl CLI tests require the pretest build; run corepack pnpm test instead of invoking Vitest without building"
    );
  });
  return builtCli;
}

async function ensureInstrumentation(
  directory: string
): Promise<Readonly<{ hook: string; report: string }>> {
  const report = join(directory, "ensure-instrumentation.json");
  const actualTypeScript = createRequire(
    join(repositoryRoot, "packages/compiler/package.json")
  ).resolve("typescript");
  await writeFile(
    join(directory, "ensure-loader.mjs"),
    [
      `const typescript = ${JSON.stringify(pathToFileURL(actualTypeScript).href)};`,
      "export function load(url, context, nextLoad) {",
      "  const loaded = nextLoad(url, context);",
      "  if (url === typescript) {",
      "    globalThis.__miraiEnsureTypeScriptLoaded = true;",
      "    return loaded;",
      "  }",
      '  if (loaded.format !== "module") return loaded;',
      '  let source = Buffer.isBuffer(loaded.source) ? loaded.source.toString("utf8") : String(loaded.source);',
      '  if (url.includes("/packages/compiler/dist/analyze-sources-")) {',
      '    source += "\\nglobalThis.__miraiEnsureAnalyzeSourcesLoaded = true;\\n";',
      "    return { ...loaded, source };",
      "  }",
      '  if (url.includes("/packages/compiler/dist/transform-")) {',
      '    source += "\\nglobalThis.__miraiEnsureTransformLoaded = true;\\n";',
      "    return { ...loaded, source };",
      "  }",
      '  if (!url.includes("/packages/compiler/dist/catalog-")) return loaded;',
      '  source = source.replace("function compileCatalog(source) {", "function compileCatalog(source) {\\n globalThis.__miraiEnsureCompileCalls += 1;");',
      '  source = source.replace("function emitArtifacts(output, representation, options = {}) {", "function emitArtifacts(output, representation, options = {}) {\\n globalThis.__miraiEnsureEmitCalls += 1;");',
      '  source += "\\nglobalThis.__miraiEnsureCompilerBundleInstrumented = true;\\n";',
      "  return { ...loaded, source };",
      "}",
      "",
    ].join("\n"),
    "utf8"
  );
  const hook = join(directory, "ensure-hook.mjs");
  await writeFile(
    hook,
    [
      'import { writeFileSync } from "node:fs";',
      'import { registerHooks } from "node:module";',
      'import { load } from "./ensure-loader.mjs";',
      "globalThis.__miraiEnsureCompileCalls = 0;",
      "globalThis.__miraiEnsureEmitCalls = 0;",
      "globalThis.__miraiEnsurePrograms = 0;",
      "globalThis.__miraiEnsureAnalyzeSourcesLoaded = false;",
      "globalThis.__miraiEnsureTypeScriptLoaded = false;",
      "globalThis.__miraiEnsureTransformLoaded = false;",
      "globalThis.__miraiEnsureCompilerBundleInstrumented = false;",
      `const report = ${JSON.stringify(report)};`,
      'process.on("exit", () => writeFileSync(report, JSON.stringify({',
      "  analyzeSourcesLoaded: globalThis.__miraiEnsureAnalyzeSourcesLoaded,",
      "  compileCalls: globalThis.__miraiEnsureCompileCalls,",
      "  compilerBundleInstrumented: globalThis.__miraiEnsureCompilerBundleInstrumented,",
      "  emitCalls: globalThis.__miraiEnsureEmitCalls,",
      "  programs: globalThis.__miraiEnsurePrograms,",
      "  transformLoaded: globalThis.__miraiEnsureTransformLoaded,",
      "  typescriptLoaded: globalThis.__miraiEnsureTypeScriptLoaded,",
      "})));",
      "registerHooks({ load });",
      "",
    ].join("\n"),
    "utf8"
  );
  return { hook, report };
}

async function workspaceAnalysisInstrumentation(
  directory: string
): Promise<Readonly<{ hook: string; report: string }>> {
  const report = join(directory, "workspace-analysis-instrumentation.json");
  await writeFile(
    join(directory, "workspace-analysis-loader.mjs"),
    [
      "export function load(url, context, nextLoad) {",
      "  const loaded = nextLoad(url, context);",
      '  if (loaded.format !== "module" || !url.includes("/packages/compiler/dist/analyze-sources-")) return loaded;',
      '  const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");',
      '  const transformed = source.replace("async function analyzeLoadedConventionSourceFiles(loaded, root, generatedDirectory, sourceFiles, workspaceRoot = root, options = {}) {", "async function analyzeLoadedConventionSourceFiles(loaded, root, generatedDirectory, sourceFiles, workspaceRoot = root, options = {}) {\\n globalThis.__miraiWorkspaceAnalysisCalls += 1;");',
      '  if (source.includes("async function analyzeLoadedConventionSourceFiles(") && transformed === source) throw new Error("Failed to instrument workspace source analysis");',
      "  return { ...loaded, source: transformed === source ? source : `${transformed}\\nglobalThis.__miraiWorkspaceAnalysisInstrumented = true;\\n` };",
      "}",
      "",
    ].join("\n"),
    "utf8"
  );
  const hook = join(directory, "workspace-analysis-hook.mjs");
  await writeFile(
    hook,
    [
      'import { writeFileSync } from "node:fs";',
      'import { registerHooks } from "node:module";',
      'import { load } from "./workspace-analysis-loader.mjs";',
      "globalThis.__miraiWorkspaceAnalysisCalls = 0;",
      "globalThis.__miraiWorkspaceAnalysisInstrumented = false;",
      `const report = ${JSON.stringify(report)};`,
      'process.on("exit", () => writeFileSync(report, JSON.stringify({',
      "  analysisCalls: globalThis.__miraiWorkspaceAnalysisCalls,",
      "  instrumented: globalThis.__miraiWorkspaceAnalysisInstrumented,",
      "})));",
      "registerHooks({ load });",
      "",
    ].join("\n"),
    "utf8"
  );
  return { hook, report };
}

describe("convention-only CLI", () => {
  it("uses Node-compatible color environment precedence", () => {
    expect(colorEnabled(undefined, {}, false)).toBe(false);
    expect(colorEnabled(undefined, {}, true)).toBe(true);
    expect(colorEnabled(undefined, { NO_COLOR: "1" }, true)).toBe(false);
    expect(colorEnabled(undefined, { NODE_DISABLE_COLORS: "1" }, true)).toBe(
      false
    );
    expect(
      colorEnabled(undefined, { FORCE_COLOR: "1", NO_COLOR: "1" }, false)
    ).toBe(true);
    expect(colorEnabled(undefined, { FORCE_COLOR: "0" }, true)).toBe(false);
    expect(colorEnabled(true, { FORCE_COLOR: "0" }, false)).toBe(true);
    expect(colorEnabled(false, { FORCE_COLOR: "1" }, true)).toBe(false);
  });

  it("uses concise stylish lifecycle output by default", async () => {
    const root = await createConventionApp();
    try {
      const generated = runCli(root, "generate", "--no-color");
      expect(generated.status).toBe(0);
      expect(generated.stderr).toBe("");
      expect(generated.stdout).toMatch(
        /^mirai-intl generate ✓ @example\/cli-app · en\+th · 1 message\n$/u
      );
      expect(generated.stdout).not.toContain('"report"');

      const checked = runCli(root, "check", "--no-color");
      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
      expect(checked.stderr).toBe("");
      expect(checked.stdout).toMatch(
        /^mirai-intl check ✓ @example\/cli-app · en\+th · 1 message · 1 authorization · 0 files\n$/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("checks and authorizes every convention catalog in a pnpm workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mirai-intl-workspace-"));
    const shared = join(workspace, "packages/i18n");
    const app = join(workspace, "apps/auth");
    try {
      await writeFile(
        join(workspace, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n  - apps/*\n"
      );
      await writeFile(
        join(workspace, "pnpm-lock.yaml"),
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "",
          "  packages/i18n:",
          "    dependencies: {}",
          "",
          "  apps/auth:",
          "    dependencies: {}",
          "",
        ].join("\n")
      );
      await writeConventionApp(shared);
      await writeConventionApp(app);
      await writeJson(join(shared, "package.json"), {
        dependencies: { vite: "8.1.4" },
        name: "@example/shared-i18n",
        version: "1.0.0",
      });
      await writeJson(join(app, "package.json"), {
        dependencies: { vite: "8.1.4" },
        name: "@example/auth",
        version: "1.0.0",
      });
      for (const root of [shared, app]) {
        await writeFile(join(root, "src/page.ts"), "export const page = 1;\n");
        await writeJson(join(root, "tsconfig.json"), {
          include: ["src/**/*.ts"],
        });
        await writeJson(join(root, "mirai-intl.config.json"), {
          checkProjects: [{ path: "tsconfig.json", role: "owner" }],
        });
      }
      expect(runCli(shared, "generate").status).toBe(0);
      expect(runCli(app, "generate").status).toBe(0);

      const checked = runCli(
        workspace,
        "check",
        "--workspace",
        "--format=json"
      );
      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
      expect(checked.stderr).toBe("");
      expect(JSON.parse(checked.stdout)).toEqual({
        command: "check",
        diagnostics: [],
        schemaVersion: 1,
        success: true,
        summary: {
          catalogCount: 2,
          projects: [
            { findings: 0, path: "apps/auth", valid: true },
            { findings: 0, path: "packages/i18n", valid: true },
          ],
          checkerProjects: 0,
          ownerProjects: 2,
          semanticAuthorizationRuns: 1,
          semanticFilesAnalyzed: 2,
          valid: true,
        },
      });
      expect(checked.stdout).not.toMatch(
        /"(?:compiled|environment|loaded|proof|receipt|report|sources)":/u
      );
      await expect(
        readFile(join(app, ".mirai-intl/check-receipt.v2.json"), "utf8")
      ).resolves.toContain('"schemaVersion":2');
      await expect(
        readFile(join(shared, ".mirai-intl/check-receipt.v2.json"), "utf8")
      ).resolves.toContain('"schemaVersion":2');
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 90_000);

  it.each([
    {
      mutate: async (workspace: string) =>
        writeFile(
          join(workspace, "pnpm-workspace.yaml"),
          "packages:\n  - packages/*\n"
        ),
      name: "workspace exclusion",
    },
    {
      mutate: async (workspace: string) =>
        rm(join(workspace, "pnpm-lock.yaml")),
      name: "missing workspace lockfile",
    },
  ])(
    "fails closed before writing a workspace receipt after $name",
    async ({ mutate }) => {
      const workspace = await mkdtemp(join(tmpdir(), "mirai-intl-workspace-"));
      const app = join(workspace, "apps/auth");
      try {
        await writeFile(
          join(workspace, "pnpm-workspace.yaml"),
          "packages:\n  - apps/*\n"
        );
        await writeFile(
          join(workspace, "pnpm-lock.yaml"),
          "lockfileVersion: '9.0'\nimporters:\n\n  apps/auth:\n    dependencies: {}\n"
        );
        await writeConventionApp(app);
        expect(runCli(app, "generate").status).toBe(0);
        await mutate(workspace);

        const checked = runCli(
          workspace,
          "check",
          "--workspace",
          "--format=json"
        );
        expect(checked.status).toBe(1);
        expect(JSON.parse(checked.stdout)).toMatchObject({
          command: "check",
          success: false,
        });
        expect(checked.stdout).toContain(
          "no pnpm-lock.yaml exists at the package root and no parent pnpm workspace lockfile includes the target package importer"
        );
        await expect(
          readFile(join(app, ".mirai-intl/check-receipt.v2.json"), "utf8")
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await rm(workspace, { force: true, recursive: true });
      }
    },
    90_000
  );

  it("uses simple workspace membership with later top-level settings", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mirai-intl-workspace-"));
    const binRoot = join(workspace, "bin");
    const app = join(workspace, "apps/auth");
    try {
      await writeFile(
        join(workspace, "pnpm-workspace.yaml"),
        "packages:\n  - apps/*\n\noverrides:\n  postcss: 8.5.10\n"
      );
      await writeFile(
        join(workspace, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n\n  apps/auth:\n    dependencies: {}\n"
      );
      await writeConventionApp(app);
      await mkdir(binRoot, { recursive: true });
      const pnpm = join(binRoot, "pnpm");
      await writeFile(
        pnpm,
        "#!/usr/bin/env node\nprocess.stderr.write('pnpm must not run for simple workspace membership\\n');\nprocess.exitCode = 1;\n",
        "utf8"
      );
      await chmod(pnpm, 0o755);

      const generated = runCliWithEnvironment(
        app,
        {
          ...process.env,
          PATH: `${binRoot}${delimiter}${process.env.PATH ?? ""}`,
        },
        "generate",
        "--json"
      );
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("falls back to pnpm for unsupported workspace YAML syntax", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mirai-intl-workspace-"));
    const binRoot = join(workspace, "bin");
    const app = join(workspace, "apps/auth");
    try {
      await writeFile(
        join(workspace, "pnpm-workspace.yaml"),
        'packages:\n  - "apps/*"\n'
      );
      await writeFile(
        join(workspace, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n\n  apps/auth:\n    dependencies: {}\n"
      );
      await writeConventionApp(app);
      await mkdir(binRoot, { recursive: true });
      const pnpm = join(binRoot, "pnpm");
      await writeFile(
        pnpm,
        `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(
          JSON.stringify([{ name: "@example/cli-app", path: app }])
        )});\n`,
        "utf8"
      );
      await chmod(pnpm, 0o755);

      const generated = runCliWithEnvironment(
        app,
        {
          ...process.env,
          PATH: `${binRoot}${delimiter}${process.env.PATH ?? ""}`,
        },
        "generate",
        "--json"
      );
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  }, 60_000);

  it("preserves workspace authorization failures without repeating source analysis", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "mirai-intl-workspace-"));
    const app = join(workspace, "apps/auth");
    const instrumentationRoot = await mkdtemp(
      join(tmpdir(), "mirai-intl-workspace-instrumentation-")
    );
    const report = join(workspace, "workspace-check-report.json");
    try {
      await writeFile(
        join(workspace, "pnpm-workspace.yaml"),
        "packages:\n  - apps/*\n"
      );
      await writeFile(
        join(workspace, "pnpm-lock.yaml"),
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "",
          "  apps/auth:",
          "    dependencies: {}",
          "",
        ].join("\n")
      );
      await writeConventionApp(app);
      await writeJson(join(app, "tsconfig.json"), {
        include: ["src/**/*.ts", "src/**/*.tsx"],
      });
      await writeJson(join(app, "mirai-intl.config.json"), {
        checkProjects: [{ path: "tsconfig.json", role: "owner" }],
      });

      const publishedCli = await requireBuiltCli();
      const generated = spawnSync(
        process.execPath,
        [publishedCli, "generate"],
        {
          cwd: app,
          encoding: "utf8",
          env: process.env,
          shell: false,
          timeout: 60_000,
        }
      );
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
      await writeFile(
        join(app, "src/page.tsx"),
        [
          'import { useTranslations } from "x";',
          "const { t } = useTranslations();",
          't("missing");',
          "<div>Hello world</div>;",
          "",
        ].join("\n"),
        "utf8"
      );

      const instrumentation =
        await workspaceAnalysisInstrumentation(instrumentationRoot);
      const checked = spawnSync(
        process.execPath,
        [
          "--import",
          instrumentation.hook,
          publishedCli,
          "check",
          "--workspace",
          "--format=json",
          "--report-file",
          report,
        ],
        {
          cwd: workspace,
          encoding: "utf8",
          env: process.env,
          shell: false,
          timeout: 60_000,
        }
      );

      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(1);
      expect(checked.stderr).toBe("");
      const failureReport = JSON.parse(await readFile(report, "utf8"));
      expect(
        JSON.parse(await readFile(instrumentation.report, "utf8"))
      ).toEqual({ analysisCalls: 1, instrumented: true });
      expect(failureReport).toEqual({
        command: "check",
        diagnostics: [
          {
            code: "INTL_SOURCE_INVALID",
            column: 3,
            file: "apps/auth/src/page.tsx",
            hint: "Fix the source usage, then rerun mirai-intl check.",
            line: 3,
            message: "Unknown translation path missing",
            severity: "error",
          },
          {
            code: "INTL_SOURCE_INVALID",
            file: "apps/auth/src/page.tsx",
            hint: "Fix the source usage, then rerun mirai-intl check.",
            line: 4,
            message:
              "hardcoded JSX text must use t()/t.rich() from locale JSON",
            severity: "error",
          },
        ],
        schemaVersion: 1,
        success: false,
      });
      expect(JSON.parse(checked.stdout)).toEqual({
        ...failureReport,
        summary: {
          catalogCount: 1,
          projects: [{ findings: 2, path: "apps/auth", valid: false }],
          checkerProjects: 0,
          ownerProjects: 1,
          semanticAuthorizationRuns: 1,
          semanticFilesAnalyzed: 1,
          valid: false,
        },
      });
      expect(JSON.stringify(failureReport)).toContain(
        "Unknown translation path missing"
      );
      expect(JSON.stringify(failureReport)).not.toMatch(
        /"(?:compiled|environment|loaded|proof|receipt|report|sources)":/u
      );
    } finally {
      await Promise.all([
        rm(workspace, { force: true, recursive: true }),
        rm(instrumentationRoot, { force: true, recursive: true }),
      ]);
    }
  }, 180_000);

  it("finalizes repeated named artifact targets in one CLI invocation", async () => {
    const root = await createConventionApp();
    try {
      await writeFile(join(root, "src/page.ts"), "export const page = 1;\n");
      await writeJson(join(root, "tsconfig.json"), {
        include: ["src/**/*.ts"],
      });
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkProjects: [{ path: "tsconfig.json", role: "owner" }],
      });
      const generated = runCli(root, "generate");
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
      expect(runCli(root, "prove").status).toBe(0);

      const client = join(root, "dist/client");
      const worker = join(root, "dist/worker");
      for (const directory of [client, worker]) {
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "entry.js"), "export {};\n");
        await writeFile(
          join(directory, "entry.js.map"),
          '{"sources":["entry.ts"],"sourcesContent":["export {};"],"version":3}\n'
        );
      }

      const finalized = runCli(
        root,
        "finalize-proof",
        "--target",
        `client=${client}`,
        "--target",
        `worker=${worker}`,
        "--map-root",
        `client=${client}`,
        "--format=json"
      );
      expect(finalized.status).toBe(0);
      expect(finalized.stderr).toBe("");
      expect(JSON.parse(finalized.stdout)).toMatchObject({
        command: "finalize-proof",
        diagnostics: [],
        schemaVersion: 1,
        success: true,
        summary: {
          buildReceiptVerifications: 1,
          buildSemanticAnalysisRuns: 0,
          valid: true,
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("reports thrown catalog findings as validation exit code 1", async () => {
    const root = await createConventionApp();
    const report = join(root, "reports/catalog-check.json");
    try {
      await writeJson(join(root, "src/locales/global/th.json"), {
        greeting: " \n\t",
      });
      const checked = runCli(
        root,
        "catalog-check",
        "--no-color",
        "--report-file",
        report
      );
      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(1);
      expect(checked.stderr).toBe("");
      expect(checked.stdout).toContain(
        "greeting th must be a non-empty translation string"
      );
      expect(checked.stdout).toContain(
        "src/locales/global/th.json · ERROR · INTL_CATALOG_INVALID · locale th · path greeting"
      );
      expect(checked.stdout).toContain(
        "Fix: Correct greeting in src/locales/global/th.json for locale th, then rerun mirai-intl catalog-check."
      );
      expect(checked.stdout).toMatch(/mirai-intl catalog-check ✗ 1 error\n$/u);
      expect(JSON.parse(await readFile(report, "utf8"))).toMatchObject({
        command: "catalog-check",
        diagnostics: [
          {
            code: "INTL_CATALOG_INVALID",
            file: "src/locales/global/th.json",
            locale: "th",
            path: "greeting",
            severity: "error",
          },
        ],
        success: false,
      });

      const colored = runCli(root, "catalog-check", "--color");
      expect(colored.status, `${colored.stdout}${colored.stderr}`).toBe(1);
      expect(colored.stderr).toBe("");
      expect(colored.stdout).toContain("\u001b[31mERROR\u001b[0m");
      expect(colored.stdout).toContain("\u001b[31m✗\u001b[0m");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("points missing locale files to the exact file that must be created", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "mirai-intl.config.json"), {
        requiredLocales: ["en", "th"],
      });
      await rm(join(root, "src/locales/global/th.json"));
      const checked = runCli(root, "catalog-check", "--no-color");
      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(1);
      expect(checked.stderr).toBe("");
      expect(checked.stdout).toContain(
        "src/locales/global/th.json · ERROR · INTL_CATALOG_INVALID · locale th"
      );
      expect(checked.stdout).toContain(
        "Fix: Create or correct src/locales/global/th.json for locale th, then rerun mirai-intl catalog-check."
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("points missing translation keys to the affected locale JSON path", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "src/locales/global/th.json"), {});
      const checked = runCli(root, "catalog-check", "--no-color");
      expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(1);
      expect(checked.stderr).toBe("");
      expect(checked.stdout).toContain(
        "src/locales/global/th.json · ERROR · INTL_CATALOG_INVALID · locale th · path greeting"
      );
      expect(checked.stdout).toContain("th is missing key greeting");
      expect(checked.stdout).toContain(
        "Fix: Correct greeting in src/locales/global/th.json for locale th, then rerun mirai-intl catalog-check."
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps JSON output machine-only through --format and --json", async () => {
    const root = await createConventionApp();
    try {
      const generated = runCli(root, "generate", "--format=json", "--color");
      expect(generated.status).toBe(0);
      expect(generated.stderr).toBe("");
      expect(generated.stdout).not.toContain("\u001b[");
      expect(JSON.parse(generated.stdout)).toEqual({
        command: "generate",
        diagnostics: [],
        schemaVersion: 1,
        success: true,
        summary: {
          catalogId: "@example/cli-app",
          locales: "en+th",
          messageCount: 1,
          valid: true,
        },
      });

      const ensured = runCli(root, "ensure", "--json");
      expect(ensured.status).toBe(0);
      expect(ensured.stderr).toBe("");
      expect(JSON.parse(ensured.stdout)).toEqual({
        command: "ensure",
        diagnostics: [],
        schemaVersion: 1,
        success: true,
        summary: { changed: false, valid: true },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("writes an atomic ANSI-free report without logging the full result", async () => {
    const root = await createConventionApp();
    const report = join(root, "reports/generate.json");
    try {
      const generated = runCli(
        root,
        "generate",
        "--color",
        "--report-file",
        report
      );
      expect(generated.status).toBe(0);
      expect(generated.stdout).toContain("\u001b[32m✓\u001b[0m");
      expect(generated.stdout).not.toContain('"sourceFiles"');

      const source = await readFile(report, "utf8");
      expect(source).not.toContain("\u001b[");
      expect(JSON.parse(source)).toEqual({
        command: "generate",
        diagnostics: [],
        schemaVersion: 1,
        success: true,
      });
      expect(await readdir(join(root, "reports"))).toEqual(["generate.json"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("emits actionable stylish findings and escaped GitHub annotations", async () => {
    const root = await createConventionApp();
    const report = join(root, "reports/check.json");
    try {
      const generated = runCli(root, "generate");
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
      await writeFile(
        join(root, "src/problem,percent%.tsx"),
        [
          'import { useTranslations } from "x";',
          "const { t } = useTranslations();",
          't("missing,%");',
          "",
        ].join("\n"),
        "utf8"
      );

      const checked = runCli(
        root,
        "check",
        "--no-color",
        "--annotations=github",
        "--report-file",
        report
      );
      expect(checked.status).toBe(1);
      expect(checked.stderr).toBe("");
      expect(checked.stdout).toContain("ERROR · INTL_SOURCE_INVALID");
      expect(checked.stdout).toContain("Fix: Fix the source usage");
      expect(checked.stdout).toContain("::error file=");
      expect(checked.stdout).toContain("%2Cpercent%25.tsx");
      expect(checked.stdout).toContain("missing,%25");
      expect(checked.stdout).toMatch(/mirai-intl check ✗ 1 error\n$/u);

      expect(JSON.parse(await readFile(report, "utf8"))).toMatchObject({
        command: "check",
        diagnostics: [
          {
            code: "INTL_SOURCE_INVALID",
            severity: "error",
          },
        ],
        success: false,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("uses exit code 2 and stderr for invalid reporting options", async () => {
    const root = await createConventionApp();
    const report = join(root, "reports/failure.json");
    try {
      const incompatible = runCli(
        root,
        "check",
        "--json",
        "--annotations=github"
      );
      expect(incompatible.status).toBe(2);
      expect(incompatible.stdout).toBe("");
      expect(incompatible.stderr).toContain(
        "--annotations=github can only be used with stylish output"
      );

      const invalid = runCli(
        root,
        "check",
        "--format",
        "sarif",
        "--report-file",
        report
      );
      expect(invalid.status).toBe(2);
      expect(invalid.stdout).toBe("");
      expect(invalid.stderr).toContain("--format must be stylish or json");
      expect(JSON.parse(await readFile(report, "utf8"))).toMatchObject({
        command: "check",
        diagnostics: [{ code: "INTL_CLI_FAILURE", severity: "error" }],
        success: false,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps contract JSON-first and explain stylish-first", async () => {
    const root = await createConventionApp();
    try {
      expect(runCli(root, "generate").status).toBe(0);
      const contract = runCli(root, "contract");
      expect(contract.status).toBe(0);
      expect(contract.stderr).toBe("");
      expect(JSON.parse(contract.stdout)).toMatchObject({
        catalogId: "@example/cli-app",
      });

      const explained = runCli(
        root,
        "explain",
        "--path",
        "greeting",
        "--no-color"
      );
      expect(explained.status).toBe(0);
      expect(explained.stderr).toBe("");
      expect(explained.stdout).toMatch(
        /^mirai-intl explain ✓ greeting · text\n$/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("generates and verifies a convention catalog with minimal configuration", async () => {
    const root = await createConventionApp();
    try {
      const generated = runCli(root, "generate", "--json");
      expect(generated.error).toBeUndefined();
      expect(generated.signal).toBeNull();
      expect(generated.stderr).toBe("");
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        command: "generate",
        success: true,
        summary: {
          catalogId: "@example/cli-app",
          valid: true,
        },
      });

      const checked = runCli(root, "check", "--json");
      expect(checked.error).toBeUndefined();
      expect(checked.signal).toBeNull();
      expect(checked.stderr).toBe("");
      expect(checked.status).toBe(0);
      expect(JSON.parse(checked.stdout)).toMatchObject({
        command: "check",
        success: true,
        summary: { valid: true },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("uses the nearest pnpm workspace lockfile for a nested package", async () => {
    const workspaceRoot = await mkdtemp(
      join(tmpdir(), "mirai-intl-workspace-")
    );
    const packageRoot = join(workspaceRoot, "packages/i18n");
    const lockfile =
      "lockfileVersion: '9.0'\nimporters:\n\n  packages/i18n:\n    dependencies: {}\n";
    try {
      await writeFile(
        join(workspaceRoot, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n"
      );
      await writeFile(join(workspaceRoot, "pnpm-lock.yaml"), lockfile);
      await writeConventionApp(packageRoot);

      const generated = runCli(packageRoot, "generate", "--json");
      expect(generated.error).toBeUndefined();
      expect(generated.signal).toBeNull();
      expect(generated.stderr).toBe("");
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        command: "generate",
        success: true,
        summary: { catalogId: "@example/cli-app", valid: true },
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }, 60_000);

  it("keeps installed versions scoped to the target when a sibling conflicts", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "mirai-intl-versions-"));
    const binRoot = join(workspaceRoot, "bin");
    const packageRoot = join(workspaceRoot, "packages/i18n");
    const siblingRoot = join(workspaceRoot, "packages/sibling");
    try {
      await writeJson(join(workspaceRoot, "package.json"), {
        name: "@example/workspace",
        packageManager: "pnpm@11.11.0",
        private: true,
      });
      await writeFile(
        join(workspaceRoot, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n"
      );
      await writeFile(
        join(workspaceRoot, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n\n  packages/i18n:\n    dependencies: {}\n\n  packages/sibling:\n    dependencies: {}\n"
      );
      await writeConventionApp(packageRoot);
      await writeJson(join(packageRoot, "package.json"), {
        dependencies: { typescript: "6.0.3", vite: "7.3.6" },
        name: "@example/cli-app",
        packageManager: "pnpm@11.11.0",
        version: "1.0.0",
      });
      await writeJson(join(siblingRoot, "package.json"), {
        dependencies: { typescript: "5.9.3" },
        name: "@example/sibling",
        version: "1.0.0",
      });
      await mkdir(binRoot, { recursive: true });
      const pnpm = join(binRoot, "pnpm");
      const pnpmListOutput = JSON.stringify([
        {
          dependencies: {
            typescript: { version: "6.0.3" },
            vite: { version: "7.3.6" },
          },
          name: "@example/cli-app",
          path: packageRoot,
        },
        {
          dependencies: { typescript: { version: "5.9.3" } },
          name: "@example/sibling",
          path: siblingRoot,
        },
      ]);
      await writeFile(
        pnpm,
        `#!/usr/bin/env node\nif (!process.argv.includes("list")) {\n  process.stderr.write("expected pnpm list\\n");\n  process.exitCode = 1;\n} else {\n  process.stdout.write(${JSON.stringify(pnpmListOutput)});\n}\n`,
        "utf8"
      );
      await chmod(pnpm, 0o755);

      const generated = runCliWithEnvironment(
        packageRoot,
        {
          ...process.env,
          PATH: `${binRoot}${delimiter}${process.env.PATH ?? ""}`,
        },
        "generate",
        "--json"
      );
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        command: "generate",
        success: true,
        summary: { valid: true },
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  }, 60_000);

  it("does not use an ancestor workspace lockfile that excludes the target", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "mirai-intl-excluded-"));
    const packageRoot = join(workspaceRoot, "excluded/i18n");
    try {
      await writeFile(
        join(workspaceRoot, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n"
      );
      await writeFile(
        join(workspaceRoot, "pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\nimporters:\n\n  excluded/i18n:\n    dependencies: {}\n\n  packages/included:\n    dependencies: {}\n"
      );
      await writeConventionApp(packageRoot);

      const generated = runCli(packageRoot, "generate");
      expect(generated.status).not.toBe(0);
      expect(`${generated.stdout}${generated.stderr}`).toContain(
        "Unable to collect environment evidence: no pnpm-lock.yaml exists at the package root and no parent pnpm workspace lockfile includes the target package importer"
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("reports a deterministic diagnostic when no appropriate lockfile exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-no-lockfile-"));
    try {
      await writeConventionApp(root);
      const generated = runCli(root, "generate", "--json");
      expect(generated.error).toBeUndefined();
      expect(generated.status).not.toBe(0);
      expect(`${generated.stdout}${generated.stderr}`).toContain(
        "Unable to collect environment evidence: no pnpm-lock.yaml exists at the package root and no parent pnpm workspace lockfile includes the target package importer"
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("generates from explicit JSON config with the Turbo source mount shape", async () => {
    const root = await createConventionApp();
    try {
      const dependencyRoot = join(root, "node_modules/@mirai/i18n");
      await writeJson(join(dependencyRoot, "package.json"), {
        name: "@mirai/i18n",
        version: "1.0.0",
      });
      await writeJson(
        join(dependencyRoot, "locales/components/ui/global/en.json"),
        { button: { label: "Button" } }
      );
      await writeJson(
        join(dependencyRoot, "locales/components/ui/global/th.json"),
        { button: { label: "ปุ่ม" } }
      );
      await writeJson(join(root, "package.json"), {
        dependencies: { "@mirai/i18n": "1.0.0", vite: "8.1.4" },
        name: "@example/cli-app",
        version: "1.0.0",
      });
      await writeJson(join(root, "mirai-intl.config.json"), {
        sources: [
          {
            from: "@mirai/i18n",
            mount: "components.ui",
            path: "locales/components/ui",
          },
        ],
      });

      const generated = runCli(root, "generate", "--json");
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        command: "generate",
        success: true,
        summary: { catalogId: "@example/cli-app", valid: true },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("ensures missing and stale catalogs while leaving a current catalog unchanged", async () => {
    const root = await createConventionApp();
    try {
      const missing = runCli(root, "ensure", "--json");
      expect(missing.status).toBe(0);
      expect(JSON.parse(missing.stdout)).toMatchObject({
        command: "ensure",
        summary: { changed: true, valid: true },
      });

      const current = runCli(root, "ensure", "--json");
      expect(current.status).toBe(0);
      expect(JSON.parse(current.stdout)).toMatchObject({
        summary: { changed: false, valid: true },
      });

      await writeJson(join(root, "src/locales/global/en.json"), {
        greeting: "Welcome {name}",
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        greeting: "ยินดีต้อนรับ {name}",
      });
      const stale = runCli(root, "ensure", "--json");
      expect(stale.status).toBe(0);
      expect(JSON.parse(stale.stdout)).toMatchObject({
        summary: { changed: true, valid: true },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("uses the receipt-first unchanged ensure path without Program, compile, or emit work", async () => {
    const root = await createConventionApp();
    const instrumentationRoot = await mkdtemp(
      join(tmpdir(), "mirai-intl-ensure-instrumentation-")
    );
    try {
      const publishedCli = await requireBuiltCli();
      const generated = spawnSync(
        process.execPath,
        [publishedCli, "generate"],
        {
          cwd: root,
          encoding: "utf8",
          env: process.env,
          shell: false,
          timeout: 60_000,
        }
      );
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
      expect(await readFile(publishedCli, "utf8")).not.toMatch(
        /^import .*["']\.\/analyze-sources-/mu
      );
      const instrumentation = await ensureInstrumentation(instrumentationRoot);
      const ensured = spawnSync(
        process.execPath,
        ["--import", instrumentation.hook, publishedCli, "ensure", "--json"],
        {
          cwd: root,
          encoding: "utf8",
          env: process.env,
          shell: false,
          timeout: 60_000,
        }
      );
      expect(ensured.status, `${ensured.stdout}${ensured.stderr}`).toBe(0);
      expect(JSON.parse(ensured.stdout)).toMatchObject({
        summary: { changed: false, valid: true },
      });
      expect(
        JSON.parse(await readFile(instrumentation.report, "utf8"))
      ).toEqual({
        analyzeSourcesLoaded: false,
        compileCalls: 0,
        compilerBundleInstrumented: true,
        emitCalls: 0,
        programs: 0,
        transformLoaded: false,
        typescriptLoaded: false,
      });
    } finally {
      await Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(instrumentationRoot, { force: true, recursive: true }),
      ]);
    }
  }, 180_000);

  it.each([
    ["--config", "intl.config.json"],
    ["--out", "generated"],
    ["--representation", "proxy"],
  ])("rejects removed legacy option %s", async (option, value) => {
    const root = await createConventionApp();
    try {
      const result = runCli(root, "generate", option, value);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        `${option} is not supported; mirai-intl uses convention discovery`
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it.each(["check", "generate"])(
    "rejects source-analysis bypasses for %s",
    async (command) => {
      const root = await createConventionApp();
      try {
        const checked = runCli(root, command, "--skip-sources");
        expect(checked.status).not.toBe(0);
        expect(`${checked.stdout}${checked.stderr}`).toContain(
          "--skip-sources is not supported"
        );
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    }
  );

  it("writes a deterministic receipt only for configured source owners", async () => {
    const root = await createConventionApp();
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "page.ts"), "export const page = 1;\n");
      await writeJson(join(root, "tsconfig.json"), {
        compilerOptions: { allowJs: true },
        include: ["src/**/*.ts"],
      });
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkProjects: [{ path: "tsconfig.json", role: "owner" }],
      });
      expect(runCli(root, "generate").status).toBe(0);
      const first = runCli(root, "prove", "--json");
      expect(first.status).toBe(0);
      const second = runCli(root, "prove", "--json");
      expect(second.status).toBe(0);
      expect(second.stdout).toBe(first.stdout);
      expect(JSON.parse(first.stdout)).toMatchObject({
        command: "prove",
        success: true,
        summary: {
          semanticAuthorizationRuns: 1,
          semanticFilesAnalyzed: 1,
          valid: true,
        },
      });
      await expect(verifyConventionCheckReceipt(root)).resolves.toMatchObject({
        schemaVersion: 2,
      });
      await writeFile(join(root, "src", "page.ts"), "export const page = 2;\n");
      await expect(verifyConventionCheckReceipt(root)).rejects.toThrow(
        /source is stale or corrupt/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects non-tsconfig check-project paths", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkProjects: [{ path: "package.json", role: "owner" }],
      });
      const result = runCli(root, "generate");
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(
        /relative tsconfig JSON path/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("requires a byte-identical provisional and finalized build proof", async () => {
    const root = await createConventionApp();
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src", "page.ts"), "export const page = 1;\n");
      await writeJson(join(root, "tsconfig.json"), {
        include: ["src/**/*.ts"],
      });
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkProjects: [{ path: "tsconfig.json", role: "owner" }],
      });
      const generated = runCli(root, "generate");
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
      expect(runCli(root, "prove").status).toBe(0);
      const output = join(root, "dist");
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "entry.js"), "export {};\n");
      await writeFile(
        join(output, "entry.js.map"),
        '{"sources":["entry.ts"],"sourcesContent":["export {};"],"version":3}\n'
      );
      await writeFile(join(output, "server.mjs"), "export {};\n");
      await writeFile(
        join(output, "server.mjs.map"),
        '{"sources":["server.ts"],"sourcesContent":["export {};"],"version":3}\n'
      );
      await expect(discoverEmittedModules(output)).resolves.toEqual([
        { mapPath: "entry.js.map", path: "entry.js" },
        { mapPath: "server.mjs.map", path: "server.mjs" },
      ]);
      const modules = [{ mapPath: "entry.js.map", path: "entry.js" }] as const;
      await expect(
        writeProvisionalBuildProof(root, output, "client", modules)
      ).resolves.toMatchObject({ state: "provisional", target: "client" });
      await writeFile(
        join(output, "entry.js"),
        "export const changed = true;\n"
      );
      await expect(
        finalizeBuildProof(root, output, "client", modules)
      ).rejects.toThrow(/changed after provisional proof/u);
      await writeFile(join(output, "entry.js"), "export {};\n");
      await expect(
        finalizeBuildProof(root, output, "client", modules)
      ).resolves.toMatchObject({ state: "finalized", target: "client" });
      await expect(
        verifyFinalizedBuildProof(root, output, "client", modules)
      ).resolves.toMatchObject({ state: "finalized", target: "client" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("rejects globbed source-analysis exceptions", async () => {
    const root = await createConventionApp();
    try {
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkExceptions: [
          {
            file: "src/*.ts",
            nodeHash: `sha256:${"0".repeat(64)}`,
            reason: "fixture",
            rule: "no-escape",
          },
        ],
      });
      const result = runCli(root, "generate");
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/exact regular file/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects stale exact source-analysis exceptions", async () => {
    const root = await createConventionApp();
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/page.tsx"), "export const page = 1;\n");
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkExceptions: [
          {
            file: "src/page.tsx",
            nodeHash: `sha256:${"0".repeat(64)}`,
            reason: "fixture",
            rule: "source-analysis",
          },
        ],
        checkProjects: [{ path: "tsconfig.json", role: "owner" }],
      });
      const generated = runCli(root, "generate");
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
      const result = runCli(root, "check");
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(
        "Stale or non-matching Mirai Intl check exception"
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("fails check when source analysis finds unknown translation keys", async () => {
    const root = await createConventionApp();
    try {
      expect(runCli(root, "generate").status).toBe(0);
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src/page.tsx"),
        [
          'import { useTranslations } from "x";',
          "const { t } = useTranslations();",
          't("missing");',
          "",
        ].join("\n"),
        "utf8"
      );

      const checked = runCli(root, "check", "--json");
      expect(checked.status).not.toBe(0);
      expect(`${checked.stdout}${checked.stderr}`).toMatch(
        /Unknown translation path missing/u
      );
      expect(JSON.parse(checked.stdout)).toMatchObject({
        command: "check",
        diagnostics: [
          {
            code: "INTL_SOURCE_INVALID",
            message: expect.stringContaining("Unknown translation path"),
          },
        ],
        success: false,
        summary: {
          semanticFilesAnalyzed: 1,
          valid: false,
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("fails check when translator bindings escape supported call syntax", async () => {
    const root = await createConventionApp();
    try {
      expect(runCli(root, "generate").status).toBe(0);
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src/page.tsx"),
        [
          'import { useTranslations } from "x";',
          "const { t } = useTranslations();",
          "consume(t);",
          "",
        ].join("\n"),
        "utf8"
      );

      const checked = runCli(root, "check");
      expect(checked.status).not.toBe(0);
      expect(`${checked.stdout}${checked.stderr}`).toMatch(
        /Translator binding t escapes the supported call syntax/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("fails check when translation calls use unbound translator props", async () => {
    const root = await createConventionApp();
    try {
      expect(runCli(root, "generate").status).toBe(0);
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src/items.tsx"),
        [
          'import type { Translator } from "@/hooks/useTranslations";',
          'export const items = ({ t }: { t: Translator<"pages.home"> }) => [',
          '  { label: t("title") },',
          "];",
          "",
        ].join("\n"),
        "utf8"
      );

      const checked = runCli(root, "check");
      expect(checked.status).not.toBe(0);
      expect(`${checked.stdout}${checked.stderr}`).toMatch(
        /Translation call must use a useTranslations\(\)\/getServerTranslations\(\) binding in this module/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("passes check for valid source calls and reports sourceAnalysis", async () => {
    const root = await createConventionApp();
    try {
      const generated = runCli(root, "generate");
      expect(generated.status, `${generated.stdout}${generated.stderr}`).toBe(
        0
      );
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(
        join(root, "src/page.tsx"),
        [
          'import { useTranslations } from "x";',
          "const { t } = useTranslations();",
          't("greeting", { name: "Ada" });',
          "",
        ].join("\n"),
        "utf8"
      );

      const checked = runCli(root, "check", "--json");
      expect(checked.error).toBeUndefined();
      expect(checked.status).toBe(0);
      expect(JSON.parse(checked.stdout)).toMatchObject({
        command: "check",
        diagnostics: [],
        success: true,
        summary: {
          semanticFilesAnalyzed: 1,
          valid: true,
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
