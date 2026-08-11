# Changelog

## [0.3.14](https://github.com/openmirai/mirai-intl/compare/v0.3.13...v0.3.14) (2026-08-11)

## [0.3.12](https://github.com/openmirai/mirai-intl/compare/v0.3.11...v0.3.12) (2026-08-02)

### Bug Fixes

- **compiler:** resolve workspace-relative V3 receipt source evidence from the workspace root during persisted authority verification

## [0.3.9](https://github.com/openmirai/mirai-intl/compare/v0.3.8...v0.3.9) (2026-08-01)

### Performance Improvements

- **compiler:** defer redundant classifier byte rereads to the complete commit-last publication fingerprint
- **compiler:** scale the outer catalog pool to CPU and memory while avoiding closure-duplicating inner workers on saturated devices
- **compiler:** skip workspace source-weight scans when every catalog already has a device-qualified worker

## [0.3.8](https://github.com/openmirai/mirai-intl/compare/v0.3.7...v0.3.8) (2026-08-01)

### Performance Improvements

- **compiler:** scale strict workspace and semantic authorization across available CPU and memory without changing canonical authority
- **compiler:** parallelize classifier frontier validation, memoize immutable projections, and remove redundant final source and config reads

### Bug Fixes

- **compiler:** fail closed when a semantic worker exits without returning authority evidence

## [0.3.7](https://github.com/openmirai/mirai-intl/compare/v0.3.6...v0.3.7) (2026-08-01)

### Performance Improvements

- **compiler:** replace duplicate final catalog compilation and workspace reads with one uncached generation-input identity and committed payload-manifest audit

### Bug Fixes

- **compiler:** preserve missing-source and invalid UTF-8 diagnostics at classifier finalization

## [0.3.6](https://github.com/openmirai/mirai-intl/compare/v0.3.5...v0.3.6) (2026-08-01)

### Performance Improvements

- **compiler:** reuse sealed classifier scans, parent path identities, and normalized V3 references across one fail-closed authorization transaction
- **compiler:** bound workspace child filesystem pools while authorizing all five catalogs concurrently

## [0.3.5](https://github.com/openmirai/mirai-intl/compare/v0.3.4...v0.3.5) (2026-08-01)

### Bug Fixes

- **compiler:** reconstruct broad TypeScript include patterns without absorbing siblings of explicitly included external files

## [0.3.4](https://github.com/openmirai/mirai-intl/compare/v0.3.3...v0.3.4) (2026-08-01)

### Bug Fixes

- **compiler:** recreate completely absent content-addressed payloads after dependency or locale changes
- **compiler:** recover an empty pre-journal publication staging directory without weakening partial-state checks

## [0.3.3](https://github.com/openmirai/mirai-intl/compare/v0.3.2...v0.3.3) (2026-08-01)

### Features

- **compiler:** activate fail-closed V3 source authority and atomic workspace receipts

### Performance Improvements

- **compiler:** classify sources before semantic analysis and authorize workspace catalogs concurrently

### Bug Fixes

- **compiler:** verify exact content-addressed authority in build and packaged-consumer paths

## [0.3.2](https://github.com/openmirai/mirai-intl/compare/v0.3.1...v0.3.2) (2026-07-28)


### Bug Fixes

