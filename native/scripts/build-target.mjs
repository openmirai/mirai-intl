import { spawnSync } from "node:child_process";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { matrix } from "./targets.mjs";
import {
  hash,
  regular,
  repositoryRoot,
  rustVersion,
  sourceHash,
} from "./release.mjs";

const [target, revision, output, mode] = process.argv.slice(2);
const config = matrix.find((item) => item.target === target);
if (!config || !/^[a-f0-9]{40}$/u.test(revision ?? "") || !output) {
  throw new Error(
    "Expected known target, immutable source SHA and output directory"
  );
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`
    );
  }
  return result.stdout?.trim() ?? "";
}
if (run("git", ["rev-parse", "HEAD"], { capture: true }) !== revision) {
  throw new Error("Native build checkout differs from immutable revision");
}
run("git", [
  "diff",
  "--exit-code",
  "HEAD",
  "--",
  "native",
  "packages/compiler/package.json",
]);
if (
  (await readFile(join(repositoryRoot, ".nvmrc"), "utf8")).trim() !== "lts/*" ||
  !process.version.startsWith("v24.")
) {
  throw new Error("Release requires Node24 selected through .nvmrc lts/*");
}
if (process.arch !== config.arch) {
  throw new Error(
    "Native builds must use matching architecture hosts, not emulation"
  );
}
const out = resolve(output);
if (config.image && mode !== "container") {
  const image = config.image.replace("NODE_VERSION", process.versions.node);
  run("docker", ["pull", image]);
  const digest = run(
    "docker",
    ["image", "inspect", "--format", "{{index .RepoDigests 0}}", image],
    { capture: true }
  );
  if (!/@sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("Build container did not resolve to an immutable digest");
  }
  const relative = out.slice(resolve(repositoryRoot).length + 1);
  if (
    !out.startsWith(`${resolve(repositoryRoot)}/`) ||
    relative.includes("..")
  ) {
    throw new Error("Container output must be inside the checkout");
  }
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${resolve(repositoryRoot)}:/work`,
    "-w",
    "/work",
    "-e",
    `NATIVE_BUILD_IMAGE=${digest}`,
    "-e",
    "CARGO_BUILD_JOBS=2",
    digest,
    "sh",
    "native/scripts/linux-build.sh",
    target,
    revision,
    `/work/${relative}`,
    process.version,
  ]);
} else {
  const before = await sourceHash();
  const envTarget = join(repositoryRoot, ".tmp", "native-cargo", target);
  process.env.CARGO_TARGET_DIR = envTarget;
  process.env.CARGO_BUILD_JOBS = "2";
  if (target.startsWith("darwin-")) {
    process.env.MACOSX_DEPLOYMENT_TARGET = "13.5";
  }
  if (target.endsWith("-musl")) {
    process.env.RUSTFLAGS = "-C target-feature=-crt-static";
  }
  run("rustup", [
    "toolchain",
    "install",
    rustVersion,
    "--profile",
    "minimal",
    "--target",
    config.triple,
  ]);
  const rust = run("rustup", ["run", rustVersion, "rustc", "--version"], {
    capture: true,
  });
  if (!rust.startsWith(`rustc ${rustVersion} `)) {
    throw new Error("Unexpected Rust compiler");
  }
  const cargo = ["run", rustVersion, "cargo"];
  run("rustup", [
    ...cargo,
    "test",
    "--locked",
    "--manifest-path",
    "native/Cargo.toml",
    "--target",
    config.triple,
    "--lib",
  ]);
  run("rustup", [
    ...cargo,
    "build",
    "--locked",
    "--release",
    "--manifest-path",
    "native/Cargo.toml",
    "--target",
    config.triple,
    "--features",
    "addon,oxc",
    "--lib",
  ]);
  const filename = {
    win32: "mirai_intl_engine.dll",
    darwin: "libmirai_intl_engine.dylib",
    linux: "libmirai_intl_engine.so",
  }[process.platform];
  const built = join(envTarget, config.triple, "release", filename);
  if (target.endsWith("-gnu")) {
    if (
      run("getconf", ["GNU_LIBC_VERSION"], { capture: true }) !== "glibc 2.28"
    ) {
      throw new Error(
        "GNU producer must execute in the glibc 2.28 baseline container"
      );
    }
    const needed = run("readelf", ["--dynamic", built], { capture: true });
    const libraries = new Set([
      "libc.so.6",
      "libm.so.6",
      "libdl.so.2",
      "libpthread.so.0",
      "librt.so.1",
      "libgcc_s.so.1",
      "libstdc++.so.6",
      "ld-linux-x86-64.so.2",
      "ld-linux-aarch64.so.1",
    ]);
    for (const match of needed.matchAll(/\(NEEDED\).*?\[([^\]]+)\]/gu)) {
      if (!libraries.has(match[1])) {
        throw new Error(`Unexpected GNU runtime dependency: ${match[1]}`);
      }
    }
    const symbols = run("readelf", ["--version-info", built], {
      capture: true,
    });
    if (symbols.includes("GLIBC_PRIVATE")) {
      throw new Error("Private glibc symbols are forbidden");
    }
    for (const match of symbols.matchAll(/\bGLIBC_(\d+)\.(\d+)/gu)) {
      if (
        Number(match[1]) > 2 ||
        (Number(match[1]) === 2 && Number(match[2]) > 28)
      ) {
        throw new Error(`Addon exceeds glibc 2.28 baseline: ${match[0]}`);
      }
    }
    for (const match of symbols.matchAll(/\bGLIBCXX_(\d+)\.(\d+)\.(\d+)/gu)) {
      if (
        Number(match[1]) > 3 ||
        Number(match[2]) > 4 ||
        Number(match[3]) > 25
      ) {
        throw new Error(`Addon exceeds baseline libstdc++: ${match[0]}`);
      }
    }
  }
  await mkdir(out, { recursive: false });
  const file = `mirai-intl-${target}.node`;
  await copyFile(built, join(out, file));
  const runtime = JSON.parse(
    run(
      process.execPath,
      ["native/scripts/runtime-smoke.mjs", join(out, file), target],
      { capture: true }
    )
  );
  if (before !== (await sourceHash())) {
    throw new Error("Native sources changed during build");
  }
  const binary = await regular(join(out, file));
  await writeFile(
    join(out, `${target}.json`),
    `${JSON.stringify({ schemaVersion: 1, target, sourceRevision: revision, sourceHash: before, rust, runtime, image: process.env.NATIVE_BUILD_IMAGE ?? null, file, bytes: binary.length, hash: hash(binary) })}\n`,
    { flag: "wx" }
  );
}
