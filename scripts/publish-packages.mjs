import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectories = [
  "packages/abi",
  "packages/compiler",
  "packages/runtime",
];
const expectedNames = [
  "@openmirai/intl-abi",
  "@openmirai/intl-compiler",
  "@openmirai/intl-runtime",
];
const cliArguments = process.argv.slice(2);
const dryRun = cliArguments.includes("--dry-run");
const preflight = cliArguments.includes("--preflight");
const requestedVersion = cliArguments.find(
  (argument) => !argument.startsWith("--")
);

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
    process.exit(result.status ?? 1);
  }
}

if (preflight) {
  runPnpm(["whoami", "--registry", "https://npm.pkg.github.com"]);
}

for (const { directory, manifest } of manifests) {
  const publishArguments = [
    "--dir",
    directory,
    "publish",
    "--access",
    "public",
    "--tag",
    tag,
    ...(dryRun || preflight ? ["--dry-run", "--no-git-checks"] : []),
  ];

  console.log(
    `${dryRun || preflight ? "Validating" : "Publishing"} ${manifest.name}@${version} with npm tag ${tag}`
  );
  runPnpm(publishArguments);
}
