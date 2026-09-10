import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  hash,
  regular,
  repositoryRoot,
  verifyNativeRelease,
  verifyPackedNative,
} from "./release.mjs";

const packages = [
  ["abi", "@openmirai/intl-abi"],
  ["compiler", "@openmirai/intl-compiler"],
  ["runtime", "@openmirai/intl-runtime"],
  ["intl", "@openmirai/intl"],
  ["intl-i18next", "@openmirai/intl-i18next"],
];
const forbiddenHooks = [
  "prepack",
  "postpack",
  "prepare",
  "prepublish",
  "prepublishOnly",
  "preinstall",
  "install",
  "postinstall",
];
const runner = (command, args, options) => spawnSync(command, args, options);

async function packedInventory(file, expected) {
  const { t } = createRequire(
    new URL("../../packages/compiler/package.json", import.meta.url)
  )("tar");
  const inventory = [];
  const seen = new Set();
  let manifest;
  let failure;
  let total = 0;
  await t({
    file,
    strict: true,
    onReadEntry(entry) {
      const path = entry.path;
      total += entry.size;
      if (
        !path.startsWith("package/") ||
        path.includes("\\") ||
        path.split("/").includes("..") ||
        path.split("/").includes(".") ||
        total > 768 * 1024 * 1024 ||
        seen.size >= 10000 ||
        !["File", "Directory"].includes(entry.type) ||
        seen.has(path) ||
        entry.size > 64 * 1024 * 1024
      ) {
        failure = new Error(
          `Invalid or oversized candidate archive entry: ${path}`
        );
        entry.resume();
        return;
      }
      seen.add(path);
      if (entry.type === "Directory") {
        entry.resume();
        return;
      }
      const digest = createHash("sha256");
      const chunks = [];
      if (path === "package/package.json" && entry.size > 65536) {
        failure = new Error("Oversized packed package manifest");
        entry.resume();
        return;
      }
      entry.on("data", (chunk) => {
        digest.update(chunk);
        if (path === "package/package.json") {
          chunks.push(chunk);
        }
      });
      entry.on("end", () => {
        inventory.push({
          path,
          bytes: entry.size,
          hash: `sha256:${digest.digest("hex")}`,
        });
        if (path === "package/package.json") {
          try {
            manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            failure = new Error("Invalid packed package manifest");
          }
        }
      });
    },
  });
  if (failure) {
    throw failure;
  }
  if (
    manifest?.name !== expected.name ||
    manifest?.version !== expected.version ||
    forbiddenHooks.some((hook) =>
      Object.hasOwn(manifest?.scripts ?? {}, hook)
    ) ||
    !inventory.some(
      (entry) => entry.path.startsWith("package/dist/") && entry.bytes > 0
    )
  ) {
    throw new Error(`Packed package identity/dist mismatch: ${expected.name}`);
  }
  return inventory.toSorted((a, b) => {
    if (a.path < b.path) {
      return -1;
    }
    return a.path > b.path ? 1 : 0;
  });
}

