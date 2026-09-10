# Intl native engine and CI adoption execution record

## Durable goal and authorization

Production-ready bounded Rust adoption in mirai-intl and verified Turbo CI adoption. This goal is **active**, not complete at a prototype. Codex goal/thread: `01a085bb-1a52-7ff1-8b5c-d1414c45edab`.

The user accepted the visual plan and authorized implementation, tests, benchmarks, feature commits/pushes, PR creation/updates and relevant CI runs on 10 September 2026. **Before publishing packages, merging PRs or changing runner infrastructure, prepare exact reviewable results and request approval.** Continue independent authorized work meanwhile. Releases are patch-only. No direct protected-branch pushes. No existing worker tree may be reset, cleaned or reused as this task's checkout.

## Workspaces and ownership

- Library: `worktrees/mirai-intl-native-engine`, branch `codex/intl-native-engine`, based on freshly fetched main.
- Turbo: `worktrees/fe-mirai-intl-native-adoption`, branch `codex/intl-native-ci-adoption`, created and checked by the repository-workflow guard at freshly fetched staging.
- Both primary checkouts were clean and left unchanged. Existing worktrees belong to other tasks.
- This record is mirrored in both repositories under `docs/plans/intl-native-ci`. Update status and evidence when a phase changes and before a context handoff. Keep repository-specific details explicit.

## Immutable baseline

See `baseline.json` for full SHA/package-integrity references and SHA-256 of the agreed research artifacts. Library main and npm remain 0.3.29 at `1aac3ee03b6f88a72f361ff5e0ad5066381ca1aa`; library CI and publication succeeded. Turbo refreshed staging is `1f57e8dda0065674abce36ef51359686038259e7`, newer than the research staging snapshot. Current Intl pins remain 0.3.29. PR #1777 final head was `12fa062f26e8117ae0f3fd1eda60b5d7a46682b2`; tested merges are separate identities in the baseline.

Original measured preparation: 17 s queue, 132 s running, 149 s total; checkout 4 s, dependencies 13 s, authorization 29 s, export plus standalone verification 80 s. This is historical CI evidence, not a new baseline A/B result. Synthetic published-0.3.29 verification: cold call median 460.63 ms / SD 20.03 ms, warm median 406.15 ms / SD 6.55 ms, n=10 each. Profiling: 913 reads / 96.3 MB logical bytes; 1283 hash updates / about 100 MB; canonical encoding 33.50% and hashing 8.57% of sampled main-thread time. macOS M4 Pro is not equivalent to Linux CI. No candidate speedup was measured in that historical research snapshot; later local operation evidence is recorded below.

Artifact inspection confirms 3931 shared messages and identical contracts/renderers across five catalogs, 19655 shared occurrences, 15724 redundant occurrences. This is code/artifact evidence, not measured compiler-call savings. ICU inference still runs on current compile=false snapshot loading.

## Ordered phases and acceptance

| Phase | Status | Acceptance gate |
| --- | --- | --- |
| 1. Refresh instructions, baseline and record | Complete with resource gap | Guarded isolated trees; exact refs/packages/CI captured; real runner evidence or explicit gap; baseline checks |
| 2. Authority reuse and clean recovery | Active: library and Turbo helpers implemented; integration pending | Valid unchanged hit performs zero audit/regeneration; rejected corrupt candidate permits one clean producer audit; invalid inputs/unsafe rollback fail; pinned trusted producer identity |
| 3. Shared reads, hashes and receipt processing | Implemented; final integration gates active | Fewer repeated operations; fresh initial/final and pre/post-publication barriers; deterministic failure and bounded work |
| 4. Shared message IR once, app composition | Implemented; five-catalog pilot passed, repeated current-consumer evidence pending | Trusted immutable IR once per content/context; app IDs/indices/descriptors/provenance/source authority retained; exact output and mutation parity |
| 5. Bounded production Rust engine | Active: Node-API receipt/discovery integration and portable asset identity implemented; strictness passes, packed and CI gates pending | Measure Node-API versus one persistent worker per operation; native scanning/receipt integration improves real paths; Oxc evaluated with retained TS semantics |
| 6. Native package distribution | Implemented all8target producer/release pipeline; matrix execution pending | Prebuilt release artifacts, no consumer Rust compilation; supported-platform/fallback and binary-integrity tests; portable authority; patch-only publication approval |
| 7. End-to-end adoption | Active packed consumers and Turbo acceptance probes; four builds/CI pending | Strictness corpus, repeated cold/warm variance/p95/peak memory, packed consumers, four production app builds and verified Turbo CI; release/merge approvals resolved |

