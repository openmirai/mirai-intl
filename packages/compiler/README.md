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

## Documentation

Read the [Mirai Intl repository guide](https://github.com/openmirai/mirai-intl)
for locale conventions, generated catalogs, adapter configuration, and CI.

## License

[MIT](https://github.com/openmirai/mirai-intl/blob/main/LICENSE)
