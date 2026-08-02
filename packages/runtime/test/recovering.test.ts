import { compileCatalog } from "@openmirai/intl-compiler/internal";
import type { TextDescriptor } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";
import { createRecoveringIntlRuntime } from "../src/recovering";
import type { RecoveringIntlRuntime } from "../src/recovering";
import { createIntlRuntime } from "../src/runtime";
import type { StrictIntlRuntime } from "../src/runtime";
import { createRecoveringTranslationFunction } from "../src/translations";
import type { RendererBackend } from "../src/backend";

const compiled = compileCatalog(catalogFixtureSource);
const descriptor = compiled.descriptors.find(
  (entry) => entry.path === "greeting.morning"
);

if (!descriptor || descriptor.kind !== "text") {
  throw new Error("Missing text fixture descriptor");
}
const textDescriptor = descriptor as TextDescriptor<{ name: string }>;

const failingBackend: RendererBackend = {
  id: "tfunction-bridge-v1",
  render() {
    throw new Error("renderer failure must not escape recovery");
  },
  supportsPortableIr: true,
};

const formatters = {
  money: {
    format: () => "0",
    version: "1.0.0",
  },
};

function renderText(
  runtime: RecoveringIntlRuntime | StrictIntlRuntime
): string {
  return runtime.t(textDescriptor, { name: "Ada" });
}

describe("RecoveringIntlRuntime", () => {
  it("contains public text failures and deduplicates safe diagnostics", () => {
    const diagnostics: Array<unknown> = [];
    const runtime = createRecoveringIntlRuntime({
      backend: failingBackend,
      catalog: compiled.catalog,
      diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
      formatters,
      locale: "en",
    });

    expect(renderText(runtime)).toBe("");
    expect(renderText(runtime)).toBe("");
    expect(diagnostics).toEqual([
      {
        locale: "en",
        operation: "text",
        proofIdentity: "unknown",
        release: "unknown",
        recovery: "terminal",
        stage: "runtime",
      },
    ]);
  });

  it("does not weaken strict runtime failures", () => {
    const runtime = createIntlRuntime({
      backend: failingBackend,
      catalog: compiled.catalog,
      formatters,
      locale: "en",
    });
    expect(() => renderText(runtime)).toThrow(
      "Strict translation renderer failed"
    );
  });

  it("contains unlowered translation functions before descriptor validation", () => {
    const runtime = createRecoveringIntlRuntime({
      backend: failingBackend,
      catalog: compiled.catalog,
      formatters,
      locale: "en",
      textFallback: () => "Translation unavailable",
    });
    const t = createRecoveringTranslationFunction(runtime) as unknown as (
      key: unknown
    ) => string;
    expect(t("unlowered.translation")).toBe("Translation unavailable");
    expect(t("unlowered.translation")).not.toBe("unlowered.translation");
  });

  it("contains text fallback failures without exposing the input key", () => {
    const runtime = createRecoveringIntlRuntime({
      backend: failingBackend,
      catalog: compiled.catalog,
      formatters,
      locale: "en",
      textFallback() {
        throw new Error("fallback failure");
      },
    });
    const t = createRecoveringTranslationFunction(runtime) as unknown as (
      key: unknown
    ) => string;

    expect(t("unlowered.translation")).toBe("");
    expect(t("unlowered.translation")).not.toBe("unlowered.translation");
  });

  it("preserves map container shapes when lowering is absent", () => {
    const diagnostics: Array<unknown> = [];
    const runtime = createRecoveringIntlRuntime({
      backend: failingBackend,
      catalog: compiled.catalog,
      formatters,
      locale: "en",
      diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
      textFallback: () => "Translation unavailable",
    });
    const t = createRecoveringTranslationFunction(runtime) as unknown as {
      map: (...input: ReadonlyArray<unknown>) => unknown;
    };
    expect(t.map(["one", "two"])).toEqual({
      one: "Translation unavailable",
      two: "Translation unavailable",
    });
    expect(t.map(["row"], ["first", "second"])).toEqual({
      row: {
        first: "Translation unavailable",
        second: "Translation unavailable",
      },
    });
    expect(t.map({ first: "key.first", second: "key.second" })).toEqual({
      first: "Translation unavailable",
      second: "Translation unavailable",
    });
    expect(diagnostics).toEqual([
      {
        locale: "en",
        operation: "map",
        proofIdentity: "unknown",
        release: "unknown",
        recovery: "terminal",
        stage: "runtime",
      },
    ]);
  });
});
