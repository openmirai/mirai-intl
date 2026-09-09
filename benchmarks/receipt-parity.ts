import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fixture } from "./receipt-verification";

const execute = promisify(execFile);
const args = process.argv.slice(2);
const option = (name: string) => {
  const value = args[args.indexOf(name) + 1];
  if (args.indexOf(name) < 0 || !value) {
    throw new Error(`Missing ${name}`);
  }
  return resolve(value);
};
const temporary = await mkdtemp(join(tmpdir(), "intl-receipt-parity-"));
try {
  const engines = [
    { name: "reference", repository: option("--reference") },
    { name: "candidate", repository: option("--candidate") },
  ];
  const cases = [
    { name: "unchanged", path: undefined, bytes: undefined },
    {
      name: "changed source",
      path: "src/page.ts",
      bytes: "export const answer = 43;\n",
    },
    {
      name: "new source",
      path: "src/new.ts",
      bytes: "export const newSource = 1;\n",
    },
    { name: "deleted source", path: "src/page.ts", bytes: undefined },
    { name: "missing locale", path: "src/locales/th.json", bytes: undefined },
    { name: "missing keys", path: "src/locales/th.json", bytes: "{}" },
    {
      name: "empty translation",
      path: "src/locales/th.json",
      bytes: '{"message0":""}',
    },
    {
      name: "wrong-kind translation",
      path: "src/locales/th.json",
      bytes: '{"message0":4}',
    },
    {
      name: "invalid ICU",
      path: "src/locales/th.json",
      bytes: '{"message0":"{"}',
    },
    {
      name: "new locale",
      path: "src/locales/ja.json",
      bytes: '{"message0":"Hello"}',
    },
    {
      name: "changed manifest",
      path: "package.json",
      bytes:
        '{"name":"@benchmark/app-0","version":"2.0.0","dependencies":{"vite":"8.1.4"}}',
    },
    {
      name: "changed config",
      path: "tsconfig.json",
      bytes: '{"include":["other/**/*.ts"]}',
    },
    {
      name: "corrupt pointer",
      path: "src/i18n/generated/current.json",
      bytes: "{}",
    },
    {
      name: "missing generation receipt",
      path: "src/i18n/generated/catalog-generation-receipt.v1.json",
      bytes: undefined,
    },
    {
      name: "missing authority selector",
      path: ".mirai-intl/check-receipt.current.json",
      bytes: undefined,
    },
  ];
  const results = [];
  for (const engine of engines) {
    const root = join(temporary, engine.name);
    await fixture(root, engine.repository);
    const { stdout: commit } = await execute("git", ["rev-parse", "HEAD"], {
      cwd: engine.repository,
    });
    for (const test of cases) {
      const path = test.path ? join(root, "apps/a", test.path) : undefined;
      const previous = path
        ? await readFile(path).catch((error: unknown) => {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            ) {
              return undefined;
            }
            throw error;
          })
        : undefined;
      try {
        if (path && test.bytes !== undefined) {
          await writeFile(path, test.bytes);
        } else if (path) {
          await rm(path);
        }
        const { stdout } = await execute(
          process.execPath,
          [
            "--import",
            import.meta.resolve("tsx"),
            resolve(import.meta.dirname, "receipt-verification.ts"),
            "--worker",
            "--probe",
            "--repository",
            engine.repository,
            "--root",
            root,
          ],
          { maxBuffer: 16 * 1024 * 1024 }
        );
        const result = JSON.parse(stdout) as {
          accepted: boolean;
          message?: string;
        };
        if (result.accepted !== (test.name === "unchanged")) {
          throw new Error(
            `${engine.name} unexpectedly ${result.accepted ? "accepted" : "rejected"} ${test.name}: ${stdout}`
          );
        }
        results.push({
          engine: engine.name,
          commit: commit.trim(),
          case: test.name,
          ...result,
        });
      } finally {
        if (path && previous) {
          await writeFile(path, previous);
        } else if (path) {
          await rm(path, { force: true });
        }
      }
    }
  }
  const output = option("--out");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ node: process.version, scope: "Acceptance/rejection parity against the exhaustive reference. Error wording is retained below, not required to be identical.", results }, null, 2)}\n`
  );
  console.log(
    `All ${results.length} reference/candidate mutation observations match expected acceptance; ${output}`
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
