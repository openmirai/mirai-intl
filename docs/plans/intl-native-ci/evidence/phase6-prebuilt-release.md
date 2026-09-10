# Phase 6: prebuilt release pipeline

Prepared 2026-09-10 in `worktrees/mirai-intl-native-engine`, on base HEAD `1aac3ee03b6f88a72f361ff5e0ad5066381ca1aa` plus concurrent, uncommitted phase work. This describes reviewable code, not a published release or a successful hosted matrix. No workflow was dispatched, no release asset rebuilt or overwritten, and no commit, push, merge, publication, package version change, or runner infrastructure change was performed in this lane. Existing `native/scripts/stage.mjs` is unchanged.

## Target recipes and runtime gates

| Target | Official hosted runner | Build and runtime environment |
| --- | --- | --- |
| darwin-arm64 | macos-14 | Native arm64 Node 24; deployment target macOS 13.5 |
| darwin-x64 | macos-15-intel | Native x64 Node 24; deployment target macOS 13.5 |
| linux-arm64-gnu | ubuntu-24.04-arm | Native arm64 manylinux_2_28 container; official Node 24 Linux archive |
| linux-x64-gnu | ubuntu-24.04 | Native x64 manylinux_2_28 container; official Node 24 Linux archive |
| linux-arm64-musl | ubuntu-24.04-arm | Native arm64 official Node 24 Alpine container |
| linux-x64-musl | ubuntu-24.04 | Native x64 official Node 24 Alpine container |
| win32-arm64 | windows-11-arm | Native arm64 Node 24 and MSVC Rust target |
| win32-x64 | windows-2022 | Native x64 Node 24 and MSVC Rust target |

Every recipe installs Rust **1.98.0**, runs locked Rust library tests, builds the addon with `addon,oxc`, and loads the resulting `.node` binary with the target's actual Node runtime. The smoke helper checks platform, architecture, libc where applicable, ABI, Unicode version, canonical receipt acceptance/rejection, file hashes and filesystem errors, Oxc classification, and engine lifecycle. No emulation is used. Job concurrency is capped at four, Cargo jobs at two, and each build job at 45 minutes.

Node selection remains `.nvmrc` = `lts/*`; producers fail closed unless it resolves to Node 24. Container Node patch versions come from the selected host Node. GNU Node downloads are checked against official SHASUMS256. Container tags are resolved to immutable image digests before execution, and the digest is recorded in each target receipt. GNU builds execute in glibc 2.28, with explicit ELF dependency and symbol checks for glibc <= 2.28 and libstdc++ <= 3.4.25. The Ubuntu host does not supply the GNU link environment.

The recipes cover all eight targets, but **none of the new hosted jobs has been executed yet**. The only local runtime execution in this lane used an existing Darwin arm64 asset. In particular, musl remains a required, unexecuted release gate: Node's Docker documentation describes musl x64 builds as experimental and arm64 musl as not tested upstream before release. This workflow supplies its own runtime check; it does not upgrade upstream support status. The modern macOS runners also do not prove execution on the oldest supported macOS version.

## Immutable source and artifact flow

`publish.yml` resolves the requested release ref once to a commit SHA. The reusable workflow checks out that SHA, verifies HEAD and clean native tracked sources, and compares native source hashes before and after compilation. Git autocrlf is disabled across hosts so manifest inputs have identical bytes. The CI caller uses `github.sha`, including the checked-out synthetic merge commit for PR runs.

Each target uploads an immutable artifact named with source SHA, current run attempt, and target. Assembly requires exactly one artifact for every target, pins positive artifact IDs and SHA-256 digests, and rejects expired, missing, duplicated, cross-run, wrong-repository, wrong-attempt, oversized, or digestless metadata. Discovery is bounded to ten pages of 100 results with request timeouts. Official download-artifact downloads by ID with digest mismatch configured as an error. Failed-job-only reruns cannot silently mix prior-attempt artifacts: rerun all producer jobs to produce a complete same-attempt set.

Assembly verifies every target's source revision/hash, Rust version, runtime success, binary size/hash, and Linux image digest. It calls existing `stage.mjs` **without a target subset**, producing one portable manifest and eight binaries. The uploaded release bundle also retains target receipts and artifact pins. Publish checks the assembled artifact's digest and run identity, downloads it by ID with digest verification, and installs it only into an absent compiler native directory.

