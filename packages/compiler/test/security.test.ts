import {
  compileCatalog,
  createCatalogContentIdentity,
  emitArtifacts,
  hashCatalogContent,
} from "@openmirai/intl-compiler/internal";
import type {
  CatalogSource,
  MessageSource,
} from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

function messageAt(path: string): MessageSource {
  const message = catalogFixtureSource.messages.find(
    (candidate) => candidate.path === path
  );
  if (!message) {
    throw new Error(`Missing fixture message ${path}`);
  }
  return message;
}

function replaceMessage(
  source: CatalogSource,
  path: string,
  replacement: (message: MessageSource) => MessageSource
): CatalogSource {
  return {
    ...source,
    messages: source.messages.map((message) =>
      message.path === path ? replacement(message) : message
    ),
  };
}

function singleMessageSource(
  message: MessageSource,
  formatterVersions: Readonly<Record<string, string>> = {}
): CatalogSource {
  return {
    ...catalogFixtureSource,
    formatterVersions,
    fragments: [],
    messages: [message],
    replacements: [],
  };
}

describe("catalog security identity", () => {
  it("binds every material normalized runtime-contract field", () => {
    const baseline = compileCatalog(catalogFixtureSource).catalog.manifest;
    const greeting = messageAt("greeting.morning");
    const payout = messageAt("payout.total");
    const rich = messageAt("rich.deactivate");
    const structured = messageAt("certificate.verification");
    const variants: ReadonlyArray<readonly [string, CatalogSource]> = [
      [
        "argument schema",
        replaceMessage(catalogFixtureSource, greeting.path, (message) => ({
          ...message,
          valuesSchema: {
            ...message.valuesSchema,
            properties: {
              ...message.valuesSchema.properties,
              name: { maxLength: 128, type: "string" },
            },
          },
        })),
      ],
      [
        "result schema",
        replaceMessage(catalogFixtureSource, greeting.path, (message) => ({
          ...message,
          resultSchema: { maxLength: 4096, type: "string" },
        })),
      ],
      [
        "rich tags",
        replaceMessage(catalogFixtureSource, rich.path, (message) => ({
          ...message,
          tags: ["emphasis", "medium"],
          translations: {
            en: "<emphasis>Deactivate <medium>{name}</medium>?</emphasis>",
            th: "<emphasis>ปิดใช้งาน <medium>{name}</medium> หรือไม่?</emphasis>",
          },
        })),
      ],
      [
        "formatter assignment",
        replaceMessage(
          { ...catalogFixtureSource, formatterVersions: { cash: "1.0.0" } },
          payout.path,
          (message) => ({
            ...message,
            formatterIds: ["cash"],
            translations: {
              en: "Total: {amount, number, custom:cash:compact}",
              th: "ยอดรวม: {amount, number, custom:cash:compact}",
            },
          })
        ),
      ],
      [
        "formatter version",
        { ...catalogFixtureSource, formatterVersions: { money: "2.0.0" } },
      ],
      ["source locale", { ...catalogFixtureSource, sourceLocale: "th" }],
      ["locale ordering", { ...catalogFixtureSource, locales: ["th", "en"] }],
      [
        "message identity",
        replaceMessage(catalogFixtureSource, greeting.path, (message) => ({
          ...message,
          path: "greeting.sunrise",
        })),
      ],
      [
        "normalized IR",
        replaceMessage(catalogFixtureSource, greeting.path, (message) => ({
          ...message,
          translations: {
            en: "Hello, {name}",
            th: "สวัสดี {name}",
          },
        })),
      ],
      [
        "structured locale payload",
        replaceMessage(catalogFixtureSource, structured.path, (message) => ({
          ...message,
          translations: {
            ...message.translations,
            en: {
              fields: [{ label: "Learner", value: "Approved" }],
              title: "Certificate verification",
            },
          },
        })),
      ],
    ];

    for (const [name, source] of variants) {
      const manifest = compileCatalog(source).catalog.manifest;
      expect([name, manifest.hash]).not.toEqual([name, baseline.hash]);
      expect([name, manifest.buildToken]).not.toEqual([
        name,
        baseline.buildToken,
      ]);
    }
  });

  it("keeps release and diagnostic metadata outside canonical content identity", () => {
    const baseline = compileCatalog(catalogFixtureSource);
    const movedSource = replaceMessage(
      catalogFixtureSource,
      "greeting.morning",
      (message) => ({
        ...message,
        provenance: "moved/locales/en.json:greeting.morning",
      })
    );
    const moved = compileCatalog(movedSource);
    const rebuilt = compileCatalog({
      ...catalogFixtureSource,
      buildId: "different-release-build",
    });
    const repackaged = compileCatalog({
      ...catalogFixtureSource,
      catalogPackage: "@mirai/intl-catalog-repackaged",
    });

    expect(moved.composition.provenance).not.toEqual(
      baseline.composition.provenance
    );
    expect(moved.catalog.manifest.hash).toBe(baseline.catalog.manifest.hash);
    expect(moved.catalog.manifest.localeHashes).toEqual(
      baseline.catalog.manifest.localeHashes
    );
    expect(rebuilt.catalog.manifest.hash).toBe(baseline.catalog.manifest.hash);
    expect(rebuilt.catalog.manifest.buildToken).not.toBe(
      baseline.catalog.manifest.buildToken
    );
    expect(repackaged.catalog.manifest.hash).toBe(
      baseline.catalog.manifest.hash
    );
    expect(repackaged.catalog.manifest.buildToken).toBe(
      baseline.catalog.manifest.buildToken
    );

    const identity = createCatalogContentIdentity(
      catalogFixtureSource,
      baseline.catalog.messages,
      baseline.composition
    );
    const messagesWithDifferentDiagnosticReferences =
      baseline.catalog.messages.map((message) => ({
        ...message,
        provenanceRef: `diagnostic:${message.id}`,
      }));
    const identityWithDifferentDiagnosticReferences =
      createCatalogContentIdentity(
        catalogFixtureSource,
        messagesWithDifferentDiagnosticReferences,
        baseline.composition
      );
    const identityWithReleaseMetadata = {
      ...identity,
      buildId: "ignored-build-metadata",
      catalogPackage: "@mirai/ignored-package-metadata",
      compilerVersion: "999.0.0-diagnostic-only",
    };

    expect(identityWithDifferentDiagnosticReferences.localeHashes).toEqual(
      identity.localeHashes
    );
    expect(hashCatalogContent(identityWithDifferentDiagnosticReferences)).toBe(
      baseline.catalog.manifest.hash
    );
    expect(hashCatalogContent(identityWithReleaseMetadata)).toBe(
      baseline.catalog.manifest.hash
    );
  });

  it("derives an exact unique custom formatter dependency set from IR", () => {
    const payout = messageAt("payout.total");
    const greeting = messageAt("greeting.morning");

    expect(() =>
      compileCatalog(
        singleMessageSource(
          { ...payout, formatterIds: ["money", "money"] },
          { money: "1.0.0" }
        )
      )
    ).toThrowError(/formatterIds contains duplicates/u);
    expect(() =>
      compileCatalog(
        singleMessageSource(
          { ...greeting, formatterIds: ["money"] },
          { money: "1.0.0" }
        )
      )
    ).toThrowError(/do not exactly match normalized IR/u);
    expect(() =>
      compileCatalog(
        singleMessageSource(
          { ...payout, formatterIds: [] },
          {
            money: "1.0.0",
          }
        )
      )
    ).toThrowError(/do not exactly match normalized IR/u);
    expect(() => compileCatalog(singleMessageSource(payout))).toThrowError(
      /formatter money is not declared/u
    );
    expect(() =>
      compileCatalog(singleMessageSource(greeting, { money: "1.0.0" }))
    ).toThrowError(/do not exactly cover used formatters/u);
  });

  it("rejects bare and malformed custom formatter styles", () => {
    const payout = messageAt("payout.total");

    expect(() =>
      compileCatalog(
        singleMessageSource(
          {
            ...payout,
            translations: {
              en: "Total: {amount, number, money}",
              th: "ยอดรวม: {amount, number, money}",
            },
          },
          { money: "1.0.0" }
        )
      )
    ).toThrowError(/must use custom:money syntax/u);
    expect(() =>
      compileCatalog(
        singleMessageSource(
          {
            ...payout,
            translations: {
              en: "Total: {amount, number, custom:money:compact:ignored}",
              th: "ยอดรวม: {amount, number, custom:money:compact:ignored}",
            },
          },
          { money: "1.0.0" }
        )
      )
    ).toThrowError(/invalid custom formatter style/u);
  });

  it("keeps raw source provenance out of the runtime artifact", () => {
    const artifacts = emitArtifacts(
      compileCatalog(catalogFixtureSource),
      "constants"
    );
    const runtime = artifacts["catalog.runtime.gen.json"];
    const provenance = artifacts["catalog.provenance.gen.json"];

    expect(runtime).toContain('"provenanceRef":"message:msg_');
    expect(runtime).not.toContain("test/fixtures/catalog.ts");
    expect(runtime).not.toContain("source:");
    expect(provenance).toContain("test/fixtures/catalog.ts");
  });
});
