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
  if (result.error) {
    throw new Error(`Failed to run corepack pnpm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`pnpm exited with status ${result.status ?? "unknown"}`);
  }
}

function runNpm(
  arguments_,
  { allowFailure = false, captureOutput = false } = {}
) {
  const result = spawnSync("npm", arguments_, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) {
    throw new Error(`Failed to run npm: ${result.error.message}`);
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error(`npm exited with status ${result.status ?? "unknown"}`);
  }
  return result;
}

function commandOutput(result) {
  return [result.stdout, result.stderr]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join("\n")
    .trim();
}

function isMissingPackageVersion(result) {
  return /\bE404\b|\b404\b/iu.test(commandOutput(result));
}

function isPublished(name, releaseVersion) {
  const result = runNpm(
    [
      "view",
      `${name}@${releaseVersion}`,
      "version",
      "--registry",
      registry,
      "--json",
    ],
    { allowFailure: true, captureOutput: true }
  );

  if (result.status !== 0) {
    if (isMissingPackageVersion(result)) {
      return false;
    }

    const details = commandOutput(result);
    throw new Error(
      `Unable to determine whether ${name}@${releaseVersion} is published in ${registry}. Verify registry access and npm Trusted Publisher configuration: ${details || `npm exited with status ${result.status ?? "unknown"}`}`
    );
  }

  const output = result.stdout?.trim() ?? "";
  let publishedVersion;
  try {
    publishedVersion = JSON.parse(output);
  } catch (error) {
    throw new Error(
      `Unable to parse the registry version for ${name}@${releaseVersion} in ${registry}: ${output || "npm returned no output"}`,
      { cause: error }
    );
  }

  if (publishedVersion !== releaseVersion) {
    throw new Error(
      `Registry returned ${String(publishedVersion)} for ${name}@${releaseVersion} in ${registry}; refusing to treat it as published`
    );
  }

  return true;
}

const publicationStates = manifests.map(({ directory, manifest }) => ({
  directory,
  manifest,
  published: isPublished(manifest.name, version),
}));

for (const { manifest, published } of publicationStates) {
  console.log(
    `${published ? "Already published" : "Pending publication"} ${manifest.name}@${version} in ${registry}`
  );
}

const pendingPublications = publicationStates.filter(
  ({ published }) => !published
);

if (pendingPublications.length === 0) {
  console.log(
    `All ${publicationStates.length} packages at ${version} are already published in ${registry}`
  );
} else {
  if (pendingPublications.length < publicationStates.length) {
    console.log(
      `Resuming partial release; publishing only missing packages: ${pendingPublications
        .map(({ manifest }) => manifest.name)
        .join(", ")}`
    );
  }

  const publishDirectory = await mkdtemp(
    resolve(tmpdir(), "mirai-intl-publish-")
  );

  try {
    for (const { directory, manifest } of pendingPublications) {
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
}
