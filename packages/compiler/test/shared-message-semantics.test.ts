import { describe, expect, it, vi } from "vitest";
import type * as IcuParser from "@formatjs/icu-messageformat-parser";
import { catalogFixtureSource } from "../../../test/fixtures/catalog";
import { compileCatalog } from "../src/compile";
import { emitArtifacts } from "../src/emit";
import { hashIntlFragmentContent } from "../src/compose";
import { mount } from "../src/source";
import {
  inferMessageContract,
  inspectMessageSyntax,
  parseMessage,
} from "../src/parser";
import {
  createMessageSemanticsSession,
  receiveMessageSemanticsSnapshot,
} from "../src/message-semantics";

const calls = vi.hoisted(() => ({ parse: 0 }));
vi.mock("@formatjs/icu-messageformat-parser", async (original) => {
  const actual = await original<typeof IcuParser>();
  return {
    ...actual,
    parse: (...args: Parameters<typeof actual.parse>) => {
      calls.parse += 1;
      return actual.parse(...args);
    },
  };
});

describe("operation-scoped message semantics", () => {
  it("shares syntax across inference and validation, with no ambient reuse", () => {
    calls.parse = 0;
    const session = createMessageSemanticsSession();
    session.run(() => {
      const contract = inferMessageContract("first", { en: "Hello {name}" }, [
        "en",
      ]);
      parseMessage("Hello {name}", contract.valuesSchema, "en");
      expect(
        inferMessageContract("remounted", { en: "Hello {name}" }, ["en"])
      ).toEqual(contract);
      expect(calls.parse).toBe(1);
    });
    inspectMessageSyntax("Hello {name}");
    inspectMessageSyntax("Hello {name}");
    expect(calls.parse).toBe(3);
    expect(session.stats().hits).toBeGreaterThan(0);
  });
});

it("reuses compiled templates while remounting identities and emits every representation byte-for-byte", () => {
  const remounted = {
    ...catalogFixtureSource,
    id: "second-app",
    buildId: "second-build",
    messages: [...catalogFixtureSource.messages]
      .toReversed()
      .map((message) => ({
        ...message,
        path: `app.${message.path}`,
        provenance: `consumer:${message.path}`,
      })),
  };
  const expected = compileCatalog(remounted);
  const session = createMessageSemanticsSession();
  session.run(() => compileCatalog(catalogFixtureSource));
  expect(
    JSON.parse(session.serialize()).entries.some(
      (entry: { stage: string }) => entry.stage === "compiled"
    )
  ).toBe(true);
  calls.parse = 0;
  const received = receiveMessageSemanticsSnapshot(session.serialize());
  const actual = received.run(() => compileCatalog(remounted));
  expect(calls.parse).toBe(0);
  expect(actual.catalog).toEqual(expected.catalog);
  expect(actual.composition).toEqual(expected.composition);
  for (const representation of ["constants", "precompiled", "proxy"] as const) {
    for (const compact of [false, true]) {
      expect(emitArtifacts(actual, representation, { compact })).toEqual(
        emitArtifacts(expected, representation, { compact })
      );
    }
  }
});

it("keeps raw styles distinct and never caches errors or freezes caller schemas", () => {
  const schema = {
    additionalProperties: false,
    properties: { n: { type: "number", finite: true } },
    required: ["n"],
    type: "object",
  } as const;
  const session = createMessageSemanticsSession();
  session.run(() => {
    const parsed = parseMessage("{n, number, custom:café}", schema, "en");
    expect(Object.isFrozen(parsed.nodes)).toBe(true);
    expect(Object.isFrozen(schema.properties.n)).toBe(false);
    for (let index = 0; index < 2; index += 1) {
      expect(() =>
        parseMessage("{n, number, custom:cafe\u0301}", schema, "en")
      ).toThrow("NFC-normalized");
    }
    calls.parse = 0;
    for (let index = 0; index < 2; index += 1) {
      expect(() => inspectMessageSyntax("{broken")).toThrow(
        "EXPECT_ARGUMENT_CLOSING_BRACE"
      );
    }
    expect(calls.parse).toBe(2);
    expect(() =>
      parseMessage("{n, plural, one {one} other {other}}", schema, "th")
    ).toThrow("invalid one category");
    expect(() =>
      parseMessage("{n}", { ...schema, required: [] }, "en")
    ).toThrow("must be required");
    expect(() => parseMessage("", schema, "en")).toThrow("unused");
    expect(() => inferMessageContract("empty", {}, [])).toThrow(
      "at least one locale"
    );
  });
});

