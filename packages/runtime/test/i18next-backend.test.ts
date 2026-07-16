import type { BackendModule } from "i18next";
import { describe, expect, it, vi } from "vitest";

import { createI18nextCatalogBackend } from "../src/i18next";

type Locale = "en" | "th";

const resources = {
  en: { translation: { greeting: "Hello" } },
  th: { translation: { greeting: "สวัสดี" } },
} as const;

function isCatalogLocale(locale: string): locale is Locale {
  return locale === "en" || locale === "th";
}

function callbackResult() {
  const calls: Array<readonly [Error | null, object | false]> = [];
  return {
    callback(error: Error | null, resource: object | false) {
      calls.push([error, resource]);
    },
    calls,
  };
}

describe("i18next catalog backend", () => {
  it("is structurally compatible and lazily loads one valid locale", async () => {
    const loadCatalogResource = vi.fn(
      async (locale: Locale) => resources[locale]
    );
    const backend = createI18nextCatalogBackend({
      isCatalogLocale,
      loadCatalogResource,
    });
    backend satisfies BackendModule;
    const result = callbackResult();

    backend.read("th", "translation", result.callback);
    await vi.waitFor(() => expect(result.calls).toHaveLength(1));

    expect(loadCatalogResource).toHaveBeenCalledTimes(1);
    expect(loadCatalogResource).toHaveBeenCalledWith("th");
    expect(result.calls).toEqual([[null, resources.th.translation]]);
  });

  it("short-circuits unsupported namespaces as an empty success", () => {
    const loadCatalogResource = vi.fn(
      async (locale: Locale) => resources[locale]
    );
    const backend = createI18nextCatalogBackend({
      isCatalogLocale,
      loadCatalogResource,
    });
    const result = callbackResult();

    backend.read("invalid", "other", result.callback);

    expect(loadCatalogResource).not.toHaveBeenCalled();
    expect(result.calls).toEqual([[null, {}]]);
  });

  it("supports an explicit nonstandard namespace", async () => {
    const loadCatalogResource = vi.fn(
      async (locale: Locale) => resources[locale]
    );
    const backend = createI18nextCatalogBackend({
      isCatalogLocale,
      loadCatalogResource,
      resourceNamespace: "catalog",
    });
    const unsupported = callbackResult();
    const supported = callbackResult();

    backend.read("en", "translation", unsupported.callback);
    backend.read("en", "catalog", supported.callback);
    await vi.waitFor(() => expect(supported.calls).toHaveLength(1));

    expect(unsupported.calls).toEqual([[null, {}]]);
    expect(supported.calls).toEqual([[null, resources.en.translation]]);
    expect(loadCatalogResource).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid locales before invoking the loader", () => {
    const loadCatalogResource = vi.fn(
      async (locale: Locale) => resources[locale]
    );
    const backend = createI18nextCatalogBackend({
      isCatalogLocale,
      loadCatalogResource,
    });
    const result = callbackResult();

    backend.read("__proto__", "translation", result.callback);

    expect(loadCatalogResource).not.toHaveBeenCalled();
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.[0]).toEqual(
      new Error("Unsupported catalog locale: __proto__")
    );
    expect(result.calls[0]?.[1]).toBe(false);
  });

  it.each([
    ["synchronous", "throw", new Error("sync failure")],
    ["asynchronous", "reject", new Error("async failure")],
    ["synchronous non-Error", "throw", "sync failure"],
    ["asynchronous non-Error", "reject", "async failure"],
  ] as const)("normalizes %s loader failures", async (_name, mode, failure) => {
    const loadCatalogResource = vi.fn((_locale: Locale) => {
      if (mode === "throw") {
        throw failure;
      }
      return Promise.reject(failure);
    });
    const backend = createI18nextCatalogBackend({
      isCatalogLocale,
      loadCatalogResource,
    });
    const result = callbackResult();

    backend.read("en", "translation", result.callback);
    await vi.waitFor(() => expect(result.calls).toHaveLength(1));

    expect(loadCatalogResource).toHaveBeenCalledTimes(1);
    const error = result.calls[0]?.[0];
    const expectedError =
      failure instanceof Error
        ? failure
        : new Error("Failed to load catalog locale: en", { cause: failure });
    expect(error).toEqual(expectedError);
    expect(result.calls[0]?.[1]).toBe(false);
  });

  it("settles exactly once for a hostile asynchronous loader", async () => {
    const loadCatalogResource = vi.fn(
      () =>
        new Promise<(typeof resources)[Locale]>((resolve, reject) => {
          resolve(resources.en);
          reject(new Error("late rejection"));
          resolve(resources.th);
        })
    );
    const backend = createI18nextCatalogBackend({
      isCatalogLocale,
      loadCatalogResource,
    });
    const result = callbackResult();

    backend.read("en", "translation", result.callback);
    await vi.waitFor(() => expect(result.calls).toHaveLength(1));
    await Promise.resolve();

    expect(result.calls).toEqual([[null, resources.en.translation]]);
  });
});
