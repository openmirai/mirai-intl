import { spawnSync } from "node:child_process";
import { deepStrictEqual } from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const outputRoot = join(repositoryRoot, ".tmp", "real-diagnostic-smoke");
const packsRoot = join(outputRoot, "packs");
const installRoot = join(outputRoot, "isolated-install");
const scenariosRoot = await mkdtemp(
  join(tmpdir(), "mirai-intl-real-diagnostic-scenarios-")
);
const commandOutputLimit = 256 * 1024;
const reportOutputLimit = 8 * 1024;
const stderrOutputLimit = 8 * 1024;
const stdoutOutputLimit = 8 * 1024;
const timeoutMilliseconds = 60_000;

type CommandResult = Readonly<{
  command: ReadonlyArray<string>;
  exitCode: number;
  stderr: string;
  stdout: string;
}>;

type Diagnostic = Readonly<{
  code: string;
  column?: number;
  file?: string;
  hint?: string;
  line?: number;
  locale?: string;
  message: string;
  path?: string;
  severity: "error" | "warning";
}>;

type ScenarioEvidence = Readonly<{
  command: string;
  diagnostic: Diagnostic;
  exitCode: number;
  name: string;
  sourceSnippet?: string;
  stderr: string;
  stdout: string;
}>;

const diagnosticFields = new Set([
  "code",
  "column",
  "file",
  "hint",
  "line",
  "locale",
  "message",
  "path",
  "severity",
]);
const forbiddenReportFields =
  /^(?:cwd|env(?:ironment)?|git|manifest|manifests|proof|proofs|receipt|receipts|result|root|roots|source|sources|sourceFiles|sourceInventor(?:y|ies)|translation|translations)$/iu;

