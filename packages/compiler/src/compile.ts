import {
  FORMAT_VERSION,
  RUNTIME_ABI,
  defineMessageDescriptor,
  emptyObjectSchema,
  validateSchemaValue,
} from "@openmirai/intl-abi";
import type {
  CatalogManifest,
  IrNode,
  JsonValue,
  MessageDescriptor,
  RuntimeCatalog,
  RuntimeMessage,
  Sha256,
} from "@openmirai/intl-abi";

import {
  canonicalHash,
  canonicalJson,
  compareCanonicalStrings,
  sha256,
} from "./canonical";
import { composeCatalog } from "./compose";
import type { CompositionResult } from "./compose";
import { parseMessage } from "./parser";
import type { ParsedMessage } from "./parser";
import type { CatalogSource, MessageSource } from "./source";
import compilerPackage from "../package.json" with { type: "json" };

export const COMPILER_VERSION = compilerPackage.version;
const LOCALE_POLICY = "exact-then-primary-then-source-v1";
const customFormatterStyle = /^custom:([^:]+)(?::([^:]*))?$/u;
const safeFormatterId = /^[\dA-Za-z][\dA-Za-z._/-]{0,127}$/u;

export type CompileOutput = Readonly<{
  catalog: RuntimeCatalog;
  composition: CompositionResult;
  descriptors: ReadonlyArray<MessageDescriptor>;
}>;

export type CatalogContentIdentity = Readonly<{
  capabilitySetHash: Sha256;
  catalogId: string;
  composition: CompositionResult["identity"];
  formatVersion: CatalogManifest["formatVersion"];
  formatterVersions: CatalogManifest["formatterVersions"];
  localeHashes: ReadonlyArray<
    Readonly<{
      hash: Sha256;
      locale: string;
    }>
  >;
  localePolicy: typeof LOCALE_POLICY;
  locales: ReadonlyArray<string>;
  rendererCapabilityId: CatalogManifest["rendererCapabilityId"];
  runtimeAbi: CatalogManifest["runtimeAbi"];
  sourceLocale: string;
}>;

function assertLocales(source: CatalogSource): void {
  if (!source.locales.includes(source.sourceLocale)) {
    throw new Error(
      `Source locale ${source.sourceLocale} is not in the locale list`
    );
  }
  if (new Set(source.locales).size !== source.locales.length) {
    throw new Error("Catalog locale list contains duplicates");
  }
  if (source.locales.length === 0) {
    throw new Error("Catalog requires at least one locale");
  }
}

function exactLocaleEntries(
  message: MessageSource,
  locales: ReadonlyArray<string>
): ReadonlyArray<[string, JsonValue]> {
  const actual = Object.keys(message.translations).toSorted();
  const expected = [...locales].toSorted();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${message.path} locale set ${actual.join(",")} does not match ${expected.join(",")}`
    );
  }
  return locales.map((locale) => {
    const translation = message.translations[locale];
    if (translation === undefined) {
      throw new Error(`${message.path} is missing locale ${locale}`);
    }
    return [locale, translation];
  });
}

function assertParsedParity(
  message: MessageSource,
  parsed: ReadonlyArray<[string, ParsedMessage]>
): void {
  const [, baseline] = parsed[0] ?? [];
  if (!baseline) {
    throw new Error(`${message.path} has no parsed locales`);
  }
  const expectedTags = [...new Set(message.tags ?? [])].toSorted();
  for (const [locale, current] of parsed) {
    if (
      canonicalJson(current.signature) !== canonicalJson(baseline.signature)
    ) {
      throw new Error(
        `${message.path} has incompatible argument signatures in ${locale}`
      );
    }
    if (
      canonicalJson(current.exactPluralBranches) !==
      canonicalJson(baseline.exactPluralBranches)
    ) {
      throw new Error(
        `${message.path} has incompatible exact plural branches in ${locale}`
      );
    }
    if (
      canonicalJson(current.tagCounts) !== canonicalJson(baseline.tagCounts)
    ) {
      throw new Error(
        `${message.path} has incompatible rich tag multiplicity in ${locale}`
      );
    }
    const parsedTags = Object.keys(current.tagCounts).toSorted();
    if (canonicalJson(parsedTags) !== canonicalJson(expectedTags)) {
      throw new Error(
        `${message.path} rich tags in ${locale} do not match the declared contract`
      );
    }
  }
  if (message.kind !== "rich" && expectedTags.length > 0) {
    throw new Error(
      `${message.path} declares rich tags but is ${message.kind}`
    );
  }
  if (message.kind === "text" && Object.keys(baseline.tagCounts).length > 0) {
    throw new Error(`${message.path} contains rich tags but is declared text`);
  }
}

function visitNodes(
  nodes: ReadonlyArray<IrNode>,
  visit: (node: IrNode) => void
): void {
  for (const node of nodes) {
    visit(node);
    if (node.type === "plural" || node.type === "select") {
      for (const branch of Object.values(node.options)) {
        visitNodes(branch, visit);
      }
    } else if (node.type === "tag") {
      visitNodes(node.children, visit);
    }
  }
}

function normalizedFormatterIds(
  message: MessageSource,
  parsed: ReadonlyArray<[string, ParsedMessage]>,
  formatterVersions: Readonly<Record<string, string>>
): ReadonlyArray<string> {
  const declared = [...(message.formatterIds ?? [])];
  if (new Set(declared).size !== declared.length) {
    throw new Error(`${message.path} formatterIds contains duplicates`);
  }

  const used = new Set<string>();
  for (const [, localeMessage] of parsed) {
    visitNodes(localeMessage.nodes, (node) => {
      if (
        node.type !== "number" &&
        node.type !== "date" &&
        node.type !== "time"
      ) {
        return;
      }
      const style = node.style;
      if (!style) {
        return;
      }
      if (!style.startsWith("custom:")) {
        if (Object.hasOwn(formatterVersions, style)) {
          throw new Error(
            `${message.path} formatter ${style} must use custom:${style} syntax`
          );
        }
        return;
      }
      const match = customFormatterStyle.exec(style);
      const formatterId = match?.[1];
      if (
        !formatterId ||
        formatterId.normalize("NFC") !== formatterId ||
        !safeFormatterId.test(formatterId)
      ) {
        throw new Error(
          `${message.path} has an invalid custom formatter style ${JSON.stringify(style)}`
        );
      }
      used.add(formatterId);
    });
  }

  const actual = [...used].toSorted(compareCanonicalStrings);
  const expected = [...declared].toSorted(compareCanonicalStrings);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${message.path} formatterIds ${expected.join(",") || "(none)"} do not exactly match normalized IR ${actual.join(",") || "(none)"}`
    );
  }
  return actual;
}

