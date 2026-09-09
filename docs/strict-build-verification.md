# Strict read-only build verification

V3 build verification does not compile catalogs, emit artifacts or construct a
TypeScript semantic program. It freshly loads generation inputs and validates
the existing receipt-bound output through the committed-artifact verifier.
The producer still performs fresh source authorization through `check`/`prove`.
Build verification never regenerates, repairs or falls back to old authority.

`mirai-intl verify --workspace` independently discovers every catalog. The public
`verifyWorkspaceBuildReceipts(root)` API performs the same bounded workspace
verification and rejects the whole operation if any catalog fails. Its immutable
toolchain reads are shared only within that call, then freshly rechecked before
success. No workspace session or trusted proof survives into the next call.

Source/config/provider/classifier bytes, project/source universes, generated
inventory, pointers and payloads are checked again at the final barrier. The
workspace catalog inventory is independently rediscovered. Failures remain
catalog-addressed in CLI JSON, including failures observed at the final barrier.

## Supported filesystem contract

Verification runs against a **quiescent CI checkout**: do not concurrently edit
sources, install dependencies, regenerate catalogs or run another publisher.
The final checks detect observed drift; they are not an atomic filesystem
snapshot or a lock against arbitrary external writers. Another finite reread
cannot provide that guarantee. If concurrent editing is required, give each
build its own immutable checkout/snapshot before invoking verification.

## Work counters

Successful V3 results report `catalogCompilations: 0`, `artifactEmissions: 0`,
`buildSemanticAnalysisRuns: 0` and `verifiedCatalogs: 1`. Workspace JSON sums
these counters across all successfully verified catalogs and fails on any
catalog error. Legacy V2 retains its exhaustive compile/emit path and reports
one compilation and emission per verified catalog instead of claiming zero.

## Reproducible evidence

Build both revisions with the same `.nvmrc` Node LTS and frozen dependencies.
Use the transfer PR tip as the exhaustive-verifier reference. Run sequentially:

```sh
node --import tsx benchmarks/receipt-parity.ts --reference /path/to/reference --candidate /path/to/candidate --out /tmp/receipt-parity.json
node --import tsx benchmarks/receipt-verification.ts --reference /path/to/reference --candidate /path/to/candidate --out /tmp/receipt-verification.json
node --import tsx benchmarks/receipt-pipeline.ts --reference /path/to/reference --candidate /path/to/candidate --out /tmp/receipt-pipeline.json
```

The parity runner compares accepted/rejected outcomes, native CLI diagnostic
codes/locations and successful source/project coverage—not merely hardcoded
expectations. Failed verification grants no accepted source coverage.

The timing runners retain 20 raw observations per engine plus median/p95. The
verification runner separates fresh-process and warmed-process calls. The
pipeline runner measures generation, source authorization, export, clean import,
verification, total preparation, archive bytes and native process resource usage.
These are five-catalog synthetic measurements, **not a claim about complete
frontend build or CI duration**. No concurrent build or benchmark should run
against either measured worktree.

## Measured result — 2026-09-09

Node 24.18.0, Apple M4 Pro; 20 samples per engine, five catalogs with 1,000 keys,
two locales and one source file each. Reference `02f4093`, candidate compiler
`7eec6f9`. These observations measure synthetic work, not the Turbo application.

| Scope | Reference median / p95 | Candidate median / p95 |
| --- | --- | --- |
| Fresh-process workspace verification | 678.7 / 708.3 ms | 507.2 / 584.8 ms |
| Warm workspace verification | 510.4 / 543.8 ms | 402.7 / 1051.9 ms |
| Full Intl preparation | 5567.9 / 5643.7 ms | 5408.8 / 5500.4 ms |

Median verification was 25.3% lower cold and 21.1% lower warm. Full preparation
was 2.9% lower at the median. **Warm p95 regressed** in this run; this is not
evidence of improved tail latency. Keep the raw observations and measure the
real CI workload after adoption rather than extrapolating these percentages.

The candidate was marked dirty during timing because the parity runner was
being extended to compare diagnostic line/column (subsequently committed as
`97b6415`). No compiler/runtime source or built artifact changed during timing.
Parity was rerun at that clean commit: all 30 reference/candidate observations
matched acceptance, full diagnostic locations and accepted source coverage.

Raw evidence: [verification](benchmarks/2026-09-09-speed-final.json),
[preparation](benchmarks/2026-09-09-pipeline.json), and
[mutation parity](benchmarks/2026-09-09-parity.json).
