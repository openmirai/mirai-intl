import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import type ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { analyzeConventionSources } from "../src/analyze-sources";
import { generateConventionCatalog } from "../src/catalog";

const programInstrumentation = vi.hoisted(() => ({ count: 0 }));

vi.mock("typescript", async (importOriginal) => {
  interface TypeScriptModule {
    default: typeof ts;
  }
  const actual = await importOriginal<TypeScriptModule>();
  const wrapped = Object.create(actual.default) as typeof actual.default;
  Object.defineProperty(wrapped, "createProgram", {
    value: (...arguments_: Parameters<typeof actual.default.createProgram>) => {
      programInstrumentation.count += 1;
      return Reflect.apply(
        actual.default.createProgram,
        actual.default,
        arguments_
      );
    },
  });
  return { ...actual, default: wrapped };
});

const cli = resolve(import.meta.dirname, "../src/cli.ts");
const tsx = resolve(
  import.meta.dirname,
  "../../../node_modules/tsx/dist/cli.mjs"
);

type FileSnapshot = Readonly<Record<string, string>>;

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function createConventionApp(
  root: string,
  fileCount: number,
  invalidSource = false
): Promise<void> {
  await writeJson(join(root, "package.json"), {
    dependencies: { vite: "8.1.4" },
    name: "@example/phase0-parity",
    version: "1.0.0",
  });
  await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await writeJson(join(root, "src/locales/global/en.json"), {
    greeting: "Hello",
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    greeting: "สวัสดี",
  });
  await writeJson(join(root, "tsconfig.json"), {
    include: ["src/**/*.ts"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  await mkdir(join(root, "src"), { recursive: true });
  await Promise.all(
    Array.from({ length: fileCount }, async (_, index) => {
      const source =
        index === 0
          ? [
              'import { useTranslations } from "example-provider";',
              "const { t } = useTranslations();",
              `export const translated = t("${invalidSource ? "missing" : "greeting"}");`,
              "",
            ].join("\n")
          : `export const value${index} = ${index};\n`;
      await writeFile(
        join(root, "src", `source-${String(index).padStart(3, "0")}.ts`),
        source,
        "utf8"
      );
    })
  );
}

function runCli(root: string, ...arguments_: ReadonlyArray<string>) {
  return spawnSync(process.execPath, [tsx, cli, ...arguments_], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    killSignal: "SIGKILL",
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    timeout: 60_000,
  });
}

async function snapshotFiles(directory: string): Promise<FileSnapshot> {
  const snapshot: Record<string, string> = {};
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        snapshot[relative(directory, path).split("\\").join("/")] =
          await readFile(path, "utf8");
      }
    }
  };
  await visit(directory);
  return Object.fromEntries(
    Object.entries(snapshot).toSorted(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

describe("Phase 0 reference-engine parity", () => {
  it("records exact Program construction separately from eligible source coverage", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 18, true);
      await generateConventionCatalog(root, { collectEnvironment: false });
      programInstrumentation.count = 0;
      const started = performance.now();
      const before = process.memoryUsage().rss;
      const first = await analyzeConventionSources(root);
      const second = await analyzeConventionSources(root);
      const measurement = {
        elapsedMilliseconds: performance.now() - started,
        filesAnalyzed: first.filesAnalyzed,
        maxRssKilobytes: process.resourceUsage().maxRSS,
        programCount: programInstrumentation.count,
        rssDeltaBytes: process.memoryUsage().rss - before,
      };

      const normalize = (analysis: typeof first) => ({
        ...analysis,
        diagnostics: analysis.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          file: diagnostic.file
            .split("\\")
            .join("/")
            .replace(/^.*\/src\//u, "src/"),
        })),
      });

      expect(normalize(second)).toEqual(normalize(first));
      expect(normalize(first)).toMatchObject({
        candidates: 18,
        diagnostics: [
          {
            file: "src/source-000.ts",
            message: expect.stringContaining(
              "Unknown translation path missing"
            ),
          },
        ],
        filesAnalyzed: 18,
      });
      expect(measurement).toMatchObject({
        filesAnalyzed: 18,
        programCount: 2,
      });
      expect(measurement.elapsedMilliseconds).toBeGreaterThan(0);
      expect(measurement.maxRssKilobytes).toBeGreaterThan(0);
      expect(Number.isFinite(measurement.rssDeltaBytes)).toBe(true);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  }, 120_000);

  it("keeps artifacts, reports, and receipts byte-identical across clean runs", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    const runs: Array<
      Readonly<{
        artifacts: FileSnapshot;
        checkReport: string;
        checkStdout: string;
        proveReport: string;
        proveStdout: string;
        receipt: string;
      }>
    > = [];
    try {
      for (let index = 0; index < 3; index += 1) {
        await rm(root, { force: true, recursive: true });
        await createConventionApp(root, 6);

        const ensured = runCli(root, "ensure", "--format=json");
        expect(ensured.status, `${ensured.stdout}${ensured.stderr}`).toBe(0);
        expect(ensured.stderr).toBe("");

        const checkReportPath = join(root, "reports/check.json");
        const checked = runCli(
          root,
          "check",
          "--format=json",
          "--report-file",
          checkReportPath
        );
        expect(checked.status, `${checked.stdout}${checked.stderr}`).toBe(0);
        expect(checked.stderr).toBe("");

        const proveReportPath = join(root, "reports/prove.json");
        const proved = runCli(
          root,
          "prove",
          "--format=json",
          "--report-file",
          proveReportPath
        );
        expect(proved.status, `${proved.stdout}${proved.stderr}`).toBe(0);
        expect(proved.stderr).toBe("");

        runs.push({
          artifacts: await snapshotFiles(join(root, "src/i18n/generated")),
          checkReport: await readFile(checkReportPath, "utf8"),
          checkStdout: checked.stdout,
          proveReport: await readFile(proveReportPath, "utf8"),
          proveStdout: proved.stdout,
          receipt: await readFile(
            join(root, ".mirai-intl/check-receipt.v2.json"),
            "utf8"
          ),
        });
      }

      expect(runs).toHaveLength(3);
      expect(runs[1]).toEqual(runs[0]);
      expect(runs[2]).toEqual(runs[0]);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 180_000);
});
