import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts/publish-packages.mjs");
const packageManifest = JSON.parse(
  await readFile(join(root, "packages/abi/package.json"), "utf8")
) as { version: string };
const version = packageManifest.version;
const packageNames = [
  "@openmirai/intl-abi",
  "@openmirai/intl-compiler",
  "@openmirai/intl-runtime",
  "@openmirai/intl",
  "@openmirai/intl-i18next",
] as const;
const workflow = join(root, ".github/workflows/publish.yml");

const fakeCorepack = `#!/bin/sh
set -eu

log="$PUBLISH_TEST_LOG"
if [ "$1" != "pnpm" ] || [ "$2" != "--dir" ] || [ "$4" != "pack" ]; then
  echo "unexpected corepack arguments: $*" >&2
  exit 64
fi

directory="$3"
destination="$6"
case "$directory" in
  packages/abi) archive="openmirai-intl-abi-${version}.tgz" ;;
  packages/compiler) archive="openmirai-intl-compiler-${version}.tgz" ;;
  packages/runtime) archive="openmirai-intl-runtime-${version}.tgz" ;;
  packages/intl) archive="openmirai-intl-${version}.tgz" ;;
  packages/intl-i18next) archive="openmirai-intl-i18next-${version}.tgz" ;;
  *) echo "unexpected package directory: $directory" >&2; exit 64 ;;
esac

printf 'pack %s\\n' "$directory" >> "$log"
if [ "$directory" = "packages/compiler" ]; then
  node "$PUBLISH_TEST_PACK_SCRIPT" "$directory" "$destination/$archive"
else
  : > "$destination/$archive"
fi
`;

const fakeNpm = `#!/bin/sh
set -eu

log="$PUBLISH_TEST_LOG"
case "$1" in
  view)
    package_spec="$2"
    package_name="$(printf '%s' "$package_spec" | sed 's/@[^@]*$//')"
    printf 'view %s\\n' "$package_spec" >> "$log"
    case ",$PUBLISH_TEST_MISSING," in
      *,"$package_name",*)
        printf '%s\\n' 'npm error code E404' >&2
        exit 1
        ;;
    esac
    if [ "\${PUBLISH_TEST_ERROR_PACKAGE:-}" = "$package_name" ]; then
      printf '%s\\n' 'npm error code E401' >&2
      exit 1
    fi
    printf '"${version}"\\n'
    ;;
  publish)
    printf 'publish %s\\n' "$*" >> "$log"
    ;;
  *)
    echo "unexpected npm arguments: $*" >&2
    exit 64
    ;;
esac
`;

