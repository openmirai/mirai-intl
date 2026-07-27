import { emptyObjectSchema } from "@openmirai/intl-abi";
import { compileCatalog } from "@openmirai/intl-compiler/internal";
import type { TypedCatalogManifest } from "@openmirai/intl-runtime";
import { createPrecompiledDescriptor } from "@openmirai/intl-runtime";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

import { createMiraiI18next } from "../src/index";

const compiled = compileCatalog({
  buildId: "intl-i18next-adapter-test",
  catalogPackage: "@openmirai/intl-i18next-adapter-test",
  formatterVersions: {},
  id: "intl-i18next-adapter-test",
  locales: ["en", "th"],
  messages: [
    {
      kind: "text",
      path: "greeting",
      provenance: "packages/intl-i18next/test/adapter.test.ts:greeting",
      resultSchema: { type: "string" },
      translations: { en: "Hello", th: "สวัสดี" },
      valuesSchema: emptyObjectSchema,
    },
  ],
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
});

type Locale = "en" | "th";
type CatalogContract = Readonly<Record<string, never>>;
const catalogManifest = compiled.catalog.manifest as TypedCatalogManifest<
  CatalogContract,
  readonly ["en", "th"],
  "en"
>;
const isCatalogLocale = (locale: string): locale is Locale =>
  locale === "en" || locale === "th";
const resources = {
  en: { translation: { greeting: "Hello" } },
  th: { translation: { greeting: "สวัสดี" } },
} as const;
const greetingDescriptor = compiled.descriptors[0];
const greetingMessage = compiled.catalog.messages[0];
if (
  !greetingDescriptor ||
  greetingDescriptor.kind !== "text" ||
  !greetingMessage
) {
  throw new TypeError("Missing greeting test descriptor");
}
const greeting = createPrecompiledDescriptor(
  greetingDescriptor,
  undefined,
  greetingMessage
);

