import { describe, expect, it } from "vitest";

import {
  emptyObjectSchema,
  defineMessageDescriptor,
} from "@openmirai/intl-abi";
import type {
  TextDescriptor,
  ValueDescriptor,
  RichDescriptor,
} from "@openmirai/intl-abi";
import { compileCatalog } from "@openmirai/intl-compiler/internal";
import type { CatalogSource } from "@openmirai/intl-compiler/internal";
import {
  createIntlRuntime,
  createPrecompiledBackend,
} from "@openmirai/intl-runtime";
import type { StrictIntlRuntime } from "@openmirai/intl-runtime";

const textResult = { type: "string" } as const;

const source = {
  buildId: "runtime-perf",
  catalogPackage: "@openmirai/intl-runtime-perf",
  formatterVersions: {},
  id: "runtime-perf",
  locales: ["en", "th"],
  messages: [
    {
      kind: "text",
      path: "label",
      provenance: "packages/runtime/test/perf.test.ts:label",
      resultSchema: textResult,
      translations: { en: "Course catalog", th: "แคตตาล็อกหลักสูตร" },
      valuesSchema: emptyObjectSchema,
    },
    {
      kind: "text",
      path: "greeting",
      provenance: "packages/runtime/test/perf.test.ts:greeting",
      resultSchema: textResult,
      translations: { en: "Hello, {name}", th: "สวัสดี {name}" },
      valuesSchema: {
        additionalProperties: false,
        properties: { name: { type: "string" } },
        required: ["name"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "plural",
      provenance: "packages/runtime/test/perf.test.ts:plural",
      resultSchema: textResult,
      translations: {
        en: "{count, plural, =0 {No results} one {# result} other {# results}}",
        th: "{count, plural, =0 {ไม่พบผลลัพธ์} other {# รายการ}}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { count: { finite: true, minimum: 0, type: "number" } },
        required: ["count"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "select",
      provenance: "packages/runtime/test/perf.test.ts:select",
      resultSchema: textResult,
      translations: {
        en: "{mode, select, none {No limit} other {{count} of {limit}}}",
        th: "{mode, select, none {ไม่จำกัด} other {{count} จาก {limit}}}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: {
          count: { finite: true, minimum: 0, type: "number" },
          limit: { finite: true, minimum: 0, type: "number" },
          mode: { type: "enum", values: ["none", "capped"] },
        },
        required: ["mode", "count", "limit"],
        type: "object",
      },
    },
    {
      kind: "rich",
      path: "rich.simple",
      provenance: "packages/runtime/test/perf.test.ts:rich.simple",
      resultSchema: textResult,
      tags: ["strong"],
      translations: {
        en: "Click <strong>{label}</strong> to continue",
        th: "คลิก <strong>{label}</strong> เพื่อดำเนินการต่อ",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { label: { type: "string" } },
        required: ["label"],
        type: "object",
      },
    },
    {
      kind: "value",
      path: "scalar",
      provenance: "packages/runtime/test/perf.test.ts:scalar",
      resultSchema: textResult,
      translations: { en: "ok", th: "ตกลง" },
      valuesSchema: emptyObjectSchema,
    },
    {
      kind: "value",
      path: "config",
      provenance: "packages/runtime/test/perf.test.ts:config",
      resultSchema: {
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          limit: { finite: true, minimum: 0, type: "number" },
          name: { type: "string" },
        },
        required: ["enabled", "limit", "name"],
        type: "object",
      },
      translations: {
        en: { enabled: true, limit: 100, name: "default" },
        th: { enabled: false, limit: 50, name: "ค่าเริ่มต้น" },
      },
      valuesSchema: emptyObjectSchema,
    },
  ],
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
} as const satisfies CatalogSource;

const compiled = compileCatalog(source);

function find<Kind extends "text" | "rich" | "value">(
  kind: Kind,
  path: string
) {
  const d = compiled.descriptors.find(
    (entry) => entry.kind === kind && entry.path === path
  );
  if (!d) {
    throw new Error(`Missing descriptor: ${path}`);
  }
  return d;
}

function makeRuntime(locale = "en"): StrictIntlRuntime {
  return createIntlRuntime({
    backend: createPrecompiledBackend(),
    catalog: compiled.catalog,
    locale,
  });
}

const strong = (children: ReadonlyArray<unknown>) => children.join("");

describe("runtime performance catalog", () => {
  it("renders literal text in both locales", () => {
    const en = makeRuntime("en");
    const th = makeRuntime("th");
    expect(en.t(find("text", "label") as TextDescriptor)).toBe(
      "Course catalog"
    );
    expect(th.t(find("text", "label") as TextDescriptor)).toBe(
      "แคตตาล็อกหลักสูตร"
    );
  });

  it("renders parameterized text in both locales", () => {
    const en = makeRuntime("en");
    const th = makeRuntime("th");
    expect(
      en.t(
        find("text", "greeting") as TextDescriptor<Record<string, unknown>>,
        { name: "Ada" } as never
      )
    ).toBe("Hello, Ada");
    expect(
      th.t(
        find("text", "greeting") as TextDescriptor<Record<string, unknown>>,
        { name: "Ada" } as never
      )
    ).toBe("สวัสดี Ada");
  });

  it("renders plural forms correctly per locale", () => {
    const en = makeRuntime("en");
    const th = makeRuntime("th");
    const d = find("text", "plural") as TextDescriptor<Record<string, unknown>>;

    expect(en.t(d, { count: 0 } as never)).toBe("No results");
    expect(en.t(d, { count: 1 } as never)).toBe("1 result");
    expect(en.t(d, { count: 5 } as never)).toBe("5 results");

    expect(th.t(d, { count: 0 } as never)).toBe("ไม่พบผลลัพธ์");
    expect(th.t(d, { count: 5 } as never)).toBe("5 รายการ");
  });

  it("renders select branches correctly", () => {
    const en = makeRuntime("en");
    const d = find("text", "select") as TextDescriptor<Record<string, unknown>>;

    expect(en.t(d, { count: 3, limit: 5, mode: "none" } as never)).toBe(
      "No limit"
    );
    expect(en.t(d, { count: 3, limit: 5, mode: "capped" } as never)).toBe(
      "3 of 5"
    );
  });

  it("renders rich tags with trusted components", () => {
    const en = makeRuntime("en");
    const d = find("rich", "rich.simple") as RichDescriptor;
    const result = en.rich(d, {
      components: { strong },
      values: { label: "Next" },
    } as never);

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) {
      throw new Error("expected array");
    }
    expect(result.join("")).toBe("Click Next to continue");
  });

  it("returns structured values verbatim", () => {
    const en = makeRuntime("en");
    const th = makeRuntime("th");

    expect(en.value(find("value", "scalar") as ValueDescriptor)).toBe("ok");
    expect(th.value(find("value", "scalar") as ValueDescriptor)).toBe("ตกลง");

    const config = en.value(find("value", "config") as ValueDescriptor);
    expect(config).toEqual({ enabled: true, limit: 100, name: "default" });

    const configTh = th.value(find("value", "config") as ValueDescriptor);
    expect(configTh).toEqual({ enabled: false, limit: 50, name: "ค่าเริ่มต้น" });
  });

  it("switches locale and preserves render output", () => {
    const runtime = makeRuntime("en");
    expect(runtime.locale).toBe("en");
    expect(runtime.t(find("text", "label") as TextDescriptor)).toBe(
      "Course catalog"
    );

    runtime.setLocale("th");
    expect(runtime.locale).toBe("th");
    expect(runtime.t(find("text", "label") as TextDescriptor)).toBe(
      "แคตตาล็อกหลักสูตร"
    );
  });

  it("rejects wrong-kind descriptor access", () => {
    const runtime = makeRuntime();

    expect(() =>
      runtime.value(find("text", "label") as unknown as ValueDescriptor)
    ).toThrow("Descriptor was used with the wrong strict operation");
  });

  it("rejects stale descriptors", () => {
    const runtime = makeRuntime();
    const original = find("text", "label") as TextDescriptor;
    const stale = defineMessageDescriptor({
      buildToken: "old-build",
      capabilitySetHash: original.capabilitySetHash,
      catalogHash: original.catalogHash,
      catalogId: original.catalogId,
      formatVersion: original.formatVersion,
      kind: original.kind,
      messageId: original.messageId,
      path: original.path,
      rendererCapabilityId: original.rendererCapabilityId,
      runtimeAbi: original.runtimeAbi,
      validatorId: original.validatorId,
    });

    expect(() => runtime.t(stale as TextDescriptor)).toThrow(
      /Descriptor|stale|invalid|build/i
    );
  });

  it("completes 10k literal lookups under 500ns median", () => {
    const runtime = makeRuntime();
    const d = find("text", "label") as TextDescriptor;

    const samples: Array<number> = [];
    for (let s = 0; s < 11; s += 1) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 10_000; i += 1) {
        runtime.t(d);
      }
      samples.push(Number(process.hrtime.bigint() - start) / 10_000);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];

    expect(median).toBeLessThan(500);
  });

  it("completes 10k parameterized calls under 2000ns median", () => {
    const runtime = makeRuntime();
    const d = find("text", "greeting") as TextDescriptor<
      Record<string, unknown>
    >;

    const samples: Array<number> = [];
    for (let s = 0; s < 11; s += 1) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 10_000; i += 1) {
        runtime.t(d, { name: "Ada" } as never);
      }
      samples.push(Number(process.hrtime.bigint() - start) / 10_000);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];

    expect(median).toBeLessThan(2000);
  });

  it("completes 10k value lookups under 200ns median", () => {
    const runtime = makeRuntime();
    const d = find("value", "scalar") as ValueDescriptor;

    const samples: Array<number> = [];
    for (let s = 0; s < 11; s += 1) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 10_000; i += 1) {
        runtime.value(d);
      }
      samples.push(Number(process.hrtime.bigint() - start) / 10_000);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];

    expect(median).toBeLessThan(200);
  });
});
