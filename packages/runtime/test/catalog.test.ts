import type { RuntimeMessage } from "@openmirai/intl-abi";
import { compileCatalog } from "@openmirai/intl-compiler/internal";
import { defineRuntimeCatalog } from "@openmirai/intl-runtime";
import { describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const compiled = compileCatalog(catalogFixtureSource);

describe("runtime catalog assembly", () => {
  it("indexes an immutable tree-shakeable subset by validator identity", () => {
    const first = compiled.catalog.messages[0];
    const greeting = compiled.catalog.messages.find(
      (message) => message.path === "greeting.morning"
    );
    if (!first || !greeting) {
      throw new Error("Missing catalog assembly fixtures");
    }

    const catalog = defineRuntimeCatalog({
      manifest: compiled.catalog.manifest,
      messages: [greeting, first],
    });

    expect(catalog.manifest).toBe(compiled.catalog.manifest);
    expect(catalog.messages[first.validatorId]).toBe(first);
    expect(catalog.messages[greeting.validatorId]).toBe(greeting);
    expect(
      catalog.messages.filter((message) => message !== undefined)
    ).toHaveLength(2);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.messages)).toBe(true);
  });

  it("rejects duplicate, negative, fractional, and excessive validator indexes", () => {
    const message = compiled.catalog.messages[0];
    if (!message) {
      throw new Error("Missing catalog assembly fixture");
    }
    const withValidatorId = (validatorId: number): RuntimeMessage => ({
      ...message,
      validatorId,
    });

    expect(() =>
      defineRuntimeCatalog({
        manifest: compiled.catalog.manifest,
        messages: [message, message],
      })
    ).toThrowError(/duplicate validatorId 0/u);
    expect(() =>
      defineRuntimeCatalog({
        manifest: compiled.catalog.manifest,
        messages: [withValidatorId(-1)],
      })
    ).toThrowError(/non-negative integer/u);
    expect(() =>
      defineRuntimeCatalog({
        manifest: compiled.catalog.manifest,
        messages: [withValidatorId(1.5)],
      })
    ).toThrowError(/non-negative integer/u);
    expect(() =>
      defineRuntimeCatalog({
        manifest: compiled.catalog.manifest,
        messages: [withValidatorId(100_000)],
      })
    ).toThrowError(/supported limit/u);
    expect(() =>
      defineRuntimeCatalog({
        manifest: compiled.catalog.manifest,
        messages: [message, { ...message, validatorId: 1 }],
      })
    ).toThrowError(/duplicate message identity/u);
  });
});
