# Feature checkpoint review

Scope: library feature branch `codex/intl-native-engine`, fixed baseline `1aac3ee03b6f88a72f361ff5e0ad5066381ca1aa`, all task-owned tracked changes and new files in the isolated workspace. No unrelated work included. Verdict: **COMMENT / draft feature CI ready; not release approval**. All-platform native runtime, repeated real Turbo benchmarks, four production-mode app builds and final CI adoption remain required.

## Concrete risks and executed evidence

| Risk | Severity | Retained protection and evidence |
| --- | --- | --- |
| Corrupt authority silently reused or unsafe rollback retried | High | Typed safe-miss boundaries, drained failures, locks/staged transaction and rollback guards. Phase2/3 focused170tests; later full-suite coverage. Final independent read-only review found no blocker. |
| Cached receipt bypasses fresh source or dependency checks | High | Exact-byte bounded operation scope, trusted immutable parsing only, fresh live relationships and final phase scopes; repeated-source/EACCES/cache-lifetime regressions pass. |
| Version-only change passes stale authority or rewrites translations | High | Stable convention generation identity, full authorization identity retained, explicit final application/raw-manifest/lock checks. Three mutation tests failed before fix and pass after;26strictness/transfer tests passed13.21s. Packed consumer version case passed. |
| Native package swap executes unverified bytes | High | Manifest/binary bounds, private verified-byte load snapshot, serialized initialization, permanent failed-load poison and fresh subsequent checks.13loader/asset tests passed; real Darwin runtime integration passed. |
| Shared IR imported from untrusted or incompatible context | High | Private per-operation parent channel, nonce/context/digest and compiler/parser/TS identity barriers; no public IR trust API. Small five-child parity test and real Turbo pilot; final shared-string intersection/repeats remain. |
| Rust Unicode/canonicalization differs from JS | High | Exact parity checks and explicit full-Node fallback for unsupported canonical cases; Rust streaming and Node differential suites passed. Node24 repeated transport results recorded separately from Node26. |
| A prebuilt platform fails to load or consumer compiles Rust | High release gate | All8target producer recipes and exact release-wide manifest, source/version/archive checks; no consumer install compilation. Only Darwin executed locally. Approved hosted matrix and packed-consumer CI must pass before release. |
| Optimization fails end-to-end performance gate | Medium | Node24 transport samples30/cell include variance,p95,sampled memory. Local Turbo pilots are n=1 only; no CI speedup claimed. Identical-input repeated consumer/CI benchmarks still required. |

Combined test accounting: full forced-Rust run972tests:932passed and40failed solely from tsx IPC denied by sandbox, across two files. Those files plus strictness and explicit buildId compatibility rerun with IPC access:112tests passed39.91s. Typecheck/build passed. Final rebuilt forced-Rust packed smoke passed including11stale/tamper cases and generation identity case. Whole-library lint has no errors (existing conditional-expect warnings), formatting and workflow actionlint pass. Logs remain in .tmp; durable compact evidence is in adjacent JSON and execution records.

## Repository review checklist

1. Product/routes: not applicable; compiler/CI surface, no route edits.
2. Authorization: clear within reviewed transfer/receipt scope; fail-closed and fresh-barrier regressions pass.
3. Server/browser boundary: clear; native module is compiler-only; packed public API/private descriptor lowering and consumer types pass. Final four production app builds pending.
4. Contracts/cache ownership: clear in tests; additive reuse API, unchanged explicit buildId contract and wire shapes; operation scope bounded. No authority label/timestamp trust.
5. Internationalization: existing locale/message/source strictness retained; version-only generation correction covered. Linguistic quality is not claimed.
6. Environment/task graph: native jobs use .nvmrc; max4matrix jobs and bounded engine queues. Turbo strict-env forwarding/adoption still pending, not approved as complete.
7. Dependencies/generated state: Cargo.lock pinned, package versions remain unpublished0.3.29candidate labels; native assets ignored locally and staged only by verified producers. Compatible eventual release patch-only.
8. Runtime/operations: local Darwin proven; platform matrix pending. User explicitly approved the listed hosted native jobs. No AWS runner change, package publication, merge or deployment authorized by that approval.
9. Observability/security: bounded logs/requests, artifact digests/source identities pinned, read-only Actions permissions for candidate matrix. No credential values persisted. Cross-repository artifact download capability still to be measured.
10. Verification/maintainability: strictness red/green, full-suite combined accounting, packed evidence and durable resume records present. Release remains gated on missing platform/consumer/CI evidence.