function compileMessage(
  message: MessageSource,
  locales: ReadonlyArray<string>,
  validatorId: number,
  formatterVersions: Readonly<Record<string, string>>
): RuntimeMessage {
  const translations = exactLocaleEntries(message, locales);
  const id = `msg_${sha256(message.path).slice(7, 23)}`;
  if (message.kind === "value") {
    const formatterIds = normalizedFormatterIds(message, [], formatterVersions);
    if (message.valuesSchema.required.length > 0) {
      throw new Error(
        `${message.path} value messages cannot declare interpolation values`
      );
    }
    const localeValues: Record<string, JsonValue> = {};
    for (const [locale, translation] of translations) {
      const result = validateSchemaValue(message.resultSchema, translation);
      if (!result.ok) {
        throw new Error(
          `${message.path} invalid ${locale} structured value at ${result.issue.path}`
        );
      }
      localeValues[locale] = result.value;
    }
    return {
      argumentSchema: message.valuesSchema,
      formatterIds,
      id,
      kind: message.kind,
      localeValues,
      path: message.path,
      provenanceRef: `message:${id}`,
      resultSchema: message.resultSchema,
      tags: [],
      validatorId,
    };
  }

  const parsed = translations.map(
    ([locale, translation]): [string, ParsedMessage] => {
      if (typeof translation !== "string") {
        throw new Error(`${message.path} ${locale} must be a string`);
      }
      return [locale, parseMessage(translation, message.valuesSchema, locale)];
    }
  );
  assertParsedParity(message, parsed);
  const formatterIds = normalizedFormatterIds(
    message,
    parsed,
    formatterVersions
  );
  return {
    argumentSchema: message.valuesSchema,
    formatterIds,
    id,
    kind: message.kind,
    localeNodes: Object.fromEntries(
      parsed.map(([locale, value]) => [locale, value.nodes])
    ),
    path: message.path,
    provenanceRef: `message:${id}`,
    resultSchema: message.resultSchema,
    tags: [...(message.tags ?? [])].toSorted(),
    validatorId,
  };
}

function localeHashes(
  locales: ReadonlyArray<string>,
  messages: ReadonlyArray<RuntimeMessage>
): Readonly<Record<string, `sha256:${string}`>> {
  return Object.fromEntries(
    locales.map((locale) => [
      locale,
      canonicalHash(
        messages.map((message) => ({
          argumentSchema: message.argumentSchema,
          formatterIds: message.formatterIds,
          id: message.id,
          kind: message.kind,
          path: message.path,
          payload:
            message.kind === "value"
              ? (message.localeValues?.[locale] ?? null)
              : (message.localeNodes?.[locale] ?? []),
          resultSchema: message.resultSchema,
          tags: message.tags,
          validatorId: message.validatorId,
        }))
      ),
    ])
  );
}

