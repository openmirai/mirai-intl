# Current execution checkpoint

Goal active: production-ready Rust and verified Turbo adoption, including stable generation under app-version-only bumps. Publication, merges and runner infrastructure still require approval; the eight-target native CI proposal is already approved.

## Current immutable revisions

- Library branch codex/intl-native-engine: 7f02a9ec5c555bfd993395e1c1573ff7902f9240, draft PR16. Implementation checkpoint f71bbc868615cce0d877f6c9e456421cd9cd1058. Published baseline0.3.29/main1aac3ee03b6f88a72f361ff5e0ad5066381ca1aa.
- Turbo branch codex/intl-native-ci-adoption: 5fa66072269baa47c07ccc1254334649d3c54b5d, draft PR1794, based on staging318d95f361ae7016db026f3a9e8d1a7f68dbb75c. Hooks passed; remote SHA verified.
- Local measured source stays42a898e58b7355326d3da121f56b63f1c995a161. Original immutable benchmark baseline1f57e8dda0065674abce36ef51359686038259e7 and incident72dd09fd3b6e95e71ec7fbcf997f62313b624cfc remain unchanged.
- Library nativeCI34459228336 and normalCI34459228084 succeeded. Compiled merge465b3df1416969b8df7c042561d3bddf1af5b232/treec6ece6a01d47156027ecf6f7e977a5f3c504001b; candidateartifact10145205307 SHA256a6c37ea3eb026681f4716714432c9033b188260464ca75ed752dac5d62f02e70.

## Completed gates

- Bounded Node-API native scanning/canonical receipts; all8platform runtime, assembly and forced-Rust full packed-consumer CI.
- Stable generation identity omits only top-level application version; complete current application identity remains bound by fresh authorization and final barriers. Unit, packed and four historical-app probes pass.
- Actual shared parser hash proof:3931sharedkeys,5718unique raw strings, eachparsedoncebycoordinator andzero inallfivechildren. See shared-workspace-parser-proof.json.
- All4 local production-mode builds at42a898e5 passed with CI-built all8binaries,3509modules finalized,zero buildtime semantics. Rawlogs/counters retained; exactproof files were replaced by subsequent authority reuse, so final CI must archive freshproofs before mutation probes.
- 80 workspace measurements complete:n10/cell across Node/Rust, verify/reuse, freshprocess/persistentworker. OS caches notcleared. Rust coldverify essentiallyneutral, warmverify~5.8%lower median, reuse~3.4%/7.1%lower cold/warmmedian. See workspace-node-rust-results.json.
- Oxc parse evaluation2561files, allsyntaxaccepted byboth parsers,1statementcountdifference,zero safeTSskips. Retain TypeScript semantics and exclude Oxc classification from productionauthorization. Exploratoryn1parse timings arenotCI evidence.
- Turbo58candidate helpertests and11typecheckcommand/CLItests pass. Exactplan proves --ci retains18projects/samecompiler/-b mode in6batches of3.

## Current acceptance failures and completed measurements

- Reviewed correction5fa66072269baa47c07ccc1254334649d3c54b5d pushed with allhooks, exactremoteSHAverified. Candidate34468546926 passed full sourcequality/strictTSC and is running applicationtests; ordinaryvalidate34468547449 stillrunning. Local347runtime-host tests,83helper/typecheck tests and all18project strict batch1 typecheck passed. Review found omitted intl:check enginepass-through; fixed,9scoped tests plus actual Turbo prove-task dryrun confirm selection. No remaining scoped review finding.
- New isolated R /Users/kentakoong/Desktop/Work/openmirai/org/worktrees/mirai-intl-native-patch-release branch codex/intl-native-patch-release created at7f02a9e for locked dependency preparation only. No version bump yet; must fastforward to reviewed packed-test checkpoint before release-it. No nativeassets copied. Registry refresh2026-09-10T10:55:33.104Z allfive latest.29 and exact.30 absent. Remote main still1aac3ee0; primarycheckout stale/unrelated and preserved.


