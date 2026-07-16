import { createHash } from "node:crypto";

import { emptyObjectSchema } from "@openmirai/intl-abi";
import { defineIntlConfig } from "../../packages/compiler/src/internal";
import type { CatalogSource } from "../../packages/compiler/src/internal";

export interface FiveFieldValues {
  code: string;
  count: number;
  name: string;
  region: "apac" | "eu";
  status: "active" | "paused";
}

export const fiveFieldValues = Object.freeze({
  code: "CAT-42",
  count: 7,
  name: "Mali",
  region: "apac",
  status: "active",
} as const satisfies FiveFieldValues);

export const fiveFieldValuesSchema = {
  additionalProperties: false,
  properties: {
    code: { minLength: 1, type: "string" },
    count: { finite: true, minimum: 0, type: "number" },
    name: { minLength: 1, type: "string" },
    region: { type: "enum", values: ["apac", "eu"] },
    status: { type: "enum", values: ["active", "paused"] },
  },
  required: ["code", "count", "name", "region", "status"],
  type: "object",
} as const;

export const fiveFieldCatalogSource = defineIntlConfig({
  buildId: "catalog-five-field-benchmark",
  catalogPackage: "@mirai/intl-catalog-five-field-benchmark",
  id: "catalog-five-field-benchmark",
  locales: ["en", "th"],
  messages: [
    {
      kind: "text",
      path: "benchmark.fiveField",
      provenance: "benchmarks/fixtures/catalog.ts:benchmark.fiveField",
      resultSchema: { type: "string" },
      translations: {
        en: "{name}:{count}:{region}:{status}:{code}",
        th: "{name}:{count}:{region}:{status}:{code}",
      },
      valuesSchema: fiveFieldValuesSchema,
    },
  ],
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
} satisfies CatalogSource);

const sentinelByteLength = 9 * 1024;
export const unusedNamespaceSentinelMarker =
  "UNUSED_NAMESPACE_SENTINEL_CATALOG_V1_";

function deterministicSentinel(byteLength: number): string {
  const blocks: Array<string> = [];
  let previous = Buffer.from("mirai-intl-catalog-tree-shaking-seed-v1");
  let index = 0;
  while (blocks.join("").length < byteLength) {
    previous = createHash("sha256")
      .update(previous)
      .update(String(index))
      .digest();
    blocks.push(previous.toString("base64url"));
    index += 1;
  }
  return blocks.join("").slice(0, byteLength);
}

export const unusedNamespaceSentinel =
  `${unusedNamespaceSentinelMarker}${deterministicSentinel(sentinelByteLength)}`.slice(
    0,
    sentinelByteLength
  );

export const usedMessageSentinel = "USED_MESSAGE_SENTINEL_CATALOG_V1";

export const treeShakingCatalogSource = defineIntlConfig({
  buildId: "catalog-tree-shaking-benchmark",
  catalogPackage: "@mirai/intl-catalog-tree-shaking-benchmark",
  id: "catalog-tree-shaking-benchmark",
  locales: ["en"],
  messages: [
    {
      kind: "text",
      path: "used.greeting",
      provenance: "benchmarks/fixtures/catalog.ts:used.greeting",
      resultSchema: { type: "string" },
      translations: { en: usedMessageSentinel },
      valuesSchema: emptyObjectSchema,
    },
    {
      kind: "text",
      path: `unused.${unusedNamespaceSentinel}`,
      provenance: "benchmarks/fixtures/catalog.ts:unused.sentinel",
      resultSchema: { type: "string" },
      translations: { en: "unused" },
      valuesSchema: emptyObjectSchema,
    },
  ],
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
} satisfies CatalogSource);
