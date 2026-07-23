import {
  FORMAT_VERSION,
  RUNTIME_ABI,
  defineMessageDescriptor,
} from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import { resolveTranslationMockPath } from "../src/testing";

const descriptor = defineMessageDescriptor({
  buildToken: "test-build",
  capabilitySetHash: "sha256:test-capabilities",
  catalogHash: "sha256:test-catalog",
  catalogId: "test-catalog",
  formatVersion: FORMAT_VERSION,
  kind: "text",
  messageId: "components.example.title",
  path: "components.example.title",
  rendererCapabilityId: "precompiled-v1",
  runtimeAbi: RUNTIME_ABI,
  validatorId: 1,
});

describe("resolveTranslationMockPath", () => {
  it("supports literal keys when compiler lowering is unavailable", () => {
    expect(resolveTranslationMockPath("title", "components.example")).toBe(
      "title"
    );
  });

  it("resolves compiler-lowered message descriptors", () => {
    expect(resolveTranslationMockPath(descriptor)).toBe(
      "components.example.title"
    );
    expect(resolveTranslationMockPath(descriptor, "components.example")).toBe(
      "title"
    );
  });

  it("rejects descriptor-shaped values that were not compiler lowered", () => {
    expect(() =>
      resolveTranslationMockPath({
        path: "components.example.title",
      })
    ).toThrow("compiler-lowered message descriptor");
  });
});
