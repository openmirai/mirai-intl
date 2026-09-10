# @openmirai/intl-compiler

Compiler and framework integration for Mirai Intl. It discovers locale sources,
validates translation contracts, generates catalogs, and transforms eligible
Next.js and Vite application code.

Most applications should install [`@openmirai/intl`](https://www.npmjs.com/package/@openmirai/intl),
which exposes the CLI and public adapter entry points. Use this package directly
when building compiler tooling or a custom integration.

## Install

```sh
npm install @openmirai/intl-compiler
```

Useful entry points include:

- `@openmirai/intl-compiler` — compiler and verification APIs.
- `@openmirai/intl-compiler/next` — Next.js integration.
- `@openmirai/intl-compiler/vite` — Vite integration.

The package is ESM-only and supports Node.js 24 and later (`>=24`).

## Compiler engine

Release packages include prebuilt Rust binaries for macOS and Windows on x64
and arm64, and Linux on x64 and arm64 with glibc or musl. Consumer installation
does not compile Rust. TypeScript remains responsible for semantic source checks.

`MIRAI_INTL_ENGINE=auto` uses a verified supported binary when available and
otherwise uses the Node implementation. `node` explicitly selects Node; `rust`
requires a supported prebuilt binary. Invalid assets, failed native loading and
operational errors fail instead of silently falling back or authorizing inputs.

The native loader creates a private verified snapshot in the operating system's
temporary directory before loading it. That directory must permit writing and
executable mappings. If `/tmp` is mounted `noexec`, set `TMPDIR` to an appropriate
writable temporary directory that permits executable mappings. Resolve the
underlying issue before starting a fresh process; retrying with the same
inaccessible directory cannot repair it. Verification and authority reuse retain
all source, locale, compiler and artifact checks under either engine.

## Documentation

Read the [Mirai Intl repository guide](https://github.com/openmirai/mirai-intl)
for locale conventions, generated catalogs, adapter configuration, and CI.

## License

[MIT](https://github.com/openmirai/mirai-intl/blob/main/LICENSE)
