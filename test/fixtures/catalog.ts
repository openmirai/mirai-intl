import { emptyObjectSchema } from "@openmirai/intl-abi";
import { defineIntlConfig } from "../../packages/compiler/src/internal";
import type { CatalogSource } from "../../packages/compiler/src/internal";

const textResultSchema = { type: "string" } as const;
const finiteNumberSchema = { finite: true, type: "number" } as const;

export const catalogFixtureSource = defineIntlConfig({
  buildId: "catalog-fixture-build",
  catalogPackage: "@mirai/intl-catalog-fixture",
  formatterVersions: { money: "1.0.0" },
  id: "catalog-fixture",
  locales: ["en", "th"],
  messages: [
    {
      kind: "value",
      path: "certificate.verification",
      provenance: "test/fixtures/catalog.ts:certificate.verification",
      resultSchema: {
        additionalProperties: false,
        properties: {
          fields: {
            items: {
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                value: { type: "string" },
              },
              required: ["label", "value"],
              type: "object",
            },
            minItems: 1,
            type: "array",
          },
          title: { type: "string" },
        },
        required: ["title", "fields"],
        type: "object",
      },
      translations: {
        en: {
          fields: [{ label: "Learner", value: "Verified" }],
          title: "Certificate verification",
        },
        th: {
          fields: [{ label: "ผู้เรียน", value: "ยืนยันแล้ว" }],
          title: "การตรวจสอบใบรับรอง",
        },
      },
      valuesSchema: emptyObjectSchema,
    },
    {
      kind: "text",
      path: "editor.limit",
      provenance: "test/fixtures/catalog.ts:editor.limit",
      resultSchema: textResultSchema,
      translations: {
        en: "{mode, select, none {No limit} other {{count} of {limit}}}",
        th: "{mode, select, none {ไม่จำกัด} other {{count} จาก {limit}}}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: {
          count: finiteNumberSchema,
          limit: finiteNumberSchema,
          mode: { type: "enum", values: ["none", "capped"] },
        },
        required: ["mode", "count", "limit"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "formatting.date",
      provenance: "test/fixtures/catalog.ts:formatting.date",
      resultSchema: textResultSchema,
      translations: {
        en: "Published {value, date, long}",
        th: "เผยแพร่เมื่อ {value, date, long}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { value: { type: "date-time" } },
        required: ["value"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "formatting.number",
      provenance: "test/fixtures/catalog.ts:formatting.number",
      resultSchema: textResultSchema,
      translations: {
        en: "Enrollment {value, number}",
        th: "ผู้เรียน {value, number}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { value: finiteNumberSchema },
        required: ["value"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "formatting.ordinal",
      provenance: "test/fixtures/catalog.ts:formatting.ordinal",
      resultSchema: textResultSchema,
      translations: {
        en: "{place, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} place",
        th: "ลำดับที่ {place, selectordinal, other {#}}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { place: finiteNumberSchema },
        required: ["place"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "formatting.percent",
      provenance: "test/fixtures/catalog.ts:formatting.percent",
      resultSchema: textResultSchema,
      translations: {
        en: "Completion {ratio, number, percent}",
        th: "ความคืบหน้า {ratio, number, percent}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { ratio: finiteNumberSchema },
        required: ["ratio"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "formatting.time",
      provenance: "test/fixtures/catalog.ts:formatting.time",
      resultSchema: textResultSchema,
      translations: {
        en: "Starts {value, time, long}",
        th: "เริ่มเวลา {value, time, long}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { value: { type: "date-time" } },
        required: ["value"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "greeting.morning",
      provenance: "test/fixtures/catalog.ts:greeting.morning",
      resultSchema: textResultSchema,
      translations: {
        en: "Good morning, {name}",
        th: "สวัสดีตอนเช้า {name}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { name: { type: "string" } },
        required: ["name"],
        type: "object",
      },
    },
    {
      formatterIds: ["money"],
      kind: "text",
      path: "payout.total",
      provenance: "test/fixtures/catalog.ts:payout.total",
      resultSchema: textResultSchema,
      translations: {
        en: "Total: {amount, number, custom:money:compact}",
        th: "ยอดรวม: {amount, number, custom:money:compact}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { amount: finiteNumberSchema },
        required: ["amount"],
        type: "object",
      },
    },
    {
      kind: "text",
      path: "results.summary",
      provenance: "test/fixtures/catalog.ts:results.summary",
      resultSchema: textResultSchema,
      translations: {
        en: "{count, plural, =0 {No results} one {# result} other {# results}}",
        th: "{count, plural, =0 {ไม่พบผลลัพธ์} other {# รายการ}}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { count: finiteNumberSchema },
        required: ["count"],
        type: "object",
      },
    },
    {
      kind: "rich",
      path: "rich.deactivate",
      provenance: "test/fixtures/catalog.ts:rich.deactivate",
      resultSchema: textResultSchema,
      tags: ["medium"],
      translations: {
        en: "Deactivate <medium>{name}</medium>?",
        th: "ปิดใช้งาน <medium>{name}</medium> หรือไม่?",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { name: { type: "string" } },
        required: ["name"],
        type: "object",
      },
    },
    {
      kind: "rich",
      path: "rich.legal",
      provenance: "test/fixtures/catalog.ts:rich.legal",
      resultSchema: textResultSchema,
      tags: ["legal", "strong"],
      translations: {
        en: "<legal>Read <strong>{name}</strong></legal>",
        th: "<legal><strong>{name}</strong> อ่านข้อกำหนด</legal>",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { name: { type: "string" } },
        required: ["name"],
        type: "object",
      },
    },
    {
      kind: "value",
      path: "statistics.passRate",
      provenance: "test/fixtures/catalog.ts:statistics.passRate",
      resultSchema: finiteNumberSchema,
      translations: { en: 0.875, th: 0.9 },
      valuesSchema: emptyObjectSchema,
    },
  ],
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
} satisfies CatalogSource);

const mediumComponents = Object.freeze({
  medium: (children: ReadonlyArray<unknown>) =>
    `<strong>${children.join("")}</strong>`,
});

const legalComponents = Object.freeze({
  legal: (children: ReadonlyArray<unknown>) =>
    `<legal>${children.join("")}</legal>`,
  strong: (children: ReadonlyArray<unknown>) =>
    `<strong>${children.join("")}</strong>`,
});

export const catalogRuntimeCases = [
  {
    expectedByLocale: {
      en: "Good morning, Mali",
      th: "สวัสดีตอนเช้า Mali",
    },
    path: "greeting.morning",
    values: { name: "Mali" },
  },
  {
    expectedByLocale: { en: "No results", th: "ไม่พบผลลัพธ์" },
    path: "results.summary",
    values: { count: 0 },
  },
  {
    expectedByLocale: { en: "2 results", th: "2 รายการ" },
    path: "results.summary",
    values: { count: 2 },
  },
  {
    expectedByLocale: { en: "No limit", th: "ไม่จำกัด" },
    path: "editor.limit",
    values: { count: 3, limit: 5, mode: "none" },
  },
  {
    expectedByLocale: { en: "3 of 5", th: "3 จาก 5" },
    path: "editor.limit",
    values: { count: 3, limit: 5, mode: "capped" },
  },
  {
    expectedByLocale: {
      en: "Enrollment 1,234,567.89",
      th: "ผู้เรียน 1,234,567.89",
    },
    path: "formatting.number",
    values: { value: 1_234_567.89 },
  },
  {
    expectedByLocale: {
      en: "Completion 88%",
      th: "ความคืบหน้า 88%",
    },
    path: "formatting.percent",
    values: { ratio: 0.875 },
  },
  {
    expectedByLocale: {
      en: "Published January 15, 2024",
      th: "เผยแพร่เมื่อ 15 มกราคม 2567",
    },
    path: "formatting.date",
    values: { value: "2024-01-15T13:05:09.000Z" },
  },
  {
    expectedByLocale: {
      en: "Starts 1:05:09 PM UTC",
      th: "เริ่มเวลา 13 นาฬิกา 05 นาที 09 วินาที UTC",
    },
    path: "formatting.time",
    values: { value: "2024-01-15T13:05:09.000Z" },
  },
  {
    expectedByLocale: { en: "22nd place", th: "ลำดับที่ 22" },
    path: "formatting.ordinal",
    values: { place: 22 },
  },
  {
    expectedByLocale: {
      en: "Total: en/compact/1200",
      th: "ยอดรวม: th/compact/1200",
    },
    path: "payout.total",
    values: { amount: 1200 },
  },
  {
    components: mediumComponents,
    expectedByLocale: {
      en: ["Deactivate ", "<strong>Mali</strong>", "?"],
      th: ["ปิดใช้งาน ", "<strong>Mali</strong>", " หรือไม่?"],
    },
    path: "rich.deactivate",
    values: { name: "Mali" },
  },
  {
    components: legalComponents,
    expectedByLocale: {
      en: ["<legal>Read <strong>Mali</strong></legal>"],
      th: ["<legal><strong>Mali</strong> อ่านข้อกำหนด</legal>"],
    },
    path: "rich.legal",
    values: { name: "Mali" },
  },
  {
    expectedByLocale: {
      en: {
        fields: [{ label: "Learner", value: "Verified" }],
        title: "Certificate verification",
      },
      th: {
        fields: [{ label: "ผู้เรียน", value: "ยืนยันแล้ว" }],
        title: "การตรวจสอบใบรับรอง",
      },
    },
    path: "certificate.verification",
    values: undefined,
  },
  {
    expectedByLocale: { en: 0.875, th: 0.9 },
    path: "statistics.passRate",
    values: undefined,
  },
] as const;