## Strictness checklist (every candidate)

- Required English and Thai, including nested/mounted files; missing/extra nested keys; empty translations; invalid message syntax and incompatible contracts.
- Unknown references, unsupported dynamic usage, hardcoded UI in supported scope; preserve conservative semantic fallback.
- Changed/deleted/new relevant files, source ownership, import resolution including negative probes, config/dependencies/lockfile/compiler/generated artifacts.
- Missing/stale/incomplete/tampered authority; exact archive members/digests/limits/path confinement; lock/rollback and concurrent mutation barriers.
- All five catalogs remain verified, downstream zero compile/emission/semantic calls; each app's final client/worker proof binds actual emitted bytes.
- Native Unicode/canonical byte/hash parity; hidden-file/symlink/discovery parity; bounded global I/O/CPU; loader/binary integrity and equivalent platform identity.
- Structural validation does not prove linguistic quality. Parser microbenchmarks do not prove CI gains.

## Decisions

- D1: Reject corrupt cached authority; preparation may perform one independent fresh audit only after safe isolation or successful rollback. Never salvage partial authority, swallow a validation failure or re-audit independently in all consumers.
- D2: Preserve live observation barriers. Only immutable pure work or phase-scoped bytes/hashes may be deduplicated.
- D3: Compile shared semantics once and link app-specific wrappers. Raw source hashes, schema/parser/formatter/plural-rule context and trusted derivation remain part of reuse.
- D4: Rust adoption is required. Compare addon versus per-operation persistent child before selecting the production boundary. Use JS as equivalent fallback/control; Oxc does not replace required TS semantic queries.
- D5: Verify target binaries against a bound release-wide engine manifest; preserve cross-platform portable authority instead of treating platform binary hash alone as portable identity.
- D6: First shared IR stage preserves current emitted artifacts/public contracts. Breaking ABI/format changes are excluded.

## Evidence ledger

- Baseline source and package metadata: `baseline.json`.
- Accepted vplan: `agreed-plan.md` (verbatim MDX in a text fence; original artifact hash remains in baseline.json; execution status lives here).
- Research/bench scripts and original raw evidence: paths and hashes in baseline; originals must not be overwritten by new measurements.
- New evidence goes under `evidence/` with commands, resource/input identity, stdout/stderr location and outcome. Keep large raw profiles/artifacts outside git and record their immutable digests/CI URLs.
- Candidate validation: reuse/strictness/CLI initial 100 tests passed outside the tsx IPC sandbox; new read-scope and transfer-session focused suite 23 passed. Combined phase 2/3 suite now passes 170 tests across eight files; typecheck and library build pass. See evidence/phase2-3-checkpoint.json. Full lint awaits completion of the concurrent benchmark harness. Turbo helpers: 18 unit tests and scoped lint/format passed. No candidate speedup or CI adoption is claimed.
- PRs/commits: none yet. Publication/merge/runner approval requests: none yet.

## Completed work

- Durable Codex goal created; repository workflow and applicable rules refreshed.
- Both feature workspaces created from fresh remote refs; Turbo check-worktree passes.
- Registry and original PR/library CI identities refreshed; agreed phase/strictness policy preserved.

## Blockers and uncertainties

- Actual CodeBuild CPU/cgroup/memory/storage limits need refresh. Earlier AWS session was expired; labels are not proof of resources.
- Current baseline CI is captured in Turbo evidence/baseline-ci.md and companion JSON. Validation passed; workflow cancelled three staging builds. Exact-baseline production builds are available as separate-context evidence.
- Node-API selected from Node24 repeated measurements; shared IR private derivation implemented. Real CI gains, complete platform support and final patch release remain acceptance gates.
- Publication/merges/runner changes require explicit approval only after exact reviewable results exist; they do not block local implementation, packed testing or feature CI.

## Next actions and resume procedure

