# @openmirai/intl-i18next

Typed React and i18next bindings for Mirai Intl. The adapter connects a
generated catalog manifest and resource loader to i18next and exposes a typed
provider, translation hook, and browser/request controllers.

## Install

```sh
npm install @openmirai/intl @openmirai/intl-i18next
```

The package expects React `19.2.7` as a peer dependency. `i18next-icu` is an
optional peer dependency; install it when ICU formatting is enabled:

```sh
npm install i18next-icu
```

## Quick start

The compiler generates `catalogManifest`, `isCatalogLocale`, and
`loadCatalogResource` in the selected generated catalog directory:

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

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <intl.Provider initialLocale="en">{children}</intl.Provider>;
}
```

Use `intl.useTranslations("namespace")` inside the provider. For server
requests, use `intl.createRequestController(locale)` so each request has an
isolated controller. For browser applications, use
`intl.getBrowserController()` when an imperative controller is needed.

## Documentation

See the complete [Mirai Intl repository guide](https://github.com/openmirai/mirai-intl)
for locale conventions, generated catalogs, Next.js/Vite adapters, and CI.

## License

[MIT](https://github.com/openmirai/mirai-intl/blob/main/LICENSE)