describe("createMiraiI18next", () => {
  it("exposes the complete public adapter surface", () => {
    const adapter = createMiraiI18next({
      catalogManifest,
      isCatalogLocale,
      loadCatalogResource: (locale) => resources[locale],
    });

    expect(Object.keys(adapter).toSorted()).toEqual([
      "Provider",
      "createRequestController",
      "getBrowserController",
      "useTranslations",
    ]);
  });

  it("deduplicates concurrent locale loads and retries failed loads", async () => {
    const gate = Promise.withResolvers<void>();
    let thaiAttempts = 0;
    const adapter = createMiraiI18next({
      catalogManifest,
      i18next: { maxRetries: 0 },
      isCatalogLocale,
      loadCatalogResource: async (locale) => {
        if (locale === "th") {
          thaiAttempts += 1;
          await gate.promise;
          if (thaiAttempts === 1) {
            throw new Error("temporary locale load failure");
          }
        }
        return resources[locale];
      },
    });
    const controller = adapter.createRequestController("en");
    await controller.activateLocale("en");

    const first = controller.loadLocale("th");
    const duplicate = controller.loadLocale("th");
    expect(first).toBe(duplicate);
    gate.resolve();
    await expect(first).rejects.toThrow("temporary locale load failure");
    await expect(controller.loadLocale("th")).resolves.toBeUndefined();
    expect(thaiAttempts).toBe(2);
  });

  it("serializes locale transitions in FIFO order", async () => {
    const adapter = createMiraiI18next({
      catalogManifest,
      isCatalogLocale,
      loadCatalogResource: (locale) => resources[locale],
    });
    const controller = adapter.createRequestController("en");
    await controller.activateLocale("en");
    const changes: Array<string> = [];
    controller.instance.on("languageChanged", (locale) => changes.push(locale));

    const thai = controller.activateLocale("th");
    const english = controller.activateLocale("en");
    await Promise.all([thai, english]);

    expect(changes.slice(-2)).toEqual(["th", "en"]);
    expect(controller.instance.language).toBe("en");
  });

  it("retries failed activation without replacing the active locale", async () => {
    let thaiAttempts = 0;
    const adapter = createMiraiI18next({
      catalogManifest,
      isCatalogLocale,
      loadCatalogResource: (locale) => {
        if (locale === "th" && thaiAttempts++ === 0) {
          throw new Error("temporary locale load failure");
        }
        return resources[locale];
      },
    });
    const controller = adapter.createRequestController("en");
    await controller.activateLocale("en");

    await expect(controller.activateLocale("th")).rejects.toThrow(
      "temporary locale load failure"
    );
    expect(controller.instance.language).toBe("en");
    await expect(controller.activateLocale("th")).resolves.toBeUndefined();
    expect(controller.instance.language).toBe("th");
    expect(thaiAttempts).toBe(2);
  });

  it("isolates request instances and rejects conflicting browser initialization", async () => {
    const adapter = createMiraiI18next({
      catalogManifest,
      isCatalogLocale,
      loadCatalogResource: (locale) => resources[locale],
    });
    const firstRequest = adapter.createRequestController("en");
    const secondRequest = adapter.createRequestController("th");
    await Promise.all([
      firstRequest.activateLocale("en"),
      secondRequest.activateLocale("th"),
    ]);

    expect(firstRequest.instance).not.toBe(secondRequest.instance);
    expect(firstRequest.instance.language).toBe("en");
    expect(secondRequest.instance.language).toBe("th");

    const browser = adapter.getBrowserController("en");
    expect(adapter.getBrowserController("en")).toBe(browser);
    expect(() => adapter.getBrowserController("th")).toThrow(
      'The browser controller is already initialized for locale "en"'
    );
  });

  it("provides an explicit controller to the React provider and disposes safely", async () => {
    const adapter = createMiraiI18next({
      catalogManifest,
      isCatalogLocale,
      loadCatalogResource: (locale) => resources[locale],
    });
    const controller = adapter.createRequestController("en");
    await controller.activateLocale("en");
    const off = vi.spyOn(controller.instance, "off");

    expect(
      renderToString(
        createElement(
          adapter.Provider,
          { controller },
          createElement("span", null, "content")
        )
      )
    ).toContain("content");

    controller.dispose();
    controller.dispose();
    expect(off).toHaveBeenCalledTimes(1);
    expect(() => controller.loadLocale("en")).toThrow(
      "The Mirai Intl controller has been disposed"
    );
  });

  it("holds browser children until the initial locale is ready", async () => {
    const gate = Promise.withResolvers<void>();
    const adapter = createMiraiI18next({
      catalogManifest,
      isCatalogLocale,
      loadCatalogResource: async (locale) => {
        await gate.promise;
        return resources[locale];
      },
    });
    const controller = adapter.getBrowserController("en");
    let renderer: ReactTestRenderer | undefined;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    try {
      act(() => {
        renderer = create(
          createElement(
            adapter.Provider,
            { controller },
            createElement("span", null, "ready")
          )
        );
      });
      expect(renderer?.toJSON()).toBeNull();

      await act(async () => {
        gate.resolve();
        await gate.promise;
        await Promise.resolve();
      });
      expect(renderer?.toJSON()).toEqual({
        children: ["ready"],
        props: {},
        type: "span",
      });
      act(() => renderer?.unmount());
    } finally {
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });

  it("recovers missing production resources without rendering the dotted key", async () => {
    const diagnostics: Array<unknown> = [];
    const adapter = createMiraiI18next({
      catalogManifest,
      isCatalogLocale,
      loadCatalogResource: () => ({ translation: {} }),
      recovery: {
        diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
        missingMessageFallback: "Translation unavailable",
      },
    });
    const controller = adapter.createRequestController("en");
    await controller.activateLocale("en");
    const Greeting = () => {
      const { t } = adapter.useTranslations();
      return createElement(
        "span",
        null,
        Reflect.apply(t, undefined, [greeting])
      );
    };

    const output = renderToString(
      createElement(adapter.Provider, { controller }, createElement(Greeting))
    );

    expect(output).toContain("Translation unavailable");
    expect(output).not.toContain("greeting");
    expect(diagnostics).toHaveLength(1);
  });
});