function execute(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env
): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...environment, CI: "1" },
    killSignal: "SIGKILL",
    maxBuffer: commandOutputLimit,
    shell: false,
    timeout: timeoutMilliseconds,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status === null) {
    throw new Error(
      [
        `Command could not complete: ${JSON.stringify([command, ...args])}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `error=${result.error?.message ?? "(none)"}`,
        `stdout=${(result.stdout ?? "").slice(0, commandOutputLimit)}`,
        `stderr=${(result.stderr ?? "").slice(0, commandOutputLimit)}`,
      ].join("\n")
    );
  }
  return {
    command: [command, ...args],
    exitCode: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertBoundedText(
  value: string,
  limit: number,
  context: string
): void {
  expect(
    Buffer.byteLength(value) <= limit,
    `${context} exceeded ${limit} bytes`
  );
  for (const line of value.split(/\r?\n/u)) {
    expect(
      Buffer.byteLength(line) <= 2 * 1024,
      `${context} emitted a line larger than 2 KiB`
    );
  }
}

function assertNoSensitiveOutput(value: string, context: string): void {
  for (const forbidden of [
    '"sources"',
    '"receipt"',
    '"proof"',
    '"manifest"',
    "Home title",
    "หน้าหลัก",
    "Required field",
    "จำเป็น",
  ]) {
    expect(
      !value.includes(forbidden),
      `${context} exposed forbidden payload text ${JSON.stringify(forbidden)}`
    );
  }
}

function assertNoLeakedReportFields(value: unknown, context: string): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertNoLeakedReportFields(entry, context);
    }
    return;
  }
  if (typeof value === "string") {
    expect(
      !/(?:^|\s)\/(?:Users|home|private|tmp)\//u.test(value),
      `${context} report exposed an absolute filesystem root`
    );
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    expect(
      !forbiddenReportFields.test(key),
      `${context} report exposed forbidden field ${JSON.stringify(key)}`
    );
    assertNoLeakedReportFields(entry, context);
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createBaseline(root: string): Promise<void> {
  await mkdir(join(root, "node_modules/x"), { recursive: true });
  await Promise.all([
    writeJson(join(root, "package.json"), {
      dependencies: { vite: "8.1.4" },
      name: "@example/real-diagnostic-smoke",
      private: true,
      version: "1.0.0",
    }),
    writeJson(join(root, "mirai-intl.config.json"), {
      checkProjects: [{ path: "tsconfig.json", role: "owner" }],
      requiredLocales: ["en", "th"],
      sourceLocale: "en",
    }),
    writeJson(join(root, "tsconfig.json"), {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        target: "ES2024",
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
    }),
    writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8"),
    writeJson(join(root, "src/locales/pages/home/en.json"), {
      error: { form: { required: "Required field" } },
      title: "Home title",
    }),
    writeJson(join(root, "src/locales/pages/home/th.json"), {
      error: { form: { required: "จำเป็น" } },
      title: "หน้าหลัก",
    }),
    writeJson(join(root, "node_modules/x/package.json"), {
      name: "x",
      types: "index.d.ts",
      version: "1.0.0",
    }),
    writeFile(
      join(root, "node_modules/x/index.d.ts"),
      [
        "export declare function useTranslations(namespace?: string): {",
        "  t(key: string, values?: Readonly<Record<string, unknown>>): string;",
        "};",
        "",
      ].join("\n"),
      "utf8"
    ),
  ]);
}

function parseReport(
  source: string,
  name: string,
  command: string
): Diagnostic {
  assertBoundedText(source, reportOutputLimit, `${name} report`);
  assertNoSensitiveOutput(source, `${name} report`);
  const report: unknown = JSON.parse(source);
  expect(
    report && typeof report === "object",
    `${name} report is not an object`
  );
  assertNoLeakedReportFields(report, name);
  deepStrictEqual(Object.keys(report).toSorted(), [
    "command",
    "diagnostics",
    "schemaVersion",
    "success",
  ]);
  expect(Reflect.get(report, "command") === command, `${name} command differs`);
  expect(Reflect.get(report, "schemaVersion") === 1, `${name} schema differs`);
  expect(Reflect.get(report, "success") === false, `${name} must fail`);
  const diagnostics = Reflect.get(report, "diagnostics");
  expect(
    Array.isArray(diagnostics) && diagnostics.length === 1,
    `${name} did not emit exactly one diagnostic`
  );
  const diagnostic = diagnostics[0] as Diagnostic;
  expect(
    Object.keys(diagnostic).every((key) => diagnosticFields.has(key)),
    `${name} diagnostic contains an unspecified field`
  );
  expect(diagnostic.severity === "error", `${name} diagnostic is not an error`);
  expect(
    typeof diagnostic.code === "string" &&
      typeof diagnostic.message === "string" &&
      typeof diagnostic.hint === "string",
    `${name} diagnostic is not actionable`
  );
  return diagnostic;
}

async function runFailureScenario(
  cli: string,
  baseline: string,
  specification: Readonly<{
    args: ReadonlyArray<string>;
    expected: Readonly<{
      code: string;
      column?: number;
      file?: string;
      hint: string;
      line?: number;
      locale?: string;
      message: string;
      path?: string;
      severity: "error";
    }>;
    mutate(root: string): Promise<string | undefined>;
    name: string;
  }>
): Promise<ScenarioEvidence> {
  const root = join(scenariosRoot, specification.name);
  await cp(baseline, root, { recursive: true });
  const sourceSnippet = await specification.mutate(root);
  const reportPath = join(root, "diagnostic-report.json");
  const result = execute(
    process.execPath,
    [cli, ...specification.args, "--report-file", reportPath],
    root
  );
  expect(result.exitCode === 1, `${specification.name} must exit 1`);
  expect(result.stderr === "", `${specification.name} must keep stderr empty`);
  assertBoundedText(
    result.stdout,
    stdoutOutputLimit,
    `${specification.name} stdout`
  );
  assertBoundedText(
    result.stderr,
    stderrOutputLimit,
    `${specification.name} stderr`
  );
  expect(
    !result.stdout.includes("\u001b["),
    `${specification.name} --no-color stdout has ANSI`
  );
  expect(
    result.stdout.endsWith(`mirai-intl ${specification.args[0]} ✗ 1 error\n`),
    `${specification.name} has an unexpected summary:\n${result.stdout}`
  );
  assertNoSensitiveOutput(result.stdout, specification.name);
  const reportSource = await readFile(reportPath, "utf8");
  expect(
    !reportSource.includes("\u001b["),
    `${specification.name} report has ANSI`
  );
  const diagnostic = parseReport(
    reportSource,
    specification.name,
    specification.args[0] ?? ""
  );
  deepStrictEqual(diagnostic, specification.expected);
  expect(
    result.stdout.includes(diagnostic.message),
    `${specification.name} stylish output omitted the diagnostic message`
  );
  expect(
    result.stdout.includes(`Fix: ${diagnostic.hint}`),
    `${specification.name} stylish output omitted the repair hint`
  );
  return {
    command: `node ${cli} ${[
      ...specification.args,
      "--report-file",
      "diagnostic-report.json",
    ].join(" ")}`,
    diagnostic,
    exitCode: result.exitCode,
    name: specification.name,
    ...(sourceSnippet ? { sourceSnippet } : {}),
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

await rm(outputRoot, { force: true, recursive: true });
await mkdir(packsRoot, { recursive: true });

for (const packageName of ["@openmirai/intl-abi", "@openmirai/intl-compiler"]) {
  const packed = execute(
    "corepack",
    ["pnpm", "--filter", packageName, "pack", "--pack-destination", packsRoot],
    repositoryRoot
  );
  expect(
    packed.exitCode === 0,
    `${packageName} pack failed:\n${packed.stdout}${packed.stderr}`
  );
}

const tarballs = (await readdir(packsRoot))
  .filter((entry) => entry.endsWith(".tgz"))
  .toSorted();
expect(
  tarballs.length === 2,
  `expected two tarballs, found ${tarballs.length}`
);
const abiTarball = tarballs.find((entry) => entry.includes("intl-abi"));
const compilerTarball = tarballs.find((entry) => entry.includes("compiler"));
expect(
  abiTarball && compilerTarball,
  "packed ABI/compiler tarballs are missing"
);
const abiPath = `file:${join(packsRoot, abiTarball)}`;
const compilerPath = `file:${join(packsRoot, compilerTarball)}`;

await mkdir(installRoot, { recursive: true });
await writeJson(join(installRoot, "package.json"), {
  dependencies: {
    "@openmirai/intl-abi": abiPath,
    "@openmirai/intl-compiler": compilerPath,
  },
  name: "mirai-intl-real-diagnostic-install",
  packageManager: "pnpm@11.11.0",
  private: true,
  type: "module",
  version: "0.0.0",
});
await writeFile(
  join(installRoot, "pnpm-workspace.yaml"),
  [
    "packages: []",
    "overrides:",
    `  '@openmirai/intl-abi': '${abiPath}'`,
    "",
  ].join("\n"),
  "utf8"
);
const installed = execute(
  "corepack",
  ["pnpm", "install", "--ignore-scripts", "--frozen-lockfile=false"],
  installRoot
);
expect(
  installed.exitCode === 0,
  `isolated packed install failed:\n${installed.stdout}${installed.stderr}`
);
const cli = join(
  installRoot,
  "node_modules/@openmirai/intl-compiler/dist/cli.js"
);

const baseline = await mkdtemp(join(tmpdir(), "mirai-intl-real-diagnostic-"));
try {
  await createBaseline(baseline);
  const generated = execute(process.execPath, [cli, "generate"], baseline);
  expect(
    generated.exitCode === 0,
    `baseline generation failed:\n${generated.stdout}${generated.stderr}`
  );
  assertBoundedText(generated.stdout, stdoutOutputLimit, "baseline stdout");
  assertBoundedText(generated.stderr, stderrOutputLimit, "baseline stderr");
  assertNoSensitiveOutput(generated.stdout, "baseline generation");

  const scenarios: Array<ScenarioEvidence> = [];
  scenarios.push(
    await runFailureScenario(cli, baseline, {
      args: ["check", "--no-color"],
      expected: {
        code: "INTL_SOURCE_INVALID",
        column: 24,
        file: "src/invalid-named-key.ts",
        hint: "Fix the source usage, then rerun mirai-intl check.",
        line: 3,
        message: "Unknown translation path pages.home.missing",
        severity: "error",
      },
      async mutate(root) {
        const source = [
          'import { useTranslations } from "x";',
          'const { t } = useTranslations("pages.home");',
          'export const value = t("missing");',
          "",
        ].join("\n");
        await writeFile(join(root, "src/invalid-named-key.ts"), source, "utf8");
        return source;
      },
      name: "invalid-named-key",
    })
  );
  scenarios.push(
    await runFailureScenario(cli, baseline, {
      args: ["check", "--no-color"],
      expected: {
        code: "INTL_SOURCE_INVALID",
        column: 24,
        file: "src/invalid-parent-namespace.ts",
        hint: "Fix the source usage, then rerun mirai-intl check.",
        line: 3,
        message: "Unknown translation path missing.title",
        severity: "error",
      },
      async mutate(root) {
        const source = [
          'import { useTranslations } from "x";',
          'const { t } = useTranslations("missing");',
          'export const value = t("title");',
          "",
        ].join("\n");
        await writeFile(
          join(root, "src/invalid-parent-namespace.ts"),
          source,
          "utf8"
        );
        return source;
      },
      name: "invalid-parent-namespace",
    })
  );
  scenarios.push(
    await runFailureScenario(cli, baseline, {
      args: ["check", "--no-color"],
      expected: {
        code: "INTL_SOURCE_INVALID",
        column: 75,
        file: "src/invalid-form-error-key.ts",
        hint: "Fix the source usage, then rerun mirai-intl check.",
        line: 2,
        message: "Unknown form error key pages.home.error.form.missing",
        severity: "error",
      },
      async mutate(root) {
        const source = [
          'import { createFormSchema } from "./i18n/generated";',
          'export const schema = createFormSchema("pages.home", ({ error }) => error("missing"));',
          "",
        ].join("\n");
        await writeFile(
          join(root, "src/invalid-form-error-key.ts"),
          source,
          "utf8"
        );
        return source;
      },
      name: "invalid-form-error-key",
    })
  );

  const catalogCases = [
    {
      expected: {
        file: "src/locales/pages/home/th.json",
        hint: "Create or correct src/locales/pages/home/th.json for locale th, then rerun mirai-intl catalog-check.",
        locale: "th",
        message: "pages/home is missing configured locale th",
        severity: "error",
      },
      async mutate(root: string) {
        await rm(join(root, "src/locales/pages/home/th.json"));
      },
      name: "missing-required-locale-file",
    },
    {
      expected: {
        file: "src/locales/pages/home/th.json",
        hint: "Correct pages.home.title in src/locales/pages/home/th.json for locale th, then rerun mirai-intl catalog-check.",
        locale: "th",
        message:
          "pages.home locale keys differ between en and th: th is missing key title",
        path: "pages.home.title",
        severity: "error",
      },
      mutate: (root: string) =>
        writeJson(join(root, "src/locales/pages/home/th.json"), {
          error: { form: { required: "จำเป็น" } },
        }),
      name: "missing-locale-key",
    },
    {
      expected: {
        file: "src/locales/pages/home/th.json",
        hint: "Correct pages.home.title in src/locales/pages/home/th.json for locale th, then rerun mirai-intl catalog-check.",
        locale: "th",
        message: "pages.home.title th must be a non-empty translation string",
        path: "pages.home.title",
        severity: "error",
      },
      mutate: (root: string) =>
        writeJson(join(root, "src/locales/pages/home/th.json"), {
          error: { form: { required: "จำเป็น" } },
          title: "",
        }),
      name: "empty-locale-value",
    },
    {
      expected: {
        file: "src/locales/pages/home/th.json",
        hint: "Correct pages.home.title in src/locales/pages/home/th.json for locale th, then rerun mirai-intl catalog-check.",
        locale: "th",
        message: "pages.home.title th must be a non-empty translation string",
        path: "pages.home.title",
        severity: "error",
      },
      mutate: (root: string) =>
        writeJson(join(root, "src/locales/pages/home/th.json"), {
          error: { form: { required: "จำเป็น" } },
          title: " \n\t",
        }),
      name: "whitespace-locale-value",
    },
    {
      expected: {
        file: "src/locales/pages/home/th.json",
        hint: "Correct pages.home.title in src/locales/pages/home/th.json for locale th, then rerun mirai-intl catalog-check.",
        locale: "th",
        message:
          "pages.home.title has cross-locale kind mismatch: en=string, th=null",
        path: "pages.home.title",
        severity: "error",
      },
      mutate: (root: string) =>
        writeJson(join(root, "src/locales/pages/home/th.json"), {
          error: { form: { required: "จำเป็น" } },
          title: null,
        }),
      name: "null-locale-value",
    },
    {
      expected: {
        file: "src/locales/pages/home/th.json",
        hint: "Correct pages.home.title in src/locales/pages/home/th.json for locale th, then rerun mirai-intl catalog-check.",
        locale: "th",
        message:
          "pages.home.title has cross-locale kind mismatch: en=string, th=object",
        path: "pages.home.title",
        severity: "error",
      },
      mutate: (root: string) =>
        writeJson(join(root, "src/locales/pages/home/th.json"), {
          error: { form: { required: "จำเป็น" } },
          title: { nested: "wrong kind" },
        }),
      name: "wrong-kind-locale-value",
    },
  ] as const;
  for (const catalogCase of catalogCases) {
    scenarios.push(
      await runFailureScenario(cli, baseline, {
        args: ["catalog-check", "--no-color"],
        expected: {
          code: "INTL_CATALOG_INVALID",
          ...catalogCase.expected,
        },
        async mutate(root) {
          await catalogCase.mutate(root);
          return undefined;
        },
        name: catalogCase.name,
      })
    );
  }

  const coloredRoot = join(scenariosRoot, "colored-whitespace");
  await cp(baseline, coloredRoot, { recursive: true });
  await writeJson(join(coloredRoot, "src/locales/pages/home/th.json"), {
    error: { form: { required: "จำเป็น" } },
    title: " ",
  });
  const colored = execute(
    process.execPath,
    [cli, "catalog-check", "--color"],
    coloredRoot
  );
  expect(colored.exitCode === 1, "colored validation must exit 1");
  expect(colored.stderr === "", "colored validation must keep stderr empty");
  assertBoundedText(colored.stdout, stdoutOutputLimit, "colored stdout");
  assertBoundedText(colored.stderr, stderrOutputLimit, "colored stderr");
  expect(
    colored.stdout.includes("\u001b[31mERROR\u001b[0m") &&
      colored.stdout.includes("\u001b[31m✗\u001b[0m"),
    "explicit --color did not color ERROR and the failure mark red"
  );
  assertNoSensitiveOutput(colored.stdout, "colored validation");

  const usageRoot = join(scenariosRoot, "usage-config-error");
  await cp(baseline, usageRoot, { recursive: true });
  const usageReport = join(usageRoot, "diagnostic-report.json");
  const usage = execute(
    process.execPath,
    [cli, "check", "--format=sarif", "--report-file", usageReport],
    usageRoot
  );
  expect(usage.exitCode === 2, "usage/config error must exit 2");
  expect(usage.stdout === "", "usage/config error must keep stdout empty");
  assertBoundedText(usage.stdout, stdoutOutputLimit, "usage stdout");
  assertBoundedText(usage.stderr, stderrOutputLimit, "usage stderr");
  expect(
    usage.stderr === "mirai-intl: --format must be stylish or json\n",
    `unexpected usage/config stderr: ${usage.stderr}`
  );
  const usageDiagnostic = parseReport(
    await readFile(usageReport, "utf8"),
    "usage-config-error",
    "check"
  );
  deepStrictEqual(usageDiagnostic, {
    code: "INTL_CLI_FAILURE",
    hint: "Correct the command arguments and rerun Mirai Intl.",
    message: "--format must be stylish or json",
    severity: "error",
  });
  scenarios.push({
    command: `node ${cli} check --format=sarif --report-file diagnostic-report.json`,
    diagnostic: usageDiagnostic,
    exitCode: usage.exitCode,
    name: "usage-config-error",
    stderr: usage.stderr,
    stdout: usage.stdout,
  });

  const machineEvidence = {
    builtFromPackedArtifacts: true,
    cli: basename(cli),
    colorProbe: {
      errorIsRed: colored.stdout.includes("\u001b[31mERROR\u001b[0m"),
      failureMarkIsRed: colored.stdout.includes("\u001b[31m✗\u001b[0m"),
    },
    node: process.version,
    packageTarballs: [abiTarball, compilerTarball],
    scenarios,
    schemaVersion: 1,
  };
  await writeFile(
    join(outputRoot, "results.json"),
    `${JSON.stringify(machineEvidence, null, 2)}\n`,
    "utf8"
  );

  const markdown = [
    "# Mirai Intl Real CLI Diagnostic Smoke",
    "",
    `- Node: \`${process.version}\``,
    "- Execution: actual built and packed `@openmirai/intl-compiler` CLI in an isolated install",
    "- Test framework: none; this is an executable process-level smoke",
    `- Command: \`corepack pnpm diagnostic:smoke\``,
    `- Result: ${scenarios.length} deliberate failures matched their exact channel and exit contracts`,
    "",
    "## Scenarios",
    "",
    ...scenarios.flatMap((scenario) => [
      `### ${scenario.name}`,
      "",
      `Command: \`${scenario.command}\``,
      "",
      ...(scenario.sourceSnippet
        ? ["Source:", "", "```ts", scenario.sourceSnippet.trimEnd(), "```", ""]
        : []),
      `Exit: \`${scenario.exitCode}\``,
      "",
      "stdout:",
      "",
      "```text",
      scenario.stdout.trimEnd() || "(empty)",
      "```",
      "",
      "stderr:",
      "",
      "```text",
      scenario.stderr.trimEnd() || "(empty)",
      "```",
      "",
      "Structured diagnostic:",
      "",
      "```json",
      JSON.stringify(scenario.diagnostic, null, 2),
      "```",
      "",
    ]),
    "## Color probe",
    "",
    "- `--color` emitted red ANSI styling for both `ERROR` and `✗`.",
    "- Every report file remained ANSI-free.",
    "",
    "## Data-safety assertions",
    "",
    "- No translation value was emitted.",
    "- No raw receipt, proof, manifest, or source inventory was emitted.",
    "- No human-output line exceeded 2 KiB.",
    "",
  ].join("\n");
  await writeFile(join(outputRoot, "REPORT.md"), markdown, "utf8");
} finally {
  await Promise.all([
    rm(baseline, { force: true, recursive: true }),
    rm(scenariosRoot, { force: true, recursive: true }),
  ]);
}

process.stdout.write(
  `mirai-intl real diagnostic smoke ✓ ${join(outputRoot, "REPORT.md")}\n`
);
