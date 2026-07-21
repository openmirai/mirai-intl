import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const cli = resolve(import.meta.dirname, "../src/cli.ts");
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
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
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

describe("convention-only CLI", () => {
  it("generates and verifies a convention catalog without configuration", async () => {
    const root = await createConventionApp();
    try {
      const generated = runCli(root, "generate");
      expect(generated.error).toBeUndefined();
      expect(generated.signal).toBeNull();
      expect(generated.stderr).toBe("");
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        report: {
          contracts: {
            discovery: { mode: "convention" },
            messages: { generated: true, source: "message-ast" },
          },
          discovery: {
            catalogId: "@example/cli-app",
            framework: "vite",
            sourceLocale: "en",
          },
          environment: {
            lockfileHash: sha256("lockfileVersion: '9.0'\n"),
          },
        },
      });

      const checked = runCli(root, "check");
      expect(checked.error).toBeUndefined();
      expect(checked.signal).toBeNull();
      expect(checked.stderr).toBe("");
      expect(checked.status).toBe(0);
      expect(JSON.parse(checked.stdout)).toMatchObject({ valid: true });
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

      const generated = runCli(packageRoot, "generate");
      expect(generated.error).toBeUndefined();
      expect(generated.signal).toBeNull();
      expect(generated.stderr).toBe("");
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        report: {
          discovery: { catalogId: "@example/cli-app" },
          environment: { lockfileHash: sha256(lockfile) },
        },
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
        "generate"
      );
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        report: {
          environment: {
            installedTuple: { typescript: "6.0.3", vite: "7.3.6" },
          },
        },
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
      const generated = runCli(root, "generate");
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

      const generated = runCli(root, "generate");
      expect(generated.status).toBe(0);
      expect(JSON.parse(generated.stdout)).toMatchObject({
        report: {
          contracts: { exceptions: { present: true } },
          inputs: {
            sourceFiles: expect.arrayContaining([
              expect.objectContaining({
                path: "node_modules/@mirai/i18n/locales/components/ui/global/en.json",
              }),
            ]),
          },
        },
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("ensures missing and stale catalogs while leaving a current catalog unchanged", async () => {
    const root = await createConventionApp();
    try {
      const missing = runCli(root, "ensure");
      expect(missing.status).toBe(0);
      expect(JSON.parse(missing.stdout)).toMatchObject({
        changed: true,
        contentHash: expect.stringMatching(/^sha256:[a-f\d]{64}$/u),
        directory: expect.stringContaining("src/i18n/generated/builds/"),
      });

      const current = runCli(root, "ensure");
      expect(current.status).toBe(0);
      expect(JSON.parse(current.stdout)).toMatchObject({
        changed: false,
      });

      await writeJson(join(root, "src/locales/global/en.json"), {
        greeting: "Welcome {name}",
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        greeting: "ยินดีต้อนรับ {name}",
      });
      const stale = runCli(root, "ensure");
      expect(stale.status).toBe(0);
      expect(JSON.parse(stale.stdout)).toMatchObject({
        changed: true,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

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

      const checked = runCli(root, "check");
      expect(checked.status).not.toBe(0);
      expect(`${checked.stdout}${checked.stderr}`).toMatch(
        /Unknown translation path missing/u
      );
      expect(JSON.parse(checked.stdout)).toMatchObject({
        sourceAnalysis: {
          candidates: 1,
          diagnostics: [
            { message: expect.stringContaining("Unknown translation path") },
          ],
        },
        valid: false,
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
      expect(runCli(root, "generate").status).toBe(0);
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

      const checked = runCli(root, "check");
      expect(checked.error).toBeUndefined();
      expect(checked.status).toBe(0);
      expect(JSON.parse(checked.stdout)).toMatchObject({
        sourceAnalysis: {
          candidates: 1,
          diagnostics: [],
          filesAnalyzed: 1,
        },
        valid: true,
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
