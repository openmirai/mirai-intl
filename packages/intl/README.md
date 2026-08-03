# @openmirai/intl

The primary Mirai Intl package for application developers. It includes the
`mirai-intl` CLI, compiler integration, runtime entry points, and public Next.js
and Vite adapters.

## Install

```sh
npm install @openmirai/intl @openmirai/intl-i18next
```

Use the CLI from your application:

```sh
npx mirai-intl ensure
npx mirai-intl check
```

## Framework adapters

Wrap an existing Next.js configuration:

```ts
import { withMiraiIntl } from "@openmirai/intl/next";

export default withMiraiIntl({ reactStrictMode: true });
```

Add the Vite plugin:

```ts
import { miraiIntlVite } from "@openmirai/intl/vite";

export default { plugins: [miraiIntlVite()] };
```

Use [`@openmirai/intl-i18next`](https://www.npmjs.com/package/@openmirai/intl-i18next)
for the typed React provider and hooks.

## Documentation

Read the complete [Mirai Intl repository guide](https://github.com/openmirai/mirai-intl)
for locale files, configuration, generated catalogs, and CI.

## License

[MIT](https://github.com/openmirai/mirai-intl/blob/main/LICENSE)