1. Read this record, baseline and each repository's current instructions; inspect git status in the task worktrees. Do not reset another task's work.
2. Frozen isolated dependencies installed and baseline CI capture complete. Retain exact references; record real resources in future authorized candidate CI.
3. Finish combined phase 2/3 review and tests, wire Turbo helpers only with a candidate compiler that supports reuse. Commit reviewed checkpoints. Continue shared message semantics then required Rust integration and release/adoption gates.
4. Advance ordered phases with tests and attribution. Update this table, decisions, commands/evidence and next actions at every milestone.
5. Rebase/check current staging before Turbo delivery, follow required review and hooks, push feature branches/open PRs and run authorized CI. Prepare exact package/merge approvals when ready.

## Journal

- 2026-09-10T04:17:30.646646+00:00 — Started authorized execution, established isolated base revisions and created this durable record. No implementation is claimed complete.

- Phase 2 checkpoint: added native `reuseAuthorityBundle` and CLI `authority reuse`. Explicit exit 0 accepted versus exit 2 safe miss; strict import still throws. Initial 54 transfer/strictness tests passed, plus five operational/rollback fault cases. A permission-error masking bug in receipt file inspection was fixed. Typecheck passes. Broader CLI tests encountered sandbox tsx IPC EPERM; rerunning unchanged suite outside sandbox, with failed sandbox log retained. Candidate performance/adoption not yet claimed.

- 2026-09-10T05:30:36.656955+00:00 — Refreshed CI: pinned validation preparation 134 s (audit 33 s, export plus verification 78 s), test restore 88 s, quality restore 87 s. Auth import/verification log envelopes 74.478/24.583 s; other three staging builds cancelled. Published .29 unchanged. Raw 62 MB evidence retained outside git with compact hashes in Turbo. Phase 2 safe reuse helpers and typed library API implemented; phase 3 bounded phase hash sharing and compiler identity batch sessions retain final per-catalog and pre/post-publication barriers. Combined tests caught and are fixing single-error wrapping compatibility. Weak immutable receipt-byte reuse under separate review. No release, push or workflow execution yet.

- 2026-09-10T06:22:01.774244+00:00 — Phase 2/3 checkpoint: 170 combined tests pass; typecheck/build pass. Added red/green workspace probe EACCES and mixed-case catalog-order tests. Receipt cache retains live relationship validation. Phase 4 in-process semantic memo implementation delegated; cross-process trusted derivation design under review. Rust 1.98.0/Cargo 1.98.0 available locally; Rust backend not implemented yet. Official Node-API/NAPI-RS/Oxc docs refreshed.

- 2026-09-10T06:59:27.138016+00:00 — Rust core/addon/persistent worker implemented with pinned Cargo.lock, bounded CPU/requests, streamed file hashing and Oxc evaluation (always retains TS). First full-tree receipt pilot regressed and was replaced by streaming canonical-byte validation. Six Rust tests and eight Node/native transport tests pass, including deterministic numeric/Unicode mutation parity and explicit Node-required cases. 36 benchmark blocks completed: 30 observations per backend/scenario/state. Receipt warm median Node 307.78 ms, addon 91.70 ms, worker 109.99 ms; sampled peaks 398.6/308.6/410.0 MiB. Hash warm median Node 75.44 ms, addon 84.06 ms, worker 90.13 ms: no hash median improvement. Select Node-API for receipt/discovery integration, retain performance gates and do not claim CI speedup. Native discovery is being added separately. Evidence: native-transport-results.json; raw sealed archive path/hash in that JSON. No native binary is shipped or enabled in Turbo yet.

- 2026-09-10T07:00:59.877534+00:00 — Runtime correction: first native transport measurements were consistently Node 26.8.1 from Homebrew, as recorded in every raw environment, not installed Node 24.18.0. Preserve this as separate secondary evidence. Explicit Node 24.18.0 parity tests and identical-input three-block benchmark repeat started. Current CI baseline used Node 24.21.0; local results still cannot substitute for CI.

- 2026-09-10T07:21:18.451073+00:00 — Node24 repeat completed: 30 observations/cell, receipt warm median/p95 Node323.33/330.62ms, Node-API106.43/110.32ms, persistent worker112.01/120.15ms; SD4.75/1.80/3.13ms; sampled max RSS343.8/332.9/374.8MiB. Hash warm median126.27/89.57/97.01ms, contrasting Node26 regression; select Node-API, gate hash adoption by integrated/runtime evidence. Raw reports sealed, hashes and scope in native-transport-node24-results.json. These are local operation measurements, not CI critical-path gains.

