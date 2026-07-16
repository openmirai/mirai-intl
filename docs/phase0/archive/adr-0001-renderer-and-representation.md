# ADR 0001: Phase 0 renderer and descriptor representation

- Status: Accepted historical Phase 0 evidence; application API superseded by
  ADR 0002
- Date: 2026-07-15
- Runtime ABI: `1.0.0`
- Catalog format: `1`
- Migration authorized: **No**

## Context

OpenMirai needs one compiler-first internationalization contract across browser,
SSR, React, pure Node, and E2E consumers. The public API must use generated
descriptors, validate every strict call, preserve upstream locale lifecycle
behavior, and remove the current source-crawling and regex-rendering divergence.

Phase 0 compared:

- a private validated i18next `TFunction` bridge;
- compiler-emitted precompiled renderers;
- explicit descriptor constants;
- a lazy proxy/table; and
- callable precompiled descriptors.

The evidence is recorded in:

- `docs/phase0/archive/phase0-results.json`;
- `.tmp/benchmarks/phase0-benchmarks.json`;
- `docs/phase0/archive/inventory.json`;
- `docs/phase0/archive/compatibility.json`; and
- `.tmp/pack-smoke/results.json`.

The reference host was an Apple M4 Pro with 14 logical cores and 48 GiB RAM,
running macOS 25.5.0, Node 24.18.0, pnpm 11.11.0, and V8
13.6.233.17-node.50.

## Decision

Select:

- renderer: `precompiled-v1`;
- descriptor representation: `precompiled`;
- application import form: named message exports;
- artifact portability: `backend-specific`; and
- runtime ABI/catalog format: `1.0.0`/`1`.

Keep i18next as the upstream lifecycle/resource integration boundary. Strict
calls render through compiler-emitted functions and do not expose string keys,
arbitrary i18next options, caller-selected return types, or assertion escape
hatches.

A catalog declaring `precompiled-v1` must be called with a descriptor carrying
its compiler-emitted renderer. The runtime rejects a missing renderer instead
of falling back to normalized IR. Portable-IR constants and proxy descriptors
remain comparison fixtures only.

The decision does **not** authorize application migration, production catalog
publication, or a legacy API ban. Those actions remain blocked until a full
shadow-catalog gate passes.

## Why precompiled wins

The precompiled backend passed the full text, structured value, rich component,
escaping, formatting, SSR, React reactivity, strict failure, hostile-input, and
package-install corpus. The bridge passed supported text/value cases but cannot
produce trusted rich-component structure and fails with
`INTL_RENDERER_FAILURE` for that required operation.

Only the precompiled representation still rendered `Good morning, Mali` after
the normalized locale payloads were removed. Constants and proxy both failed
that proof because they contain descriptors, not emitted message functions.
Their smaller bundles therefore do not make them eligible for a
backend-specific precompiled catalog.

Each selected runtime-message export carries the same non-enumerable emitted
renderer as its descriptor. This lets validated dynamic calls render from a
sparse named-export catalog without restoring normalized locale payload IR or
changing canonical catalog identity.

All three candidates removed the deterministic 9,216-byte unused-namespace
sentinel in real Vite 7.3.6 and Next 16.2.9 Turbopack production builds.

| Named-export candidate | Vite gzip delta | Next gzip delta | Backend-specific precompiled |
| --- | ---: | ---: | --- |
| constants | 8,682 B | 8,474 B | No |
| proxy | 8,682 B | 8,474 B | No |
| precompiled | 8,894 B | 8,666 B | Yes |

The selected descriptor module is 21,243 raw bytes and 3,048 gzip bytes for the
Phase 0 corpus. All four split artifacts total 38,619 raw bytes and 6,264 gzip
bytes.

## Measured runtime evidence

The final exact-Node benchmark recorded:

- precompiled strict call p95: 8.167 microseconds hot and 18.709 microseconds
  cold;
- bridge strict call p95: 13.913 microseconds hot and 23.750 microseconds cold;
- five-field validation p95: 5.512 microseconds;
- precompiled named-export access plus strict render p95: 3.920 microseconds;
- precompiled runtime construction p95: 0.375 microseconds;
- precompiled descriptor module first import: 4.062 milliseconds;
- precompiled descriptor module reevaluation p95: 0.632 milliseconds; and
- 50,000 named-export calls with explicit GC: +5,344 retained heap bytes and
  +1,490,944 RSS bytes.

Memory deltas are noisy even with explicit GC and are not used to choose between
semantically different candidates. Negative retained-heap measurements are
reported as noise, not converted into percentage advantages.

## Release and migration budgets

The following absolute gates replace the unstable preliminary relative-cost
percentage:

| Gate | Budget |
| --- | ---: |
| Five-field validator p95 | at most 25 microseconds |
| Representative strict-call hot p95 | at most 25 microseconds |
| Representative strict-call cold p95 | at most 50 microseconds |
| Named-export client gzip delta per entry | at most 10 KiB |
| Fresh generated-module import | at most 10 milliseconds |
| Generated-module reevaluation p95 | at most 2 milliseconds |
| Runtime construction p95 | at most 10 microseconds |
| Retained heap after 50,000 calls with explicit GC | at most 1 MiB |
| RSS delta after 50,000 calls with explicit GC | at most 4 MiB |
| Ordinary watch event to atomic artifact p95 | at most 1,000 milliseconds |
| Final save-storm event to atomic artifact p95 | at most 2,000 milliseconds |
| Rolling deployment convergence | 2-second polling, at most 120 seconds |

The measured validation cost was 67.491% of the very small precompiled
end-to-end measurement and failed the preliminary 20% relative target. That
ratio is retained in `docs/phase0/archive/phase0-results.json`, but it is not a
release gate:
minor host noise can move its small denominator materially. The absolute
validator and complete-call budgets bound the actual user-visible cost.

The 7,838,318-byte brownfield declaration baseline and the 6,781-byte synthetic
Phase 0 fixture remain incomparable catalog populations. The later
same-catalog shadow harness therefore regenerates each legacy and strict
catalog from the same source worktree and requires:

- emit at most 50% of the corresponding legacy declaration bytes;
- keep cold TypeScript check time and peak memory within 15% of the
  corresponding same-catalog brownfield baseline; and
- pass exact TypeScript 5.9.3, 6.0.3, and 7.0.2 positive and negative fixtures.

The authorized Landing and Internal Dashboard shadows now pass all four gates
under Node 24.18.0 and pnpm 11.11.0:

| Application | Strict / legacy declaration | TypeScript wall ratio | TypeScript memory ratio | Reachable gzip delta | Exact parity |
| --- | ---: | ---: | ---: | ---: | ---: |
| Landing | 115,163 / 580,148 B (19.85%) | 0.939 | 1.079 | +9,043 B | 2,226 / 2,226 |
| Internal Dashboard | 32,716 / 69,221 B (47.26%) | 0.924 | 0.771 | +9,097 B | 643 / 643 |

Both unused-message sentinels are absent, both parity mismatch counts are zero,
and each full generated declaration also typechecks with `skipLibCheck: false`
under its application compiler. This establishes
`authorizedApplicationsShadowReady: true`; it does not establish the global
every-catalog gate. Turbo is intentionally outside the authorized app scope,
so `everyCatalogGateReady` remains `false`. The worktree reports are
non-authoritative, and `migrationAuthorized` remains `false`.

## Compatibility

Compatibility is an exact tuple policy, not a broad semver cross-product.

Qualified Phase 0 rows:

- canonical framework fixture: i18next 26.3.6, i18next-icu 2.4.4,
  intl-messageformat 11.2.11, React/React DOM 19.2.7, react-i18next 17.0.9,
  parser 3.5.14, and TypeScript 5.9.3/6.0.3/7.0.2;
- pure Node precompiled fixture: Node 24.18.0 with a Node 26.5.0 forward probe
  and no i18next or React peer requirement.

Current application release rows remain unsupported until aligned or
independently qualified:

- Turbo: i18next 26.3.4, i18next-icu 2.4.4,
  intl-messageformat 11.2.7, Next 16.2.6, React 19.2.6,
  react-i18next 17.0.8, TypeScript 6.0.3;
- Landing: i18next 26.3.6, i18next-icu 2.4.4,
  intl-messageformat 11.2.9, Next 16.2.9, React 19.2.7,
  react-i18next 17.0.9, TypeScript 5.9.3; and
- Internal Dashboard: i18next 26.3.6, i18next-icu 2.4.4,
  intl-messageformat 11.1.2, React/React DOM 19.2.7,
  react-i18next 17.0.9, TypeScript 7.0.2, and Vite 8.1.4.

Those application tuples have passed compiler/artifact shadow gates. Landing
and Internal Dashboard now use convention-discovered catalogs, AST-generated
contracts, semantic descriptor exports, and one generic i18next-reactive
runtime for the accepted leaf. This local, non-authoritative implementation
evidence does not qualify the complete renderer tuple or change unsupported
release/global status until a later migration decision.

TypeScript 7.0.2 compiler fixtures pass. Its package does not expose the
tsserver binary used by the editor proxy, so TS 7 editor-proxy evidence is
explicitly unavailable rather than inferred from TS 5.9/6 results.

## Artifact identity and transitions

The selected artifact is not `portable-ir-v1`. A renderer or
`rendererCapabilityId` change requires:

1. regeneration from canonical IR;
2. a new immutable catalog package;
3. application rebuild and redeployment; and
4. exact E2E package repinning and integrity verification.

An old backend-specific tarball cannot be relabeled. ABI, catalog hash, build
token, capability-set hash, formatter versions, descriptor identity, and kind
are validated before rendering and on every strict call.

