import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptyObjectSchema } from "@openmirai/intl-abi";
import type { Sha256 } from "@openmirai/intl-abi";
import {
  artifactContentHash,
  canonicalJson,
  compileCatalog,
  emitArtifacts,
  hashIntlFragmentContent,
  mount,
  writeArtifactSet,
} from "@openmirai/intl-compiler/internal";
import type {
  CatalogSource,
  IntlFragment,
  IntlFragmentContent,
  MessageSource,
  ReplacementDeclaration,
} from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const stablePaths = [
  "certificate.verification",
  "editor.limit",
  "formatting.date",
  "formatting.number",
  "formatting.ordinal",
  "formatting.percent",
  "formatting.time",
  "greeting.morning",
  "payout.total",
  "results.summary",
  "rich.deactivate",
  "rich.legal",
  "statistics.passRate",
] as const;

function messageAt(path: string): MessageSource {
  const message = catalogFixtureSource.messages.find(
    (candidate) => candidate.path === path
  );
  if (!message) {
    throw new Error(`Missing fixture message ${path}`);
  }
  return message;
}

function sourceWith(message: MessageSource): CatalogSource {
  return {
    ...catalogFixtureSource,
    formatterVersions: message.formatterIds?.includes("money")
      ? { money: "1.0.0" }
      : {},
    fragments: [],
    messages: [message],
    replacements: [],
  };
}

function replacementFixture(): Readonly<{
  baseMessage: MessageSource;
  fragment: IntlFragment;
  replacement: ReplacementDeclaration;
  replacementMessage: MessageSource;
  source: CatalogSource;
}> {
  const baseMessage: MessageSource = {
    kind: "text",
    path: "CartCard.applyCoupon",
    provenance: "packages/shared/locales/en.json:17",
    resultSchema: { type: "string" },
    translations: { en: "Apply coupon", th: "ใช้คูปอง" },
    valuesSchema: emptyObjectSchema,
  };
  const fragmentContent: IntlFragmentContent = {
    id: "@mirai/shared-checkout",
    locales: ["en", "th"],
    messages: [baseMessage],
    version: "1.0.0",
  };
  const fragment: IntlFragment = {
    ...fragmentContent,
    hash: hashIntlFragmentContent(fragmentContent),
  };
  const replacementMessage: MessageSource = {
    ...baseMessage,
    provenance: "apps/learner/locales/en.json:42",
    translations: { en: "Use coupon", th: "ใช้รหัสคูปอง" },
  };
  const replacement: ReplacementDeclaration = {
    base: {
      fragmentId: fragment.id,
      hash: fragment.hash,
      version: fragment.version,
    },
    exactKey: baseMessage.path,
    provenance: {
      decision: "ADR-0001",
      owner: "learner-team",
      source: "catalog-overlap-audit",
    },
    reason: "Preserve the audited learner wording",
  };
  const source = {
    ...catalogFixtureSource,
    formatterVersions: {},
    fragments: [mount(fragment, { at: [] })],
    messages: [replacementMessage],
    replacements: [replacement],
  } satisfies CatalogSource;

  return {
    baseMessage,
    fragment,
    replacement,
    replacementMessage,
    source,
  };
}

