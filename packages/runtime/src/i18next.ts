import type { CatalogManifest } from "@openmirai/intl-abi";

import { createTFunctionBridgeBackend } from "./backend";
import type { TypedCatalogManifest } from "./catalog";
import { defineRuntimeCatalog } from "./catalog";
import { StrictIntlRuntime } from "./runtime";

export type I18nextCatalogResource<Translation extends object = object> =
  Readonly<{
    translation: Translation;
  }>;

export type I18nextCatalogBackendOptions<
  Locale extends string,
  Resource extends I18nextCatalogResource,
> = Readonly<{
  isCatalogLocale: (locale: string) => locale is Locale;
  loadCatalogResource: (locale: Locale) => PromiseLike<Resource> | Resource;
  resourceNamespace?: string;
}>;

export type I18nextCatalogBackendReadCallback<Translation extends object> = (
  error: Error | null,
  resource: Translation | Readonly<Record<string, never>> | false
) => void;

export type I18nextCatalogBackendModule<Translation extends object> = Readonly<{
  type: "backend";
  init: () => void;
  read: (
    locale: string,
    namespace: string,
    callback: I18nextCatalogBackendReadCallback<Translation>
  ) => void;
}>;

function normalizeCatalogLoadError(error: unknown, locale: string): Error {
  return error instanceof Error
    ? error
    : new Error(`Failed to load catalog locale: ${locale}`, { cause: error });
}

export function createI18nextCatalogBackend<
  Locale extends string,
  Resource extends I18nextCatalogResource,
>(
  options: I18nextCatalogBackendOptions<Locale, Resource>
): I18nextCatalogBackendModule<Resource["translation"]> {
  const resourceNamespace = options.resourceNamespace ?? "translation";

  return {
    type: "backend",
    init() {},
    read(locale, namespace, callback) {
      let settled = false;
      const settle: I18nextCatalogBackendReadCallback<
        Resource["translation"]
      > = (error, resource) => {
        if (settled) {
          return;
        }
        settled = true;
        callback(error, resource);
      };
      const reject = (error: unknown) => {
        settle(normalizeCatalogLoadError(error, locale), false);
      };

      if (namespace !== resourceNamespace) {
        settle(null, {});
        return;
      }
      if (!options.isCatalogLocale(locale)) {
        settle(new Error(`Unsupported catalog locale: ${locale}`), false);
        return;
      }

      let resource: PromiseLike<Resource> | Resource;
      try {
        resource = options.loadCatalogResource(locale);
      } catch (error) {
        reject(error);
        return;
      }

      void Promise.resolve(resource).then(
        (loaded) => {
          let translation: Resource["translation"];
          try {
            translation = loaded.translation;
          } catch (error) {
            reject(error);
            return;
          }
          settle(null, translation);
        },
        (error: unknown) => reject(error)
      );
    },
  };
}

export type I18nextLike = Readonly<{
  getResource: (locale: string, namespace: string, key: string) => unknown;
  language?: string;
  languages?: ReadonlyArray<string>;
  off: (
    event: "languageChanged",
    listener: (locale: string) => void
  ) => unknown;
  on: (event: "languageChanged", listener: (locale: string) => void) => unknown;
  options?: Readonly<{ fallbackLng?: unknown }>;
  resolvedLanguage?: string;
  services?: Readonly<{
    languageUtils?: Readonly<{
      toResolveHierarchy: (
        locale: string,
        fallbackLocale?: unknown
      ) => ReadonlyArray<string>;
    }>;
  }>;
  t: unknown;
}>;

export type I18nextRuntimeOptions<Instance extends I18nextLike> = Readonly<{
  resourceNamespace?: string;
  resolveResourceLocale?: (
    instance: Instance,
    key: string,
    requestedLocale: string,
    candidates: ReadonlyArray<string>
  ) => string | undefined;
}>;

function uniqueLocales(
  locales: ReadonlyArray<string | undefined>
): Array<string> {
  const seen = new Set<string>();
  const output: Array<string> = [];
  for (const locale of locales) {
    if (typeof locale !== "string" || locale.length === 0 || seen.has(locale)) {
      continue;
    }
    seen.add(locale);
    output.push(locale);
  }
  return output;
}

export function i18nextLocaleCandidates(
  instance: I18nextLike,
  requestedLocale: string,
  sourceLocale: string
): ReadonlyArray<string> {
  const hierarchy = instance.services?.languageUtils?.toResolveHierarchy(
    requestedLocale,
    instance.options?.fallbackLng
  );
  const regionalBase = requestedLocale.split("-")[0];
  const activeLocale = instance.resolvedLanguage ?? instance.language;
  const activeBase = activeLocale?.split("-")[0];
  const activeHierarchy =
    requestedLocale === activeLocale || regionalBase === activeBase
      ? (instance.languages ?? [])
      : [];
  return uniqueLocales([
    requestedLocale,
    ...(hierarchy ?? []),
    ...activeHierarchy,
    regionalBase,
    sourceLocale,
  ]);
}

export function resolveI18nextCatalogLocale(
  manifest: CatalogManifest,
  instance: I18nextLike,
  requestedLocale: string
): string {
  const candidates = i18nextLocaleCandidates(
    instance,
    requestedLocale,
    manifest.sourceLocale
  );
  for (const candidate of candidates) {
    const exact = manifest.locales.find((locale) => locale === candidate);
    if (exact) {
      return exact;
    }
    const base = candidate.split("-")[0];
    const primary = manifest.locales.find((locale) => locale === base);
    if (primary) {
      return primary;
    }
  }
  return manifest.sourceLocale;
}

export function activeI18nextLocale(
  manifest: CatalogManifest,
  instance: I18nextLike
): string {
  return resolveI18nextCatalogLocale(
    manifest,
    instance,
    instance.resolvedLanguage ?? instance.language ?? manifest.sourceLocale
  );
}

export function createI18nextRuntime<
  Contract extends object,
  Instance extends I18nextLike,
>(
  catalogManifest: TypedCatalogManifest<Contract>,
  instance: Instance,
  locale?: string,
  options: I18nextRuntimeOptions<Instance> = {}
): StrictIntlRuntime {
  if (typeof instance.t !== "function") {
    throw new TypeError(
      "The i18next instance must expose a translation function"
    );
  }
  const translate = instance.t;
  const resourceNamespace = options.resourceNamespace ?? "translation";
  const resolveResourceLocale = (
    key: string,
    requestedLocale: string
  ): string | undefined => {
    const candidates = i18nextLocaleCandidates(
      instance,
      requestedLocale,
      catalogManifest.sourceLocale
    );
    const custom = options.resolveResourceLocale?.(
      instance,
      key,
      requestedLocale,
      candidates
    );
    if (custom !== undefined) {
      return custom;
    }
    return candidates.find(
      (candidate) =>
        instance.getResource(candidate, resourceNamespace, key) !== undefined
    );
  };
  const backend = createTFunctionBridgeBackend(
    (key, bridgeOptions) =>
      Reflect.apply(translate, instance, [
        key,
        { ...bridgeOptions, ns: resourceNamespace },
      ]),
    {
      resourceExists: (key, requestedLocale) =>
        resolveResourceLocale(key, requestedLocale) !== undefined,
      resolveResourceLocale,
    }
  );
  return new StrictIntlRuntime({
    backend,
    catalog: defineRuntimeCatalog({ manifest: catalogManifest, messages: [] }),
    locale: resolveI18nextCatalogLocale(
      catalogManifest,
      instance,
      locale ??
        instance.resolvedLanguage ??
        instance.language ??
        catalogManifest.sourceLocale
    ),
  });
}