- Native integration checkpoint: manifest binds all prebuilt targets portably; selected binary checked each fresh compiler identity; Node-API ABI/lifecycle checks, bounded queue and worker pool, explicit operational error codes, Unicode-version mismatch falls back to full Node canonical validation. Native discovery preserves Node sorting/catalog rules; async receipt path retains JS schema/named hashes/counters/live evidence and compares reconstructed receipt to raw parsed JSON before caching canonical bytes. Forced-Rust combined authority/receipt/hash-scope suites: 75 tests pass, 29.14s, .tmp/native-stable-strictness.log. Prior run during source edits rejected mutation barriers; retained as .tmp/native-real-strictness.log, not a correctness pass. Production loader/discovery lifecycle tests3 pass; Node24 native differential tests8 pass; typecheck/build pass at checkpoint. Local macOS arm64 binary staged only (releaseComplete=false); all-platform packaging, packed smoke, real Turbo corpus and four app builds, CI adoption remain required. Rust review found FIFO-open and restored-mtime races; fixes/test work active.

- 2026-09-10T07:44:21.030554+00:00 — Packed Node24 forced-Rust consumer smoke passed: isolated installed tarballs, public API/types/descriptors, V3 authorize/build and11 malformed/stale negative cases (evidence/native-integration-checkpoint.json). Full suite941pass/4diagnostic failures in104.21s; four failures hid provider-specific messages in the new AggregateError. Retain all child failures and add bounded message details; affected43tests nowpass25.40s. Rust10debug tests pass including deterministic FIFO/restored-mtime/growth races. Native source discovery now additionally covers collectConventionSourceFiles, retaining generated exclusions/extensions/symlinks/order/fresh inventories; four production integration tests pass.

- Local dependency recovery: pnpm verifyDepsBeforeRun=install auto-triggered after package files metadata changed, then sandbox network failed. Own isolated dependencies restored, lock unchanged. All further local commands use explicit Node24 PATH plus pnpm_config_verify_deps_before_run=error, pnpm_config_enable_global_virtual_store=false, pnpm_config_store_dir=/private/tmp/intl-native-pnpm-store to match CI local-store semantics. No global config was changed.

- Disposable Turbo consumer /private/tmp/intl-native-turbo-consumer-vr6radmm extracted immutable staging baseline1f57e8d; baseline frozen install then temporary direct local tarball overrides (catalog file protocol unsupported by pnpm12). Candidate v1 pack hashes .tmp/turbo-candidate-packs-v1.json. Instrumented full five-catalog authorization succeeds11.3258s, sampled tree RSS4280.6MiB, one observation only, no variance or comparative CI claim. Raw /private/tmp/intl-native-execution-evidence/turbo-candidate-v1/authorization.json and ICU PID counts; parent5718 parses, shared packagechild0, apps103/3469/3520/6996. Need shared-string intersection and repeated uninstrumented baseline/candidate comparisons. v1 predates final native source-walk and loader hardening.

- Current ownership/next: Sartre implements private verified-byte native snapshot loading, single initialization and permanent load-failure poison with race/retry tests in native-assets.ts/native-engine.ts; main must not edit these until handoff. Hegel implements all8 prebuilt targets/release gates in native workflows/publish scripts, no publishing or workflow dispatch yet. Main owns real Turbo packed benchmarks/adoption and final integration. Native stage currently sourceHash d05fb9f3df6d9c69beb83fa192419eba3bb658992f3547573c4abe05fa45e9c6 (source walk present), local binary not releaseComplete. Rebuild/restage if Cargo/source changes. Need full final strictness/typecheck/lint/packed suite, shared3931message proof, four builds, PRs/featureCI and exact patch publication approval. Goal remains active.

## Required generation identity correction (10 September 2026)