- Candidate34464044260 at511f0f8356 failed strict typecheck after --ci batches of3, without child diagnostics. All five authorization/export/reuse/isolate/import stages passed again. Go TypeScript7 CLI execves its native compiler: a Node heap cap does not bound it. Memory pressure remains a hypothesis; add explicit signal reporting, batch-size1 and Go soft limit5GiB while retaining every project and the named lint:strict script.
- Ordinaryvalidate34464044891 quality failed because globalPassThroughEnv violates the existing task-scope contract. Main removed it and passed MIRAI_INTL_ENGINE only to compiler-invoking tasks. Nine environment contract tests pass; broader validation and a new CI head remain pending.
- Local preparation comparison COMPLETE:50 successful samples, n10/cell, counterbalanced blocks, identical42a898e5 application source/resources. Median/p95 milliseconds: published Node full42557.8/44027.0; candidate Node full23959.8/26764.2; candidate Rust full25709.2/29251.5; actual Rust CLI reuse16893.3/17173.4; published verify9631.0/9725.6. See preparation-comparison-results.json for variance, CPU, peak memory and raw hashes.
- Rust full preparation is39.6% lower than published baseline but7.3% slower than optimized Node control, with lower peak RSS. Actual unchanged reuse is60.3% lower than baseline full preparation locally. These are not CI critical-path speedup claims. Cold means fresh process; OS caches were not cleared and CPUs were not isolated.
- First CLI reuse harness failed before Intl due a missing relative wrapper. Failed evidence retained, absolute wrapper smoke passed, remaining cells completed without overwriting successful observations.
- D /private/tmp/intl-native-current-consumer-1uw94sgu uses all8candidatev3 packs; E /private/tmp/intl-native-published-baseline-hnz9n6lh uses frozen published0.3.29. Both source42a898e5. No active benchmark.
- Diagnostic hook L.tmp/source-operation-profile/hook.mjs prepared but NOT yet executed. Node filesystem/hash and TypeScript6 API counts must be distinguished from Rust filesystem work and Turbo's separate TypeScript7 Go typechecker.

## Next actions and ownership

1. Main owns workflows, task environment correction, EXECUTION/CURRENT, CI evidence and source profiling. Download/verify artifact10147169453 and capture second candidate resource/step facts. Integrate tested typecheck and strictness helpers, run checks/hooks, push reviewed feature changes and verify all candidate gates.
2. Sartre completed/released typecheck and review. Now owns only .github/actions/prepare-intl-authority/action.yml plus its new test, composing existing discovery/download/pin-recheck/prepare helpers; no ordinary workflow wiring until patch adoption is ready.
3. Hegel owns L scripts/pack-smoke.ts to extend actual packed locale/contract failures and genuine translation changes; existing stale-input negatives retained.
4. Averroes owns new T .github/scripts/verify-intl-strictness.mjs and test, plus EXCLUSIVE D/Auth mutation for real consumer probes. Do not profile or mutate D until released. Every input restored and valid baseline checked between failures. Main wires CI after final-proof archival and before version probes.
5. Prepare exact0.3.30 patch in clean isolated library tree after packed extensions pass; refresh version availability first. Follow patch-release-readiness.md. No tag/publish/merge. Run all8native/packed gates on postbump source and pin exact new candidate for Turbo.
6. Prepare ordinary Turbo validate/release cache adoption for published patch. Candidate lane alone does not constitute production adoption. Publication, merges and infrastructure remain approval gates; previously approved eight native jobs need no further permission.
7. Present exact reviewable commits/artifacts, strictness and performance before publication/merge approval. Continue independent authorized work. Preserve primary checkouts and other agents.

Full journal and decisions:EXECUTION.md. Detailed commands/hashes: evidence/ plus referenced raw directories. Goal remains active, not complete.