it("bounds entries and bytes and isolates nested async sessions", async () => {
  const bounded = createMessageSemanticsSession({
    maxEntries: 1,
    maxBytes: 2048,
  });
  bounded.run(() => {
    inspectMessageSyntax("one");
    inspectMessageSyntax("two");
  });
  expect(bounded.stats().entries).toBe(1);
  expect(bounded.stats().bytes).toBeLessThanOrEqual(2048);
  const tiny = createMessageSemanticsSession({ maxBytes: 0 });
  tiny.run(() => inspectMessageSyntax("hello"));
  expect(tiny.stats().entries).toBe(0);
  const outer = createMessageSemanticsSession();
  const inner = createMessageSemanticsSession();
  calls.parse = 0;
  await outer.run(async () => {
    inspectMessageSyntax("shared");
    await inner.run(async () => {
      await Promise.resolve();
      inspectMessageSyntax("shared");
    });
    inspectMessageSyntax("shared");
  });
  expect(calls.parse).toBe(2);
  expect(outer.stats().hits).toBe(1);
  expect(inner.stats().hits).toBe(0);
});

it("does not memoize accessor schemas and validates changed schema on each call", () => {
  let reads = 0;
  const schema = {
    additionalProperties: false,
    get properties() {
      reads += 1;
      return { n: { type: "number", finite: true } } as const;
    },
    required: ["n"],
    type: "object",
  } as const;
  const session = createMessageSemanticsSession();
  session.run(() => {
    parseMessage("{n, number}", schema, "en");
    const first = reads;
    parseMessage("{n, number}", schema, "en");
    expect(reads).toBeGreaterThan(first);
  });
  expect(session.stats().skipped).toBe(2);
});

it("rejects changed formatter, locale keys, tags, kind and unsafe app keys despite warm semantics", () => {
  const session = createMessageSemanticsSession();
  const money = catalogFixtureSource.messages.find(
    (message) => message.path === "payout.total"
  );
  if (!money) {
    throw new Error("missing fixture");
  }
  const source = { ...catalogFixtureSource, messages: [money] };
  session.run(() => {
    compileCatalog(source);
    expect(() => compileCatalog({ ...source, formatterVersions: {} })).toThrow(
      "not declared in formatterVersions"
    );
    expect(() =>
      compileCatalog({ ...source, messages: [{ ...money, formatterIds: [] }] })
    ).toThrow("do not exactly match normalized IR");
    expect(() =>
      compileCatalog({ ...source, messages: [{ ...money, tags: ["a"] }] })
    ).toThrow("do not match the declared contract");
    expect(() =>
      compileCatalog({ ...source, messages: [{ ...money, kind: "value" }] })
    ).toThrow("formatterIds");
    expect(() =>
      compileCatalog({
        ...source,
        messages: [
          { ...money, translations: { ...money.translations, fr: "bonjour" } },
        ],
      })
    ).toThrow("locale set");
    expect(() =>
      compileCatalog({
        ...source,
        messages: [{ ...money, path: "__proto__.bad" }],
      })
    ).toThrow("unsafe");
    expect(() =>
      compileCatalog({ ...source, messages: [{ ...money, path: "" }] })
    ).toThrow("unsafe");
    const changed = { ...source, formatterVersions: { money: "2.0.0" } };
    expect(compileCatalog(changed).catalog.manifest.hash).not.toBe(
      compileCatalog(source).catalog.manifest.hash
    );
  });
});

it("rejects malformed, duplicate, oversized and foreign-context snapshots", () => {
  const session = createMessageSemanticsSession();
  session.run(() => inspectMessageSyntax("hello"));
  const snapshot = JSON.parse(session.serialize());
  expect(() =>
    receiveMessageSemanticsSnapshot(
      JSON.stringify({ ...snapshot, identity: {} })
    )
  ).toThrow("context");
  expect(() =>
    receiveMessageSemanticsSnapshot(
      JSON.stringify({
        ...snapshot,
        entries: [...snapshot.entries, ...snapshot.entries],
      })
    )
  ).toThrow("duplicate");
  expect(() =>
    receiveMessageSemanticsSnapshot(
      JSON.stringify({
        ...snapshot,
        entries: [{ stage: "syntax", key: "a", value: {} }],
      })
    )
  ).toThrow("entry");
  expect(() =>
    receiveMessageSemanticsSnapshot(session.serialize(), { maxEntries: 0 })
  ).toThrow("bounds");
  expect(() =>
    receiveMessageSemanticsSnapshot(" ".repeat(32 * 1024 * 1024 + 1))
  ).toThrow("bound");
});

