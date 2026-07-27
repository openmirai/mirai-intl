import type { InitOptions, i18n } from "i18next";
import { createInstance } from "i18next";
import type { ComponentType, ReactNode } from "react";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
} from "react";
import { I18nextProvider, useTranslation } from "react-i18next";

import type { IntlDiagnostic } from "@openmirai/intl-abi";
import type { BoundUseTranslations } from "@openmirai/intl-runtime/react-i18next";

import type {
  CatalogContractOf,
  CatalogLocaleOf,
  I18nextCatalogResource,
  IntlRecoveryDiagnostic,
  NamespacePaths,
  RecoveringI18nextRuntimeOptions,
  TranslationFunctionFor,
  TypedCatalogManifest,
} from "@openmirai/intl-runtime";
import {
  createI18nextCatalogBackend,
  createI18nextRuntime,
  createOtelDiagnosticSink,
  createOtelRecoveryDiagnosticSink,
  createRecoveringI18nextRuntime,
  createRecoveringTranslationFunction,
  createTranslationFunction,
} from "@openmirai/intl-runtime";
import {
  createRecoveringUseTranslations,
  createUseTranslations,
} from "@openmirai/intl-runtime/react-i18next";

export type MiraiI18nextController<
  Locale extends string,
  Contract extends object = object,
> = Readonly<{
  instance: i18n;
  loadLocale: (locale: Locale) => Promise<void>;
  activateLocale: (locale: Locale) => Promise<void>;
  getActiveLocale: () => Locale | undefined;
  getTranslations: <
    const Namespace extends NamespacePaths<Contract> | undefined = undefined,
  >(
    namespace?: Namespace
  ) => Readonly<{
    t: TranslationFunctionFor<Contract, Namespace, ReactNode>;
  }>;
  dispose: () => void;
}>;

export type MiraiI18nextProviderProps<
  Locale extends string,
  Contract extends object = object,
> = Readonly<{
  children?: ReactNode;
  controller?: MiraiI18nextController<Locale, Contract>;
  initialLocale?: Locale;
}>;

export type MiraiI18nextOptions<
  Manifest extends TypedCatalogManifest<object>,
  Resource extends I18nextCatalogResource,
> = Readonly<{
  catalogManifest: Manifest;
  defaultLocale?: CatalogLocaleOf<Manifest>;
  i18next?: Omit<
    InitOptions,
    | "backend"
    | "defaultNS"
    | "fallbackLng"
    | "lng"
    | "ns"
    | "resources"
    | "supportedLngs"
  >;
  icu?: false | Readonly<Record<string, unknown>>;
  isCatalogLocale: (locale: string) => locale is CatalogLocaleOf<Manifest>;
  loadCatalogResource: (
    locale: CatalogLocaleOf<Manifest>
  ) => PromiseLike<Resource> | Resource;
  recovery?: false | RecoveringI18nextRuntimeOptions<i18n>;
  resourceNamespace?: string;
}>;

export type MiraiUseTranslations<
  Manifest extends TypedCatalogManifest<object>,
> = BoundUseTranslations<CatalogContractOf<Manifest>, i18n>;

export type MiraiI18nextAdapter<Manifest extends TypedCatalogManifest<object>> =
  Readonly<{
    Provider: ComponentType<
      MiraiI18nextProviderProps<
        CatalogLocaleOf<Manifest>,
        CatalogContractOf<Manifest>
      >
    >;
    createRequestController: (
      initialLocale?: CatalogLocaleOf<Manifest>
    ) => MiraiI18nextController<
      CatalogLocaleOf<Manifest>,
      CatalogContractOf<Manifest>
    >;
    getBrowserController: (
      initialLocale?: CatalogLocaleOf<Manifest>
    ) => MiraiI18nextController<
      CatalogLocaleOf<Manifest>,
      CatalogContractOf<Manifest>
    >;
    useTranslations: MiraiUseTranslations<Manifest>;
  }>;

type ProviderTranslationBinding = (
  namespace?: string
) => Readonly<{ i18n: i18n; ready: boolean; t: unknown }>;

const MiraiI18nextTranslationContext = createContext<
  ProviderTranslationBinding | undefined
>(undefined);

export function createProviderBoundUseTranslations<
  Contract extends object,
>(): BoundUseTranslations<Contract, i18n> {
  const useProviderBoundTranslations = (namespace?: string) => {
    const useTranslations = useContext(MiraiI18nextTranslationContext);
    if (!useTranslations) {
      throw new Error(
        "Mirai Intl translations require a parent adapter Provider"
      );
    }
    return useTranslations(namespace);
  };
  return useProviderBoundTranslations as BoundUseTranslations<Contract, i18n>;
}

function productionEnvironment(): boolean {
  const processValue: unknown = Reflect.get(globalThis, "process");
  if (!processValue || typeof processValue !== "object") {
    return false;
  }
  const environment: unknown = Reflect.get(processValue, "env");
  return (
    !!environment &&
    typeof environment === "object" &&
    Reflect.get(environment, "NODE_ENV") === "production"
  );
}

