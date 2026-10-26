import {
  FORMAT_VERSION,
  RUNTIME_ABI,
  defineMessageDescriptor,
} from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import {
  createTranslationMock,
  resolveTranslationMockPath,
} from "../src/testing";

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

  it("resolves callable compiler-lowered descriptor carriers", () => {
    const callableDescriptor = Object.assign(() => undefined, descriptor);

    expect(
      resolveTranslationMockPath(callableDescriptor, "components.example")
    ).toBe("title");
  });

  it("renders fixture messages with interpolated values", () => {
    const t = createTranslationMock({
      messages: { openLabel: "View details for promotion {code}" },
      namespace: "components.example",
    });

    expect(t("openLabel", { code: "SAVE20" })).toBe(
      "View details for promotion SAVE20"
    );
  });

  it("echoes the values a call was given after its key, in the order passed", () => {
    const t = createTranslationMock({
      echoValues: true,
      namespace: "components.example",
    });

    expect(t(descriptor)).toBe("title");
    expect(t("job.giveAccess", { count: 2, type: "bundle" })).toBe(
      "job.giveAccess(count=2, type=bundle)"
    );
    expect(t("job.giveAccess", { type: "bundle", count: 0 })).toBe(
      "job.giveAccess(type=bundle, count=0)"
    );
    expect(t("job.undo", {})).toBe("job.undo()");
    expect(t("who.course", { course: "Photography 101" })).toBe(
      "who.course(course=Photography 101)"
    );
  });

  it("echoes values after the rendered fixture message", () => {
    const t = createTranslationMock({
      echoValues: true,
      messages: { openLabel: "View promotion {code}" },
    });

    expect(t("openLabel", { code: "SAVE20" })).toBe(
      "View promotion SAVE20(code=SAVE20)"
    );
  });

  it("leaves values out of the text unless echoValues is set", () => {
    const t = createTranslationMock();

    expect(t("job.giveAccess", { count: 2 })).toBe("job.giveAccess");
  });

  it("rejects descriptor-shaped values that were not compiler lowered", () => {
    expect(() =>
      resolveTranslationMockPath({
        path: "components.example.title",
      })
    ).toThrow("compiler-lowered message descriptor");
  });
});
