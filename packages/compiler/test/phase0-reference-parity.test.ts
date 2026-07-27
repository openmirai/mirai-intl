import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import type ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  analyzeConventionSourceFiles,
  analyzeConventionSources,
  collectConventionSourceFiles,
} from "../src/analyze-sources";
import { generateConventionCatalog } from "../src/catalog";
import { resolveConventionSourceUniverse } from "../src/ownership";
import { transformMiraiIntlSource } from "../src/transform";

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
  it("constructs one owner-scoped semantic Program and evidence record for every eligible source", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 18, true);
      await generateConventionCatalog(root, { collectEnvironment: false });
      programInstrumentation.count = 0;
      const started = performance.now();
      const before = process.memoryUsage().rss;
      const reference = await analyzeConventionSources(root, {
        semanticEngine: "reference",
      });
      const referenceProgramCount = programInstrumentation.count;
      programInstrumentation.count = 0;
      const observations: Array<unknown> = [];
      const candidate = await analyzeConventionSources(root, {
        semanticBatchObserver(owner, observation) {
          observations.push({ observation, owner });
        },
      });
      const candidateProgramCount = programInstrumentation.count;
      const measurement = {
        elapsedMilliseconds: performance.now() - started,
        filesAnalyzed: candidate.filesAnalyzed,
        maxRssKilobytes: process.resourceUsage().maxRSS,
        rssDeltaBytes: process.memoryUsage().rss - before,
      };

      const normalize = (analysis: typeof candidate) => ({
        ...analysis,
        diagnostics: analysis.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          file: diagnostic.file
            .split("\\")
            .join("/")
            .replace(/^.*\/src\//u, "src/"),
        })),
      });

      expect(normalize(candidate)).toEqual(normalize(reference));
      expect(normalize(candidate)).toMatchObject({
        candidates: 18,
        diagnostics: [
          {
            file: "src/source-000.ts",
            message: expect.stringContaining(
              "Unknown translation path missing"
            ),
          },
        ],
        evidence: expect.arrayContaining([
          expect.objectContaining({ source: "src/source-000.ts" }),
          expect.objectContaining({ source: "src/source-017.ts" }),
        ]),
        filesAnalyzed: 18,
      });
      expect(reference.evidence).toHaveLength(reference.filesAnalyzed);
      expect(candidate.evidence).toHaveLength(candidate.filesAnalyzed);
      expect(referenceProgramCount).toBe(reference.filesAnalyzed);
      expect(candidateProgramCount).toBe(1);
      expect(observations).toEqual([
        {
          observation: {
            fallbackFiles: 0,
            fallbackPrograms: 0,
            sharedFiles: 18,
            sharedPrograms: 1,
          },
          owner: "tsconfig.json",
        },
      ]);
      expect(measurement).toMatchObject({
        filesAnalyzed: 18,
      });
      expect(measurement.elapsedMilliseconds).toBeGreaterThan(0);
      expect(measurement.maxRssKilobytes).toBeGreaterThan(0);
      expect(Number.isFinite(measurement.rssDeltaBytes)).toBe(true);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  }, 120_000);

  it("authorizes a 613-file safe owner with one Program and complete evidence", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 613);
      await generateConventionCatalog(root, { collectEnvironment: false });
      const observations: Array<unknown> = [];
      programInstrumentation.count = 0;
      const analysis = await analyzeConventionSources(root, {
        semanticBatchObserver(owner, observation) {
          observations.push({ observation, owner });
        },
      });
      expect(analysis).toMatchObject({
        candidates: 613,
        diagnostics: [],
        filesAnalyzed: 613,
      });
      expect(analysis.evidence).toHaveLength(613);
      expect(programInstrumentation.count).toBe(1);
      expect(observations).toEqual([
        {
          observation: {
            fallbackFiles: 0,
            fallbackPrograms: 0,
            sharedFiles: 613,
            sharedPrograms: 1,
          },
          owner: "tsconfig.json",
        },
      ]);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  }, 120_000);

  it("creates one shared Program per exact owner and none for a checker", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 4);
      await writeJson(join(root, "tsconfig.owner-a.json"), {
        compilerOptions: { lib: ["ES5"] },
        files: ["src/source-000.ts", "src/source-001.ts"],
      });
      await writeJson(join(root, "tsconfig.owner-b.json"), {
        compilerOptions: { lib: ["ES2022"] },
        files: ["src/source-002.ts", "src/source-003.ts"],
      });
      await writeJson(join(root, "tsconfig.checker.json"), {
        include: ["src/**/*.ts"],
      });
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkProjects: [
          { path: "tsconfig.checker.json", role: "checker" },
          { path: "tsconfig.owner-a.json", role: "owner" },
          { path: "tsconfig.owner-b.json", role: "owner" },
        ],
      });
      await generateConventionCatalog(root, { collectEnvironment: false });
      const sourceFiles = await collectConventionSourceFiles(
        root,
        "src/i18n/generated"
      );
      const universe = await resolveConventionSourceUniverse(
        root,
        [
          { path: "tsconfig.checker.json", role: "checker" },
          { path: "tsconfig.owner-a.json", role: "owner" },
          { path: "tsconfig.owner-b.json", role: "owner" },
        ],
        "src/i18n/generated",
        sourceFiles
      );
      expect(universe.files.map(({ owner }) => owner)).toEqual([
        "tsconfig.owner-a.json",
        "tsconfig.owner-a.json",
        "tsconfig.owner-b.json",
        "tsconfig.owner-b.json",
      ]);
      expect(
        universe.files.some(({ owner }) => owner === "tsconfig.checker.json")
      ).toBe(false);

      const observations: Array<unknown> = [];
      programInstrumentation.count = 0;
      const analysis = await analyzeConventionSources(root, {
        semanticBatchObserver(owner, observation) {
          observations.push({ observation, owner });
        },
      });
      expect(analysis.filesAnalyzed).toBe(4);
      expect(programInstrumentation.count).toBe(2);
      expect(observations).toEqual([
        {
          observation: {
            fallbackFiles: 0,
            fallbackPrograms: 0,
            sharedFiles: 2,
            sharedPrograms: 1,
          },
          owner: "tsconfig.owner-a.json",
        },
        {
          observation: {
            fallbackFiles: 0,
            fallbackPrograms: 0,
            sharedFiles: 2,
            sharedPrograms: 1,
          },
          owner: "tsconfig.owner-b.json",
        },
      ]);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  });

  it("falls back per file for global, augmentation, triple-slash, and provider closure while retaining parity", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 6);
      await writeFile(
        join(root, "src/source-000.ts"),
        "const globalScript = 1;\n",
        "utf8"
      );
      await writeFile(
        join(root, "src/source-001.ts"),
        "export {};\ndeclare global { interface Window { mirai: string } }\n",
        "utf8"
      );
      await writeFile(
        join(root, "src/source-002.ts"),
        '/// <reference path="./provider.d.ts" />\nexport const referenced = 1;\n',
        "utf8"
      );
      await writeFile(
        join(root, "src/source-003.ts"),
        [
          'import { keys } from "./provider";',
          'import { useTranslations } from "example-provider";',
          "const { t } = useTranslations();",
          "export const translated = t(keys.greeting);",
          "",
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(root, "src/source-004.ts"),
        [
          "export {};",
          'declare module "example-provider" {',
          "  interface ProviderOptions { mirai: string }",
          "}",
          "",
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(root, "src/source-005.ts"),
        "export const isolated = 1;\n",
        "utf8"
      );
      await writeFile(
        join(root, "src/provider.d.ts"),
        'export declare const keys: { readonly greeting: "greeting" };\n',
        "utf8"
      );
      await writeJson(join(root, "tsconfig.json"), {
        include: ["src/**/*.ts"],
      });
      await generateConventionCatalog(root, { collectEnvironment: false });

      programInstrumentation.count = 0;
      const reference = await analyzeConventionSources(root, {
        semanticEngine: "reference",
      });
      const referencePrograms = programInstrumentation.count;
      const observations: Array<unknown> = [];
      programInstrumentation.count = 0;
      const candidate = await analyzeConventionSources(root, {
        semanticBatchObserver(owner, observation) {
          observations.push({ observation, owner });
        },
      });
      expect(candidate).toEqual(reference);
      expect(referencePrograms).toBe(7);
      expect(programInstrumentation.count).toBe(6);
      expect(observations).toEqual([
        {
          observation: {
            fallbackFiles: 5,
            fallbackPrograms: 5,
            sharedFiles: 2,
            sharedPrograms: 1,
          },
          owner: "tsconfig.json",
        },
      ]);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  });

  it("analyzes an explicitly authorized mounted owner while preserving the transform exclusion", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    const mountedOwner = join(root, "node_modules/@mirai/i18n/src/owner.ts");
    const source = "export const owner = 1;\n";
    try {
      await createConventionApp(root, 1);
      await mkdir(join(root, "node_modules/@mirai/i18n/src"), {
        recursive: true,
      });
      await writeFile(mountedOwner, source, "utf8");
      await writeJson(join(root, "tsconfig.json"), {
        files: ["src/source-000.ts", "node_modules/@mirai/i18n/src/owner.ts"],
      });
      await generateConventionCatalog(root, { collectEnvironment: false });

      programInstrumentation.count = 0;
      const transformed = await transformMiraiIntlSource(source, mountedOwner, {
        root,
      });
      expect(transformed).toBeNull();
      expect(programInstrumentation.count).toBe(0);

      const canonicalRoot = await realpath(root);
      const canonicalMountedOwner = await realpath(mountedOwner);
      const analysis = await analyzeConventionSourceFiles(
        root,
        [canonicalMountedOwner],
        canonicalRoot
      );
      expect(programInstrumentation.count).toBe(1);
      expect(analysis).toMatchObject({
        candidates: 1,
        diagnostics: [],
        evidence: [
          expect.objectContaining({
            source: "node_modules/@mirai/i18n/src/owner.ts",
          }),
        ],
        filesAnalyzed: 1,
      });
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  });

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
