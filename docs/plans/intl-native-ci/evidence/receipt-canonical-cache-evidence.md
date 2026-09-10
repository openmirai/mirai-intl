# Trusted receipt canonical cache sidecar

Scope: authorization-snapshot.ts and new receipt-canonical-cache.test.ts only. No commits, benchmarks or builds. Existing tests referenced but not edited. Catalog/check-receipt files remain main-owned.

Base main: 1aac3ee03b6f88a72f361ff5e0ad5066381ca1aa; working diff includes concurrent main changes.
Working directory: /Users/kentakoong/Desktop/Work/openmirai/org/worktrees/mirai-intl-native-engine

## Test proof

Red command: `node_modules/.bin/vitest run packages/compiler/test/receipt-canonical-cache.test.ts`
[Actual redirected red log](receipt-canonical-cache-red.log): exit 1, 4 failed / 2 passed. Repeated full canonicalization counted 2 instead of 1; trusted rebuild returned a different identity.

Green command: `node_modules/.bin/vitest run packages/compiler/test/receipt-canonical-cache.test.ts packages/compiler/test/authorization-snapshot-v3.test.ts`
[Actual redirected final green log](receipt-canonical-cache-green-final.log): exit 0, 58 passed (6 new and 52 existing). Includes changed-source and throwing-source-reader checks, canonical input rejection, mutable/caller-frozen untrusted inputs, and named-hash/counter parity.

Format: `node_modules/.bin/oxfmt --check packages/compiler/src/authorization-snapshot.ts packages/compiler/test/receipt-canonical-cache.test.ts`
[Format log](receipt-canonical-cache-format-final.log): exit 0. Only owned files formatted.

Typecheck: `node_modules/.bin/tsc -p tsconfig.tools.json --pretty false`
[Typecheck log](receipt-canonical-cache-typecheck-final.log): exit 1 solely because concurrent main-owned check-receipt.ts:989 accesses .size on a stat type that omits it. Sidecar type errors fixed; this is not a clean full-workspace typecheck claim.

## Safety and limits

WeakMap holds canonical strings only under private-WeakSet-trusted deeply frozen receipt keys. No strong receipt map, arbitrary-object cache or source-byte cache. Successful canonical parsing primes the same cache through canonicalIntlCheckReceiptV3Bytes. buildIntlCheckReceiptV3 retains trusted identity to enable reuse across persisted binding; relationship validation with fresh options/source reader and derived-counter comparison still executes on every trusted rebuild. Untrusted inputs keep full structure/hash/relationship validation. Fresh JSON parses never reuse trust by bytes or string identity. Named hashes and serialized receipt counters remain byte-equivalent to full untrusted rebuild. Work metrics can report less work rather than fabricate skipped hash computations.

Cache retains one canonical string while its receipt is alive, and only helps same-object reuse. Full relationship validation and initial parse/hash work remain; no wall-time claim or broad dedup implementation. Independent read-only post-edit reviewer found no cache-safety issue; its missing RuntimeAbi import finding was fixed, and requested source-reader EACCES coverage was added and passed.

Prior catalog proof: [red/green transcript](catalog-regression-red-green.log), explicitly transcribed from captured tool outputs after the original run (not retroactively represented as redirected raw logs).