Application generation publishes complete content-addressed directories before
atomically replacing one authoritative `index.ts` selector containing both the
semantic re-exports and machine-readable content identity. `current.json` is
tooling metadata, not a second runtime selector. Prior complete directories are
retained for live development processes and rollback evidence.

The isolated package proof created four tarballs, installed them without
sibling source paths, typechecked the consumer under NodeNext with
`skipLibCheck: false`, and rendered `Good morning, Mali`. The synthetic
catalog identity is:

- package: `@mirai/intl-catalog-phase0@0.1.0-phase0.8c76de70bc25`;
- catalog hash:
  `sha256:8c76de70bc253ebae9bae9578d83b2f63ca44a5fa2ea59b651cae419ef2e4f73`;
- renderer capability: `precompiled-v1`.

## Composition and overlap policy

Library fragment composition has no implicit scan and no last-write-wins
behavior. Application convention discovery permits exactly one `locales` or
`src/locales` root and requires paired locale files at every leaf. Unsafe,
empty, non-NFC, dotted, control/separator, and prototype-sensitive path or mount
segments fail. Every formatter ID must have an exact own entry in
`formatterVersions`.

The learner/shared audit accounts for all 39 current overlapping leaves:

- 23 identical leaves: deduplicate to the shared owner after EN/TH equality is
  proven at the pinned commits;
- 7 differing leaves: keep the current shared built output authoritative until
  product intent is confirmed; and
- 9 learner-only leaves hidden by branch replacement: restore through an
  explicit learner mount without changing wording or call sites.

Any future intentional wording override must name one exact key and the exact
base fragment ID, version, and hash, plus reason, owner, source, and ADR
provenance. Prefix, namespace, glob, schema-changing, and stale-hash
replacements fail.

The inventory preserves the initial audit counts of 15 EN/TH formatter-role
mismatches, 8 Landing ICU parse failures, and 161 invalid Thai named `one`
branches. The Landing shadow source defects and six Internal Dashboard Thai
role mismatches were repaired explicitly with regression coverage. Both current
authorized shadow catalogs report zero diagnostics; the compiler still does
not normalize invalid source silently.

## Tooling and dependency policy

- TypeScript configs extend exact `@tsconfig/node24@24.0.4`; the reference
  Node and CI version is 24.18.0 and `@types/node` is exact 24.13.3.
- TypeScript source imports remain extensionless. Generated distribution
  declarations may contain NodeNext-required `.js` chunk specifiers.
- Oxc and Oxfmt policy mirrors the applicable sibling repositories, excluding
  app-only React/Next rules.
- Exact `tsdown@0.22.7` replaces the custom build script.
- Exact `@formatjs/icu-messageformat-parser@3.5.14` remains a direct compiler
  dependency.
- `rimraf` remains the cross-platform clean command.
- `date-fns` is not added: the runtime performs no calendar arithmetic and
  uses `Intl.DateTimeFormat` for ICU-compatible formatting.
- `chalk` is not added: diagnostics and CLI evidence are stable plain/JSON
  output, not terminal decoration.
- No subprocess wrapper is added in Phase 0. The callers require distinct
  synchronous/asynchronous, bounded-output, timeout, signal, and
  nonzero-as-data contracts. `tinyexec` and `nano-spawn` do not preserve all
  of them; `execa` does but is disproportionate for dev-only evidence scripts.
  Revisit `execa` if the Phase 1 supervisor materially expands this surface.
- The unused direct Rollup pin was removed; Vite owns its bundler dependency.
- PostCSS is overridden to exact 8.5.10. Production and full dependency audits
  report no known vulnerabilities.

## Consequences

The compiler/runtime now owns message parsing, AST-inferred exact contracts,
deterministic canonical IR, emitted renderer parity, rich-tag safety, and
capability transitions. Plain interpolation intentionally widens 117 existing
string-only declarations to the safe `string | number` scalar (85 Landing, 32
Dashboard); source/render parity, hostile-value validation, and the recorded
inference counts gate that change. Strict consumers get one framework-free ABI,
genuine tree shaking, synchronous sanitized failures, immutable release
identity, and an exact E2E contract.

The bridge remains useful as a parity oracle for supported upstream behavior,
not as the selected strict renderer. Constants and proxy remain bounded
comparison fixtures, not production representations.

The authorized application catalogs close discovery, inference, declaration,
typecheck, synthetic bundle, and exact-parity gates for Landing and Internal
Dashboard only. Their accepted leaves use generic local runtimes without temporary
flags, manual export maps, or ordinary message schemas. Publication, Turbo
coverage, the global every-catalog gate, and the legacy API ban remain outside
this decision. This non-authoritative implementation evidence does not change
the ADR's migration decision. No broader consumer may migrate until the
remaining gates pass and a later decision changes `migrationAuthorized` from
`false`.