The durable goal additionally requires compatible separation of stable translation-generation identity from application release provenance and source authorization. Incident revision: Turbo `72dd09fd3b6e95e71ec7fbcf997f62313b624cfc` (PR #1788, version packages). This is an additional immutable regression input, not a replacement for either benchmark baseline. Convention catalog buildId currently derives from app version, changing buildToken and generated artifacts; generation input identity also binds the full application manifest. Changing only the token cannot satisfy this requirement.

Acceptance: an application-version-only bump preserves payload files, manifests/descriptors, generated imports, catalog.lock.json, current.json and catalog-generation-receipt.v1.json byte for byte. Old source authorization must fail against the changed package manifest; a fresh audit must bind the current full manifest and verified stable payload. Identical reruns must remain stable. Actual translation/contract changes must invalidate generation; source, configuration, dependency/import resolution, compiler, descriptor and artifact changes must retain their existing rejection and mutation barriers. Generation reuse is never proof of fresh source authorization.

Compatibility gate: demonstrate legacy receipt handling and explicit public buildId behavior without weakening validation or requiring a major release. Include version-only bumps, identical reruns, translation/contract edits, source/config/dependency-resolution changes and tampering in regression, packed-consumer and Turbo CI acceptance tests before any patch publication. Phase status: active implementation; no compatibility or performance result claimed yet.

Decision D7: separate the identities by purpose. Stable generation records describe verified translation generation; fresh authorization retains full release/package/source provenance. Do not discard application identity from authority or treat an unchanged generation hash as authorization.

Next action: implement and prove the identity split before final candidate packs and repeated end-to-end benchmarks. Continue native distribution, strictness and CI adoption work independently. Main owns catalog/generation/proof implementation; Sartre reviews compatibility read-only; Hegel owns native runtime smoke coverage only.

- Generation identity checkpoint: incident first-parent evidence confirms all four app manifests changed only2.0.7→2.0.8 and each changed four tracked generation controls. Convention buildId is now content-v1; explicit CatalogSource.buildId semantics unchanged. Domain-separated generation manifest projection excludes only top-level version; every other manifest field and full lock remain bound. Full authorization identity unchanged.68focused tests pass10.64s; forced-Rust packed consumer passes version-only stable output, old authority rejection before/after generation, fresh authorization and identical rerun, plus11 existing stale/tamper cases. Local pack predates pending final-barrier correction, so this is not final release proof. Turbo four-app acceptance script added with3harness fault tests; actual packed Turbo execution pending.
- Review caught a required V3 final barrier gap: generation hash intentionally no longer catches mid-verification version changes. Sartre owns explicit final full-application/raw-manifest+lock checks and standalone/batch/transfer deterministic regression tests. Main must not edit check-receipt.ts/transferred-verification-batch.test.ts/strict-receipt-verification.test.ts until handoff. Hegel owns native-engine.ts/native-loader.test.ts lint-only cleanup. Prior phase6 implementation is source-ready, all8target workflow not yet run; runtime discovery smoke now covers both operations on Darwin. Operation-scoped exact-byte receipt parse cache and combined91tests passed before identity split. Final full suite/pack/matrix still required.

- Final application barrier corrected: fresh full identity plus raw manifest/lock bindings run after final payload checks. Three deterministic version-only mutation probes failed before fix and pass after (standalone, batch, transfer);26focused tests pass13.21s including late raw-manifest/lock mutations. Full forced-Rust suite:932pass,40tsx-IPC sandbox failures across two files,972total; affected CLI/parity tests being rerun with required IPC access. Do not record sandbox failures as product pass/failure. Final lint cleanup active. Forced-Rust packed identity test passed before this barrier addition; final rebuild/repack required.
- 2026-09-10 upstream refresh: library main still1aac3ee03b6f88a72f361ff5e0ad5066381ca1aa. Turbo main72dd09fd3b6e95e71ec7fbcf997f62313b624cfc; current staging42a898e58b7355326d3da121f56b63f1c995a161. Own Turbo feature tree fast-forwarded from1f57e8d to42a898e5 with all untracked task work preserved; check-worktree passed and changed promotion/release instructions refreshed. Original immutable benchmark baseline remains1f57e8d, disposable consumer C remains at that input. Final adoption must additionally validate current staging inputs/workflows. No history rewrite, push, package publication or deployment.

- Explicit approval received: user approved enabling/running the reviewed eight existing GitHub-hosted native target jobs (max4concurrent), artifact assembly and one packed-consumer job, after automatic review classified the added hosted job as infrastructure. Exact proposal: proposals/CI-APPROVAL.md and proposals/native-build-ci.yml in library. Approval permits committing/pushing these workflows and running native feature CI. It does not authorize package publication, merging, AWS/CodeBuild changes or production deployment. Reviewed consumer proposal now installed as .github/workflows/native-build-ci.yml. Do not ask for this approval again.
