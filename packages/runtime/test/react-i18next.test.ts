import { emptyObjectSchema } from "@openmirai/intl-abi";
import type { TextDescriptor } from "@openmirai/intl-abi";
import { compileCatalog } from "@openmirai/intl-compiler/internal";
import { createInstance } from "i18next";
import type { i18n } from "i18next";
import {
  createContext,
  createElement,
  StrictMode,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";
import { renderToString } from "react-dom/server";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import type { TypedCatalogManifest } from "../src/catalog";
import { createI18nextRuntime } from "../src/i18next";
import { createPrecompiledDescriptor } from "../src/representations";
import { createUseTranslations } from "../src/react-i18next";
import { createTranslationFunction } from "../src/translations";

const compiled = compileCatalog({
  buildId: "react-i18next-runtime-test",
  catalogPackage: "@openmirai/react-i18next-runtime-test",
  formatterVersions: {},
  id: "react-i18next-runtime-test",
  locales: ["en", "th"],
  messages: [
    {
      kind: "text",
      path: "greeting",
      provenance: "packages/runtime/test/react-i18next.test.ts:greeting",
      resultSchema: { type: "string" },
      translations: { en: "Hello", th: "สวัสดี" },
      valuesSchema: emptyObjectSchema,
    },
  ],
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
});

interface CatalogContract {
  greeting: TextDescriptor<
    Readonly<Record<never, never>>,
    "fixture",
    "greeting"
  >;
}

const catalogManifest: TypedCatalogManifest<CatalogContract> =
  compiled.catalog.manifest;
const greetingDescriptor = compiled.descriptors[0];
const greetingMessage = compiled.catalog.messages[0];
if (
  !greetingDescriptor ||
  greetingDescriptor.kind !== "text" ||
  !greetingMessage
) {
  throw new TypeError("Missing greeting descriptor");
}
const greeting = createPrecompiledDescriptor(
  greetingDescriptor,
  undefined,
  greetingMessage
);

function callGreeting(
  runtime: ReturnType<typeof createI18nextRuntime>
): string {
  const t = createTranslationFunction<CatalogContract>(runtime);
  return Reflect.apply(t, undefined, [greeting]) as string;
}

async function i18nextFixture(
  options: {
    fallbackLng?:
      | string
      | ReadonlyArray<string>
      | ((locale: string) => Array<string>);
    locale?: string;
    resources?: Readonly<
      Record<string, { translation: Record<string, string> }>
    >;
  } = {}
): Promise<i18n> {
  const instance = createInstance();
  await instance.init({
    defaultNS: "translation",
    fallbackLng: options.fallbackLng ?? false,
    initAsync: false,
    keySeparator: false,
    lng: options.locale ?? "en",
    resources: options.resources ?? {
      en: { translation: { greeting: "Hello" } },
      th: { translation: { greeting: "สวัสดี" } },
    },
  });
  return instance;
}

describe("i18next runtime binding", () => {
  it("adds no runtime field for the catalog contract phantom type", () => {
    expect(Object.getOwnPropertySymbols(catalogManifest)).toEqual([]);
  });

  it.each([
    ["string", "th"],
    ["array", ["th"]],
    ["function", () => ["th"]],
  ] as const)(
    "uses i18next %s fallback configuration",
    async (_name, fallbackLng) => {
      const instance = await i18nextFixture({
        fallbackLng,
        locale: "en-US",
        resources: { th: { translation: { greeting: "สวัสดี" } } },
      });
      expect(
        callGreeting(createI18nextRuntime(catalogManifest, instance))
      ).toBe("สวัสดี");
    }
  );

  it("uses the active regional hierarchy and fails closed for a missing resource", async () => {
    const regional = await i18nextFixture({
      locale: "en-US",
      resources: { "en-US": { translation: { greeting: "Howdy" } } },
    });
    expect(callGreeting(createI18nextRuntime(catalogManifest, regional))).toBe(
      "Howdy"
    );
    const missing = await i18nextFixture({
      resources: { en: { translation: {} } },
    });
    expect(() =>
      callGreeting(createI18nextRuntime(catalogManifest, missing))
    ).toThrow("Strict translation renderer failed");
  });

  it("shares one listener per instance, cleans it up, and isolates instances", async () => {
    const first = await i18nextFixture();
    const second = await i18nextFixture();
    const on = vi.spyOn(first, "on");
    const off = vi.spyOn(first, "off");
    const I18nextContext = createContext<i18n | undefined>(undefined);
    const injectedHook = () => {
      const instance = useContext(I18nextContext);
      if (!instance) {
        throw new TypeError("Missing test i18next instance");
      }
      return { i18n: instance, ready: true };
    };
    const useTranslations = createUseTranslations(
      catalogManifest,
      injectedHook
    );
    const Greeting = () => {
      const { t } = useTranslations();
      return createElement(
        "span",
        null,
        Reflect.apply(t, undefined, [greeting])
      );
    };
    const MemoizedGreeting = () => {
      const { t } = useTranslations();
      return useMemo(
        () =>
          createElement("span", null, Reflect.apply(t, undefined, [greeting])),
        [t]
      );
    };
    let renderer: ReactTestRenderer | undefined;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    try {
      await act(() => {
        renderer = create(
          createElement(
            StrictMode,
            null,
            createElement(
              I18nextContext.Provider,
              { value: first },
              createElement(Greeting),
              createElement(Greeting),
              createElement(MemoizedGreeting)
            ),
            createElement(
              I18nextContext.Provider,
              { value: second },
              createElement(Greeting)
            )
          )
        );
      });
      const languageEvents = (spy: typeof on | typeof off): number =>
        spy.mock.calls.filter(([event]) => event === "languageChanged").length;
      expect(languageEvents(on) - languageEvents(off)).toBe(1);
      await act(async () => {
        await first.changeLanguage("th");
      });
      expect(renderer?.toJSON()).toEqual([
        { children: ["สวัสดี"], props: {}, type: "span" },
        { children: ["สวัสดี"], props: {}, type: "span" },
        { children: ["สวัสดี"], props: {}, type: "span" },
        { children: ["Hello"], props: {}, type: "span" },
      ]);
      await act(() => renderer?.unmount());
      expect(languageEvents(on)).toBe(languageEvents(off));
    } finally {
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });

  it("provides a stable SSR snapshot without installing listeners", async () => {
    const instance = await i18nextFixture();
    const on = vi.spyOn(instance, "on");
    const useTranslations = createUseTranslations(catalogManifest, () => ({
      i18n: instance,
      ready: true,
    }));
    const Greeting = () => {
      const { ready, t } = useTranslations();
      return createElement(
        "span",
        { "data-ready": ready },
        Reflect.apply(t, undefined, [greeting])
      );
    };
    expect(renderToString(createElement(Greeting))).toContain("Hello");
    expect(
      on.mock.calls.filter(([event]) => event === "languageChanged")
    ).toHaveLength(0);
  });

  it("refreshes memoized translations across regional languages", async () => {
    const instance = await i18nextFixture({
      locale: "en-US",
      resources: {
        "en-GB": { translation: { greeting: "Good day" } },
        "en-US": { translation: { greeting: "Howdy" } },
      },
    });
    const I18nextContext = createContext<i18n | undefined>(undefined);
    const useTranslations = createUseTranslations(catalogManifest, () => {
      const current = useContext(I18nextContext);
      if (!current) {
        throw new TypeError("Missing test i18next instance");
      }
      return { i18n: current, ready: true };
    });
    const MemoizedGreeting = () => {
      const { t } = useTranslations();
      return useMemo(
        () =>
          createElement("span", null, Reflect.apply(t, undefined, [greeting])),
        [t]
      );
    };
    let renderer: ReactTestRenderer | undefined;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    try {
      await act(() => {
        renderer = create(
          createElement(
            I18nextContext.Provider,
            { value: instance },
            createElement(MemoizedGreeting)
          )
        );
      });
      expect(renderer?.toJSON()).toEqual({
        children: ["Howdy"],
        props: {},
        type: "span",
      });
      await act(async () => {
        await instance.changeLanguage("en-GB");
      });
      expect(renderer?.toJSON()).toEqual({
        children: ["Good day"],
        props: {},
        type: "span",
      });
      await act(() => renderer?.unmount());
    } finally {
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });

  it("reconciles a language change before store subscription", async () => {
    const instance = await i18nextFixture();
    const I18nextContext = createContext<i18n | undefined>(undefined);
    const useTranslations = createUseTranslations(catalogManifest, () => {
      const current = useContext(I18nextContext);
      if (!current) {
        throw new TypeError("Missing test i18next instance");
      }
      return { i18n: current, ready: true };
    });
    const ChangeLanguage = () => {
      useLayoutEffect(() => {
        void instance.changeLanguage("th");
      }, []);
      return null;
    };
    const MemoizedGreeting = () => {
      const { t } = useTranslations();
      return useMemo(
        () =>
          createElement("span", null, Reflect.apply(t, undefined, [greeting])),
        [t]
      );
    };
    let renderer: ReactTestRenderer | undefined;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    try {
      await act(() => {
        renderer = create(
          createElement(
            I18nextContext.Provider,
            { value: instance },
            createElement(ChangeLanguage),
            createElement(MemoizedGreeting)
          )
        );
      });
      expect(instance.language).toBe("th");
      expect(renderer?.toJSON()).toEqual({
        children: ["สวัสดี"],
        props: {},
        type: "span",
      });
      await act(() => renderer?.unmount());
    } finally {
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });
});
