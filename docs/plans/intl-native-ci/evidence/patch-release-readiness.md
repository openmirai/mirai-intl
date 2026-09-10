# Patch release readiness — source audit

Reviewed 2026-09-10. Library HEAD: `7f02a9ec5c555bfd993395e1c1573ff7902f9240`. This is a bounded source review, not a release execution or a new test result. The active worktree contains other agents’ evidence changes and must not be used for release preparation. No versions, tags, commits, packages, native assets, or workflow runs were changed by this audit.

## Decision

No blocking public API/patch-compatibility bug was identified in the inspected release hooks and native packaging path. There is a concrete **stale local asset sequencing failure**: the version-bump hook does not regenerate the native manifest, so ignored `.29` assets beside newly bumped `.30` package manifests fail validation. That is a fail-closed integrity check, not evidence that an ordinary clean checkout is broken. Release readiness still requires the post-bump, all-eight-target and consumer gates below; this source review cannot substitute for them.

The next PATCH is **0.3.30**, conditional on repeating the registry check immediately before preparation/publication. Neither the synchronization helper nor publication script enforces “patch only”; use an explicit version and review the entire change set for compatibility. Do not let conventional-changelog select an increment implicitly.

## Fresh registry observation

At `2026-09-10T09:53:03.879Z`, fresh HTTPS reads of each public npm `/latest` endpoint returned `0.3.29`:

| Package | Registry endpoint | Observed latest |
| --- | --- | --- |
| @openmirai/intl-abi | https://registry.npmjs.org/@openmirai%2Fintl-abi/latest | 0.3.29 |
| @openmirai/intl-compiler | https://registry.npmjs.org/@openmirai%2Fintl-compiler/latest | 0.3.29 |
| @openmirai/intl-runtime | https://registry.npmjs.org/@openmirai%2Fintl-runtime/latest | 0.3.29 |
| @openmirai/intl | https://registry.npmjs.org/@openmirai%2Fintl/latest | 0.3.29 |
| @openmirai/intl-i18next | https://registry.npmjs.org/@openmirai%2Fintl-i18next/latest | 0.3.29 |

Reproducible read-only command (successfully executed with Node 24.18.0; this does not install or invoke any package):