function createUnavailableTranslationWarning(): (locale: string) => void {
  const warnedLocales = new Set<string>();
  return (locale): void => {
    if (warnedLocales.has(locale)) {
      return;
    }
    warnedLocales.add(locale);
    try {
      globalThis.console.warn(
        `[mirai-intl] WARNING Translation unavailable for locale "${locale}"; rendered safe fallback.`
      );
    } catch {
      // Console failures must not affect translation rendering.
    }
  };
}

function composeSinks<Diagnostic>(
  first: (diagnostic: Diagnostic) => void,
  second: ((diagnostic: Diagnostic) => void) | undefined
): (diagnostic: Diagnostic) => void {
  return (diagnostic): void => {
    try {
      first(diagnostic);
    } catch {
      // Built-in telemetry must not affect translation rendering.
    }
    try {
      second?.(diagnostic);
    } catch {
      // Consumer observability must not affect translation rendering.
    }
  };
}

export function createMiraiI18next<
  Manifest extends TypedCatalogManifest<object>,
  Resource extends I18nextCatalogResource,
>(
  options: MiraiI18nextOptions<Manifest, Resource>
): MiraiI18nextAdapter<Manifest> {
  type Locale = CatalogLocaleOf<Manifest>;
  type Contract = CatalogContractOf<Manifest>;
  const defaultLocale =
    options.defaultLocale ?? options.catalogManifest.sourceLocale;
  const resourceNamespace = options.resourceNamespace ?? "translation";
  const configuredRecovery =
    options.recovery === false ? undefined : options.recovery;
  const recoveringRuntime =
    options.recovery !== false &&
    (options.recovery !== undefined || productionEnvironment());
  const warnUnavailableTranslation = createUnavailableTranslationWarning();
  const otelDiagnosticSink = createOtelDiagnosticSink();
  const otelRecoveryDiagnosticSink = createOtelRecoveryDiagnosticSink();
  const diagnosticSink = (diagnostic: IntlDiagnostic): void => {
    if (diagnostic.code === "INTL_MISSING_RESOURCE") {
      warnUnavailableTranslation(diagnostic.locale ?? defaultLocale);
    }
    otelDiagnosticSink(diagnostic);
  };
  const recoveryDiagnosticSink = (diagnostic: IntlRecoveryDiagnostic): void => {
    warnUnavailableTranslation(diagnostic.locale);
    otelRecoveryDiagnosticSink(diagnostic);
  };
  const runtimeOptions = { resourceNamespace };
  const recoveryRuntimeOptions = {
    ...configuredRecovery,
    diagnosticSink: composeSinks(
      diagnosticSink,
      configuredRecovery?.diagnosticSink
    ),
    recoveryDiagnosticSink: composeSinks(
      recoveryDiagnosticSink,
      configuredRecovery?.recoveryDiagnosticSink
    ),
    resourceNamespace,
    strictValidation: configuredRecovery?.strictValidation ?? false,
  };
  const backend = createI18nextCatalogBackend({
    isCatalogLocale: options.isCatalogLocale,
    loadCatalogResource: options.loadCatalogResource,
    resourceNamespace,
  });
  let browserController:
    | Readonly<{
        controller: MiraiI18nextController<Locale, Contract>;
        initialLocale: Locale;
      }>
    | undefined;

  const assertLocale = (locale: Locale): void => {
    if (!options.isCatalogLocale(locale)) {
      throw new TypeError(`Unsupported catalog locale: ${locale}`);
    }
  };

  const createController = (
    initialLocale: Locale
  ): MiraiI18nextController<Locale, Contract> => {
    assertLocale(initialLocale);
    const instance = createInstance();
    let disposed = false;
    let activeLocale: Locale | undefined;
    let transitionTail: Promise<void> = Promise.resolve();
    const pendingLoads = new Map<Locale, Promise<void>>();
    let translationRuntime:
      | ReturnType<typeof createI18nextRuntime>
      | ReturnType<typeof createRecoveringI18nextRuntime>
      | undefined;

    const initialization = (async (): Promise<void> => {
      instance.use(backend);
      if (options.icu !== false && options.icu !== undefined) {
        const { default: I18nextIcu } = await import("i18next-icu");
        instance.use(new I18nextIcu(options.icu));
      }
      await instance.init({
        ...options.i18next,
        defaultNS: resourceNamespace,
        fallbackLng: options.catalogManifest.sourceLocale,
        lng: initialLocale,
        ns: [resourceNamespace],
        resources: {},
        supportedLngs: [...options.catalogManifest.locales],
      });
    })();

    const assertActive = (): void => {
      if (disposed) {
        throw new Error("The Mirai Intl controller has been disposed");
      }
    };

    const loadLocale = (locale: Locale): Promise<void> => {
      assertActive();
      assertLocale(locale);
      const existing = pendingLoads.get(locale);
      if (existing) {
        return existing;
      }
      const load = initialization
        .then(async () => {
          if (instance.hasResourceBundle(locale, resourceNamespace)) {
            return;
          }
          const resource = await options.loadCatalogResource(locale);
          instance.addResourceBundle(
            locale,
            resourceNamespace,
            resource.translation,
            true,
            true
          );
        })
        .finally(() => {
          pendingLoads.delete(locale);
        });
      pendingLoads.set(locale, load);
      return load;
    };

    const activateLocale = (locale: Locale): Promise<void> => {
      assertActive();
      assertLocale(locale);
      const transition = transitionTail
        .catch(() => undefined)
        .then(async () => {
          await loadLocale(locale);
          await instance.changeLanguage(locale);
          activeLocale = locale;
          translationRuntime?.setLocale(locale);
        });
      transitionTail = transition;
      return transition;
    };

    const getTranslations = (_namespace?: string): Readonly<{ t: unknown }> => {
      assertActive();
      if (activeLocale === undefined) {
        throw new Error(
          "Cannot get translations before a locale is active; call activateLocale(locale) first"
        );
      }
      if (!translationRuntime) {
        translationRuntime = recoveringRuntime
          ? createRecoveringI18nextRuntime(
              options.catalogManifest,
              instance,
              activeLocale,
              recoveryRuntimeOptions
            )
          : createI18nextRuntime(
              options.catalogManifest,
              instance,
              activeLocale,
              runtimeOptions
            );
      }
      const t = recoveringRuntime
        ? createRecoveringTranslationFunction(
            translationRuntime as ReturnType<
              typeof createRecoveringI18nextRuntime
            >
          )
        : createTranslationFunction(
            translationRuntime as ReturnType<typeof createI18nextRuntime>
          );
      return Object.freeze({ t });
    };

    return Object.freeze({
      activateLocale,
      dispose() {
        if (disposed) {
          return;
        }
        disposed = true;
        pendingLoads.clear();
        instance.off("languageChanged");
      },
      getActiveLocale: () => activeLocale,
      getTranslations,
      instance,
      loadLocale,
    }) as unknown as MiraiI18nextController<Locale, Contract>;
  };

  const getBrowserController = (
    initialLocale: Locale = defaultLocale
  ): MiraiI18nextController<Locale, Contract> => {
    assertLocale(initialLocale);
    if (browserController) {
      if (browserController.initialLocale !== initialLocale) {
        throw new Error(
          `The browser controller is already initialized for locale "${browserController.initialLocale}"`
        );
      }
      return browserController.controller;
    }
    const controller = createController(initialLocale);
    browserController = Object.freeze({ controller, initialLocale });
    return controller;
  };

  const createRequestController = (
    initialLocale: Locale = defaultLocale
  ): MiraiI18nextController<Locale, Contract> =>
    createController(initialLocale);

  const injectedUseTranslation = () => {
    const result = useTranslation(resourceNamespace, { useSuspense: false });
    return { i18n: result.i18n, ready: result.ready };
  };
  const useTranslations: MiraiUseTranslations<Manifest> = recoveringRuntime
    ? createRecoveringUseTranslations(
        options.catalogManifest,
        injectedUseTranslation,
        recoveryRuntimeOptions
      )
    : createUseTranslations(
        options.catalogManifest,
        injectedUseTranslation,
        runtimeOptions
      );

  const Provider: ComponentType<
    MiraiI18nextProviderProps<Locale, Contract>
  > = ({ children, controller, initialLocale }) => {
    const controllerLocale = controller?.getActiveLocale();
    const selectedLocale =
      initialLocale ??
      (controllerLocale && options.isCatalogLocale(controllerLocale)
        ? controllerLocale
        : defaultLocale);
    const selectedController =
      controller ?? getBrowserController(selectedLocale);
    const [activationError, setActivationError] = useState<unknown>();
    const [readySelection, setReadySelection] = useState<
      | Readonly<{
          controller: MiraiI18nextController<Locale, Contract>;
          locale: Locale;
        }>
      | undefined
    >(() =>
      selectedController.getActiveLocale() === selectedLocale
        ? { controller: selectedController, locale: selectedLocale }
        : undefined
    );
    useEffect(() => {
      let active = true;
      setActivationError(undefined);
      if (
        selectedController.getActiveLocale() !== selectedLocale ||
        readySelection?.controller !== selectedController
      ) {
        setReadySelection(undefined);
      }
      void selectedController.activateLocale(selectedLocale).then(
        () => {
          if (active) {
            setReadySelection({
              controller: selectedController,
              locale: selectedLocale,
            });
          }
        },
        (error: unknown) => {
          if (active) {
            setActivationError(error);
          }
        }
      );
      return () => {
        active = false;
      };
    }, [readySelection?.controller, selectedController, selectedLocale]);
    if (activationError) {
      throw activationError;
    }
    return createElement(
      MiraiI18nextTranslationContext.Provider,
      {
        value: useTranslations as ProviderTranslationBinding,
      },
      createElement(
        I18nextProvider,
        {
          i18n: selectedController.instance,
        },
        readySelection?.controller === selectedController &&
          readySelection.locale === selectedLocale
          ? children
          : null
      )
    );
  };

  return Object.freeze({
    Provider,
    createRequestController,
    getBrowserController,
    useTranslations,
  });
}
