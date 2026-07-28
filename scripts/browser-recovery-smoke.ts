import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const smokeRoot = join(repositoryRoot, ".tmp", "browser-recovery-smoke");
const packsRoot = join(smokeRoot, "packs");
const consumerRoot = join(smokeRoot, "consumer");
const outputLimit = 64 * 1024;

function run(
  command: string,
  args: ReadonlyArray<string>,
  cwd: string,
  timeout = 60_000
): string {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
    killSignal: "SIGKILL",
    maxBuffer: outputLimit,
    shell: false,
    timeout,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      [
        `Command failed: ${JSON.stringify([command, ...args])}`,
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `error=${result.error?.message ?? "(none)"}`,
        `stdout=${(result.stdout ?? "").slice(0, outputLimit)}`,
        `stderr=${(result.stderr ?? "").slice(0, outputLimit)}`,
      ].join("\n")
    );
  }
  return result.stdout ?? "";
}

function pnpm(
  args: ReadonlyArray<string>,
  cwd: string,
  timeout?: number
): string {
  return run("corepack", ["pnpm", ...args], cwd, timeout);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

await rm(smokeRoot, { force: true, recursive: true });
await mkdir(packsRoot, { recursive: true });

for (const packageName of [
  "@openmirai/intl-abi",
  "@openmirai/intl-runtime",
  "@openmirai/intl-i18next",
]) {
  pnpm(
    ["--filter", packageName, "pack", "--pack-destination", packsRoot],
    repositoryRoot
  );
}

const tarballs = (await readdir(packsRoot))
  .filter((name) => name.endsWith(".tgz"))
  .toSorted();
expect(
  tarballs.length === 3,
  `Expected three tarballs, found ${tarballs.length}`
);
const packedPackages = Object.fromEntries(
  tarballs.map((name) => {
    let packageName = "@openmirai/intl-abi";
    if (name.includes("intl-i18next")) {
      packageName = "@openmirai/intl-i18next";
    } else if (name.includes("runtime")) {
      packageName = "@openmirai/intl-runtime";
    }
    return [packageName, `file:${join(packsRoot, name)}`];
  })
);

await mkdir(consumerRoot, { recursive: true });
await mkdir(join(consumerRoot, "locales"), { recursive: true });
await writeFile(
  join(consumerRoot, "package.json"),
  `${JSON.stringify(
    {
      dependencies: {
        "@openmirai/intl-i18next": packedPackages["@openmirai/intl-i18next"],
        react: "19.2.7",
        "react-dom": "19.2.7",
      },
      devDependencies: { vite: "7.3.6" },
      name: "mirai-intl-browser-recovery-smoke",
      packageManager: "pnpm@11.11.0",
      private: true,
      type: "module",
      version: "0.0.0",
    },
    null,
    2
  )}\n`,
  "utf8"
);
await writeFile(
  join(consumerRoot, "locales", "en.json"),
  `${JSON.stringify(
    {
      system: {
        translationUnavailable: "Translation unavailable",
      },
    },
    null,
    2
  )}\n`,
  "utf8"
);
await writeFile(
  join(consumerRoot, "pnpm-workspace.yaml"),
  [
    "packages: []",
    "overrides:",
    ...Object.entries(packedPackages).map(
      ([name, path]) => `  '${name}': '${path}'`
    ),
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(consumerRoot, ".npmrc"),
  [
    "auto-install-peers=false",
    "resolve-peers-from-workspace-root=false",
    "strict-peer-dependencies=true",
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(consumerRoot, "entry.js"),
  [
    'import { createMiraiI18next } from "@openmirai/intl-i18next";',
    'import en from "./locales/en.json";',
    "const localizedFallback = en.system.translationUnavailable;",
    "const sha = `sha256:${'0'.repeat(64)}`;",
    "const catalogManifest = {",
    '  buildId: "browser-recovery-smoke",',
    '  buildToken: "browser-recovery-smoke",',
    "  capabilitySetHash: sha,",
    '  catalogId: "browser-recovery-smoke",',
    '  catalogPackage: "browser-recovery-smoke",',
    '  compilerVersion: "mirai-intl-artifact-v2",',
    "  formatVersion: 1,",
    "  formatterVersions: {},",
    "  hash: sha,",
    "  localeHashes: { en: sha },",
    '  locales: ["en"],',
    '  rendererCapabilityId: "portable-ir-v1",',
    '  runtimeAbi: "1.0.0",',
    '  sourceLocale: "en",',
    "};",
    "const adapter = createMiraiI18next({",
    "  catalogManifest,",
    '  isCatalogLocale: (locale) => locale === "en",',
    "  loadCatalogResource: () => ({ translation: en }),",
    "  recovery: {",
    "    missingMessageFallback: (diagnostic) =>",
    '      diagnostic.locale === "en" ? localizedFallback : "",',
    "  },",
    "});",
    'const controller = adapter.createRequestController("en");',
    'await controller.activateLocale("en");',
    "let result;",
    "try {",
    "  const t = controller.getTranslations().t;",
    '  result = { threw: false, value: t("missing.parent.key") };',
    "} catch {",
    "  result = { threw: true };",
    "}",
    "globalThis.__MIRAI_BROWSER_RECOVERY_RESULT__ = result;",
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(consumerRoot, "vite.config.js"),
  [
    'import { defineConfig } from "vite";',
    "export default defineConfig(({ mode }) => ({",
    "  define: {",
    '    "process.env.NODE_ENV": JSON.stringify(mode),',
    "  },",
    "  build: {",
    '    lib: { entry: "entry.js", fileName: "bundle", formats: ["es"] },',
    "    minify: false,",
    "  },",
    "}));",
    "",
  ].join("\n"),
  "utf8"
);
await writeFile(
  join(consumerRoot, "execute.mjs"),
  [
    'import { pathToFileURL } from "node:url";',
    "const bundle = process.argv[2];",
    'if (typeof bundle !== "string") throw new Error("Missing bundle path");',
    "Reflect.deleteProperty(globalThis, 'process');",
    "await import(pathToFileURL(bundle).href);",
    "console.log(JSON.stringify(globalThis.__MIRAI_BROWSER_RECOVERY_RESULT__));",
    "",
  ].join("\n"),
  "utf8"
);

pnpm(["install", "--ignore-scripts"], consumerRoot, 120_000);

for (const mode of ["production", "development"] as const) {
  const outputRoot = join(consumerRoot, `dist-${mode}`);
  pnpm(
    [
      "exec",
      "vite",
      "build",
      "--mode",
      mode,
      "--outDir",
      outputRoot,
      "--emptyOutDir",
    ],
    consumerRoot,
    120_000
  );
  const bundle = join(outputRoot, "bundle.js");
  const bundleSource = await readFile(bundle, "utf8");
  expect(
    !bundleSource.includes("process.env.NODE_ENV"),
    `${mode} bundle retained process.env.NODE_ENV`
  );
  const result = JSON.parse(
    run(
      process.execPath,
      [join(consumerRoot, "execute.mjs"), bundle],
      consumerRoot
    )
  ) as Readonly<{ threw: boolean; value?: string }>;
  if (mode === "production") {
    expect(!result.threw, "Production bundle remained strict");
    expect(
      result.value !== "missing.parent.key",
      "Production bundle exposed the dotted key"
    );
    expect(
      result.value === "Translation unavailable",
      `Production fallback was ${JSON.stringify(result.value)}`
    );
  } else {
    expect(result.threw, "Development bundle did not remain strict");
  }
}

console.log(
  "mirai-intl browser recovery smoke ✓ production auto-recovers, development stays strict, and bundles run without global process"
);