function assertFormatterVersions(
  source: CatalogSource,
  messages: ReadonlyArray<RuntimeMessage>
): void {
  const formatterVersions = source.formatterVersions ?? {};
  const used = new Set<string>();
  for (const message of messages) {
    for (const formatterId of message.formatterIds) {
      used.add(formatterId);
      if (!Object.hasOwn(formatterVersions, formatterId)) {
        throw new Error(
          `${message.path} formatter ${formatterId} is not declared in formatterVersions`
        );
      }
    }
  }
  const declaredIds = Object.keys(formatterVersions).toSorted(
    compareCanonicalStrings
  );
  const usedIds = [...used].toSorted(compareCanonicalStrings);
  if (canonicalJson(declaredIds) !== canonicalJson(usedIds)) {
    throw new Error(
      `formatterVersions ${declaredIds.join(",") || "(none)"} do not exactly cover used formatters ${usedIds.join(",") || "(none)"}`
    );
  }
}

export function createCatalogContentIdentity(
  source: CatalogSource,
  messages: ReadonlyArray<RuntimeMessage>,
  composition: CompositionResult
): CatalogContentIdentity {
  const formatterVersions = Object.fromEntries(
    Object.entries(source.formatterVersions ?? {}).toSorted(([left], [right]) =>
      compareCanonicalStrings(left, right)
    )
  );
  const capabilitySetHash = canonicalHash({
    formatterVersions,
    rendererCapabilityId: source.rendererCapabilityId,
    runtimeAbi: RUNTIME_ABI,
  });
  const perLocale = localeHashes(source.locales, messages);

  return {
    capabilitySetHash,
    catalogId: source.id,
    composition: composition.identity,
    formatVersion: FORMAT_VERSION,
    formatterVersions,
    localeHashes: source.locales.map((locale) => {
      const hash = perLocale[locale];
      if (!hash) {
        throw new Error(`Missing canonical hash for locale ${locale}`);
      }
      return { hash, locale };
    }),
    localePolicy: LOCALE_POLICY,
    locales: [...source.locales],
    rendererCapabilityId: source.rendererCapabilityId,
    runtimeAbi: RUNTIME_ABI,
    sourceLocale: source.sourceLocale,
  };
}

export function hashCatalogContent(identity: CatalogContentIdentity): Sha256 {
  return canonicalHash({
    capabilitySetHash: identity.capabilitySetHash,
    catalogId: identity.catalogId,
    composition: identity.composition,
    formatVersion: identity.formatVersion,
    formatterVersions: identity.formatterVersions,
    localeHashes: identity.localeHashes,
    localePolicy: identity.localePolicy,
    locales: identity.locales,
    rendererCapabilityId: identity.rendererCapabilityId,
    runtimeAbi: identity.runtimeAbi,
    sourceLocale: identity.sourceLocale,
  });
}

function createManifest(
  source: CatalogSource,
  messages: ReadonlyArray<RuntimeMessage>,
  composition: CompositionResult
): CatalogManifest {
  const identity = createCatalogContentIdentity(source, messages, composition);
  const hash = hashCatalogContent(identity);
  const perLocale = Object.fromEntries(
    identity.localeHashes.map(({ hash: localeHash, locale }) => [
      locale,
      localeHash,
    ])
  );

  return {
    buildId: source.buildId,
    buildToken: `${source.buildId}:${hash.slice(7, 19)}`,
    capabilitySetHash: identity.capabilitySetHash,
    catalogId: source.id,
    catalogPackage: source.catalogPackage,
    compilerVersion: COMPILER_VERSION,
    formatVersion: FORMAT_VERSION,
    formatterVersions: identity.formatterVersions,
    hash,
    localeHashes: perLocale,
    locales: source.locales,
    rendererCapabilityId: source.rendererCapabilityId,
    runtimeAbi: RUNTIME_ABI,
    sourceLocale: source.sourceLocale,
  };
}

export function compileCatalog(source: CatalogSource): CompileOutput {
  assertLocales(source);
  const composition = composeCatalog(source);
  const formatterVersions = source.formatterVersions ?? {};
  const messages = composition.messages.map((message, index) =>
    compileMessage(message, source.locales, index, formatterVersions)
  );
  assertFormatterVersions(source, messages);
  const manifest = createManifest(source, messages, composition);
  const descriptors = messages.map((message) =>
    defineMessageDescriptor({
      buildToken: manifest.buildToken,
      capabilitySetHash: manifest.capabilitySetHash,
      catalogHash: manifest.hash,
      catalogId: manifest.catalogId,
      formatVersion: manifest.formatVersion,
      kind: message.kind,
      messageId: message.id,
      path: message.path,
      rendererCapabilityId: manifest.rendererCapabilityId,
      runtimeAbi: manifest.runtimeAbi,
      validatorId: message.validatorId,
    })
  );

  return {
    catalog: { manifest, messages },
    composition,
    descriptors,
  };
}

export const noValues: typeof emptyObjectSchema = emptyObjectSchema;
