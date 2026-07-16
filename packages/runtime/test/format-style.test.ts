import {
  renderPrecompiledDate,
  renderPrecompiledNumber,
  renderPrecompiledTime,
} from "@openmirai/intl-runtime";
import { describe, expect, it } from "vitest";

const state = {
  escapeValues: false,
  formatters: {},
  locale: "en",
  values: {
    amount: 1_200,
    value: "2026-07-14T12:34:56.000Z",
  },
} as const;

const customState = {
  ...state,
  formatters: {
    clock: {
      format(value: unknown, locale: string, options?: string): string {
        if (typeof value !== "string") {
          throw new TypeError("Clock value must be a date-time string");
        }
        return `${locale}/${options ?? "default"}/${value}`;
      },
      version: "1.0.0",
    },
  },
} as const;

describe("precompiled format style handling", () => {
  it("rejects unknown styles instead of silently using defaults", () => {
    expect(() =>
      renderPrecompiledNumber(state, "amount", "compact")
    ).toThrowError(/Unsupported number style compact/u);
    expect(() =>
      renderPrecompiledNumber(state, "amount", "currency/usd")
    ).toThrowError(/Unsupported number style currency\/usd/u);
    expect(() => renderPrecompiledDate(state, "value", "narrow")).toThrowError(
      /Unsupported date style narrow/u
    );
    expect(() => renderPrecompiledTime(state, "value", "narrow")).toThrowError(
      /Unsupported time style narrow/u
    );
  });

  it("keeps supported default, named, and currency rendering available", () => {
    expect(renderPrecompiledNumber(state, "amount")).toBe("1,200");
    expect(renderPrecompiledNumber(state, "amount", "currency/USD")).toBe(
      "$1,200.00"
    );
    expect(renderPrecompiledDate(state, "value", "full")).toContain("Tuesday");
    expect(renderPrecompiledTime(state, "value")).toContain("12:34:56");
  });

  it("routes custom date and time styles through the registered formatter", () => {
    expect(
      renderPrecompiledDate(customState, "value", "custom:clock:date")
    ).toBe("en/date/2026-07-14T12:34:56.000Z");
    expect(
      renderPrecompiledTime(customState, "value", "custom:clock:time")
    ).toBe("en/time/2026-07-14T12:34:56.000Z");
  });
});
