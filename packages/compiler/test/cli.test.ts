import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/cli-app",
    version: "1.0.0",
  });
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello {name}",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี {name}",
  });
  return root;
}

function runCli(root: string, ...arguments_: ReadonlyArray<string>) {
  return spawnSync(process.execPath, [tsx, cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 30_000,
  });
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
});
