# Mirai Intl

Compiler-first, convention-based internationalization for OpenMirai. Application
source keeps ordinary namespace and named-key calls while the compiler infers
contracts from ICU message syntax and lowers eligible calls to private compact
descriptors.

```tsx
const { t } = useTranslations("pages.{-$locale}.short-links");

t("title");
t("page.resultsCount", { count: 2 });
```

Landing and Internal Dashboard currently consume the sibling packages through
`link:` dependencies. Their lifecycle scripts run
`scripts/prepare-local-link.mjs` so missing local package artifacts are rebuilt
without publishing.

## Convention-first catalogs

From a standard Next or Vite application:

```sh
mirai-intl ensure
mirai-intl generate
mirai-intl check
```

The compiler derives the locale root, paired locales, source locale, framework,
package/catalog identity, generated output, and semantic paths. ICU ASTs infer
required arguments, safe scalar roles, finite plural/number roles, selects,
date/time/custom formatters, and rich tags across every locale.

`package.json.miraiIntl` is optional. It is limited to genuine exceptions:
custom formatter versions, structured `value()` result schemas, and a source
locale only when multiple non-English locales make the convention ambiguous.
Deployable apps may also mount translation sources from declared dependencies
when a standard app-local locale tree is not enough:

```json
{
  "miraiIntl": {
    "sources": [
      {
        "from": "@mirai/i18n",
        "path": "src",
        "mount": "components.ui"
      }
    ]
  }
}
```

The app-local `locales` or `src/locales` source remains implicit. Mounted
dependencies must be declared and installed through the app package context;
their paths are confined to the canonical dependency package root. Every
source must provide the app locale set, and exact/object-leaf collisions fail
instead of using source order as precedence. It does not duplicate ordinary
text/rich message contracts.

Generation is atomic and content-addressed. `src/i18n/generated` retains one
selected build plus a stable facade that publicly exposes only:

- `CatalogContract`
- `CatalogLocale`
- `catalogManifest`
- `createTranslationKey`
- `isCatalogLocale`
- `loadCatalogResource`
- `parseTranslationKey`

Each locale resource is emitted as a separate lazy module, so importing the
stable facade does not retain every locale payload in the initial bundle. All
private compiled messages share one pure `catalog.messages.gen.mjs` module per
selected build. Adapters import only the exact named exports selected by source
calls, so unused messages remain tree-shakeable without producing thousands of
files. Compact descriptor and renderer details never enter application source.
Vite and Next/Turbopack adapters lower finite named-key calls to exact
descriptors. Normal `t(...)` calls accept only catalog literals, finite literal
or template unions, and compiler-generated branded keys. Widened `string`,
`unknown`, and arbitrary runtime input are rejected by both the public type
contract and the compiler transform.

`createTranslationKey("schema.contact")("nameRequired")` produces a generated,
catalog-bound key for statically declared application configuration. The
compiler accepts only literal argument-free text messages imported directly
from the generated facade, lowers them to a dotted string, and fails closed if
the marker reaches an untransformed runtime.

Genuinely open boundaries such as Zod/TanStack error messages must first call
`parseTranslationKey("schema", input)`. The compiler lowers that parser to a
namespace-bounded registry of argument-free text messages. It returns a
branded named key or `undefined`; only a successful result may be passed to
`t(...)`. The translator itself never accepts the raw boundary string. Dynamic
namespaces, root-level runtime keys, extra arguments, rich messages, structured
values, and parameterized text remain rejected.

Catalog generation runs before Vite starts or before Next compiles. Locale
edits during an active Vite session emit a restart-required diagnostic rather
than publishing and pruning underneath live module readers. Do not run another
generator against an application while its dev server or production build is
active. Lifecycle scripts should call `mirai-intl ensure`; it regenerates a
missing or stale selected build and returns a concise unchanged result when the
catalog is current. `generate` retains the full diagnostic report for explicit
release/debug work.

## Runtime

`@openmirai/intl-runtime` supplies the generic client/server bindings and an
i18next bridge. i18next remains responsible for resource loading, fallback,
locale selection, readiness, and language-change events. The strict boundary
rejects missing, extra, inherited, accessor-backed, nullish, non-scalar, and
otherwise unsafe translation inputs before rendering.

## Packages

- `@openmirai/intl-abi`: framework-free catalog, schema, diagnostic, and wire contracts.
- `@openmirai/intl-compiler`: configless discovery, AST contract generation, private lowering, and atomic emission.
- `@openmirai/intl-runtime`: exact text/rich/value validation plus client and server bindings.

## Verification

```sh
nvm use
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

The verification chain covers formatting, lint, type checking, TypeScript
5.9/6/7 fixtures, runtime/compiler tests, production builds, generated drift,
benchmarks, packed-package installation, named-key lowering, and referenced
renderer inclusion/unrelated renderer exclusion.

The accepted renderer investigation is historical evidence under
`docs/phase0/archive/`; it is not an active migration or release gate.

## Prerelease publishing

The committed `.npmrc` only routes `@openmirai` to GitHub Packages. Credentials
stay in trusted user/CI state and are never interpolated into the project file.
Before releasing, verify that external authentication is available:

```sh
corepack pnpm whoami --registry https://npm.pkg.github.com
```

Release-it also performs this preflight and dry-runs all three package publishes
before creating the Git release. Actual package publishing runs only after the
release commit, tag, and push succeed. Its version-bump hook regenerates and
verifies the committed compiler fixture catalog so compiler-version metadata
cannot leave CI with a stale content-addressed build.

After this repository has an initial commit, an `origin` upstream, and a clean
working tree, the first beta prerelease command is:

```sh
corepack pnpm run release:prerelease
```

Starting from root version `0.0.0`, that targets `0.1.0-beta.0` and publishes
the public ABI, compiler, and runtime packages under the `beta` distribution
tag. The packages are linked to the public `openmirai/mirai-intl` repository so
GitHub Packages can inherit its public access permissions.
