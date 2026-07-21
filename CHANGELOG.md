## 0.1.0-beta.11

### Added
- Runtime soft-fail for recoverable missing resources when `strictValidation` is false (production): optional `missingMessageFallback`, `INTL_MISSING_RESOURCE`, never returns dotted key paths. Brand/kind/unlowered markers still fail closed.
- `mirai-intl check` scans sources for high-confidence hardcoded JSX/user-facing props and Zod validation message literals (`mirai-intl-allow-literal` escape hatch).

## 0.1.0-beta.10

### Added
- `requiredLocales` in `mirai-intl.config.json` to fail closed when discovered locales are not exactly the declared set (OpenMirai: `en` + `th`).

# [0.1.0-beta.9](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.8...v0.1.0-beta.9) (2026-07-20)

### Bug Fixes

* detect translator escapes through object shorthand (`factory({ t })`) via shorthand value symbols
* fail source analysis when `t(...)` / `t.rich(...)` uses a `Translator`-typed prop
* treat `t("…")` call sites as transform candidates even without a local factory import

# Changelog

# [0.1.0-beta.8](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.7...v0.1.0-beta.8) (2026-07-20)


### Features

* **compiler:** full-tree source analysis in \`mirai-intl check\` for early build failures
* **runtime:** skip exact value/hash validation in production (\`strictValidation\` / \`NODE_ENV\`)

# [0.1.0-beta.7](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.6...v0.1.0-beta.7) (2026-07-20)

# [0.1.0-beta.6](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.5...v0.1.0-beta.6) (2026-07-20)


### Bug Fixes

* **abi:** make descriptor types structurally compatible across duplicate package installs ([cross-install](https://github.com/openmirai/mirai-intl))
* **runtime:** detect catalog message paths via string `brand`/`kind` instead of install-local unique symbols

# [0.1.0-beta.5](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.4...v0.1.0-beta.5) (2026-07-20)


### Performance Improvements

* **runtime:** cache validated descriptors to eliminate per-call inspection overhead ([e5fd68d](https://github.com/openmirai/mirai-intl/commit/e5fd68de05c430e123550ffa72001624200910a4))

# [0.1.0-beta.4](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.3...v0.1.0-beta.4) (2026-07-19)


### Features

* infer structured value catalogs ([da35150](https://github.com/openmirai/mirai-intl/commit/da3515079c8b7494e056515f890553b9811f6e8b))

# [0.1.0-beta.3](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.2...v0.1.0-beta.3) (2026-07-19)


### Bug Fixes

* harden generated catalog tooling ([dd77306](https://github.com/openmirai/mirai-intl/commit/dd77306473328a914d87c7ecdff6d2925f5e8505))

# [0.1.0-beta.2](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.1...v0.1.0-beta.2) (2026-07-19)


### Bug Fixes

* stage content-addressed fixtures during release ([2c6326d](https://github.com/openmirai/mirai-intl/commit/2c6326d3cfe4d9fa878afe655a7c67c82e77850f))
* support composed workspace catalogs ([4612bbd](https://github.com/openmirai/mirai-intl/commit/4612bbd1aa7d5d3ca685295e00016b5123fe3fe4))

# [0.1.0-beta.1](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.0...v0.1.0-beta.1) (2026-07-16)


### Bug Fixes

* regenerate fixtures after release version bumps ([0ed0278](https://github.com/openmirai/mirai-intl/commit/0ed027800237abdc8e3bf1167d5a5f57293bbd3a))


### Features

* finalize convention-first catalog slicing ([5762931](https://github.com/openmirai/mirai-intl/commit/576293173a16a63ef7308ee04e5b2dcfae71a0d0))

# 0.1.0-beta.0 (2026-07-16)


### Bug Fixes

* configure beta prerelease command ([a25868c](https://github.com/openmirai/mirai-intl/commit/a25868cba62d968fa432db71ecec8fe8fdb0ce35))


### Features

* add convention-first type-safe intl packages ([650a2d5](https://github.com/openmirai/mirai-intl/commit/650a2d5b83cfd1176ecaaeb841275cfd5bfe3362))

All notable changes to the OpenMirai internationalization packages are documented in this file.