* **compiler:** qualify workspace build receipts ([b71075c](https://github.com/openmirai/mirai-intl/commit/b71075c024045ac146574f16d78244fac2d64e57))

## [0.3.1](https://github.com/openmirai/mirai-intl/compare/v0.3.0...v0.3.1) (2026-07-28)


### Bug Fixes

* **compiler:** support shared Vite workspace sources ([3859000](https://github.com/openmirai/mirai-intl/commit/385900003f20bb1951a3a0e6e79a96fc0c314c76))

# [0.3.0](https://github.com/openmirai/mirai-intl/compare/v0.2.0...v0.3.0) (2026-07-28)


### Bug Fixes

* **abi:** expose v2 authorization manifests ([6dfe383](https://github.com/openmirai/mirai-intl/commit/6dfe383e00979b17eaaa0f4496f4e6adf4776b2f))
* **compiler:** analyze mounted owner sources ([68e82d3](https://github.com/openmirai/mirai-intl/commit/68e82d3ded0734a31b71552420bf6c0bde497bf7))
* **compiler:** bind provider resolution authority ([ee75f1b](https://github.com/openmirai/mirai-intl/commit/ee75f1b8ded917419d58fb16203bb56e504a09f8))
* **compiler:** bind provider resolution frontier ([bf72097](https://github.com/openmirai/mirai-intl/commit/bf72097d3a346bf5bd31f3d5c15c1063647a625d))
* **compiler:** bind transitive package bytes ([efab354](https://github.com/openmirai/mirai-intl/commit/efab354b892e1cb1c6484778441f6a6930342053))
* **compiler:** canonicalize lock-free app identity ([cd3809c](https://github.com/openmirai/mirai-intl/commit/cd3809c69c6032a05b93769f827e21006dd78369))
* **compiler:** canonicalize provider frontier paths ([9c09699](https://github.com/openmirai/mirai-intl/commit/9c09699b7674341cabf1cf5d0641ebef3275fa61))
* **compiler:** clean confined legacy catalog stages ([6b42286](https://github.com/openmirai/mirai-intl/commit/6b422868258e9aca6ae37370cdb03930c5868794))
* **compiler:** enforce authorization receipt counters ([dd06063](https://github.com/openmirai/mirai-intl/commit/dd060631b517393c3b46e872dddab302f9d0e7f8))
* **compiler:** fail closed generation publication ([f6145d9](https://github.com/openmirai/mirai-intl/commit/f6145d9dc4d68f9eb298045a08e89a42008c9352))
* **compiler:** fail closed on symlinked provider probes ([59898c8](https://github.com/openmirai/mirai-intl/commit/59898c835720a596f798e5d607f28e0c8f6a80e8))
* **compiler:** harden catalog publication recovery ([baf5493](https://github.com/openmirai/mirai-intl/commit/baf5493b0410c8b0e7d361475785f94d4832efec))
* **compiler:** pinpoint generated receipt corruption ([0452662](https://github.com/openmirai/mirai-intl/commit/04526625e15125ee338041453a08cee366512455))
* **compiler:** preserve multiple extends ordering ([a90e2c4](https://github.com/openmirai/mirai-intl/commit/a90e2c4a34961ee8b3c4ae6f196d956debd324e0))
* **compiler:** preserve TypeScript verifier parity ([077085c](https://github.com/openmirai/mirai-intl/commit/077085c5a787c39fa45a3e87197beef1f8cd4237))
* **compiler:** preserve workspace authorization failures ([f85886f](https://github.com/openmirai/mirai-intl/commit/f85886f5991c285e830e9933a18a38e1bca651a3))
* **compiler:** prioritize receipt input diagnostics ([75362ef](https://github.com/openmirai/mirai-intl/commit/75362efe1fb7d0d1a57399be09f47b56e4429be7))
* **compiler:** reconstruct authorization integrity barrier ([e3f20ca](https://github.com/openmirai/mirai-intl/commit/e3f20cabe11b1a6641dcced271f6bec2da3f19e3))
* **compiler:** reconstruct complete source universe ([fae94a8](https://github.com/openmirai/mirai-intl/commit/fae94a86fa94e2d8c08bc2d7baadf2feab820ad6))
* **compiler:** record authorization evidence in one pass ([25fa422](https://github.com/openmirai/mirai-intl/commit/25fa4222061fe1e286194b66b640dc411a9256c6))
* **compiler:** recover interrupted generation safely ([e48380c](https://github.com/openmirai/mirai-intl/commit/e48380c655f37786f6b6b32c1bb3e7f59d18a724))
* **compiler:** require semantic evidence per source ([50dcd7e](https://github.com/openmirai/mirai-intl/commit/50dcd7e19648a78d0387e42c457781cc987dfce0))
* **compiler:** reset stale generation stages ([f6b3d83](https://github.com/openmirai/mirai-intl/commit/f6b3d839447b607f6fb3420bb35b2463c68644c9))
* **compiler:** revalidate rollback backups ([bd499bf](https://github.com/openmirai/mirai-intl/commit/bd499bf1cb05e60ad454f4394c4bbcf999f4748a))
* **compiler:** scope provider frontiers to semantic imports ([3ce43f1](https://github.com/openmirai/mirai-intl/commit/3ce43f1aa18ba8ee1f5ef44cedf171d9ed54e423))
* **compiler:** use receipt-first ensure path ([53f8410](https://github.com/openmirai/mirai-intl/commit/53f84104a0295cbf7116ec88900e24bb4615bb01))
* emit recovery diagnostics by default ([8c8b137](https://github.com/openmirai/mirai-intl/commit/8c8b1374e2c49df04ac8ed876ec753e84f7be587))
* explain and lower intl failures safely ([e607191](https://github.com/openmirai/mirai-intl/commit/e607191b5a221e0c205f475a7c89da1c6e769f3b))
* **i18next:** close adapter lifecycle races ([89f48f7](https://github.com/openmirai/mirai-intl/commit/89f48f7774d4362bccb4bb83d6a6ac355abd879f))
* **i18next:** harden controller lifecycle ([5117b2a](https://github.com/openmirai/mirai-intl/commit/5117b2aa7e04a04bbbcaca876647bdc6a0292f71))
* pinpoint catalog validation diagnostics ([e7da24d](https://github.com/openmirai/mirai-intl/commit/e7da24d13e371276d4add3133c13e6f0c518a279))
* regenerate missing intl catalog payloads ([da7e9cf](https://github.com/openmirai/mirai-intl/commit/da7e9cf01770650af01e6fa471a43417c285c1ec))
* reject invalid inline form error keys ([2c2cd08](https://github.com/openmirai/mirai-intl/commit/2c2cd084edd5257160dae9962912f5fbc654afe8))


### Features

* **abi:** define v2 check receipt ([82b65d6](https://github.com/openmirai/mirai-intl/commit/82b65d617518a6e79c8933c073774dc916ee5216))
* **compiler:** add integrity identity utility ([5227e1c](https://github.com/openmirai/mirai-intl/commit/5227e1c1f2ec3d1bcd049297493883e27f26b1a4))
* **compiler:** add snapshot contract modules ([4bbb95b](https://github.com/openmirai/mirai-intl/commit/4bbb95b491109d06bf6926f4fc304e0ea73174bd))
* **compiler:** infer strict workspace conventions ([4a9ea4c](https://github.com/openmirai/mirai-intl/commit/4a9ea4ccf8d6e62d0f049530ca81d8ef5e71ac8f))
* **compiler:** integrate v2 authorization tooling ([f1a7c9e](https://github.com/openmirai/mirai-intl/commit/f1a7c9e6309bbc64267808a236b6f69fd5dc0cf1))
* **compiler:** issue and verify v2 authorization receipts ([57cc173](https://github.com/openmirai/mirai-intl/commit/57cc173376b807ff29206e9f02476ffb802bbe91))
* **compiler:** make catalog publication crash safe ([f602d80](https://github.com/openmirai/mirai-intl/commit/f602d802cf58668f1920db6bd51aa93379ee0ed6))
* **compiler:** reuse valid generation receipts ([f3f1929](https://github.com/openmirai/mirai-intl/commit/f3f1929cf8f38a03f92c5bcb7e9a0e4d80203090))
* complete Mirai Intl v0.3 migration ([1f52a84](https://github.com/openmirai/mirai-intl/commit/1f52a8431ff0354ed30a0a375cb870584ec71382))
* **i18next:** complete public adapter contract ([52a1802](https://github.com/openmirai/mirai-intl/commit/52a18028e0e82550f9b799a02a4da06d07baf81a))
* reject direct i18next translation calls ([f74166b](https://github.com/openmirai/mirai-intl/commit/f74166b20bcbf0742a39ef56d4e983d40a3942a5))
* ship plug-and-play Intl v0.3 ([91c7f44](https://github.com/openmirai/mirai-intl/commit/91c7f44f8e20c41e0e83be89a3e64bff0d0e85c7))


### Performance Improvements

* **compiler:** accelerate strict catalog authorization ([a48fe9d](https://github.com/openmirai/mirai-intl/commit/a48fe9d15aec18ada75ef1e33ebaeacf8b88ce3a))
* **compiler:** batch owner semantic authorization ([eefedbb](https://github.com/openmirai/mirai-intl/commit/eefedbbf54555e0ff6cd28dac45fc7994d6450a6))
* **compiler:** lazy-load semantic CLI analysis ([09f11c1](https://github.com/openmirai/mirai-intl/commit/09f11c155a55cd8ae6fb142bd17d8b194ec1dfa7))
* **compiler:** reuse catalog snapshots during authorization ([2da91b2](https://github.com/openmirai/mirai-intl/commit/2da91b228f49f265b6e039354300b85b05e1b74e))

# [0.2.0](https://github.com/openmirai/mirai-intl/compare/v0.1.7...v0.2.0) (2026-07-25)


### Features

* add production proof and recovery ([8a5fa4a](https://github.com/openmirai/mirai-intl/commit/8a5fa4a515700d2ae2099c414a0be3dbdafe8a73))

## [0.1.7](https://github.com/openmirai/mirai-intl/compare/v0.1.6...v0.1.7) (2026-07-23)

## [0.1.6](https://github.com/openmirai/mirai-intl/compare/v0.1.5...v0.1.6) (2026-07-23)

## [0.1.5](https://github.com/openmirai/mirai-intl/compare/v0.1.4...v0.1.5) (2026-07-23)

## [0.1.4](https://github.com/openmirai/mirai-intl/compare/v0.1.3...v0.1.4) (2026-07-23)

## [0.1.3](https://github.com/openmirai/mirai-intl/compare/v0.1.2...v0.1.3) (2026-07-23)

### Bug Fixes

* preserve generated form schema helpers during compiler lowering

## [0.1.2](https://github.com/openmirai/mirai-intl/compare/v0.1.1-beta.0...v0.1.2) (2026-07-23)

### Features

* add compiler-lowered, catalog-bound form schema contracts

## [0.1.1-beta.0](https://github.com/openmirai/mirai-intl/compare/v0.1.0...v0.1.1-beta.0) (2026-07-22)


### Bug Fixes

* synchronize workspace package versions for releases ([9d84695](https://github.com/openmirai/mirai-intl/commit/9d846952e35b3bc6e9e8fdf20d72a6be9f888742))


### Features

* add compiler-lowered form error translators ([8a9ddab](https://github.com/openmirai/mirai-intl/commit/8a9ddabf54a4b890454369a1d587914359cba1f5))

# [0.1.0](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.13...v0.1.0) (2026-07-21)

# [0.1.0-beta.13](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.12...v0.1.0-beta.13) (2026-07-21)

# [0.1.0-beta.12](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.11...v0.1.0-beta.12) (2026-07-21)

# [0.1.0-beta.11](https://github.com/openmirai/mirai-intl/compare/v0.1.0-beta.7...v0.1.0-beta.11) (2026-07-21)

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