it("shares a fragment mounted in different apps while rebuilding validator slots and provenance", () => {
  const content = {
    id: "shared",
    version: "1.0.0",
    locales: catalogFixtureSource.locales,
    messages: catalogFixtureSource.messages,
  };
  const fragment = { ...content, hash: hashIntlFragmentContent(content) };
  const extra = catalogFixtureSource.messages.find(
    (message) => message.path === "greeting.morning"
  );
  if (!extra) {
    throw new Error("missing greeting fixture");
  }
  const first = {
    ...catalogFixtureSource,
    fragments: [mount(fragment, { at: ["shared"] })],
    messages: [],
  };
  const second = {
    ...catalogFixtureSource,
    id: "app-two",
    fragments: [mount(fragment, { at: ["org", "shared"] })],
    messages: [{ ...extra, path: "aaa", provenance: "app-two:aaa" }],
  };
  const baseline = compileCatalog(second);
  const session = createMessageSemanticsSession();
  const uniqueRaw = new Set(
    catalogFixtureSource.messages
      .filter((message) => message.kind !== "value")
      .flatMap((message) => Object.values(message.translations))
  );
  calls.parse = 0;
  session.run(() => compileCatalog(first));
  expect(calls.parse).toBe(uniqueRaw.size);
  calls.parse = 0;
  const actual = session.run(() => compileCatalog(second));
  expect(calls.parse).toBe(0);
  expect(actual.catalog).toEqual(baseline.catalog);
  expect(actual.descriptors).toEqual(baseline.descriptors);
  expect(actual.composition).toEqual(baseline.composition);
  expect(actual.catalog.messages[1]?.validatorId).toBe(1);
  expect(actual.catalog.messages[1]?.path).toBe(
    "org.shared.certificate.verification"
  );
  expect(emitArtifacts(actual, "precompiled", { compact: true })).toEqual(
    emitArtifacts(baseline, "precompiled", { compact: true })
  );
});

it("keys parsed contracts by full schemas and locale, and owned copies resist caller mutation", () => {
  const schema = {
    additionalProperties: false,
    properties: { name: { type: "string", minLength: 1 } },
    required: ["name"],
    type: "object",
  } as const;
  const session = createMessageSemanticsSession();
  session.run(() => {
    parseMessage("Hello {name}", schema, "en");
    const initialMisses = session.stats().misses;
    parseMessage(
      "Hello {name}",
      { ...schema, properties: { name: { type: "string", minLength: 2 } } },
      "en"
    );
    expect(session.stats().misses).toBe(initialMisses + 1);
    parseMessage("Hello {name}", schema, "th");
    expect(session.stats().misses).toBe(initialMisses + 2);
    const inferred = inferMessageContract("first", { en: "{name}" }, ["en"]);
    expect(Object.isFrozen(inferred.valuesSchema.properties.name)).toBe(true);
    expect(() =>
      inferMessageContract("invalid", { en: "{e\u0301}" }, ["en"])
    ).toThrow("NFC-normalized");
  });
  expect(Object.isFrozen(schema)).toBe(false);
});

it("rejects extra snapshot payload fields and freezes received owned nodes", () => {
  const session = createMessageSemanticsSession();
  session.run(() => inspectMessageSyntax("hello"));
  const snapshot = JSON.parse(session.serialize());
  const malformed = {
    ...snapshot,
    entries: snapshot.entries.map((entry: { value: object }) => ({
      ...entry,
      value: { ...entry.value, injected: true },
    })),
  };
  expect(() =>
    receiveMessageSemanticsSnapshot(JSON.stringify(malformed))
  ).toThrow("entry");
  const received = receiveMessageSemanticsSnapshot(session.serialize());
  const syntax = received.run(() => inspectMessageSyntax("hello"));
  expect(Object.isFrozen(syntax.nodes[0])).toBe(true);
  expect(Reflect.set(syntax.nodes[0] ?? {}, "value", "modified")).toBe(false);
  expect(received.run(() => inspectMessageSyntax("hello")).nodes).toEqual([
    { type: "literal", value: "hello" },
  ]);
});
