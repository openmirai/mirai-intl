import { validateSchemaValue } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

const dateTimeSchema = { type: "date-time" } as const;
const scalarSchema = { type: "scalar" } as const;

describe("safe scalar validation", () => {
  it.each(["Mali", "", 0, 42, -3.5])("accepts %p", (value) => {
    expect(validateSchemaValue(scalarSchema, value)).toEqual({
      ok: true,
      value,
    });
  });

  it.each([
    null,
    undefined,
    true,
    {},
    [],
    () => "secret",
    Symbol("secret"),
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("rejects %p without coercion", (value) => {
    expect(validateSchemaValue(scalarSchema, value)).toMatchObject({
      ok: false,
    });
  });
});

describe("date-time validation", () => {
  it.each(["2024-02-29T23:59:59Z", "2026-07-14T08:30:00.123456789Z"])(
    "accepts a real RFC 3339 UTC instant: %s",
    (value) => {
      expect(validateSchemaValue(dateTimeSchema, value)).toEqual({
        ok: true,
        value,
      });
    }
  );

  it.each([
    "2023-02-29T08:30:00Z",
    "2026-04-31T08:30:00Z",
    "2026-07-14T24:01:00Z",
    "2026-07-14T08:30:60Z",
    "2026-07-14T08:30:00+07:00",
  ])("rejects a syntactically plausible but invalid instant: %s", (value) => {
    const result = validateSchemaValue(dateTimeSchema, value);

    expect(result).toMatchObject({
      issue: { expected: "RFC 3339 UTC string" },
      ok: false,
    });
  });

  it("rejects Date instances instead of coercing them", () => {
    expect(validateSchemaValue(dateTimeSchema, new Date())).toMatchObject({
      issue: { actualType: "instance" },
      ok: false,
    });
  });
});

describe("hostile value inspection", () => {
  it("returns a sanitized failure when reflection traps throw", () => {
    const input = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("proxy secret");
        },
      }
    );

    expect(
      validateSchemaValue(
        {
          additionalProperties: false,
          properties: {},
          required: [],
          type: "object",
        },
        input
      )
    ).toEqual({
      issue: {
        actualType: "uninspectable",
        code: "type",
        expected: "inspectable data value",
        path: "$",
      },
      ok: false,
    });
  });
});