describe("canonical compiler identities", () => {
  it("orders NFC Unicode keys by stable UTF-16 code units", () => {
    expect(canonicalJson({ äther: 1, zeta: 2 })).toBe('{"zeta":2,"äther":1}');
  });

  it("rejects nested non-NFC and normalization-colliding keys", () => {
    expect(() =>
      canonicalJson({ nested: { "e\u0301": "decomposed" } })
    ).toThrowError(/not NFC-normalized/u);

    const collision: Record<string, string> = {
      é: "composed",
      "e\u0301": "decomposed",
    };
    expect(() => canonicalJson({ nested: collision })).toThrowError(
      /same NFC form/u
    );
  });

  it("orders Unicode message paths without host collation", () => {
    const base = messageAt("certificate.verification");
    const output = compileCatalog({
      ...catalogFixtureSource,
      formatterVersions: {},
      fragments: [],
      messages: [
        { ...base, path: "äther" },
        { ...base, path: "zeta" },
      ],
      replacements: [],
    });

    expect(output.catalog.messages.map((message) => message.path)).toEqual([
      "zeta",
      "äther",
    ]);
  });

  it("hashes normalized fragment content without source-file provenance", () => {
    const rich = messageAt("rich.deactivate");
    const baseline = {
      id: "@mirai/fragment-identity",
      locales: ["en", "th"],
      messages: [rich],
      version: "1.0.0",
    } satisfies IntlFragmentContent;
    const baselineHash = hashIntlFragmentContent(baseline);
    const movedSource = {
      ...baseline,
      messages: [
        {
          ...rich,
          provenance: "moved/packages/locales/rich.deactivate.json",
        },
      ],
    } satisfies IntlFragmentContent;
    const contentVariants: ReadonlyArray<IntlFragmentContent> = [
      { ...baseline, id: "@mirai/other-fragment" },
      { ...baseline, locales: ["en", "th", "fr"] },
      { ...baseline, version: "1.0.1" },
      {
        ...baseline,
        messages: [{ ...rich, path: "rich.disable" }],
      },
      {
        ...baseline,
        messages: [
          {
            ...rich,
            resultSchema: { maxLength: 512, type: "string" },
          },
        ],
      },
      {
        ...baseline,
        messages: [
          {
            ...rich,
            tags: ["emphasis"],
          },
        ],
      },
      {
        ...baseline,
        messages: [
          {
            ...rich,
            translations: {
              ...rich.translations,
              en: "Disable <medium>{name}</medium>?",
            },
          },
        ],
      },
      {
        ...baseline,
        messages: [
          {
            ...rich,
            valuesSchema: {
              ...rich.valuesSchema,
              properties: {
                ...rich.valuesSchema.properties,
                name: { maxLength: 128, type: "string" },
              },
            },
          },
        ],
      },
    ];

    expect(hashIntlFragmentContent(movedSource)).toBe(baselineHash);
    for (const variant of contentVariants) {
      expect(hashIntlFragmentContent(variant)).not.toBe(baselineHash);
    }

    const payout = messageAt("payout.total");
    const formatterBaseline = {
      ...baseline,
      messages: [payout],
    } satisfies IntlFragmentContent;
    expect(
      hashIntlFragmentContent({
        ...formatterBaseline,
        messages: [{ ...payout, formatterIds: ["cash"] }],
      })
    ).not.toBe(hashIntlFragmentContent(formatterBaseline));

    const structured = messageAt("certificate.verification");
    const valueBaseline = {
      ...baseline,
      messages: [structured],
    } satisfies IntlFragmentContent;
    expect(
      hashIntlFragmentContent({
        ...valueBaseline,
        messages: [
          {
            ...structured,
            translations: {
              ...structured.translations,
              en: {
                fields: [{ label: "Learner", value: "Approved" }],
                title: "Certificate verification",
              },
            },
          },
        ],
      })
    ).not.toBe(hashIntlFragmentContent(valueBaseline));
  });
});

