import { inferMessageContract } from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

describe("message contract inference", () => {
  it("infers scalar, number, select, date, time, formatter, and rich roles", () => {
    const contract = inferMessageContract(
      "example.summary",
      {
        en: "<strong>{name}</strong> {count, plural, one {# item} other {# items}} for {mode, select, compact {{amount, number, custom:money:compact}} other {{publishedAt, date, custom:clock:date} {startsAt, time, custom:clock:time}}}",
        th: "<strong>{name}</strong> {count, plural, other {# รายการ}} สำหรับ {mode, select, compact {{amount, number, custom:money:compact}} other {{publishedAt, date, custom:clock:date} {startsAt, time, custom:clock:time}}}",
      },
      ["en", "th"]
    );

    expect(contract).toEqual({
      formatterIds: ["clock", "money"],
      kind: "rich",
      tags: ["strong"],
      valuesSchema: {
        additionalProperties: false,
        properties: {
          amount: { finite: true, type: "number" },
          count: { finite: true, type: "number" },
          mode: { type: "string" },
          name: { type: "scalar" },
          publishedAt: { type: "date-time" },
          startsAt: { type: "date-time" },
        },
        required: [
          "amount",
          "count",
          "mode",
          "name",
          "publishedAt",
          "startsAt",
        ],
        type: "object",
      },
    });
  });

  it("narrows a plain argument when formatter syntax gives it a stronger role", () => {
    expect(
      inferMessageContract(
        "example.count",
        { en: "{count}: {count, number}", th: "{count}: {count, number}" },
        ["en", "th"]
      ).valuesSchema.properties
    ).toEqual({ count: { finite: true, type: "number" } });
  });

  it.each([
    {
      en: "{value, number}",
      error: /incompatible inferred argument contracts in th/u,
      th: "{value, select, other {ok}}",
    },
    {
      en: "<strong>Hello</strong>",
      error: /incompatible inferred rich tags in th/u,
      th: "<em>สวัสดี</em>",
    },
    {
      en: "<strong>Hello</strong> <strong>again</strong>",
      error: /incompatible parsed contracts in th/u,
      th: "<strong>สวัสดี</strong>",
    },
    {
      en: "{count, plural, =0 {none} other {some}} {count, plural, =0 {zero again} other {more}}",
      error: /incompatible parsed contracts in th/u,
      th: "{count, plural, =0 {ไม่มี} other {มี}} {count, plural, other {เพิ่มเติม}}",
    },
    {
      en: "{amount, number, percent}",
      error: /incompatible parsed contracts in th/u,
      th: "{amount, number, integer}",
    },
  ])("rejects locale contract drift", ({ en, error, th }) => {
    expect(() =>
      inferMessageContract("example.drift", { en, th }, ["en", "th"])
    ).toThrowError(error);
  });
});
