import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { hash, sourceHash, targets } from "./release.mjs";
import { packCandidate } from "./pack-candidate.mjs";

const { c } = createRequire(
  new URL("../../packages/compiler/package.json", import.meta.url)
)("tar");
const revision = "a".repeat(40);
const packages = ["abi", "compiler", "runtime", "intl", "intl-i18next"];
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "intl-pack-candidate-"));
  const calls = [];
  const state = {
    dirty: false,
    failPack: false,
    corruptCompiler: false,
    moved: false,
  };
  try {
    await mkdir(join(root, "native/src"), { recursive: true });
    for (const file of ["Cargo.toml", "Cargo.lock", "build.rs", "src/lib.rs"]) {
      await writeFile(join(root, "native", file), "fixture");
    }
    await writeFile(join(root, ".nvmrc"), "lts/*\n");
    for (const directory of packages) {
      const path = join(root, "packages", directory);
      await mkdir(join(path, "dist"), { recursive: true });
      const name = directory.startsWith("intl")
        ? directory
        : `intl-${directory}`;
      await writeFile(
        join(path, "package.json"),
        JSON.stringify({
          name: `@openmirai/${name}`,
          version: "0.3.29",
          files: ["dist", "native"],
        })
      );
      await writeFile(
        join(path, "dist/index.js"),
        "export const fixture = true;\n"
      );
    }
    const native = join(root, "packages/compiler/native");
    await mkdir(native);
    const entries = {};
    for (const target of targets) {
      const file = `mirai-intl-${target}.node`;
      const bytes = Buffer.from(`fixture:${target}`);
      await writeFile(join(native, file), bytes);
      entries[target] = { file, bytes: bytes.length, hash: hash(bytes) };
    }
    await writeFile(
      join(native, "engine-manifest.json"),
      `${JSON.stringify({ compilerVersion: "0.3.29", engineAbi: "mirai-intl-native-v1", schemaVersion: 1, sourceHash: await sourceHash(root), targets: entries })}\n`
    );
    const runner = async (command, args, options) => {
      calls.push({ command, args, options });
      assert.ok(options.timeout > 0 && options.timeout <= 120000);
      assert.equal(options.killSignal, "SIGKILL");
      if (command === "git") {
        if (args[0] === "status") {
          return {
            status: 0,
            stdout: state.dirty ? " M native/src/lib.rs\n" : "",
          };
        }
        if (args.includes("HEAD^{tree}")) {
          return { status: 0, stdout: "b".repeat(40) };
        }
        return { status: 0, stdout: state.moved ? "c".repeat(40) : revision };
      }
      assert.equal(command, "corepack");
      assert.ok(args.includes("pack"));
      assert.equal(options.env.npm_config_ignore_scripts, "true");
      if (state.failPack) {
        return {
          status: null,
          error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
        };
      }
      const pkg = JSON.parse(
        await readFile(join(options.cwd, "package.json"), "utf8")
      );
      const file = join(
        args.at(-1),
        `${pkg.name.replace("@", "").replace("/", "-")}-${pkg.version}.tgz`
      );
      const files = ["package.json", "dist"];
      if (pkg.name === "@openmirai/intl-compiler" && !state.corruptCompiler) {
        files.push("native");
      }
      await c({ gzip: true, file, cwd: options.cwd, prefix: "package" }, files);
      return { status: 0, stdout: "packed" };
    };
    await run({
      root,
      output: join(root, ".tmp/candidate"),
      run: runner,
      sourceRevision: revision,
      calls,
      state,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("packs all five unpublished candidates with exact source and all-eight inventory evidence", async () => {
  await fixture(async (options) => {
    const report = await packCandidate(options);
    assert.equal(report.sourceRevision, revision);
    assert.equal(report.published, false);
    assert.equal(report.packages.length, 5);
    assert.deepEqual(
      Object.keys(report.native.manifest.targets).toSorted(),
      targets
    );
    for (const pkg of report.packages) {
      const bytes = await readFile(join(options.output, pkg.file));
      assert.equal(pkg.hash, hash(bytes));
      assert.equal(pkg.bytes, bytes.length);
      assert.equal(pkg.version, "0.3.29");
    }
    assert.deepEqual(
      JSON.parse(
        await readFile(join(options.output, "candidate.json"), "utf8")
      ),
      report
    );
    assert.equal(
      options.calls.filter((call) => call.command === "corepack").length,
      5
    );
  });
});

for (const [name, setup, pattern] of [
  [
    "dirty source",
    async (o) => {
      o.state.dirty = true;
    },
    /checkout must be clean/u,
  ],
  [
    "mismatched immutable revision",
    async (o) => {
      o.sourceRevision = "d".repeat(40);
    },
    /revision changed or mismatched/u,
  ],
  [
    "existing output",
    async (o) => {
      await mkdir(o.output, { recursive: true });
      await writeFile(join(o.output, "sentinel"), "retain");
    },
    /already exists/u,
  ],
  [
    "missing target",
    async (o) => {
      await rm(
        join(o.root, "packages/compiler/native/mirai-intl-win32-arm64.node")
      );
    },
    /ENOENT/u,
  ],
  [
    "missing Node build",
    async (o) => {
      await rm(join(o.root, "packages/intl/dist"), { recursive: true });
    },
    /ENOENT/u,
  ],
  [
    "pack lifecycle hook",
    async (o) => {
      const path = join(o.root, "packages/intl/package.json");
      const manifest = JSON.parse(await readFile(path, "utf8"));
      await writeFile(
        path,
        JSON.stringify({ ...manifest, scripts: { prepack: "cargo build" } })
      );
    },
    /lifecycle hook/u,
  ],
]) {
  test(`rejects ${name} before any pack subprocess`, async () => {
    await fixture(async (options) => {
      await setup(options);
      await assert.rejects(packCandidate(options), pattern);
      assert.equal(
        options.calls.filter((call) => call.command === "corepack").length,
        0
      );
      await assert.rejects(
        readFile(join(options.output, "candidate.json")),
        /ENOENT/u
      );
      if (name === "existing output") {
        assert.equal(
          await readFile(join(options.output, "sentinel"), "utf8"),
          "retain"
        );
      }
    });
  });
}

for (const [name, key, pattern] of [
  ["timed out pack", "failPack", /ETIMEDOUT/u],
  [
    "compiler tar omitting native inventory",
    "corruptCompiler",
    /missing native/u,
  ],
]) {
  test(`rejects ${name} without success evidence`, async () => {
    await fixture(async (options) => {
      options.state[key] = true;
      await assert.rejects(packCandidate(options), pattern);
      await assert.rejects(
        readFile(join(options.output, "candidate.json")),
        /ENOENT/u
      );
    });
  });
}

test("rechecks source revision after packing", async () => {
  await fixture(async (options) => {
    const run = options.run;
    options.run = async (...args) => {
      const result = await run(...args);
      if (args[0] === "corepack") {
        options.state.moved = true;
      }
      return result;
    };
    await assert.rejects(
      packCandidate(options),
      /revision changed or mismatched/u
    );
    await assert.rejects(
      readFile(join(options.output, "candidate.json")),
      /ENOENT/u
    );
  });
});

test("rechecks earlier tar bytes after the final pack", async () => {
  await fixture(async (options) => {
    const run = options.run;
    let packs = 0;
    options.run = async (...args) => {
      const result = await run(...args);
      if (args[0] === "corepack" && ++packs === 5) {
        await writeFile(
          join(options.output, "openmirai-intl-abi-0.3.29.tgz"),
          "replaced"
        );
      }
      return result;
    };
    await assert.rejects(packCandidate(options), /tarball changed/u);
    await assert.rejects(
      readFile(join(options.output, "candidate.json")),
      /ENOENT/u
    );
  });
});
