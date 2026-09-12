import { defineMessageDescriptor } from "@openmirai/intl-abi";
import type { Sha256 } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import {
  createMiraiIntlCallSites,
  createPrecompiledDescriptor,
  createPrecompiledRuntimeMessage,
  getEmbeddedRuntimeMessage,
  getPrecompiledRenderer,
} from "../src/representations";
import type { MiraiIntlCallSiteShared } from "../src/representations";

const capabilitySetHash: Sha256 = `sha256:${"a".repeat(64)}`;
const catalogHash: Sha256 = `sha256:${"b".repeat(64)}`;
const shared = {
  buildToken: "call-site-build:0123456789ab",
  capabilitySetHash,
  catalogHash,
  catalogId: "catalog-fixture",
  formatVersion: 1,
  rendererCapabilityId: "portable-ir-v1",
  runtimeAbi: "1.0.0",
} as const satisfies MiraiIntlCallSiteShared;

const emptyArgumentSchema = {
  additionalProperties: false,
  properties: {},
  required: [],
  type: "object",
} as const;

describe("shared call-site factories", () => {
  it("rebuilds the descriptor the legacy emission spelled out per call site", () => {
    const callSites = createMiraiIntlCallSites(shared);
    const actual = callSites.text(7, "msg_7", "greeting.morning");
    const expected = createPrecompiledDescriptor(
      defineMessageDescriptor({
        buildToken: shared.buildToken,
        capabilitySetHash: shared.capabilitySetHash,
        catalogHash: shared.catalogHash,
        catalogId: shared.catalogId,
        formatVersion: shared.formatVersion,
        kind: "text",
        messageId: "msg_7",
        path: "greeting.morning",
        rendererCapabilityId: shared.rendererCapabilityId,
        runtimeAbi: shared.runtimeAbi,
        validatorId: 7,
      })
    );

    expect({ ...actual }).toStrictEqual({ ...expected });
    expect(Object.isFrozen(actual)).toBe(true);
    expect(getEmbeddedRuntimeMessage(actual)).toStrictEqual({
      argumentSchema: emptyArgumentSchema,
      formatterIds: [],
      id: "msg_7",
      kind: "text",
      path: "greeting.morning",
      provenanceRef: "message:msg_7",
      resultSchema: { type: "string" },
      tags: [],
      validatorId: 7,
    });
  });

  it("rebuilds the argument schema, formatters, and optional text renderer", () => {
    const callSites = createMiraiIntlCallSites(shared);
    const renderer = (): string => "Total";
    const withArguments = callSites.text(
      8,
      "msg_8",
      "payout.total",
      { amount: { finite: true, type: "number" } },
      ["amount"],
      ["money"],
      renderer
    );

    expect(getEmbeddedRuntimeMessage(withArguments)).toStrictEqual({
      argumentSchema: {
        additionalProperties: false,
        properties: { amount: { finite: true, type: "number" } },
        required: ["amount"],
        type: "object",
      },
      formatterIds: ["money"],
      id: "msg_8",
      kind: "text",
      path: "payout.total",
      provenanceRef: "message:msg_8",
      resultSchema: { type: "string" },
      tags: [],
      validatorId: 8,
    });
    expect(getPrecompiledRenderer(withArguments)).toBe(renderer);
    expect(
      getPrecompiledRenderer(getEmbeddedRuntimeMessage(withArguments))
    ).toBe(renderer);
  });

  it("omits the renderer brand when no text renderer is emitted", () => {
    const callSites = createMiraiIntlCallSites(shared);
    const message = callSites.text(1, "msg_1", "cart.title");

    expect(getPrecompiledRenderer(message)).toBeUndefined();
    expect(getPrecompiledRenderer(getEmbeddedRuntimeMessage(message))).toBe(
      undefined
    );
  });

  it("carries rich tags and value result schemas", () => {
    const callSites = createMiraiIntlCallSites(shared);
    const richRenderer = (): ReadonlyArray<string> => ["Deactivate"];
    const valueRenderer = (): number => 0.875;
    const rich = callSites.rich(
      10,
      "msg_10",
      "rich.deactivate",
      richRenderer,
      ["medium"],
      { name: { type: "string" } },
      ["name"]
    );
    const value = callSites.value(
      12,
      "msg_12",
      "statistics.passRate",
      valueRenderer,
      {
        finite: true,
        type: "number",
      }
    );

    expect(rich.kind).toBe("rich");
    expect(getEmbeddedRuntimeMessage(rich)).toMatchObject({
      kind: "rich",
      resultSchema: { type: "string" },
      tags: ["medium"],
    });
    expect(getPrecompiledRenderer(rich)).toBe(richRenderer);
    expect(value.kind).toBe("value");
    expect(getEmbeddedRuntimeMessage(value)).toStrictEqual({
      argumentSchema: emptyArgumentSchema,
      formatterIds: [],
      id: "msg_12",
      kind: "value",
      path: "statistics.passRate",
      provenanceRef: "message:msg_12",
      resultSchema: { finite: true, type: "number" },
      tags: [],
      validatorId: 12,
    });
    expect(getPrecompiledRenderer(value)).toBe(valueRenderer);
  });

  it("produces runtime messages congruent with the legacy precompiled factory", () => {
    const callSites = createMiraiIntlCallSites(shared);
    const renderer = (): string => "Good morning";
    const actual = getEmbeddedRuntimeMessage(
      callSites.text(
        7,
        "msg_7",
        "greeting.morning",
        { name: { type: "string" } },
        ["name"],
        undefined,
        renderer
      )
    );
    const expected = createPrecompiledRuntimeMessage(
      {
        argumentSchema: {
          additionalProperties: false,
          properties: { name: { type: "string" } },
          required: ["name"],
          type: "object",
        },
        formatterIds: [],
        id: "msg_7",
        kind: "text",
        path: "greeting.morning",
        provenanceRef: "message:msg_7",
        resultSchema: { type: "string" },
        tags: [],
        validatorId: 7,
      },
      renderer
    );

    expect(actual).toStrictEqual(expected);
    expect(Object.isFrozen(actual)).toBe(true);
  });

  it("returns a frozen builder set", () => {
    const callSites = createMiraiIntlCallSites(shared);

    expect(Object.isFrozen(callSites)).toBe(true);
    expect(Object.keys(callSites).toSorted()).toStrictEqual([
      "rich",
      "text",
      "value",
    ]);
  });
});
