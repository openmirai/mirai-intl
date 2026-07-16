import { useMemo, useSyncExternalStore } from "react";

import type { StrictIntlRuntime } from "./runtime";
import { createTranslationFunction } from "./translations";
import type { NamespacePaths, UseTranslations } from "./translations";

export function createUseTranslations<
  Catalog extends object,
  RichResult = unknown,
>(useRuntime: () => StrictIntlRuntime): UseTranslations<Catalog, RichResult> {
  return function useTranslations<
    const Namespace extends NamespacePaths<Catalog> | undefined = undefined,
  >(_namespace?: Namespace) {
    const runtime = useRuntime();
    const t = useMemo(
      () => createTranslationFunction<Catalog, Namespace, RichResult>(runtime),
      [runtime]
    );
    return { t };
  };
}

export type UseIntl = () => StrictIntlRuntime;

export function createUseIntl(getRuntime: () => StrictIntlRuntime): UseIntl {
  return function useIntl(): StrictIntlRuntime {
    const runtime = getRuntime();
    useSyncExternalStore(
      runtime.subscribe,
      () => runtime.locale,
      () => runtime.locale
    );
    return runtime;
  };
}

export type {
  ComponentsOf,
  IntlRuntimeOptions,
  StrictIntlRuntime,
  StrictRichInput,
} from "./runtime";
export type { RichComponent, RichComponentMap, RichRenderValue } from "./rich";
export type {
  ArgumentFreeTextKeysFor,
  DeferredTranslationKeyFor,
  NamespacePaths,
  ParseTranslationKey,
  TranslationFunction,
  TranslationFunctionFor,
  UseTranslations,
} from "./translations";
