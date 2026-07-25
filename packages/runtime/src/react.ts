import { useMemo, useSyncExternalStore } from "react";

import type { StrictIntlRuntime } from "./runtime";
import {
  createRecoveringTranslationFunction,
  createTranslationFunction,
} from "./translations";
import type { NamespacePaths, UseTranslations } from "./translations";
import type { RecoveringIntlRuntime } from "./recovering";

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

export function createRecoveringUseTranslations<
  Catalog extends object,
  RichResult = unknown,
>(
  useRuntime: () => RecoveringIntlRuntime
): UseTranslations<Catalog, RichResult> {
  return function useTranslations<
    const Namespace extends NamespacePaths<Catalog> | undefined = undefined,
  >(_namespace?: Namespace) {
    const runtime = useRuntime();
    const t = useMemo(
      () =>
        createRecoveringTranslationFunction<Catalog, Namespace, RichResult>(
          runtime
        ),
      [runtime]
    );
    return { t };
  };
}

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
export type { RecoveringIntlRuntime } from "./recovering";
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