describe("catalog compiler fixture", () => {
  it("compiles the stable EN/TH interpolation, plural, select, rich, and value corpus", () => {
    const output = compileCatalog(catalogFixtureSource);

    expect(output.catalog.messages.map((message) => message.path)).toEqual(
      stablePaths
    );
    expect(output.descriptors.map((descriptor) => descriptor.path)).toEqual(
      stablePaths
    );
    expect(output.catalog.manifest.locales).toEqual(["en", "th"]);
    expect(output.catalog.manifest.hash).toMatch(/^sha256:[a-f\d]{64}$/u);
    expect(output.catalog.manifest.localeHashes.en).toMatch(
      /^sha256:[a-f\d]{64}$/u
    );
    expect(output.catalog.manifest.localeHashes.th).toMatch(
      /^sha256:[a-f\d]{64}$/u
    );

    const legal = output.catalog.messages.find(
      (message) => message.path === "rich.legal"
    );
    expect(legal?.tags).toEqual(["legal", "strong"]);
    expect(legal?.localeNodes?.th).toEqual([
      {
        children: [
          {
            children: [{ name: "name", type: "argument" }],
            name: "strong",
            type: "tag",
          },
          { type: "literal", value: " อ่านข้อกำหนด" },
        ],
        name: "legal",
        type: "tag",
      },
    ]);
  });

  it("rejects incomplete or extra locale sets", () => {
    const greeting = messageAt("greeting.morning");

    expect(() =>
      compileCatalog(
        sourceWith({
          ...greeting,
          translations: { en: greeting.translations.en ?? "" },
        })
      )
    ).toThrowError(/locale set en does not match en,th/u);
    expect(() =>
      compileCatalog(
        sourceWith({
          ...greeting,
          translations: {
            ...greeting.translations,
            fr: "Bonjour {name}",
          },
        })
      )
    ).toThrowError(/locale set en,fr,th does not match en,th/u);
  });

  it("rejects locale argument-name signature drift", () => {
    const greeting = messageAt("greeting.morning");

    expect(() =>
      compileCatalog(
        sourceWith({
          ...greeting,
          translations: {
            ...greeting.translations,
            th: "สวัสดีตอนเช้า {learner}",
          },
        })
      )
    ).toThrowError(/Argument learner requires an inferred scalar schema/u);
  });

  it("rejects formatter syntax that disagrees with the declared argument role", () => {
    const greeting = messageAt("greeting.morning");
    const translations = {
      en: "Good morning, {name, number}",
      th: "สวัสดีตอนเช้า {name, number}",
    };

    expect(() =>
      compileCatalog(sourceWith({ ...greeting, translations }))
    ).toThrowError(
      /Argument name expects number syntax but schema declares string/u
    );
  });

  it("allows one numeric argument to be interpolated plainly and used by numeric ICU roles", () => {
    const source = sourceWith({
      kind: "text",
      path: "dashboard.usageSummary",
      provenance: "locales/pages/dashboard/{en,th}.json:usageSummary",
      resultSchema: { type: "string" },
      translations: {
        en: "{current} of {limit} {limit, plural, =1 {block} other {blocks}} used ({current, number})",
        th: "{current, number} ({current}) จาก {limit, plural, =1 {บล็อก} other {บล็อก}} ใช้ไปแล้ว {limit}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: {
          current: { finite: true, type: "number" },
          limit: { finite: true, type: "number" },
        },
        required: ["current", "limit"],
        type: "object",
      },
    });

    expect(() => compileCatalog(source)).not.toThrow();
  });

  it("keeps locale signatures strict when compatible numeric syntax sets drift", () => {
    const source = sourceWith({
      kind: "text",
      path: "dashboard.count",
      provenance: "locales/pages/dashboard/{en,th}.json:count",
      resultSchema: { type: "string" },
      translations: {
        en: "Count: {count}",
        th: "จำนวน: {count, number}",
      },
      valuesSchema: {
        additionalProperties: false,
        properties: { count: { finite: true, type: "number" } },
        required: ["count"],
        type: "object",
      },
    });

    expect(() => compileCatalog(source)).toThrowError(
      /incompatible argument signatures in th/u
    );
  });

  it("requires every message formatter to have an exact manifest version entry", () => {
    const payout = messageAt("payout.total");
    const inheritedVersions = Object.create({ money: "1.0.0" }) as Record<
      string,
      string
    >;

    expect(() =>
      compileCatalog({
        ...sourceWith(payout),
        formatterVersions: {},
      })
    ).toThrowError(
      /payout\.total formatter money is not declared in formatterVersions/u
    );
    expect(() =>
      compileCatalog({
        ...sourceWith(payout),
        formatterVersions: inheritedVersions,
      })
    ).toThrowError(
      /payout\.total formatter money is not declared in formatterVersions/u
    );
  });

  it("rejects empty, non-canonical, and prototype-sensitive path segments", () => {
    const greeting = messageAt("greeting.morning");
    for (const path of [
      "",
      ".greeting",
      "greeting.",
      "greeting..morning",
      "greeting.__proto__",
      "greeting.constructor",
      "greeting.prototype",
      "greeting. morning",
      "greeting.e\u0301",
    ]) {
      expect(() =>
        compileCatalog(sourceWith({ ...greeting, path }))
      ).toThrowError(/Message path contains an unsafe path segment/u);
    }
  });

  it("rejects ambiguous or prototype-sensitive fragment mount segments", () => {
    const fragment = {
      hash: "sha256:mounted-fragment" as Sha256,
      id: "@mirai/mounted",
      locales: ["en", "th"],
      messages: [messageAt("greeting.morning")],
      version: "1.0.0",
    };

    for (const at of [["packages.ui"], ["packages", "__proto__"]]) {
      expect(() =>
        compileCatalog({
          ...catalogFixtureSource,
          fragments: [mount(fragment, { at })],
          messages: [],
          replacements: [],
        })
      ).toThrowError(/Fragment mount path contains an unsafe path segment/u);
    }
  });

  it("allows locale-specific CLDR categories but rejects invalid Thai categories", () => {
    const plural = messageAt("results.summary");

    expect(() => compileCatalog(sourceWith(plural))).not.toThrow();
    expect(() =>
      compileCatalog(
        sourceWith({
          ...plural,
          translations: {
            ...plural.translations,
            th: "{count, plural, one {หนึ่งรายการ} other {# รายการ}}",
          },
        })
      )
    ).toThrowError(/Plural count uses invalid one category for th/u);
  });

  it("rejects locale drift in exact plural branches", () => {
    const plural = messageAt("results.summary");

    expect(() =>
      compileCatalog(
        sourceWith({
          ...plural,
          translations: {
            ...plural.translations,
            th: "{count, plural, other {# รายการ}}",
          },
        })
      )
    ).toThrowError(/incompatible exact plural branches in th/u);
  });

  it("allows legal rich-tag reordering and nesting but rejects tag-contract drift", () => {
    expect(() =>
      compileCatalog(sourceWith(messageAt("rich.legal")))
    ).not.toThrow();

    const rich = messageAt("rich.deactivate");
    expect(() =>
      compileCatalog(
        sourceWith({
          ...rich,
          translations: {
            ...rich.translations,
            th: "ปิดใช้งาน <strong>{name}</strong> หรือไม่?",
          },
        })
      )
    ).toThrowError(/incompatible rich tag multiplicity in th/u);
  });

  it("rejects structured locale values that do not match the exact result shape", () => {
    const value = messageAt("certificate.verification");

    expect(() =>
      compileCatalog(
        sourceWith({
          ...value,
          translations: {
            ...value.translations,
            th: {
              fields: [{ value: "ยืนยันแล้ว" }],
              title: "การตรวจสอบใบรับรอง",
            },
          },
        })
      )
    ).toThrowError(/invalid th structured value at \$\.fields\[0\]\.label/u);
  });

  it("reports both provenance chains for an undeclared exact collision", () => {
    const fragmentMessage: MessageSource = {
      kind: "text",
      path: "CartCard.applyCoupon",
      provenance: "learner/locales/en.json:42",
      resultSchema: { type: "string" },
      translations: { en: "Apply", th: "ใช้" },
      valuesSchema: emptyObjectSchema,
    };
    const fragmentContent = {
      id: "@mirai/learner",
      locales: ["en", "th"],
      messages: [fragmentMessage],
      version: "1.0.0",
    } satisfies IntlFragmentContent;
    const fragment = {
      ...fragmentContent,
      hash: hashIntlFragmentContent(fragmentContent),
    } satisfies IntlFragment;
    const appMessage: MessageSource = {
      ...fragmentMessage,
      provenance: "packages/shared/locales/en.json:17",
      translations: { en: "Apply coupon", th: "ใช้คูปอง" },
    };
    const source = {
      ...catalogFixtureSource,
      fragments: [mount(fragment, { at: [] })],
      messages: [appMessage],
      replacements: [],
    } satisfies CatalogSource;

    expect(() => compileCatalog(source)).toThrowError(
      /Collision at CartCard\.applyCoupon: learner\/locales\/en\.json:42 conflicts with packages\/shared\/locales\/en\.json:17/u
    );
  });

  it("accepts one exact replacement with verified content identity and provenance", () => {
    const fixture = replacementFixture();
    const output = compileCatalog(fixture.source);

    expect(output.composition.messages).toHaveLength(1);
    expect(output.composition.messages[0]?.translations.en).toBe("Use coupon");
    expect(output.composition.provenance.at(-1)).toEqual({
      action: "replace",
      base: fixture.baseMessage.provenance,
      path: fixture.baseMessage.path,
      replacement: fixture.replacement,
      source: fixture.replacementMessage.provenance,
    });
  });

  it("binds stable composition ownership and exact replacement declarations", () => {
    const fixture = replacementFixture();
    const baseline = compileCatalog(fixture.source);
    const declarationChange = compileCatalog({
      ...fixture.source,
      replacements: [
        {
          ...fixture.replacement,
          reason: "Preserve the audited learner wording after legal review",
        },
      ],
    });

    expect(declarationChange.catalog.manifest.localeHashes).toEqual(
      baseline.catalog.manifest.localeHashes
    );
    expect(declarationChange.catalog.manifest.hash).not.toBe(
      baseline.catalog.manifest.hash
    );

    const appMessage = messageAt("greeting.morning");
    const appSource = sourceWith(appMessage);
    const appOwned = compileCatalog(appSource);
    const fragmentContent = {
      id: "@mirai/owner-identity",
      locales: [...appSource.locales],
      messages: [appMessage],
      version: "1.0.0",
    } satisfies IntlFragmentContent;
    const fragment = {
      ...fragmentContent,
      hash: hashIntlFragmentContent(fragmentContent),
    } satisfies IntlFragment;
    const fragmentOwned = compileCatalog({
      ...appSource,
      fragments: [mount(fragment, { at: [] })],
      messages: [],
    });

    expect(fragmentOwned.catalog.manifest.localeHashes).toEqual(
      appOwned.catalog.manifest.localeHashes
    );
    expect(fragmentOwned.catalog.manifest.hash).not.toBe(
      appOwned.catalog.manifest.hash
    );
  });

  it("keeps fragment identity across source moves and rejects stale real content", () => {
    const fixture = replacementFixture();
    const baseline = compileCatalog(fixture.source);
    const movedFragmentContent = {
      id: fixture.fragment.id,
      locales: fixture.fragment.locales,
      messages: [
        {
          ...fixture.baseMessage,
          provenance: "moved/shared/locales/en.json:17",
        },
      ],
      version: fixture.fragment.version,
    } satisfies IntlFragmentContent;
    const movedFragment = {
      ...movedFragmentContent,
      hash: fixture.fragment.hash,
    } satisfies IntlFragment;
    const moved = compileCatalog({
      ...fixture.source,
      fragments: [mount(movedFragment, { at: [] })],
    });
    const changedFragment = {
      ...fixture.fragment,
      messages: [
        {
          ...fixture.baseMessage,
          translations: { en: "Changed base", th: "ฐานเปลี่ยนแล้ว" },
        },
      ],
    } satisfies IntlFragment;
    const changedFragmentContent = {
      id: changedFragment.id,
      locales: changedFragment.locales,
      messages: changedFragment.messages,
      version: changedFragment.version,
    } satisfies IntlFragmentContent;
    const rehashedChangedFragment = {
      ...changedFragmentContent,
      hash: hashIntlFragmentContent(changedFragmentContent),
    } satisfies IntlFragment;

    expect(hashIntlFragmentContent(movedFragmentContent)).toBe(
      fixture.fragment.hash
    );
    expect(moved.catalog.manifest.hash).toBe(baseline.catalog.manifest.hash);

    expect(() =>
      compileCatalog({
        ...fixture.source,
        fragments: [mount(changedFragment, { at: [] })],
      })
    ).toThrowError(/content hash mismatch/u);

    expect(rehashedChangedFragment.hash).not.toBe(fixture.fragment.hash);
    expect(() =>
      compileCatalog({
        ...fixture.source,
        fragments: [mount(rehashedChangedFragment, { at: [] })],
      })
    ).toThrowError(/does not match its exact base fragment/u);

    expect(() =>
      compileCatalog({
        ...fixture.source,
        replacements: [
          {
            ...fixture.replacement,
            base: {
              ...fixture.replacement.base,
              hash: `sha256:${"0".repeat(64)}` as Sha256,
            },
          },
        ],
      })
    ).toThrowError(/does not match its exact base fragment/u);
  });

  it("rejects duplicate and schema-changing replacement declarations", () => {
    const fixture = replacementFixture();

    expect(() =>
      compileCatalog({
        ...fixture.source,
        replacements: [fixture.replacement, fixture.replacement],
      })
    ).toThrowError(/Duplicate replacement declaration/u);

    expect(() =>
      compileCatalog({
        ...fixture.source,
        messages: [
          {
            ...fixture.replacementMessage,
            resultSchema: { finite: true, type: "number" },
          },
        ],
      })
    ).toThrowError(/changes its public schema/u);
  });

  it("requires complete audited replacement provenance", () => {
    const fixture = replacementFixture();
    const invalidDeclarations: ReadonlyArray<ReplacementDeclaration> = [
      { ...fixture.replacement, reason: " " },
      {
        ...fixture.replacement,
        provenance: { ...fixture.replacement.provenance, decision: " " },
      },
      {
        ...fixture.replacement,
        provenance: { ...fixture.replacement.provenance, owner: " " },
      },
      {
        ...fixture.replacement,
        provenance: { ...fixture.replacement.provenance, source: " " },
      },
    ];

    for (const declaration of invalidDeclarations) {
      expect(() =>
        compileCatalog({ ...fixture.source, replacements: [declaration] })
      ).toThrowError(
        /requires reason, decision, owner, and source provenance/u
      );
    }
  });

  it("emits byte-identical artifacts and hashes across clean identical generations", () => {
    for (const representation of [
      "constants",
      "precompiled",
      "proxy",
    ] as const) {
      const first = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        representation
      );
      const second = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        representation
      );

      expect(second).toEqual(first);
      expect(artifactContentHash(second)).toBe(artifactContentHash(first));
      for (const name of Object.keys(first)) {
        expect(second[name as keyof typeof second]).toBe(
          first[name as keyof typeof first]
        );
      }
    }
  });

  it("emits message-specific locale functions for the precompiled representation", () => {
    const module = emitArtifacts(
      compileCatalog(catalogFixtureSource),
      "precompiled"
    )["catalog.descriptors.gen.mjs"];

    expect(module).toContain("createPrecompiledLocaleRenderer");
    expect(module).toContain("renderPrecompiledPlural");
    expect(module).toContain("renderPrecompiledComponent");
    expect(module).toContain('"en": (state) =>');
    expect(module).toContain('"th": (state) =>');
    expect(module).toContain("export const message_greeting_morning");
    expect(module).toContain("export const namespace_greeting");
    expect(module).not.toContain("localeNodes");
    expect(module).not.toContain("localeValues");
  });

  it("does not rewrite an unchanged artifact set", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-compiler-"));
    try {
      const artifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "constants"
      );
      const first = await writeArtifactSet(root, artifacts);
      const pointerAfterFirstWrite = await readFile(
        join(root, "current.json"),
        "utf8"
      );
      const second = await writeArtifactSet(root, artifacts);
      const pointerAfterSecondWrite = await readFile(
        join(root, "current.json"),
        "utf8"
      );

      expect(first.changed).toBe(true);
      expect(second).toEqual({ ...first, changed: false });
      expect(pointerAfterSecondWrite).toBe(pointerAfterFirstWrite);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not report unchanged when destination contents are stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-compiler-"));
    try {
      const artifacts = emitArtifacts(
        compileCatalog(catalogFixtureSource),
        "constants"
      );
      const first = await writeArtifactSet(root, artifacts);
      await writeFile(
        join(first.directory, "catalog.runtime.gen.json"),
        "stale\n",
        "utf8"
      );

      await expect(writeArtifactSet(root, artifacts)).rejects.toThrowError(
        /does not match its destination files/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
