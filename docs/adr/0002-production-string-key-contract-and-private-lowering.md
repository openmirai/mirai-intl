# ADR 0002: Production named-key contract and private lowering

- Status: Accepted for scoped implementation
- Date: 2026-07-15
- Supersedes: the archived validation implementation's application import form and migration API
- Scope: `fe-openmirai-landing`, `fe-mirai-internal-dashboard`
- Prerelease authorized: **No, pending production gates**

## Context

Archived validation work established AST parsing, exact runtime validation,
compact descriptors, and tree-shaking with direct generated imports. That
initial import form had unacceptable application ergonomics: it leaked mangled
compiler symbols, required page-specific strict wrappers, and left the ordinary
`useTranslations(namespace)` surface unmigrated.

The production design must keep i18next responsible for resource loading,
locale and fallback resolution, readiness, and language-change reactivity. It
must also reject missing, extra, inherited, accessor-backed, or unsafe values
without a hand-maintained schema for ordinary rendered messages.

## Decision

Application source uses a generated-contract-bound named-key API:

```ts
const { t } = useTranslations("pages.{-$locale}.short-links");
t("title");
t("page.resultsCount", { count: 2 });
```

Message syntax is the source of truth for required argument names, scalar,
plural, select, formatter, and rich-tag roles. Only structured `value()`
messages and genuinely non-inferable formatter representation choices may use
the small optional exception section in `package.json`.

The generated public facade exposes the type-only `CatalogContract` and the
minimal provider metadata/resources required by the shared app binding. It does
not expose `catalogTree`, `mNNN`/`rNNN`, semantic mangled aliases, or a public
descriptor registry. Compact descriptors remain private inside the selected
content-addressed build.

The compiler adapters lower eligible literal, finite-union, and generated
branded client/server keys to direct private descriptor imports before
Vite/React or Next/Turbopack compilation. Widened strings and unknown values are
build errors. Explicit boundary input must first cross the generated
`parseTranslationKey(namespace, input)` validator and its namespace-bounded
registry; only the returned branded key may reach `t`. This may retain that
namespace chunk but may not pull a full catalog registry into an initial route.

Convention discovery derives the locale root, locale set, source locale,
framework, package/catalog identity, output directory, exclusions, and
semantic paths from standard repository layout and `package.json`. Ambiguity
fails with a targeted diagnostic rather than creating mandatory config.

Scoped application catalogs use portable per-message IR with the validated
i18next `TFunction` bridge for text, so the existing instances remain the
loading/fallback authority. Rich rendering uses the same validated per-message
IR and exact generated component contract after confirming the i18next resource
is available. This replaces the temporary regex renderer while keeping descriptors
private and tree-shakeable.

## Publication and atomicity

Generation is an exclusive `predev`, `prebuild`, or CI operation. Publishers
are serialized, generate and validate in a sibling staging directory, install a
content-addressed build, atomically replace the selector, and then prune every
non-selected build. At rest, exactly one selected build exists.

The Vite and Next adapters generate only before a dev server starts or before a
compilation begins. They never publish from an active locale hot-update path.
Changing, adding, or removing a locale file while Vite is running emits a
targeted restart diagnostic; the developer restarts Vite so publication
finishes before any new module reader is created. Running the CLI or any other
publisher against an application with an active dev/build reader is
unsupported.

This contract is crash/concurrent-writer safe; it does not claim lock-free
atomicity for a module reader paused across selector replacement and pruning.
Applications must not run generation concurrently with an active build/dev
module reader. Publication locks require stale-owner recovery and must be
created only after output-root confinement is validated.

Next loader dependencies include the selector, the selected contract and
provenance, and only the private message modules referenced by the transformed
source. A warm compiler can therefore observe a prepared selector change and
lower against the new build. Such rotation is reader-safe only in a coordinated
environment that retains the old selected build until every old reader has
finished; the default exactly-one-build publisher does not provide concurrent
reader retention, so its supported path remains restart before generation.

## Acceptance gates

The prerelease remains blocked until:

1. actual transformed Vite and Next fixtures prove inclusion of referenced
   renderers and exclusion of unrelated sentinels;
2. Landing and Dashboard use one generic shared client hook, with one separate
   request-scoped Landing server binding;
3. all eligible calls are lowered and explicit dynamic paths are bounded;
4. one generation path and exactly one selected catalog remain per app;
5. combined resources, generated translation trees, temporary hooks/flags/tests,
   direct descriptor imports, public mangled exports, and ordinary manual
   schemas are removed after replacement coverage is green;
6. parity, locale/fallback/reactivity, strict hostile-input, SSR isolation,
   restart-only locale-edit diagnostics, lint, typecheck, tests, production
   builds, and bundle gates pass; and
7. GitHub Packages authentication succeeds externally without project-level
   token interpolation.

## Consequences

The compiler owns a small framework transform surface, source maps, and clear
diagnostics for syntax it cannot safely lower. Dynamic translation code has an
explicit, measurable chunk cost. Application code remains conventional and no
longer imports compiler-generated names. Historical validation and
representation evidence remains under `docs/phase0/archive/`; it is not an
active release gate or production approval.
