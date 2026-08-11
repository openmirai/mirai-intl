import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

import type ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  analyzeConventionSourceFiles,
  analyzeConventionSources,
  collectConventionSourceFiles,
} from "../src/analyze-sources";
import { canonicalIntlCheckReceiptV3Bytes } from "../src/authorization-snapshot";
import {
  generateConventionCatalog,
  loadConventionCatalog,
} from "../src/catalog";
import { readConventionCheckReceipt } from "../src/check-receipt";
import { resolveConventionSourceUniverse } from "../src/ownership";
import { transformMiraiIntlSource } from "../src/transform";

const programInstrumentation = vi.hoisted(() => ({
  count: 0,
  generatedFacadePaths: new Set<string>(),
}));

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
  Object.defineProperty(wrapped, "createSourceFile", {
    value: (
      ...arguments_: Parameters<typeof actual.default.createSourceFile>
    ) => {
      if (
        /\.mirai-intl-generated-facade(?:\.[a-f\d]{64})?\.d\.ts$/u.test(
          arguments_[0]
        )
      ) {
        programInstrumentation.generatedFacadePaths.add(arguments_[0]);
      }
      return Reflect.apply(
        actual.default.createSourceFile,
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

async function readSelectedV3Receipt(root: string) {
  const selected = await readConventionCheckReceipt(root);
  if (selected.receipt.schemaVersion !== 3) {
    throw new Error("Expected selected Intl check receipt V3");
  }
  return selected.receipt;
}

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
  it("selects the internal reference engine exactly and fails closed", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    const environment = "MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE";
    const originalEnvironment = process.env[environment];
    try {
      await createConventionApp(root, 3);
      await generateConventionCatalog(root, { collectEnvironment: false });

      delete process.env[environment];
      programInstrumentation.count = 0;
      const ownerBatch = await analyzeConventionSources(root);
      expect(programInstrumentation.count).toBe(1);

      process.env[environment] = "owner-batch";
      programInstrumentation.count = 0;
      const environmentOwnerBatch = await analyzeConventionSources(root);
      expect(programInstrumentation.count).toBe(1);
      expect(environmentOwnerBatch).toEqual(ownerBatch);

      process.env[environment] = "reference";
      programInstrumentation.count = 0;
      const reference = await analyzeConventionSources(root);
      expect(programInstrumentation.count).toBe(reference.filesAnalyzed);
      expect(reference).toEqual(ownerBatch);

      process.env[environment] = "invalid";
      await expect(analyzeConventionSources(root)).rejects.toThrow(
        'Invalid MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE: "invalid"'
      );

      programInstrumentation.count = 0;
      const explicitOwnerBatch = await analyzeConventionSources(root, {
        semanticEngine: "owner-batch",
      });
      expect(programInstrumentation.count).toBe(1);
      expect(explicitOwnerBatch).toEqual(ownerBatch);

      programInstrumentation.count = 0;
      const explicitReference = await analyzeConventionSources(root, {
        semanticEngine: "reference",
      });
      expect(programInstrumentation.count).toBe(
        explicitReference.filesAnalyzed
      );
      expect(explicitReference).toEqual(reference);
    } finally {
      if (originalEnvironment === undefined) {
        delete process.env[environment];
      } else {
        process.env[environment] = originalEnvironment;
      }
      programInstrumentation.count = 0;
      programInstrumentation.generatedFacadePaths.clear();
      await rm(container, { force: true, recursive: true });
    }
  }, 120_000);

  it("rejects lexical, symlinked, and case-aliased virtual facade collisions before evidence", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 1);
      await generateConventionCatalog(root, { collectEnvironment: false });
      await writeFile(
        join(root, "src/source-000.ts"),
        [
          'import type { TranslationKey } from "./i18n/generated";',
          'import { useTranslations } from "example-provider";',
          'declare const key: TranslationKey<"global">;',
          "const { t } = useTranslations();",
          "export const translated = t(key);",
          "",
        ].join("\n"),
        "utf8"
      );
      programInstrumentation.generatedFacadePaths.clear();
      await analyzeConventionSources(root);
      const [virtualFacadePath] = [
        ...programInstrumentation.generatedFacadePaths,
      ];
      expect(virtualFacadePath).toBeDefined();
      if (!virtualFacadePath) {
        throw new Error("Expected a generated facade VFS path");
      }
      const moduleSpecifier = `../${basename(virtualFacadePath).replace(
        /\.d\.ts$/u,
        ""
      )}`;
      await writeFile(
        join(root, "src/source-000.ts"),
        [
          `import type { CollisionMarker } from ${JSON.stringify(moduleSpecifier)};`,
          'import type { TranslationKey } from "./i18n/generated";',
          'import { useTranslations } from "example-provider";',
          'declare const key: TranslationKey<"global">;',
          "const { t } = useTranslations();",
          "export const translated: CollisionMarker | string = t(key);",
          "",
        ].join("\n"),
        "utf8"
      );
      const canonicalRoot = await realpath(root);
      const canonicalSource = await realpath(join(root, "src/source-000.ts"));
      const expectCollision = async (): Promise<void> => {
        programInstrumentation.count = 0;
        const reference = await analyzeConventionSourceFiles(
          root,
          [canonicalSource],
          canonicalRoot,
          { semanticEngine: "reference" }
        );
        const candidate = await analyzeConventionSourceFiles(
          root,
          [canonicalSource],
          canonicalRoot,
          { semanticEngine: "owner-batch" }
        );
        expect(candidate).toEqual(reference);
        expect(candidate.evidence).toEqual([]);
        expect(candidate.diagnostics).toEqual([
          expect.objectContaining({
            message: expect.stringContaining(
              "Virtual generated facade path is occupied or aliased"
            ),
          }),
        ]);
        expect(programInstrumentation.count).toBe(0);
      };

      await writeFile(
        virtualFacadePath,
        "export interface CollisionMarker {}\n",
        "utf8"
      );
      await expectCollision();
      await rm(virtualFacadePath);

      const symlinkTarget = join(root, "src/collision-target.d.ts");
      await writeFile(
        symlinkTarget,
        "export interface CollisionMarker {}\n",
        "utf8"
      );
      await symlink(symlinkTarget, virtualFacadePath);
      await expectCollision();
      await rm(virtualFacadePath);

      const caseAlias = join(
        dirname(virtualFacadePath),
        basename(virtualFacadePath).toUpperCase()
      );
      await writeFile(
        caseAlias,
        "export interface CollisionMarker {}\n",
        "utf8"
      );
      await expectCollision();
      await rm(caseAlias);
    } finally {
      programInstrumentation.count = 0;
      programInstrumentation.generatedFacadePaths.clear();
      await rm(container, { force: true, recursive: true });
    }
  }, 120_000);

  it("constructs owner-scoped Programs only for semantic candidates while recording every eligible source", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 18, true);
      await generateConventionCatalog(root, { collectEnvironment: false });
      const firstSourcePath = join(root, "src/source-000.ts");
      await writeFile(
        firstSourcePath,
        [
          'import { createTranslationKey } from "./i18n/generated";',
          await readFile(firstSourcePath, "utf8"),
          'export const deferred = createTranslationKey("global")("greeting");',
          "",
        ].join("\n"),
        "utf8"
      );
      programInstrumentation.count = 0;
      const started = performance.now();
      const before = process.memoryUsage().rss;
      const reference = await analyzeConventionSources(root, {
        semanticEngine: "reference",
      });
      const referenceProgramCount = programInstrumentation.count;
      programInstrumentation.count = 0;
      programInstrumentation.generatedFacadePaths.clear();
      const observations: Array<unknown> = [];
      const candidate = await analyzeConventionSources(root, {
        semanticBatchObserver(owner, observation) {
          observations.push({ observation, owner });
        },
      });
      const candidateProgramCount = programInstrumentation.count;
      const candidateGeneratedFacadePaths = [
        ...programInstrumentation.generatedFacadePaths,
      ];
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
      expect(candidate.evidence.map(({ source }) => source)).toEqual(
        Array.from(
          { length: candidate.filesAnalyzed },
          (_, index) => `src/source-${String(index).padStart(3, "0")}.ts`
        )
      );
      expect(
        candidate.evidence.map(({ closureHash, source, sourceHash }) => ({
          closureHash,
          source,
          sourceHash,
        }))
      ).toEqual(
        reference.evidence.map(({ closureHash, source, sourceHash }) => ({
          closureHash,
          source,
          sourceHash,
        }))
      );
      expect(
        new Set(candidate.evidence.map(({ sourceHash }) => sourceHash)).size
      ).toBe(candidate.filesAnalyzed);
      expect(referenceProgramCount).toBe(reference.filesAnalyzed);
      expect(candidateProgramCount).toBe(1);
      expect(candidateGeneratedFacadePaths).toHaveLength(1);
      expect(candidateGeneratedFacadePaths[0]).toMatch(
        new RegExp(
          `^${(await realpath(root)).replaceAll(
            /[.*+?^${}()|[\]\\]/gu,
            String.raw`\$&`
          )}/\\.mirai-intl-generated-facade\\.[a-f\\d]{64}\\.d\\.ts$`,
          "u"
        )
      );
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
      programInstrumentation.generatedFacadePaths.clear();
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

  it("shares generated-facade consumers across nested source directories", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 2);
      await writeJson(join(root, "config/tsconfig.json"), {
        compilerOptions: {
          paths: {
            "@example/i18n/generated": ["../src/i18n/generated/index.ts"],
          },
        },
        include: ["../src/**/*.ts"],
      });
      await writeJson(join(root, "mirai-intl.config.json"), {
        checkProjects: [{ path: "config/tsconfig.json", role: "owner" }],
      });
      await writeJson(join(root, "src/locales/global/en.json"), {
        global: { greeting: "Hello" },
      });
      await writeJson(join(root, "src/locales/global/th.json"), {
        global: { greeting: "สวัสดี" },
      });
      const provider = [
        'import { parseTranslationKey } from "@example/i18n/generated";',
        'import type { TranslationKey } from "@example/i18n/generated";',
        'export const key = "greeting" satisfies TranslationKey<"global">;',
        'export const parsed = parseTranslationKey("global", "greeting");',
        "",
      ].join("\n");
      await mkdir(join(root, "src/nested"), { recursive: true });
      await writeFile(
        join(root, "src/source-000.ts"),
        [
          'import { key } from "./nested/provider";',
          'import { useTranslations } from "example-provider";',
          'const { t } = useTranslations("global");',
          "export const translated = t(key);",
          "",
        ].join("\n"),
        "utf8"
      );
      await writeFile(join(root, "src/nested/provider.ts"), provider, "utf8");
      await generateConventionCatalog(root, { collectEnvironment: false });

      programInstrumentation.count = 0;
      const analysis = await analyzeConventionSources(root);

      expect(analysis).toMatchObject({
        candidates: 3,
        diagnostics: [],
        filesAnalyzed: 3,
      });
      expect(analysis.evidence).toHaveLength(3);
      expect(
        analysis.evidence
          .find((entry) => entry.source === "src/nested/provider.ts")
          ?.providers.find((entry) => entry.kind === "generated")?.resolutions
      ).toHaveLength(1);
      expect(
        analysis.evidence
          .find((entry) => entry.source === "src/source-000.ts")
          ?.providers.find((entry) => entry.kind === "generated")?.resolutions
      ).toEqual([
        expect.objectContaining({
          from: expect.stringContaining("/src/nested/provider.ts"),
          specifier: "@example/i18n/generated",
        }),
      ]);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  });

  it("canonicalizes a generated facade provider once in reference and owner receipts", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    const environment = "MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE";
    const originalEnvironment = process.env[environment];
    try {
      await createConventionApp(root, 1);
      await writeFile(
        join(root, "src/source-000.ts"),
        [
          'import type { CatalogContract } from "./i18n/generated";',
          'export type Greeting = CatalogContract["greeting"];',
          "",
        ].join("\n"),
        "utf8"
      );
      await generateConventionCatalog(root, { collectEnvironment: false });

      for (const engine of ["reference", "owner-batch"] as const) {
        process.env[environment] = engine;
        const checked = runCli(root, "prove", "--format=json");
        expect(
          checked.status,
          `${engine}\n${checked.stdout}${checked.stderr}`
        ).toBe(0);
        expect(checked.stderr).toBe("");
        const analysis = await analyzeConventionSources(root, {
          semanticEngine: engine,
        });
        expect(analysis.diagnostics).toEqual([]);
        const generatedProviders = analysis.evidence[0]?.providers.filter(
          (provider) => provider.kind === "generated"
        );
        expect(generatedProviders).toHaveLength(1);
        expect(
          new Set(
            generatedProviders?.[0]?.resolutions.map(
              (resolution) => `${resolution.from}\u0000${resolution.specifier}`
            )
          ).size
        ).toBe(generatedProviders?.[0]?.resolutions.length);
      }
    } finally {
      if (originalEnvironment === undefined) {
        delete process.env[environment];
      } else {
        process.env[environment] = originalEnvironment;
      }
      await rm(container, { force: true, recursive: true });
    }
  }, 120_000);

  it("keeps generated provider receipts root-independent and mutation-sensitive", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const roots = [join(container, "reference"), join(container, "candidate")];
    const environment = "MIRAI_INTL_INTERNAL_SEMANTIC_ENGINE";
    const originalEnvironment = process.env[environment];
    try {
      for (const root of roots) {
        await createConventionApp(root, 1);
        await writeFile(
          join(root, "src/source-000.ts"),
          [
            'import type { CatalogContract } from "./i18n/generated";',
            'export type Greeting = CatalogContract["greeting"];',
            "",
          ].join("\n"),
          "utf8"
        );
        await generateConventionCatalog(root, { collectEnvironment: false });
      }
      const receipts = [];
      for (const [index, root] of roots.entries()) {
        process.env[environment] = index === 0 ? "reference" : "owner-batch";
        const checked = runCli(root, "prove", "--format=json");
        expect(
          checked.status,
          `${root}\n${checked.stdout}${checked.stderr}`
        ).toBe(0);
        const parsed = await readSelectedV3Receipt(root);
        const receiptSource = canonicalIntlCheckReceiptV3Bytes(parsed);
        expect(receiptSource).not.toContain(root);
        receipts.push({
          parsed,
          source: receiptSource,
        });
      }
      expect(receipts[1]?.source).toBe(receipts[0]?.source);
      const initialClosure = receipts[1]?.parsed.providerClosures.find(
        ({ source }) => source === "src/source-000.ts"
      )?.closureHash;
      expect(initialClosure).toBeDefined();

      const candidateRoot = roots[1] ?? "";
      await writeJson(join(candidateRoot, "src/locales/global/en.json"), {
        greeting: "Hello changed",
      });
      await rm(join(candidateRoot, "src/i18n/generated"), {
        force: true,
        recursive: true,
      });
      await rm(join(candidateRoot, ".mirai-intl"), {
        force: true,
        recursive: true,
      });
      const regenerated = runCli(candidateRoot, "ensure", "--format=json");
      expect(
        regenerated.status,
        `${regenerated.stdout}${regenerated.stderr}`
      ).toBe(0);
      const rechecked = runCli(candidateRoot, "prove", "--format=json");
      expect(rechecked.status, `${rechecked.stdout}${rechecked.stderr}`).toBe(
        0
      );
      const mutated = await readSelectedV3Receipt(candidateRoot);
      expect(
        mutated.providerClosures.find(
          ({ source }) => source === "src/source-000.ts"
        )?.closureHash
      ).not.toBe(initialClosure);
    } finally {
      if (originalEnvironment === undefined) {
        delete process.env[environment];
      } else {
        process.env[environment] = originalEnvironment;
      }
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
      expect(programInstrumentation.count).toBe(1);
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
            sharedPrograms: 0,
          },
          owner: "tsconfig.owner-b.json",
        },
      ]);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  });

  it("seals configured ambient types and their triple-slash path closure", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 2);
      await writeJson(join(root, "tsconfig.json"), {
        compilerOptions: { types: ["closure-ambient"] },
        include: ["src/**/*.ts"],
      });
      await writeJson(
        join(
          root,
          "node_modules/.pnpm/@types+closure-ambient@1.0.0/node_modules/@types/closure-ambient/package.json"
        ),
        {
          name: "@types/closure-ambient",
          types: "index.d.ts",
          version: "1.0.0",
        }
      );
      await writeFile(
        join(
          root,
          "node_modules/.pnpm/@types+closure-ambient@1.0.0/node_modules/@types/closure-ambient/index.d.ts"
        ),
        ['/// <reference path="./global.d.ts" />', "export {};", ""].join("\n"),
        "utf8"
      );
      await writeFile(
        join(
          root,
          "node_modules/.pnpm/@types+closure-ambient@1.0.0/node_modules/@types/closure-ambient/global.d.ts"
        ),
        "interface ClosureAmbientGlobal { readonly enabled: true }\n",
        "utf8"
      );
      await mkdir(join(root, "node_modules/@types"), { recursive: true });
      await symlink(
        "../.pnpm/@types+closure-ambient@1.0.0/node_modules/@types/closure-ambient",
        join(root, "node_modules/@types/closure-ambient")
      );
      await generateConventionCatalog(root, { collectEnvironment: false });
      const sourceFiles = await collectConventionSourceFiles(
        root,
        "src/i18n/generated"
      );
      const loaded = await loadConventionCatalog(root);
      const universe = await resolveConventionSourceUniverse(
        root,
        loaded.checkProjects,
        "src/i18n/generated",
        sourceFiles
      );
      expect(universe.files[0]?.ownerCompilerOptions.types).toEqual([
        "closure-ambient",
      ]);

      programInstrumentation.count = 0;
      const reference = await analyzeConventionSources(root, {
        semanticEngine: "reference",
      });
      const referencePrograms = programInstrumentation.count;
      programInstrumentation.count = 0;
      const candidate = await analyzeConventionSources(root);

      expect(candidate).toEqual(reference);
      expect(referencePrograms).toBe(2);
      expect(programInstrumentation.count).toBe(1);
      expect(
        candidate.evidence.every(
          (entry) =>
            entry.unsupportedProviderResolutionOptions.length === 0 &&
            entry.providers.some(
              (provider) =>
                provider.kind === "ambient" &&
                provider.resolutions.some(
                  (resolution) =>
                    resolution.from.endsWith("/__inferred type names__.ts") &&
                    resolution.specifier === "closure-ambient"
                ) &&
                provider.declarations.some((declaration) =>
                  declaration.path.endsWith("closure-ambient/global.d.ts")
                )
            )
        )
      ).toBe(true);
    } finally {
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  });

  it("seals TypeScript 6 lib aliases referenced by next-env declarations", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const root = join(container, "app");
    try {
      await createConventionApp(root, 1);
      await writeJson(join(root, "tsconfig.json"), {
        include: ["next-env.d.ts", "src/**/*.ts"],
      });
      await mkdir(join(root, ".next/types"), { recursive: true });
      await writeFile(
        join(root, ".next/types/routes.d.ts"),
        "export {};\n",
        "utf8"
      );
      await writeFile(
        join(root, "next-env.d.ts"),
        [
          '/// <reference types="next" />',
          '/// <reference types="next/image-types/global" />',
          'import "./.next/types/routes.d.ts";',
          "",
        ].join("\n"),
        "utf8"
      );
      const nextTypes = join(
        root,
        "node_modules/.pnpm/@types+next@1.0.0/node_modules/@types/next"
      );
      await writeJson(join(nextTypes, "package.json"), {
        name: "@types/next",
        types: "index.d.ts",
        version: "1.0.0",
      });
      await writeFile(
        join(nextTypes, "index.d.ts"),
        ['/// <reference lib="esnext.float16" />', "export {};", ""].join("\n"),
        "utf8"
      );
      await mkdir(join(nextTypes, "image-types"), { recursive: true });
      await writeFile(
        join(nextTypes, "image-types/global.d.ts"),
        "export {};\n",
        "utf8"
      );
      await mkdir(join(root, "node_modules/@types"), { recursive: true });
      await symlink(
        "../.pnpm/@types+next@1.0.0/node_modules/@types/next",
        join(root, "node_modules/@types/next")
      );
      await generateConventionCatalog(root, { collectEnvironment: false });

      const analysis = await analyzeConventionSources(root);
      expect(analysis.diagnostics).toEqual([
        expect.objectContaining({
          message: expect.stringContaining(
            "Triple-slash reference controls are not supported"
          ),
        }),
      ]);
      expect(
        analysis.evidence
          .find((entry) => entry.source.endsWith("next-env.d.ts"))
          ?.libs.some((entry) => entry.path.endsWith("lib.es2025.float16.d.ts"))
      ).toBe(true);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("seals pnpm-style @types package aliases and package-scope probes", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-phase0-"));
    const workspace = join(container, "workspace");
    const root = join(workspace, "apps/learner");
    const originalCwd = process.cwd();
    try {
      await mkdir(workspace, { recursive: true });
      await writeFile(
        join(workspace, "pnpm-workspace.yaml"),
        "packages:\n  - apps/*\n",
        "utf8"
      );
      await createConventionApp(root, 2);
      await writeJson(join(root, "tsconfig.json"), {
        compilerOptions: {
          paths: { "*": ["./*"] },
        },
        include: ["src/**/*.ts"],
      });
      const reactStore = join(
        workspace,
        "node_modules/.pnpm/@types+react@19.2.17/node_modules/@types/react"
      );
      await cp(
        await realpath(
          resolve(import.meta.dirname, "../../../node_modules/@types/react")
        ),
        reactStore,
        { recursive: true }
      );
      await mkdir(join(root, "node_modules/@types"), { recursive: true });
      await symlink(
        "../../../../node_modules/.pnpm/@types+react@19.2.17/node_modules/@types/react",
        join(root, "node_modules/@types/react")
      );
      const source = [
        'import { Fragment } from "react";',
        "interface Props { readonly node: React.ReactNode }",
        "export const Component: React.FC<Props> = ({ node }) => node;",
        "export const fragment = Fragment;",
        "",
      ].join("\n");
      await writeFile(join(root, "src/source-000.ts"), source, "utf8");
      await writeFile(join(root, "src/source-001.ts"), source, "utf8");
      await generateConventionCatalog(root, { collectEnvironment: false });
      process.chdir(workspace);

      const reference = await analyzeConventionSources(root, {
        semanticEngine: "reference",
      });
      const candidate = await analyzeConventionSources(root);

      expect(candidate).toEqual(reference);
      expect(candidate.diagnostics).toEqual([]);
    } finally {
      process.chdir(originalCwd);
      programInstrumentation.count = 0;
      await rm(container, { force: true, recursive: true });
    }
  });

  it("isolates unsafe sources while sharing an exact provider closure with reference parity", async () => {
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
          'import { values } from "closure-provider";',
          'import { useTranslations } from "example-provider";',
          "const { t } = useTranslations();",
          "export const translated = t(values.keys.greeting);",
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
      await mkdir(join(root, "src/nested"), { recursive: true });
      await writeFile(
        join(root, "src/nested/source-005.ts"),
        [
          'import { values } from "closure-provider";',
          'import { useTranslations } from "example-provider";',
          "const { t } = useTranslations();",
          "export const alsoTranslated = t(values.keys.greeting);",
          "",
        ].join("\n"),
        "utf8"
      );
      await rm(join(root, "src/source-005.ts"));
      await writeFile(
        join(root, "src/provider.d.ts"),
        'export declare const keys: { readonly greeting: "greeting" };\n',
        "utf8"
      );
      await writeJson(
        join(root, "node_modules/closure-provider/package.json"),
        {
          name: "closure-provider",
          types: "index.d.ts",
          version: "1.0.0",
        }
      );
      await writeFile(
        join(root, "node_modules/closure-provider/index.d.ts"),
        [
          '/// <reference path="./global.d.ts" />',
          'export * as values from "./values.js";',
          "",
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        join(root, "node_modules/closure-provider/values.d.ts"),
        'export declare const keys: { readonly greeting: "greeting" };\n',
        "utf8"
      );
      await writeFile(
        join(root, "node_modules/closure-provider/global.d.ts"),
        "interface ClosureProviderGlobal { readonly enabled: true }\n",
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
      expect(programInstrumentation.count).toBe(5);
      expect(observations).toEqual([
        {
          observation: {
            fallbackFiles: 4,
            fallbackPrograms: 4,
            sharedFiles: 3,
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
      expect(programInstrumentation.count).toBe(0);
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
          receipt: canonicalIntlCheckReceiptV3Bytes(
            await readSelectedV3Receipt(root)
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
