import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
: > "$destination/$archive"
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
}: {
  missing?: ReadonlyArray<string>;
  errorPackage?: string;
  preflight?: boolean;
} = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), "mirai-intl-publish-test-"));
  const bin = join(sandbox, "bin");
  const log = join(sandbox, "commands.log");
  await mkdir(bin);
  await writeFile(join(bin, "corepack"), fakeCorepack, { mode: 0o755 });
  await writeFile(join(bin, "npm"), fakeNpm, { mode: 0o755 });
  await writeFile(log, "");
  await chmod(join(bin, "corepack"), 0o755);
  await chmod(join(bin, "npm"), 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      [script, ...(preflight ? ["--preflight"] : []), "--", version],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          NPM_REGISTRY: "https://registry.npmjs.org",
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
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

  it("uses npm Trusted Publishing for the canonical release workflow", async () => {
    const contents = await readFile(workflow, "utf8");

    expect(contents).toContain("id-token: write");
    expect(contents).toContain("contents: read");
    expect(contents).toContain("registry-url: https://registry.npmjs.org");
    expect(contents).not.toContain("npm.pkg.github.com");
    expect(contents).not.toContain("NODE_AUTH_TOKEN");
  });
});
