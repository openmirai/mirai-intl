import {
  dynamicValidationLimits,
  validateResourceLimits,
  validateSchemaValue,
} from "@openmirai/intl-abi";
import type { ObjectSchema, ValidationLimits } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

const stringSchema = { type: "string" } as const;
const stringArraySchema = { items: stringSchema, type: "array" } as const;
const totalBoundarySchema = {
  additionalProperties: false,
  properties: {
    a: stringSchema,
    b: stringSchema,
    c: stringSchema,
    d: stringSchema,
  },
  required: ["a", "b", "c", "d"],
  type: "object",
} as const satisfies ObjectSchema;

describe("validation resource boundaries", () => {
  it("accepts exactly 16 KiB UTF-8 strings and rejects the next byte", () => {
    const asciiBoundary = "x".repeat(dynamicValidationLimits.maxStringBytes);
    const unicodeBoundary = "é".repeat(
      dynamicValidationLimits.maxStringBytes / 2
    );

    expect(validateSchemaValue(stringSchema, asciiBoundary).ok).toBe(true);
    expect(
      validateSchemaValue(stringSchema, `${asciiBoundary}x`)
    ).toMatchObject({ issue: { code: "limit" }, ok: false });
    expect(validateSchemaValue(stringSchema, unicodeBoundary).ok).toBe(true);
    expect(
      validateSchemaValue(stringSchema, `${unicodeBoundary}é`)
    ).toMatchObject({ issue: { code: "limit" }, ok: false });
  });

  it("accepts exactly 64 KiB including key bytes and rejects one byte more", () => {
    const exact = {
      a: "a".repeat(16 * 1024),
      b: "b".repeat(16 * 1024),
      c: "c".repeat(16 * 1024),
      d: "d".repeat(16 * 1024 - 29),
    };
    const overflow = { ...exact, d: `${exact.d}x` };

    expect(new TextEncoder().encode(JSON.stringify(exact)).byteLength).toBe(
      dynamicValidationLimits.maxTotalBytes
    );

    expect(validateSchemaValue(totalBoundarySchema, exact).ok).toBe(true);
    expect(validateResourceLimits(exact).ok).toBe(true);
    expect(validateSchemaValue(totalBoundarySchema, overflow)).toMatchObject({
      issue: { code: "limit" },
      ok: false,
    });
    expect(validateResourceLimits(overflow)).toMatchObject({
      issue: { code: "limit" },
      ok: false,
    });
  });

  it("counts object-key bytes against the total budget", () => {
    const limits = {
      maxAggregateEntries: 4,
      maxDepth: 4,
      maxStringBytes: 16,
      maxTotalBytes: 8,
    } as const satisfies ValidationLimits;
    const exactSchema = {
      additionalProperties: false,
      properties: { a: stringSchema },
      required: ["a"],
      type: "object",
    } as const satisfies ObjectSchema;
    const overflowSchema = {
      additionalProperties: false,
      properties: { ab: stringSchema },
      required: ["ab"],
      type: "object",
    } as const satisfies ObjectSchema;

    expect(validateSchemaValue(exactSchema, { a: "" }, limits).ok).toBe(true);
    expect(
      validateSchemaValue(overflowSchema, { ab: "" }, limits)
    ).toMatchObject({ issue: { code: "limit" }, ok: false });
  });

  it("counts JSON quoting and escapes rather than only raw string bytes", () => {
    const escaped = {
      a: "\\".repeat(dynamicValidationLimits.maxStringBytes),
      b: "\\".repeat(dynamicValidationLimits.maxStringBytes),
      c: "\\".repeat(dynamicValidationLimits.maxStringBytes),
      d: "\\".repeat(dynamicValidationLimits.maxStringBytes),
    };

    expect(new TextEncoder().encode(JSON.stringify(escaped)).byteLength).toBe(
      2 * 64 * 1024 + 29
    );
    expect(validateResourceLimits(escaped)).toMatchObject({
      issue: { code: "limit" },
      ok: false,
    });
  });
});

describe("validation diagnostic safety", () => {
  it("bounds and escapes attacker-controlled path segments without values", () => {
    const key = `line\n\u202e\\\u001b${"x".repeat(1_000)}`;
    const input = Object.defineProperty({}, key, {
      enumerable: true,
      value: "TOP_SECRET_VALUE",
    });
    const result = validateSchemaValue(
      {
        additionalProperties: false,
        properties: {},
        required: [],
        type: "object",
      },
      input
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected a sanitized validation failure");
    }
    expect(result.issue.path.length).toBeLessThanOrEqual(512);
    expect(result.issue.path).not.toContain("\n");
    expect(result.issue.path).not.toContain("\u202e");
    expect(result.issue.path).not.toContain("\u001b");
    expect(result.issue.path).not.toContain("\\");
    expect(JSON.stringify(result)).not.toContain("TOP_SECRET_VALUE");
  });
});

describe("hostile array inspection", () => {
  it("rejects array accessors without evaluating them", () => {
    let reads = 0;
    const input: Array<string> = [];
    Object.defineProperty(input, "0", {
      enumerable: true,
      get() {
        reads += 1;
        return "TOP_SECRET_VALUE";
      },
    });

    expect(validateSchemaValue(stringArraySchema, input)).toMatchObject({
      issue: { code: "accessor", path: "$[0]" },
      ok: false,
    });
    expect(validateResourceLimits(input)).toMatchObject({
      issue: { code: "accessor", path: "$[0]" },
      ok: false,
    });
    expect(reads).toBe(0);
  });

  it.each(["extra", Symbol("extra")])(
    "rejects extra array property %s",
    (key) => {
      const input = ["value"];
      Object.defineProperty(input, key, {
        enumerable: true,
        value: "TOP_SECRET_VALUE",
      });

      expect(validateSchemaValue(stringArraySchema, input)).toMatchObject({
        issue: { code: "extra" },
        ok: false,
      });
      expect(validateResourceLimits(input)).toMatchObject({
        issue: { code: "extra" },
        ok: false,
      });
    }
  );

  it("rejects sparse arrays instead of normalizing holes", () => {
    const input: Array<string> = [];
    input.length = 1;

    expect(validateSchemaValue(stringArraySchema, input)).toMatchObject({
      issue: { code: "missing", path: "$[0]" },
      ok: false,
    });
    expect(validateResourceLimits(input)).toMatchObject({
      issue: { code: "missing", path: "$[0]" },
      ok: false,
    });
  });
});
