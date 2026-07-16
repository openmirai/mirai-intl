import { parseMessage } from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

const numberSchema = {
  additionalProperties: false,
  properties: { amount: { finite: true, type: "number" } },
  required: ["amount"],
  type: "object",
} as const;

const dateSchema = {
  additionalProperties: false,
  properties: { value: { type: "date-time" } },
  required: ["value"],
  type: "object",
} as const;

describe("ICU format style normalization", () => {
  it("preserves the parser's null sentinel for default formatting", () => {
    expect(() =>
      parseMessage("{amount, number}", numberSchema, "en")
    ).not.toThrow();
  });

  it("rejects parser skeleton objects instead of silently dropping them", () => {
    expect(() =>
      parseMessage("{amount, number, ::currency/USD}", numberSchema, "en")
    ).toThrowError(/ICU number skeleton styles are unsupported/u);
  });

  it("rejects unknown named styles instead of compiling default formatting", () => {
    expect(() =>
      parseMessage("{amount, number, compact}", numberSchema, "en")
    ).toThrowError(/Unsupported ICU number style "compact"/u);
    expect(() =>
      parseMessage("{value, date, narrow}", dateSchema, "en")
    ).toThrowError(/Unsupported ICU date style "narrow"/u);
  });

  it("retains every explicitly supported named style", () => {
    for (const style of [
      "integer",
      "percent",
      "currency/USD",
      "custom:money:compact",
    ]) {
      expect(() =>
        parseMessage(`{amount, number, ${style}}`, numberSchema, "en")
      ).not.toThrow();
    }
    for (const kind of ["date", "time"] as const) {
      for (const style of ["short", "medium", "long", "full"]) {
        expect(() =>
          parseMessage(`{value, ${kind}, ${style}}`, dateSchema, "en")
        ).not.toThrow();
      }
    }
  });
});
