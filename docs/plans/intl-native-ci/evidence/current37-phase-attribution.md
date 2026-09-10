# CI37 current operation attribution — diagnostic complete

All six operations succeeded once: full five-catalog check, authority export and fresh-process standalone verify, Node then Rust. Each operation retained its 180-second bound; no retries, runtime edits, remote changes or deadline relaxation occurred. This is instrumented work attribution, **not a speed benchmark**.

Both isolated workspaces began with identical 7,721 archived authored/generated input identities and exact CI37 packs. Both producers authorized all five catalogs with **899** semantic files; export contained five catalogs; verify reported five receipts, zero semantic analysis, zero compilation and zero emission.

| Engine | Operation | Result | CPU profiles | Observed JS reads | Observed hash constructors | Observed process CPU (s) | Largest process RSS (MiB) |
|---|---|---|---:|---:|---:|---:|---:|
| node | check | pass | 15 | 31,496 | 174,009 | 105.20 | 2519.3 |
| node | export | pass | 1 | 25,872 | 45,274 | 12.79 | 770.1 |
| node | verify | pass | 1 | 22,018 | 37,880 | 11.20 | 809.8 |
| rust | check | pass | 15 | 31,502 | 174,039 | 106.36 | 2595.8 |
| rust | export | pass | 1 | 25,873 | 45,279 | 11.87 | 1035.0 |
| rust | verify | pass | 1 | 22,019 | 37,885 | 10.60 | 1171.4 |

Counts omit worker/native paths; CPU includes instrumentation and is aggregated once per recorded PID. RSS is an individual-process high-water statistic, **not** simultaneous tree memory. Do not use differences in this table to rank engine speed.

## Available phase spans

The four enabled profile families captured all five producer authorization, analysis and classifier records plus V3 details. The semantic-owner span was the largest analysis component for each catalog; it combines setup, provider work, TS Program/checker execution and worker coordination. The JSON retains every measured span by catalog without flattening nested stages.

| Engine | Catalog | Semantic files | Lexical files | Classifier span (ms) | Semantic-owner span (ms) | Combined publication spans (ms) |
|---|---|---:|---:|---:|---:|---:|
| node | packages/i18n | 288 | 2570 | 1483.3 | 4195.8 | 974.0 |
| node | apps/admin | 325 | 1244 | 1220.6 | 5817.4 | 863.2 |
| node | apps/auth | 9 | 117 | 112.7 | 577.1 | 368.4 |
| node | apps/instructor | 135 | 538 | 462.7 | 5895.7 | 804.8 |
| node | apps/learner | 142 | 650 | 589.5 | 5627.8 | 796.0 |
| rust | packages/i18n | 288 | 2570 | 1662.7 | 4492.1 | 1165.2 |
| rust | apps/admin | 325 | 1244 | 1475.4 | 6262.7 | 910.4 |
| rust | apps/auth | 9 | 117 | 102.4 | 540.6 | 295.2 |
| rust | apps/instructor | 135 | 538 | 481.3 | 6617.9 | 941.7 |
| rust | apps/learner | 142 | 650 | 586.3 | 6320.8 | 978.7 |

The Program hook counted one Auth constructor per engine. CPU profiles observed Program work in ten contexts per producer, including nine semantic worker contexts missing from hook records. Consequently neither zero Programs nor an exact all-context Program count is supported.

## Earlier publication failure

The retained historical JSON confirms the 20-second **internal publication** failure. Standalone Auth exited 1 after 88.242 seconds without hitting its 180-second outer timeout. Current operations succeeded with the internal deadline unchanged. Historical and current packages declare the same source tree but have different tarball/native-manifest hashes and different lockfiles; execution conditions were uncontrolled. Current success therefore does not establish why the earlier attempt failed, and host load is not a proven cause.

## Exact remaining gaps

- No exclusive cross-phase accounting: built-in wall spans nest and child/worker contexts overlap. CPU sampler stack time is sampling attribution, not exact CPU or invocation counts.
- Program factory hook counts one Auth createProgram per engine. Nine semantic-worker contexts are absent from operation-hook records; CPU samples show ten Program execution contexts per producer. Exact total calls, separate Program setup/checker/type-query time and worker read/hash counts are unavailable.
- Only authorization, analyze, classifier and V3 built-in flags were enabled. Optional transform/fusion profiles were not enabled; the one-attempt constraint precludes a new run to obtain those finer spans.
- JS read/hash hooks observe readFile/readFileSync and createHash/update in instrumented main threads, including bootstrap/module loading. They miss uninstrumented workers, FileHandle/streams/other APIs and Rust-internal I/O/hashes. Counts are partial operation-level observations, not totals or per-phase counts.
- Publication-precommit-verification combines work since the previous mark, including preparation/staging and live verification. selector-commit includes remaining frontier and final selector work. There is no separate staging/live-fingerprint/frontier duration, exact deadline-arm timestamp or remaining-slack event; historical failure had no emitted success-only authorization span.
- Process-tree ps polling and time(1) preflight were unavailable in this sandbox. Own CPU is summed once per recorded PID (including its threads); maxRSS is the largest individual process high-water, not simultaneous tree memory. Native Rust stack detail and per-phase memory are absent.
- No current failure path was exercised because all six operations succeeded. Historical failure JSON/command records are preserved; existing success-only spans cannot retroactively attribute that failure. Partial snapshots would retain coarse evidence on a current failure.
- Single sequential instrumented runs with uncleared caches and uncontrolled host conditions are not a speed benchmark or causal load experiment.

## Evidence and privacy

Private raw evidence and runnable diagnostic tooling: `/private/tmp/intl-current37-attribution-x_ywnomv`. It contains raw stderr per process, all CPU profiles, read paths, receipt counters, exported authority archives, command/failed-path output, historical failure records, baseline/identity checks and digests. Only this safe report and aggregate JSON are in R.

The completed shared-final37 proof was checked against every sealed file digest and remains unchanged. R/T runtime, active fixtures, planning documents and remote refs were not modified. No additional runtime work is proposed or scheduled.

## Durable private package

The private Turbo evidence ZIP `docs/plans/intl-native-ci/evidence/current37-phase-attribution.zip` contains 156 verified members, including all **34 CPU profiles**, exact diagnostic scripts/logs, original command records and identity metadata. Compressed size: **12,969,668 bytes**, below the guarded 100,000,000-byte limit.

SHA256: `7a340a11f6de88ae3abdea9077512b45b84c025df97e37bc2d01940fdc18a7a4`. The adjacent safe JSON contains the complete ZIP member manifest and reproduction metadata; the ZIP includes `MANIFEST.json` and `REPRODUCTION.json`. Workspace/dependency source trees, raw source archive, packed binaries, exported authority tar files and runtime reference source bodies are omitted; original hashes remain recorded privately. The package is stored only in T. R and T receive identical safe summaries.

Packaging performed no diagnostic, runtime or benchmark reruns. Existing one-attempt results and limitations are unchanged.
