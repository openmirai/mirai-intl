# R37 dormant V3 publication deadline: read-only diagnosis

Source: 37a8628f66cd793330db2d5a163287f8454182a8; tree 6cf328a934ac7ddb6a550e0f4e292c301ee2ef50. No new prove/check/test run or source edit performed during diagnosis.

## Exact failure and scope

`packages/compiler/src/proof.ts:2125-2132` creates an absolute monotonic deadline using performance.now() + 20_000 by default, immediately before publishDormantConventionAuthorityV3. Analysis and V3 binding construction are already complete (:1890-1904). This is a 20-second publication window, not an 88-second command limit. Internal injectable deadline/clock options exist; no production CLI deadline override was found or used.

The window includes package identity and authority preparation (:828-866), immutable authority/receipt/set staging (:920-975), directory/regular-file checks and selector staging/datasync (:742-790), the complete live fingerprint verification, and finalized classifier frontier revalidation (:714-723). Immutable install also validates installed bytes and uses filesystem operations (:540 onward).

The exact observed error is thrown at :725-731 when the supplied deadline is absent or now >= deadline. Production supplies it at :2125. It runs AFTER await verifyLive(), and BEFORE final staged selector checks/rename (:789-792). Identical existing selectors also take verifyLive and the deadline check (:760-764). Therefore the observed path completed the preceding identity/fingerprint/frontier checks without their errors; it does not establish absence of every possible later race, and is not evidence of invalid input acceptance.

Fingerprint checks rediscover current catalog/universe and artifacts (:1911-1992), reread all source and provider bytes, path ledgers, application and immutable compiler identity, and recheck provider frontiers (:1994-2048). Specific mismatch errors are distinct: source :2050, config :2055, provider :2060, ledger :2082, generation :2089, application :2094, compiler/dependency :2101. The failure can mask an unexecuted later staged-selector check, not an earlier identity error already raised.

## Existing evidence

G: /private/tmp/intl-native-semantic-consumer.bPVcp5Wo
- Full forced-Rust five-catalog check exit1; final output after 528.6643s. Admin and shared pass, Auth/Instructor/Learner deadline errors. Original producer.json SHA256 9e8be7de0cc86f20437cf5f66e6205e42bf88cd219cc8882469930db17d16827 remains unchanged.
- After confirming all producer children exited and renaming prior Auth authority to evidence/auth-serial/pre-standalone-authority, standalone Auth prove exit1 after 88.242243s with the same internal deadline error. External command timeout180s did not fire. No locale/source probes or version probes ran; no invalid-input verdict is established.
- Exact reports: .intl-candidate/evidence/producer.json; producer-command.json; auth-serial/standalone-prove.json; auth-serial/standalone-command.json, relative to G.
- Installed compiler sourcemaps for proof.ts and classifier-candidate-shadow.ts are byte-identical to R37 source; semantic-source is present in installed JS. A stale-classifier packaging explanation is not supported.

F: /private/tmp/intl-native-profile-consumer.HDeWIM
- /private/tmp/intl-native-execution-evidence/semantic-source-turbo-diagnostic.json reports all5 success and899 semantic files.
- Current selected immutable receipts independently sum to899: Admin325, Auth9, Instructor135, Learner142, shared288.
- Auth F receipt 7ff8b0163b1410f3a3138bd21146af86ca8caf239934fae897dae1da513ca737.json versus G inert/unpublished receipt 033d8b7e27a94ea3bdda3920a83c64f1d220007f8ec286b2ed465aef8d7d0ff7.json, each under apps/auth/.mirai-intl/authority/receipts/v3.
- All117 Auth source paths AND hashes match. Both record9 semantic files,457 loadedLibFiles,89 TypeScript lib files,633 boundaries,5 resolver requests,0 owner fallbacks,6 unknown-boundary identities. loadedLibFiles is a receipt counter, not a TS Program count. TypeScript libHash is identical (24cfe456e0becf3e5b104353b60f12050973e91921b90a290046c2be73814ecb).
- Dependency closure differs: F55/G130 declaration counter (11/26 unique declaration identities across closures), F13/G28 physical frontiers, F28/G72 resolution bindings, F69/G115 probes, F7/G8 control sets. Receipt bytes F491861/G565367.
- F resolved installed .29 runtime/ABI packs with bundled declaration chunks; G resolves .30 packs with split runtime/ABI declarations (including ABI catalog/descriptor/diagnostics/json/proof/schema/validation/wire and runtime backend/catalog/dynamic/precompiled/representations/rich/runtime). Thus R-direct F is NOT the same installed dependency context as G. F Auth package version2.0.8, G2.0.9; application/compiler identities legitimately differ across roots. Cross-root differences are not within-operation identity mutations.

## Ranked hypotheses and discriminating evidence needed

1. Fresh publication work exceeds the20s window in the observed execution conditions. This is the directly supported failure mechanism, but its expensive phase is unmeasured. Capture monotonic start/end for inert staging, fingerprint verification, classifier frontier recheck and commit-barrier slack, including failure paths. Existing authorization profile output is only emitted after success (proof.ts:2135-2142), so the empty failure stderr cannot locate the cost.
2. G's expanded .30 declaration/frontier topology materially increases fresh verification cost versus F's .29 dependency closure. Prediction: matched source and compiler with controlled installed dependency layouts changes provider/frontier work and window consumption. Receipt counts prove the difference, not its causal cost. No new matched run performed.
3. Scheduling/I/O pauses consume the monotonic wall window. Prediction: boundary wall duration grows without corresponding CPU work under controlled load; event-loop/CPU/I/O samples distinguish this from computation. Host load181 and delayed commands were observed/reported, but no per-phase CPU/I/O trace was captured. Do not attribute the cause to load as proven.
4. An identity mutation is a competing concern, but does not explain this exact thrown error: prior identity checks completed on this path. Deterministic mutation tests should retain their specific errors independently of deadline tests and preserve the old selector. The current reports cannot exclude a later race after the last read.

## Safe operational direction and tests

Keep final raw source/config/provider/application/compiler/ledger reads, source-set discovery, selector-byte checks and atomic publication. Do not merely extend/suppress the deadline or restart it after live verification. First expose failure-phase timing and deadline slack without authorizing anything new. Inert content-addressed staging could be completed before arming a bounded LIVE-verification window, if the design retains a deadline covering the entire fresh read/frontier/commit interval and the explicit absolute-deadline contract; staging alone cannot activate authority. This is a design option, not a demonstrated fix.

Existing `packages/compiler/test/dormant-v3-publication.test.ts:167` test “leaves the prior selector valid across every pre-commit interruption and corrupt-object failure” includes deterministic now=deadline expiry (:199-207) and old-selector preservation. Needed additional tests: slow inert staging versus slow live validation; exact20s boundary; expiration after frontier recheck/before rename; independent source/provider/compiler mutation errors; no selector activation on deadline failure; identical-selector route; valid large packed closure under bounded serial and workspace resources. None newly executed here.

Main reports both corrected37 Linux lanes now pass producer/export/reuse/isolated import, with remaining work ongoing. This is user-reported external evidence, not independently fetched in this diagnosis. It proves neither a localhost cause nor complete strictness acceptance. No local retry is needed or performed.