async function runPublish({
  missing = [],
  errorPackage,
  preflight = true,
  nativeFault,
}: {
  missing?: ReadonlyArray<string>;
  errorPackage?: string;
  preflight?: boolean;
  nativeFault?:
    | "missing"
    | "tampered"
    | "packed-missing"
    | "packed-tampered"
    | "partial"
    | "source-stale"
    | "version-stale"
    | "install-hook"
    | "extra-file";
} = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), "mirai-intl-publish-test-"));
  const bin = join(sandbox, "bin");
  const log = join(sandbox, "commands.log");
  await mkdir(bin);
  await mkdir(join(sandbox, "scripts"));
  await mkdir(join(sandbox, "native/scripts"), { recursive: true });
  await mkdir(join(sandbox, "native/src"));
  await cp(script, join(sandbox, "scripts/publish-packages.mjs"));
  await cp(
    join(root, "native/scripts/release.mjs"),
    join(sandbox, "native/scripts/release.mjs")
  );
  // The tar reader is a producer dependency, never a consumer build hook.
  await mkdir(join(sandbox, "packages/compiler"), { recursive: true });
  const { symlink } = await import("node:fs/promises");
  await symlink(
    join(root, "packages/compiler/node_modules"),
    join(sandbox, "packages/compiler/node_modules")
  );
  for (const directory of [
    "abi",
    "compiler",
    "runtime",
    "intl",
    "intl-i18next",
  ]) {
    await mkdir(join(sandbox, "packages", directory, "dist"), {
      recursive: true,
    });
    await cp(
      join(root, "packages", directory, "package.json"),
      join(sandbox, "packages", directory, "package.json")
    );
  }
  const digest = (bytes: string | Buffer) =>
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const paths = [
    "native/Cargo.lock",
    "native/Cargo.toml",
    "native/build.rs",
    "native/src/lib.rs",
  ];
  for (const path of paths) {
    await writeFile(join(sandbox, path), "fixture\n");
  }
  const targets = [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64-gnu",
    "linux-x64-gnu",
    "linux-arm64-musl",
    "linux-x64-musl",
    "win32-arm64",
    "win32-x64",
  ].toSorted();
  const nativeDir = join(sandbox, "packages/compiler/native");
  await mkdir(nativeDir);
  const entries: Record<string, { file: string; bytes: number; hash: string }> =
    {};
  for (const target of targets) {
    const file = `mirai-intl-${target}.node`;
    await writeFile(join(nativeDir, file), "binary");
    entries[target] = { file, bytes: 6, hash: digest("binary") };
  }
  await writeFile(
    join(nativeDir, "engine-manifest.json"),
    `${JSON.stringify({ compilerVersion: version, engineAbi: "mirai-intl-native-v1", schemaVersion: 1, sourceHash: digest(JSON.stringify(paths.map((path) => ({ path, hash: digest("fixture\n") })))), targets: entries })}\n`
  );
  if (nativeFault === "missing") {
    await rm(join(nativeDir, "mirai-intl-win32-arm64.node"));
  }
  if (nativeFault === "tampered") {
    await writeFile(
      join(nativeDir, "mirai-intl-linux-arm64-gnu.node"),
      "damage"
    );
  }
  if (
    ["partial", "source-stale", "version-stale"].includes(nativeFault ?? "")
  ) {
    const manifestPath = join(nativeDir, "engine-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (nativeFault === "partial") {
      delete manifest.targets["win32-arm64"];
    }
    if (nativeFault === "source-stale") {
      manifest.sourceHash = digest("stale source");
    }
    if (nativeFault === "version-stale") {
      manifest.compilerVersion = "0.0.0";
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  }
  if (nativeFault === "install-hook") {
    const manifestPath = join(sandbox, "packages/compiler/package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.scripts = {
      ...manifest.scripts,
      install: "cargo build --release",
    };
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
  if (nativeFault === "extra-file") {
    await writeFile(join(nativeDir, "unexplained.node"), "binary");
  }
  await writeFile(
    join(sandbox, "pack.mjs"),
    `
    import { createRequire } from 'node:module';
    import { writeFile } from 'node:fs/promises';
    if (${JSON.stringify(nativeFault)} === 'packed-tampered') await writeFile(process.argv[2] + '/native/mirai-intl-darwin-arm64.node', 'damage');
    const { c } = createRequire(${JSON.stringify(join(root, "packages/compiler/package.json"))})('tar');
    await c({ file: process.argv[3], gzip: true, cwd: process.argv[2], prefix: 'package' }, ['package.json', 'dist', ...(${JSON.stringify(nativeFault)} === 'packed-missing' ? [] : ['native'])]);
  `
  );
  await writeFile(join(bin, "corepack"), fakeCorepack, { mode: 0o755 });
  await writeFile(join(bin, "npm"), fakeNpm, { mode: 0o755 });
  await writeFile(log, "");
  await chmod(join(bin, "corepack"), 0o755);
  await chmod(join(bin, "npm"), 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      [
        join(sandbox, "scripts/publish-packages.mjs"),
        ...(preflight ? ["--preflight"] : []),
        "--",
        version,
      ],
      {
        cwd: sandbox,
        encoding: "utf8",
        env: {
          ...process.env,
          NPM_REGISTRY: "https://registry.npmjs.org",
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          PUBLISH_TEST_PACK_SCRIPT: join(sandbox, "pack.mjs"),
          PUBLISH_TEST_LOG: log,
          PUBLISH_TEST_MISSING: missing.join(","),
          PUBLISH_TEST_ERROR_PACKAGE: errorPackage ?? "",
        },
      }
    );
    return { lines: (await readFile(log, "utf8")).trim().split("\n"), result };
  } finally {
    await rm(sandbox, { force: true, recursive: true });
  }
}

