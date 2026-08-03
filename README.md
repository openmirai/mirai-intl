# Mirai Intl

[![CI](https://github.com/openmirai/mirai-intl/actions/workflows/ci.yml/badge.svg)](https://github.com/openmirai/mirai-intl/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Compiler-first, convention-based internationalization for OpenMirai. Mirai Intl
keeps ordinary namespace and named-key calls in application code while the
compiler infers contracts from ICU message syntax, validates the full source
tree, and lowers eligible calls to compact private descriptors.

```tsx
const { t } = useTranslations("pages.{-$locale}.short-links");

t("title");
t("page.resultsCount", { count: 2 });
```

The framework adapters transform application source. The i18next adapter owns
resource loading, browser/request controllers, and typed React hooks. Your app
still owns route or cookie locale policy and provider placement.

## Packages

Most applications need the two public consumer packages:

| Package | Use it for | Important exports |
| --- | --- | --- |
| `@openmirai/intl` | CLI, compiler, runtime, Next.js/Vite adapters, and public types | `.`, `./next`, `./vite`, `./runtime`, `./types`, `./server`, `./react`, `./react-i18next` |
| `@openmirai/intl-i18next` | Typed React/i18next provider, hooks, and browser/request controllers | `.` |

The lower-level packages are published for advanced integrations and are used
by the consumer packages:

- `@openmirai/intl-abi` — catalog, descriptor, diagnostic, and wire contracts.
- `@openmirai/intl-compiler` — compiler and framework implementation.
- `@openmirai/intl-runtime` — runtime validation and i18next primitives.

Normal application code should not pin the lower-level packages directly.

## Requirements

- Node.js **24** (CI uses `24.18.0`).
- pnpm **11**.
- Next.js or Vite for the corresponding source adapter.
- React for the React/i18next adapter.

The package manager is pinned in `package.json`; the repository's `.nvmrc`
contains the supported Node major version.

## Installation

The public packages are published to the npm registry under the `@openmirai`
organization. No registry configuration or token is required to install them:

```sh
pnpm add @openmirai/intl @openmirai/intl-i18next
```

The repository keeps the scope mapping in `.npmrc` so local and CI commands use
the same registry. Applications can omit that file and use npm's default public
registry, or keep the following explicit mapping:

```ini
@openmirai:registry=https://registry.npmjs.org
```

`@openmirai/intl-i18next` brings the compatible i18next and
react-i18next dependencies. React remains a peer dependency supplied by Next,
Vite, or the application. Install `i18next-icu` only when ICU formatting is
enabled:

```sh
pnpm add i18next-icu
```

## Quick start

### 1. Add conventional locale files

The compiler discovers `locales` or `src/locales` automatically:

```text
src/
  locales/
    global/
      en.json
      th.json
  i18n/
    generated/       # generated; do not edit
```

Each locale must have the same message shape. ICU placeholders become typed
arguments:

```json
{
  "welcome": "Welcome, {name}!",
  "items": "{count, plural, =0 {No items} one {# item} other {# items}}"
}
```

Nested namespaces, rich messages, structured `.value.json` resources, and
explicitly mounted dependency catalogs are supported. Use
`mirai-intl.config.json` or the `miraiIntl` key in `package.json` only when the
defaults are not enough. Do not use both configuration locations in one app.

### 2. Configure locale discovery (optional)

Most applications need no configuration. Add `mirai-intl.config.json` at the
application package root when you want to make the locale contract explicit:

```json
{
  "requiredLocales": ["en", "th"],
  "sourceLocale": "en"
}
```

`requiredLocales` makes the locale set fail closed. `sourceLocale` identifies
the source language; set it when the locale set does not include `en` or has
more than one possible source locale. If the application is in a pnpm
workspace, put the same two fields in `mirai-intl.workspace.json` beside
`pnpm-workspace.yaml` to share the defaults across packages. A package-level
configuration may widen the workspace locale set, but it cannot remove a
workspace-required locale.

Use the `miraiIntl` key in `package.json` instead of a separate file when that
fits the application better:

```json
{
  "miraiIntl": {
    "requiredLocales": ["en", "th"],
    "sourceLocale": "en"
  }
}
```

Advanced applications can also configure `sources` to mount locale files from
an installed dependency, `checkProjects` to name explicit TypeScript projects,
and `values` for structured value schemas. Keep `checkExceptions` limited to
reviewed, exact source exceptions; globs and inline suppressions are not
supported. The complete supported shape is validated by `mirai-intl check`.

### 3. Add lifecycle scripts

```json
{
  "scripts": {
    "predev": "mirai-intl ensure",
    "prebuild": "mirai-intl ensure",
    "intl:check": "mirai-intl check",
    "dev": "<your-framework> dev",
    "build": "<your-framework> build"
  }
}
```

`ensure` creates or refreshes the selected generated catalog. The adapters also
ensure the catalog at build boundaries, but explicit lifecycle scripts keep
development, standalone checks, and CI deterministic.

### 4. Configure the framework adapter

Use the [Next.js adapter](#nextjs-adapter) or [Vite adapter](#vite-adapter)
below. Both lower eligible named-key calls to the selected generated catalog.

### 5. Create the typed runtime

```tsx
import { createMiraiI18next } from "@openmirai/intl-i18next";

import {
  catalogManifest,
  isCatalogLocale,
  loadCatalogResource,
} from "./i18n/generated";

export const intl = createMiraiI18next({
  catalogManifest,
  isCatalogLocale,
  loadCatalogResource,
  defaultLocale: "en",
  icu: false,
});
```

Mount the provider at the application boundary:

```tsx
export function AppProviders({ children }: { children: React.ReactNode }) {
  return <intl.Provider initialLocale="en">{children}</intl.Provider>;
}
```

Use `intl.useTranslations("namespace")` inside that provider. For server
requests, create a request-scoped controller with
`intl.createRequestController(locale)`; do not share request controllers across
requests.

## Next.js adapter

Import `withMiraiIntl` from the public umbrella package and wrap the existing
Next configuration. The adapter adds the transform to Turbopack and Webpack
while preserving existing Webpack callbacks and rules.

`next.config.ts`:

```ts
import type { NextConfig } from "next";

import { withMiraiIntl } from "@openmirai/intl/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default withMiraiIntl(nextConfig);
```

The default root is `process.cwd()` and the generated directory is
`src/i18n/generated`. Override them for a nested monorepo app:

```ts
export default withMiraiIntl(nextConfig, {
  generatedDirectory: "src/i18n/generated",
  root: process.cwd(),
});
```

Keep `predev` and `prebuild` scripts even when using the adapter. They make
catalog generation explicit for Turbopack, standalone checks, and CI.

## Vite adapter

Add `miraiIntlVite()` to `vite.config.ts`. The plugin runs before normal source
transforms, loads generated private message slices, watches catalog roots, and
requires a restart after locale JSON changes.

`vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { miraiIntlVite } from "@openmirai/intl/vite";

export default defineConfig({
  plugins: [miraiIntlVite(), react()],
});
```

For an app whose Vite root is resolved elsewhere, pass the adapter options:

```ts
miraiIntlVite({
  generatedDirectory: "src/i18n/generated",
  root: process.cwd(),
});
```

When a locale file changes during `vite dev`, stop and restart Vite before
checking the new translation. The plugin intentionally does not rotate the
selected catalog underneath active module readers.

## CLI and catalog checks

The `mirai-intl` binary is included in `@openmirai/intl`:

```sh
pnpm exec mirai-intl ensure
pnpm exec mirai-intl generate
pnpm exec mirai-intl check
```

- `ensure` performs the normal idempotent lifecycle generation.
- `generate` performs a full generation and retains detailed diagnostics.
- `check` verifies catalog artifacts and authorizes the complete source tree.
  It catches unknown keys, widened dynamic strings, translator escapes, and
  high-confidence hardcoded user-facing text.
- `catalog-check` validates catalog artifacts without replacing full source
  authorization.
- `contract` prints the explicit compiler contract for tooling integrations.

Use `--format=json` or the compatible `--json` for a bounded machine-readable
summary. Use `--report-file` when a CI job needs an ANSI-free diagnostic report.
Normal JSON does not contain receipts, proofs, manifests, source inventories,
or translation values.

Generated output is atomic and content-addressed. Import only the stable facade
from `src/i18n/generated`; never import private generated modules or edit the
generated directory by hand.

Do not run another generator against an application while its dev server or
production build is active. Vite reports a restart-required diagnostic after a
locale edit so readers never observe a partially rotated catalog.

## Runtime behavior

`@openmirai/intl-i18next` exposes:

- `intl.Provider` for browser or request-scoped rendering.
- `intl.useTranslations` for typed React translations.
- `intl.getBrowserController()` for the singleton browser lifecycle.
- `intl.createRequestController()` for isolated server requests.

Development and test mode strictly validate missing, extra, inherited,
accessor-backed, nullish, non-scalar, and unsafe translation inputs. Production
recovery can render safe fallbacks for missing resources while emitting
`INTL_MISSING_RESOURCE`; it never returns dotted message paths as UI text.

## Building and verifying the repository

From a clean checkout:

```sh
nvm install
nvm use
corepack enable
corepack pnpm install --frozen-lockfile
```

Run the root scripts:

```sh
corepack pnpm build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:perf
corepack pnpm check:generated
corepack pnpm pack:smoke
corepack pnpm pack:browser-smoke
corepack pnpm diagnostic:smoke
corepack pnpm verify
```

`pnpm build` uses `tsdown` to emit ESM, declarations, and source maps into
`packages/*/dist`. `pnpm test` builds first through its `pretest` lifecycle.
`pnpm verify` is the complete local gate: formatting, lint, type checks,
fixtures, tests, performance tests, generated drift, benchmarks, packed
installation, browser recovery, and diagnostic smoke checks.

Use `pnpm clean` to remove build output, TypeScript build state, coverage, and
temporary files. Do not commit `dist` output.

## Continuous integration

GitHub Actions is configured in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).
Pull requests and pushes to `main` run the same repository check used locally:

```sh
corepack pnpm verify
```

The check installs with the frozen lockfile on Node `24.18.0` and pnpm
`11.11.0`. Run it before opening a pull request; it covers formatting, lint,
type checks, tests, generated-file drift, benchmarks, and package smoke tests.

## License

Mirai Intl is released under the [MIT License](LICENSE).