// Build Node outputs separately before calling this pack-only gate. There is no
// registry query/publication, dependency install, Rust build, or local-target bypass.
// A failure leaves the new directory for diagnosis, without candidate.json.
export async function packCandidate({
  root: rootPath = repositoryRoot,
  sourceRevision,
  output: outputPath,
  run = runner,
}) {
  const root = resolve(rootPath);
  if (!/^[a-f0-9]{40}$/u.test(sourceRevision ?? "") || !outputPath) {
    throw new Error(
      "Explicit immutable source revision and absent output directory required"
    );
  }
  if (
    !process.version.startsWith("v24.") ||
    (await readFile(join(root, ".nvmrc"), "utf8")).trim() !== "lts/*"
  ) {
    throw new Error(
      "Candidate packing requires Node 24 selected through .nvmrc lts/*"
    );
  }
  const output = resolve(outputPath);
  const within = relative(root, output);
  if (
    within === "" ||
    (!within.startsWith(`..${sep}`) &&
      within !== ".." &&
      !within.startsWith(`.tmp${sep}`))
  ) {
    throw new Error("Output must be outside checkout or under .tmp");
  }
  try {
    await lstat(output);
    throw new Error("Candidate output already exists");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  const checked = async (command, args, cwd = root) => {
    const result = await run(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: command === "git" ? 30000 : 120000,
      killSignal: "SIGKILL",
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        npm_config_ignore_scripts: "true",
        pnpm_config_ignore_scripts: "true",
      },
    });
    if (result.error || result.signal || result.status !== 0) {
      throw new Error(
        `Candidate command failed: ${command} ${args.join(" ")} (${result.error?.code ?? result.signal ?? result.status})`
      );
    }
    return (result.stdout ?? "").trim();
  };
  const checkSource = async () => {
    if ((await checked("git", ["rev-parse", "HEAD"])) !== sourceRevision) {
      throw new Error("Candidate source revision changed or mismatched");
    }
    if (
      await checked("git", [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ])
    ) {
      throw new Error("Candidate source checkout must be clean");
    }
    const tree = await checked("git", ["rev-parse", "HEAD^{tree}"]);
    if (!/^[a-f0-9]{40}$/u.test(tree)) {
      throw new Error("Invalid candidate source tree");
    }
    return tree;
  };
  const sourceTree = await checkSource();
  const native = await verifyNativeRelease(root);
  const manifests = [];
  for (const [directory, name] of packages) {
    const path = join(root, "packages", directory);
    const manifest = JSON.parse(
      await regular(join(path, "package.json"), 65536)
    );
    if (
      manifest.name !== name ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(manifest.version ?? "") ||
      forbiddenHooks.some((hook) => Object.hasOwn(manifest.scripts ?? {}, hook))
    ) {
      throw new Error(
        `Invalid candidate package identity or lifecycle hook: ${name}`
      );
    }
    const dist = await lstat(join(path, "dist"));
    if (!dist.isDirectory() || dist.isSymbolicLink()) {
      throw new Error(`Node build output required: ${name}`);
    }
    manifests.push({ path, name, version: manifest.version });
  }
  if (new Set(manifests.map((pkg) => pkg.version)).size !== 1) {
    throw new Error("Candidate package versions must match");
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  const artifacts = [];
  for (const pkg of manifests) {
    await checked(
      "corepack",
      ["pnpm", "pack", "--pack-destination", output],
      pkg.path
    );
    const file = `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`;
    const path = join(output, file);
    const bytes = await regular(path, 576 * 1024 * 1024);
    const inventory = await packedInventory(path, pkg);
    if (pkg.name === "@openmirai/intl-compiler") {
      await verifyPackedNative(path, native);
    }
    artifacts.push({
      name: pkg.name,
      version: pkg.version,
      file,
      bytes: bytes.length,
      hash: hash(bytes),
      inventory,
    });
  }
  if (
    JSON.stringify((await readdir(output)).toSorted()) !==
    JSON.stringify(artifacts.map((pkg) => pkg.file).toSorted())
  ) {
    throw new Error("Unexpected candidate output inventory");
  }
  if ((await checkSource()) !== sourceTree) {
    throw new Error("Candidate source tree changed");
  }
  const after = await verifyNativeRelease(root);
  if (
    !after.files
      .get("engine-manifest.json")
      .equals(native.files.get("engine-manifest.json"))
  ) {
    throw new Error("Native assets changed while packing");
  }
  for (const pkg of artifacts) {
    const bytes = await regular(join(output, pkg.file), 576 * 1024 * 1024);
    if (hash(bytes) !== pkg.hash || bytes.length !== pkg.bytes) {
      throw new Error("Candidate tarball changed while packing");
    }
  }
  const report = {
    schemaVersion: 1,
    kind: "unpublished-library-candidate",
    published: false,
    sourceRevision,
    sourceTree,
    node: process.version,
    native: {
      manifest: native.manifest,
      manifestHash: hash(native.files.get("engine-manifest.json")),
    },
    packages: artifacts,
  };
  await writeFile(
    join(output, "candidate.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: "wx" }
  );
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: {
      "source-revision": { type: "string" },
      output: { type: "string" },
    },
  });
  const result = await packCandidate({
    sourceRevision: values["source-revision"],
    output: values.output,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
