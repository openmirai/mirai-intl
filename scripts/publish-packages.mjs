import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectories = [
  "packages/abi",
  "packages/compiler",
  "packages/runtime",
  "packages/intl",
  "packages/intl-i18next",
];
const expectedNames = [
  "@openmirai/intl-abi",
  "@openmirai/intl-compiler",
  "@openmirai/intl-runtime",
  "@openmirai/intl",
  "@openmirai/intl-i18next",
];
const cliArguments = process.argv.slice(2);
const dryRun = cliArguments.includes("--dry-run");
const preflight = cliArguments.includes("--preflight");
const requestedVersion = cliArguments.find(
  (argument) => !argument.startsWith("--")
);
const registry = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";

const manifests = await Promise.all(
  packageDirectories.map(async (directory) => {
    const manifestPath = resolve(root, directory, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await access(resolve(root, directory, "dist"));
    return { directory, manifest };
  })
);

for (const [index, { manifest }] of manifests.entries()) {
  if (manifest.name !== expectedNames[index]) {
    throw new Error(
      `Unexpected release package at index ${index}: ${String(manifest.name)}`
    );
  }
}

const versions = new Set(manifests.map(({ manifest }) => manifest.version));
if (versions.size !== 1) {
  throw new Error(
    `Workspace package versions must match: ${[...versions].join(", ")}`
  );
}

const [version] = versions;
if (requestedVersion !== undefined && requestedVersion !== version) {
  throw new Error(
    `Release version ${requestedVersion} does not match workspace version ${version}`
  );
}

const prereleaseId = version.includes("-")
  ? version.split("-")[1]?.split(".")[0]
  : undefined;
const tag = prereleaseId ?? "latest";
if (!/^[a-z][a-z0-9-]*$/u.test(tag)) {
  throw new Error(
    `Invalid npm distribution tag derived from version ${version}: ${tag}`
  );
}

function runPnpm(arguments_, cwd = root) {
  const result = spawnSync("corepack", ["pnpm", ...arguments_], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`pnpm exited with status ${result.status ?? "unknown"}`);
  }
}

function runNpm(arguments_) {
  const result = spawnSync("npm", arguments_, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`npm exited with status ${result.status ?? "unknown"}`);
  }
}

const publishDirectory = await mkdtemp(
  resolve(tmpdir(), "mirai-intl-publish-")
);

try {
  for (const { directory, manifest } of manifests) {
    runPnpm([
      "--dir",
      directory,
      "pack",
      "--pack-destination",
      publishDirectory,
    ]);

    const tarballName = `${manifest.name.replace("@", "").replace("/", "-")}-${version}.tgz`;
    const publishArguments = [
      "publish",
      resolve(publishDirectory, tarballName),
      "--access",
      "public",
      "--registry",
      registry,
      "--tag",
      tag,
      ...(dryRun || preflight ? ["--dry-run"] : []),
    ];

    console.log(
      `${dryRun || preflight ? "Validating" : "Publishing"} ${manifest.name}@${version} with npm tag ${tag}`
    );
    runNpm(publishArguments);
  }
} finally {
  await rm(publishDirectory, { recursive: true, force: true });
}