## Publish gate and consumer contract

`scripts/publish-packages.mjs` checks the local all-eight native inventory before any registry read. It rejects stale compiler versions or source hashes, malformed/noncanonical manifests, missing/extra/symlinked/corrupt assets, and compiler installation lifecycle hooks. It packs every pending package before publishing any package, then checks the actual compiler tarball for the exact native files, sizes, types, and hashes. A pack-time omission or mutation therefore cannot publish ABI first and fail later on the compiler package. Existing idempotent release/resume behavior is retained behind this mandatory preflight.

Rust compilation runs only in the producer workflow. Consumers receive prebuilt files in the compiler tarball; this lane adds no consumer install hook, download fallback, or Rust build fallback. Package versions were left to the release owner; this lane does not introduce a minor or major release change.

## Changed files

- Workflows: new `.github/workflows/native-build.yml`, new `.github/workflows/native-build-ci.yml`, existing `.github/workflows/publish.yml`.
- Producer helpers: new `native/scripts/targets.mjs`, `build-target.mjs`, `linux-build.sh`, `runtime-smoke.mjs`, `artifact-pins.mjs`, `assemble.mjs`, `install-release.mjs`, `release.mjs`, and `release.test.mjs`.
- Publish gate and tests: `scripts/publish-packages.mjs`, `test/publish-packages.test.ts`.
- Evidence: this note and `phase6-darwin-runtime-smoke.json`. Local raw logs are `phase6-release-helpers.log` and `phase6-publish-tests.log` alongside this note; `.log` files may be ignored by Git, so the results are also recorded below.

## Local verification

Commands ran with `/Users/kentakoong/.nvm/versions/node/v24.18.0/bin` first on PATH.

| Command | Result |
| --- | --- |
| `node --test native/scripts/release.test.mjs` | 3 passed, 0 failed; all-eight recipe inventory, artifact identity rejection cases, real stage output compatibility and stale source rejection |
| `node_modules/.bin/vitest run test/publish-packages.test.ts` | 15 passed, 0 failed; includes missing/corrupt assets, packed omissions/mutations, partial manifests, stale source/version, install hooks, and extra files; no publish on failures |
| `node native/scripts/runtime-smoke.mjs .tmp/native-local-assets/mirai-intl-darwin-arm64.node darwin-arm64` | Passed on Node v24.18.0, Unicode 17.0; existing binary only |
| `node_modules/.bin/tsc -p tsconfig.tools.json --pretty false` | Exit 0 |
| `actionlint .github/workflows/native-build.yml .github/workflows/native-build-ci.yml .github/workflows/publish.yml` | Exit 0, shellcheck enabled |
| `sh -n native/scripts/linux-build.sh` | Exit 0 |
| `oxlint` and `oxfmt --check` on owned JS/TS/workflows | Exit 0 |

These results establish local helper/gate behavior and workflow syntax. They do not establish eight-target compilation, hosted runtime success, npm Trusted Publishing success, or consumer CI success. All eight matrix jobs and final package checks remain mandatory before publication.

## Primary references consulted

- [GitHub standard hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and [Windows 11 arm64 image inventory](https://github.com/actions/runner-images/blob/main/images/windows/Windows11-Arm64-Readme.md): public runner labels and native architectures.
- [Node 24 platform requirements](https://github.com/nodejs/node/blob/v24.x/BUILDING.md): glibc 2.28 baseline and macOS minimum; [manylinux images](https://github.com/pypa/manylinux): manylinux_2_28 x86_64/aarch64 environment.
- [Official Node Docker images](https://github.com/nodejs/docker-node): Alpine/musl differences and upstream testing limitations.
- [Rust versioned toolchains](https://rust-lang.github.io/rustup/concepts/toolchains.html) and [Windows MSVC targets](https://doc.rust-lang.org/rustc/platform-support/windows-msvc.html): exact toolchain selection and native Windows targets.
- [upload-artifact](https://github.com/actions/upload-artifact) and [download-artifact](https://github.com/actions/download-artifact): immutable artifact IDs, digest outputs, downloads by ID, and explicit digest mismatch failure. Recipes use upload v7/download v8.
- [setup-node](https://github.com/actions/setup-node): `.nvmrc` input, architecture selection, and LTS resolution.
