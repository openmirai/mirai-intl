# Patch0.3.30 release review — not yet approved or ready

Benchmarked implementation source: openmirai/mirai-intl commit `37a8628f66cd793330db2d5a163287f8454182a8`, tree `6cf328a934ac7ddb6a550e0f4e292c301ee2ef50`, PR16. Release scope is exactly five public packages: @openmirai/intl-abi, @openmirai/intl-compiler, @openmirai/intl-runtime, @openmirai/intl and @openmirai/intl-i18next, version0.3.30, npm tag latest. This is a patch; no major or prerelease is proposed.

## Reviewable behavior

Valid unchanged authority is fully revalidated and reused without audit or regeneration. Corrupt candidates are rejected; one producer audit is allowed only after safe isolation/rollback. Shared message semantics are composed once with per-catalog identities. Phase-scoped read/hash/receipt reuse preserves fresh mutation barriers. The bounded Rust Node-API engine serves discovery and receipt operations with verified fallback and portable compiler identity; all eight prebuilt targets ship in the compiler package, with no Rust build on consumer installation. TypeScript semantics remain authoritative, including supported adapter calls retained by the final source-classifier repair. Version-only application bumps preserve generation surfaces and invalidate prior authorization; fresh authorization binds the current manifest and verified payload.

Local release candidate now adds commit3eb49b8 (55 transfer-boundary tests, their evidence, native TMPDIR documentation). Its runtime source is identical to37. Final publication must pin the final reviewed commit after its own native/normal CI; do not publish the historical37 command below. Remote37 remains frozen only to finish identical-input measurements.

## Evidence already available

- Normal CI34494038352 and native CI34494038965 pass on exact37; all eight platform jobs, assembly and expanded packed consumer pass.
- Candidate artifact10159503087 and native artifact10159288263 downloaded and digest-verified; all native files match manifest hashes, exact sourceHash and0.3.30 compiler identity.
- Explicit local `release:packages:npm:preflight -- 0.3.30` passed for all five packages with npm --dry-run. All were pending in registry at that read. This neither publishes nor proves a future OIDC release execution.
- Turbo cb22e05067 full run34498093485 SUCCESS: all5 producer/export, byte-identical reuse, isolated import, quality/tests, four production builds/eight final proofs,17 actual strictness cases and four version-only regressions. Evidence artifact10162472204 SHA2561a9558fe06c56dfb3b9ee11be0a89d7a4b36989ea1cbe1c99deb8879d0bd7b84 retained and inspected. Ordinary validation34498094349 still uses published.29 and also passed.
- Full Turbo911 candidate34506410455 also SUCCESS, all four builds/17 strictness/four version probes/eight proofs. Full shared-corpus parity70 generated files/3931 shared contracts per app and same-authority forced-Rust Mac/Linux/Mac roundtrip pass. All55 new real transfer fault cases pass Node96/Rust96; independent review found no blocker.
- Corrected paired preparation34506408677 n10/engine: Rust median3.26368%/p953.81087% faster. Workspace verify34510179246 n10/cell: coldmedian4.65944%/p956.71837% and warmmedian6.33636%/p956.21946% faster. Raw variance, peak memory and scoped limitations retained; warm Rust sampledRSS median is higher. Workspace reuse34512294604 running; historical context still pending.
- Measurement34498088946 failed confirmed AWS45min BUILD_TIMED_OUT with no artifacts. It supplies no usable comparative samples. Shorter n10 profiles retain all guards; actual n2 workspace orchestration pilot passed16blocks but is not final performance evidence.

## Remaining acceptance before requesting approval

Corrected Turbo strictness and four production builds/eight final proofs are retained. Finish repeated equal-work Node/Rust and reuse comparisons with variance, p95, peak memory and critical path. Add post-repair fresh/persistent workspace measurements; earlier local warm results are historical. Resolve real correctness/performance failures without weakening checks. Retain the local20-second publication-window failure and its unproven cause; failure must never activate authority. Complete final requirements audit and recheck registry/version/source immediately before asking.

## Exact prospective publication operation

Historical command template only, superseded by local3eb49b8 additions. Before requesting approval, replace37 with the final reviewed release commit after its own CI succeeds. No command in this checkpoint is approved for publication:

```sh
gh workflow run publish.yml --repo openmirai/mirai-intl --ref codex/intl-native-engine \
  -f release_ref=37a8628f66cd793330db2d5a163287f8454182a8 \
  -f release_version=0.3.30
```

Before execution, verify the dispatch ref still contains the reviewed publish/native workflows; a moved source or workflow needs renewed review. The workflow resolves once, rebuilds the eight prebuilt targets from that immutable source, verifies artifact metadata/digests, runs full verify/build and package preflight, then publishes through npm Trusted Publishing. It does not merge either PR or deploy applications. No tag is required for this manual immutable-ref path; tagging/merging remains a separately reviewed action.

Do not execute this command before approval. After publication, verify registry bytes and installed native identities, apply the separate ordinary Turbo adoption patch, generate the real frozen lock and all five tracked generation controls, and verify ordinary validate/release consumers. Publication alone cannot complete the durable goal. No approval is requested by this document while the remaining gates are open.
