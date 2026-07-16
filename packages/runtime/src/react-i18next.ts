import type { ReactNode } from "react";
import { useMemo, useSyncExternalStore } from "react";

import type { CatalogContractOf, TypedCatalogManifest } from "./catalog";
import {
  activeI18nextLocale,
  createI18nextRuntime,
  resolveI18nextCatalogLocale,
} from "./i18next";
import type { I18nextLike, I18nextRuntimeOptions } from "./i18next";
import type { StrictIntlRuntime } from "./runtime";
import { createTranslationFunction } from "./translations";
import type { NamespacePaths, TranslationFunctionFor } from "./translations";

export type TranslationHookResult<Instance extends I18nextLike> = Readonly<{
  i18n: Instance;
  ready: boolean;
}>;

export type UseTranslationHook<Instance extends I18nextLike> = (
  namespace: string
) => TranslationHookResult<Instance>;

export type CreateUseTranslationsOptions<Instance extends I18nextLike> =
  I18nextRuntimeOptions<Instance>;

type BoundUseTranslations<Contract extends object, Instance> = <
  const Namespace extends NamespacePaths<Contract> | undefined = undefined,
>(
  namespace?: Namespace
) => Readonly<{
  i18n: Instance;
  ready: boolean;
  t: TranslationFunctionFor<Contract, Namespace, ReactNode>;
}>;

interface RuntimeResource<Instance extends I18nextLike> {
  readonly instance: Instance;
  readonly listeners: Set<() => void>;
  readonly runtime: StrictIntlRuntime;
  languageSnapshot: string;
  revision: number;
  unbind: (() => void) | undefined;
}

function i18nextLanguageSnapshot(instance: I18nextLike): string {
  return JSON.stringify([
    instance.language ?? null,
    instance.resolvedLanguage ?? null,
    [...(instance.languages ?? [])],
  ]);
}

export function createUseTranslations<
  Manifest extends TypedCatalogManifest<object>,
  Instance extends I18nextLike,
>(
  catalogManifest: Manifest,
  useTranslation: UseTranslationHook<Instance>,
  options: CreateUseTranslationsOptions<Instance> = {}
): BoundUseTranslations<CatalogContractOf<Manifest>, Instance> {
  type Contract = CatalogContractOf<Manifest>;
  const resources = new WeakMap<object, RuntimeResource<Instance>>();

  const synchronizeResource = (
    resource: RuntimeResource<Instance>,
    locale?: string,
    forceRevision = false
  ): boolean => {
    resource.runtime.setLocale(
      locale === undefined
        ? activeI18nextLocale(catalogManifest, resource.instance)
        : resolveI18nextCatalogLocale(
            catalogManifest,
            resource.instance,
            locale
          )
    );
    const nextSnapshot = i18nextLanguageSnapshot(resource.instance);
    if (!forceRevision && nextSnapshot === resource.languageSnapshot) {
      return false;
    }
    resource.languageSnapshot = nextSnapshot;
    resource.revision += 1;
    return true;
  };

  const resourceFor = (instance: Instance): RuntimeResource<Instance> => {
    const existing = resources.get(instance);
    if (existing) {
      if (existing.listeners.size === 0) {
        synchronizeResource(existing);
      }
      return existing;
    }
    const resource: RuntimeResource<Instance> = {
      instance,
      languageSnapshot: i18nextLanguageSnapshot(instance),
      listeners: new Set(),
      runtime: createI18nextRuntime(
        catalogManifest,
        instance,
        undefined,
        options
      ),
      revision: 0,
      unbind: undefined,
    };
    resources.set(instance, resource);
    return resource;
  };

  const subscribeResource = (
    resource: RuntimeResource<Instance>,
    subscriber: () => void
  ): (() => void) => {
    resource.listeners.add(subscriber);
    if (resource.listeners.size === 1) {
      const listener = (locale: string): void => {
        synchronizeResource(resource, locale, true);
        for (const notify of resource.listeners) {
          notify();
        }
      };
      resource.instance.on("languageChanged", listener);
      resource.unbind = () => {
        resource.instance.off("languageChanged", listener);
      };
      synchronizeResource(resource);
    }
    return () => {
      resource.listeners.delete(subscriber);
      if (resource.listeners.size === 0) {
        resource.unbind?.();
        resource.unbind = undefined;
      }
    };
  };

  const useTranslations = (_namespace?: string) => {
    const hookResult = useTranslation(
      options.resourceNamespace ?? "translation"
    );
    const resource = useMemo(
      () => resourceFor(hookResult.i18n),
      [hookResult.i18n]
    );
    const subscribe = useMemo(
      () => (subscriber: () => void) => subscribeResource(resource, subscriber),
      [resource]
    );
    const revision = useSyncExternalStore(
      subscribe,
      () => resource.revision,
      () => 0
    );
    const t = useMemo(
      () => createTranslationFunction(resource.runtime),
      [resource.runtime, revision]
    );
    return { i18n: hookResult.i18n, ready: hookResult.ready, t };
  };
  return useTranslations as BoundUseTranslations<Contract, Instance>;
}