describe("publish package idempotence", () => {
  it("succeeds without republishing an already complete release", async () => {
    const { lines, result } = await runPublish();

    expect(result.status).toBe(0);
    expect(lines.filter((line) => line.startsWith("view "))).toEqual(
      packageNames.map((name) => `view ${name}@${version}`)
    );
    expect(lines.filter((line) => line.startsWith("pack "))).toEqual([]);
    expect(lines.filter((line) => line.startsWith("publish "))).toEqual([]);
    expect(result.stdout).toContain(
      `All ${packageNames.length} packages at ${version} are already published`
    );
  });

  it("validates and publishes only the missing packages after a partial release", async () => {
    const missing = ["@openmirai/intl-compiler", "@openmirai/intl"];
    const { lines, result } = await runPublish({ missing });

    expect(result.status).toBe(0);
    expect(lines.filter((line) => line.startsWith("pack "))).toEqual([
      "pack packages/compiler",
      "pack packages/intl",
    ]);
    const publishLines = lines.filter((line) => line.startsWith("publish "));
    expect(publishLines).toHaveLength(missing.length);
    expect(publishLines.every((line) => line.includes("--dry-run"))).toBe(true);
    expect(publishLines).toEqual([
      expect.stringContaining(`openmirai-intl-compiler-${version}.tgz`),
      expect.stringContaining(`openmirai-intl-${version}.tgz`),
    ]);
    expect(result.stdout).toContain(
      "Resuming partial release; publishing only missing packages"
    );
  });

  it("publishes only missing packages when resuming a partial release", async () => {
    const missing = ["@openmirai/intl-compiler", "@openmirai/intl"];
    const { lines, result } = await runPublish({ missing, preflight: false });

    expect(result.status).toBe(0);
    const publishLines = lines.filter((line) => line.startsWith("publish "));
    expect(publishLines).toHaveLength(missing.length);
    expect(publishLines.every((line) => !line.includes("--dry-run"))).toBe(
      true
    );
    expect(
      publishLines.every((line) =>
        line.includes("--registry https://registry.npmjs.org")
      )
    ).toBe(true);
  });

  it("packs and publishes every package for a genuinely new release", async () => {
    const { lines, result } = await runPublish({
      missing: packageNames,
      preflight: false,
    });

    expect(result.status).toBe(0);
    expect(lines.filter((line) => line.startsWith("pack "))).toEqual([
      "pack packages/abi",
      "pack packages/compiler",
      "pack packages/runtime",
      "pack packages/intl",
      "pack packages/intl-i18next",
    ]);
    const publishLines = lines.filter((line) => line.startsWith("publish "));
    expect(publishLines).toHaveLength(packageNames.length);
    expect(publishLines.every((line) => !line.includes("--dry-run"))).toBe(
      true
    );
  });

  it("fails closed when registry state cannot be inspected", async () => {
    const { lines, result } = await runPublish({
      errorPackage: packageNames[0],
    });

    expect(result.status).not.toBe(0);
    expect(lines).toEqual([`view ${packageNames[0]}@${version}`]);
    expect(result.stderr).toContain(
      `Unable to determine whether ${packageNames[0]}@${version} is published`
    );
    expect(result.stderr).toContain(
      "Verify registry access and npm Trusted Publisher configuration"
    );
  });

  it.each([
    "missing",
    "tampered",
    "packed-missing",
    "packed-tampered",
    "partial",
    "source-stale",
    "version-stale",
    "install-hook",
    "extra-file",
  ] as const)(
    "blocks publication when native assets are %s",
    async (nativeFault) => {
      const { lines, result } = await runPublish({
        missing: packageNames,
        preflight: false,
        nativeFault,
      });
      expect(result.status).not.toBe(0);
      expect(lines.filter((line) => line.startsWith("publish "))).toEqual([]);
      expect(lines.filter((line) => line.startsWith("view ")).length).toBe(
        nativeFault.startsWith("packed-") ? packageNames.length : 0
      );
    }
  );

  it("uses npm Trusted Publishing for the canonical release workflow", async () => {
    const contents = await readFile(workflow, "utf8");

    expect(contents).toContain("id-token: write");
    expect(contents).toContain("contents: read");
    expect(contents).toContain("registry-url: https://registry.npmjs.org");
    expect(contents).not.toContain("npm.pkg.github.com");
    expect(contents).not.toContain("NODE_AUTH_TOKEN");
  });
});