```sh
/Users/kentakoong/.nvm/versions/node/v24.18.0/bin/node --input-type=module <<'JS'
console.log(new Date().toISOString());
for (const name of ['intl-abi', 'intl-compiler', 'intl-runtime', 'intl', 'intl-i18next']) {
  const url = `https://registry.npmjs.org/@openmirai%2F${name}/latest`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(String(response.status));
  const pkg = await response.json();
  console.log(JSON.stringify({ name: pkg.name, version: pkg.version, integrity: pkg.dist.integrity, url }));
}
JS
```

This proves the observed `latest` versions, not that `0.3.30` is absent or reserved. Check exact-version availability separately before an approved release.

## Hook and asset behavior

- `.release-it.json:18`: `before:init` runs the full `pnpm verify`. The installed release-it lifecycle runs this hook before plugin initialization; do not use the dirty shared worktree and expect the clean-worktree check to avoid expensive work.
- `.release-it.json:19`: after bump, synchronize the five workspace package versions, explicitly refresh the lockfile, build, generate fixtures, and check generated files. `scripts/sync-workspace-versions.mjs:5` accepts a general semver, and `:11` lists the five package manifests; `:23` writes their versions. It does not update native manifests. The npm release-it plugin handles the root version, while the bumper also targets workspace manifests (`.release-it.json:23`).
- `.gitignore:7` excludes `packages/compiler/native/`. Therefore clean Git status alone does not prove asset absence. `packages/compiler/src/native-assets.ts:122` treats only missing directory as absent; `:146` rejects manifest/compiler version disagreement. With no assets, the default engine can use Node; forced Rust requires a usable native target. With stale assets, validation fails closed. Selecting Node is not a supported way to bypass malformed asset identity validation.
- `native/scripts/stage.mjs:105` reads the current compiler package version and writes it to the manifest. `native/scripts/release.mjs:112` requires exact equality; `:115` requires all eight targets; `:116` checks current native source hash; `:117` requires canonical manifest encoding. Subsequent checks bind every asset’s bytes/hash and reject extra inventory. Do not hand-edit `compilerVersion` to relabel an earlier artifact.
- `native/scripts/assemble.mjs:29` checks every target’s exact source revision, native source hash, Rust/runtime evidence, size and digest, then invokes staging at `:61` and verifies the assembled release at `:75`. This is how a fresh `.30` manifest is produced from the exact `.30` source revision. Local staging with a target subset is not sufficient for release.
- `native/scripts/install-release.mjs` verifies the input, refuses an existing destination, copies it, and verifies again. Use a fresh checkout rather than overwriting ignored assets in a live worktree.

## Reviewable preparation, before tag/publish approval

These are **future commands and gates**, not actions performed in this audit. Wait until the current heavy study finishes and the preparation work is authorized. Merges and package publication remain unapproved.

1. Select the approved immutable library source revision. Use a new isolated clone/worktree and release-preparation branch, with no shared `node_modules`, ignored native assets, or generated state copied from the development worktree. Confirm tracked and untracked status is clean and `packages/compiler/native` does not exist. Retain `.nvmrc` as the repository runtime contract; use the explicitly validated Node 24 runtime for these gates. Install locked dependencies deliberately, with `pnpm_config_verify_deps_before_run=error` and `pnpm_config_enable_global_virtual_store=false` to prevent implicit dependency refreshes.
2. Refresh all five registry versions and exact `.30` availability. Confirm root and five package manifests currently agree on `.29`. Prepare the explicit patch in the isolated checkout with all Git release effects disabled:

   ```sh
   export PATH="/Users/kentakoong/.nvm/versions/node/v24.18.0/bin:$PATH"
   export pnpm_config_verify_deps_before_run=error
   export pnpm_config_enable_global_virtual_store=false
   CI=true node node_modules/release-it/bin/release-it.js 0.3.30 --ci --no-git.commit --no-git.tag --no-git.push
   ```

   This is a real local bump/build/fixture preparation, not a dry run. The hook’s explicit `install --no-frozen-lockfile` is intentional. It must run with no native assets staged, so the pre/post-bump local validation uses normal Node fallback. The installed release-it `Git.release()` gates commit, tag, and push independently (`node_modules/release-it/lib/plugin/git/Git.js:91`). Keep the npm plugin enabled so the root version is updated; configured `npm.publish: false` prevents direct npm publication here. The `after:release` echo incorrectly says a tag was pushed even with these flags—verify Git state rather than trusting that message.
3. Review the actual version/changelog/lockfile/generated diff and completed hook outputs. Require exactly patch `.29 → .30` for root and all five packages, no public API/ABI or receipt-schema break, and no unexpected generated changes. Version-only stability is an acceptance requirement, not something proven by running this hook alone. Do not rerun an ordinary release command against an already prepared `.30` tree.
4. Once separately authorized, record the reviewed preparation on a candidate branch. That immutable commit (or the CI PR synthetic merge) must include the version change. Run **Native release readiness**, not **Publish npm packages**, against that revision. `.github/workflows/native-build-ci.yml:30` sends the exact SHA to the all-target build; `:56` verifies artifact identity/digest and same-run provenance; `:76` installs into a fresh checkout; `:79` runs full verification with Rust required; `:81` packs all five packages without publishing. The candidate helper requires matching HEAD and a clean source tree both before and after packaging (`native/scripts/pack-candidate.mjs:187`, `:262`). An uncommitted local version bump cannot produce an accepted immutable candidate pack.
5. Require all eight target build/runtime results, canonical manifest `compilerVersion=0.3.30`, exact-revision artifact metadata, source-tree identity, five package inventories and versions, forced-Rust packed-consumer verification, and fresh Turbo candidate acceptance. Preserve artifact IDs/digests, run attempt, exact source SHA/tree, and consumer proofs. A successful `.29` candidate is supporting evidence, not a substitute for post-bump `.30` gates. If merge/rebase changes the tested revision, repeat the applicable exact-revision gates.
6. Stop with the concrete diff, immutable candidate SHA, artifacts, and acceptance results for tag/publish approval. No tag, publication workflow dispatch, or ordinary `pnpm release` is needed to complete this checkpoint.

## Publication boundary and retry behavior

`.release-it.json:7` enables push by default. `npm.publish: false` does **not** make the default release command harmless: `.github/workflows/publish.yml:3` publishes on `v*` tag pushes, and its manual dispatch also reaches publication. There is no intermediate human approval step in this workflow. Approval must precede either trigger; do not dispatch it as a readiness test.

After explicit approval, publish only the reviewed exact release revision/version. The publication workflow resolves its input ref once (`publish.yml:38`), rebuilds all targets from that SHA (`:42`), verifies/downloads the same-run bundle (`:93`), installs it before dependencies and validation (`:113`), validates the requested/tag version (`:118`), and then performs preflight and publication (`:144`, `:145`). This ordering handles normal clean checkout assets correctly.

`scripts/publish-packages.mjs:164` verifies the all-target native release before registry state checks. All pending package tarballs are prepared and the compiler’s packed native bytes verified before the first actual publication. Preflight still packs locally and invokes `npm publish --dry-run`; it is not merely a registry query and was not run here. Publication is sequential across five packages, not atomic: a partial failure may leave some packages published. A retry skips exact versions already present, so independently verify their actual published contents/integrities before approving a resume; version existence alone does not prove matching bytes.

## Evidence limits

Executed in this audit: bounded source reads, installed release-it control-flow inspection, and five fresh public registry reads. No verification suite, build, benchmark, pack, preflight, install, version change, commit, merge, tag, dispatch, or publish was executed. All future gates above remain required; no previously reported test count is represented as a newly executed release test.
