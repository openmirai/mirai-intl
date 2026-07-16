import type { IrNode, JsonValue, Sha256 } from "@openmirai/intl-abi";

import { canonicalHash, compareCanonicalStrings } from "./canonical";
import { parseMessage } from "./parser";
import type {
  CatalogSource,
  IntlFragment,
  IntlFragmentContent,
  MessageSource,
  MountedFragment,
  ReplacementDeclaration,
} from "./source";

const prototypeSensitiveSegments = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);
const invalidSegmentCharacters = /[.\p{C}\p{Z}]/u;

type CompositionOwner =
  | Readonly<{ type: "app" }>
  | Readonly<{
      fragmentHash: Sha256;
      fragmentId: string;
      fragmentVersion: string;
      type: "fragment";
    }>;

export type ComposedMessage = MessageSource &
  Readonly<{ owner: CompositionOwner }>;

export type CompositionIdentity = Readonly<{
  messageOwners: ReadonlyArray<
    Readonly<{
      owner: CompositionOwner;
      path: string;
    }>
  >;
  replacements: ReadonlyArray<ReplacementDeclaration>;
}>;

export type CompositionResult = Readonly<{
  identity: CompositionIdentity;
  messages: ReadonlyArray<ComposedMessage>;
  provenance: ReadonlyArray<
    Readonly<{
      action: "add" | "replace";
      base?: string;
      path: string;
      replacement?: ReplacementDeclaration;
      source: string;
    }>
  >;
}>;

function schemaHash(schema: MessageSource["valuesSchema"]): Sha256 {
  return canonicalHash(schema);
}

function normalizedLocaleContent(
  message: MessageSource
): Readonly<Record<string, JsonValue | ReadonlyArray<IrNode>>> {
  return Object.fromEntries(
    Object.entries(message.translations)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right))
      .map(([locale, translation]) => {
        if (message.kind === "value") {
          return [locale, translation];
        }
        if (typeof translation !== "string") {
          throw new Error(`${message.path} ${locale} must be a string`);
        }
        return [
          locale,
          parseMessage(translation, message.valuesSchema, locale).nodes,
        ];
      })
  );
}

function assertSafePathSegment(segment: unknown, context: string): void {
  if (
    typeof segment !== "string" ||
    segment.length === 0 ||
    segment.normalize("NFC") !== segment ||
    invalidSegmentCharacters.test(segment) ||
    prototypeSensitiveSegments.has(segment)
  ) {
    throw new Error(
      `${context} contains an unsafe path segment ${JSON.stringify(segment)}`
    );
  }
}

function assertSafePath(path: unknown, context: string): void {
  if (typeof path !== "string") {
    throw new Error(`${context} must be a string`);
  }
  for (const segment of path.split(".")) {
    assertSafePathSegment(segment, context);
  }
}

function assertSafeMountPath(path: ReadonlyArray<string>): void {
  for (const segment of path) {
    assertSafePathSegment(segment, "Fragment mount path");
  }
}

export function hashMessageSource(message: MessageSource): Sha256 {
  return canonicalHash({
    formatterIds: [...(message.formatterIds ?? [])].toSorted(
      compareCanonicalStrings
    ),
    kind: message.kind,
    localeContent: normalizedLocaleContent(message),
    path: message.path,
    resultSchema: message.resultSchema,
    tags: [...(message.tags ?? [])].toSorted(compareCanonicalStrings),
    valuesSchemaHash: schemaHash(message.valuesSchema),
  });
}

export function hashIntlFragmentContent(fragment: IntlFragmentContent): Sha256 {
  return canonicalHash({
    id: fragment.id,
    locales: [...fragment.locales].toSorted(compareCanonicalStrings),
    messages: fragment.messages
      .map((message) => ({
        contentHash: hashMessageSource(message),
        path: message.path,
      }))
      .toSorted(
        (left, right) =>
          compareCanonicalStrings(left.path, right.path) ||
          compareCanonicalStrings(left.contentHash, right.contentHash)
      ),
    version: fragment.version,
  });
}

function assertFragmentContentHash(fragment: IntlFragment): void {
  const { hash, ...content } = fragment;
  const expected = hashIntlFragmentContent(content);
  if (hash !== expected) {
    throw new Error(
      `Fragment ${fragment.id}@${fragment.version} content hash mismatch: expected ${expected}, found ${hash}`
    );
  }
}

function mountedMessages(
  mount: MountedFragment
): ReadonlyArray<ComposedMessage> {
  assertSafeMountPath(mount.at);
  assertFragmentContentHash(mount.fragment);
  const prefix = mount.at.join(".");
  return mount.fragment.messages.map((message) => ({
    ...message,
    owner: {
      fragmentHash: mount.fragment.hash,
      fragmentId: mount.fragment.id,
      fragmentVersion: mount.fragment.version,
      type: "fragment",
    },
    path: prefix ? `${prefix}.${message.path}` : message.path,
  }));
}

function prefixCollision(left: string, right: string): boolean {
  return left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function assertReplacement(
  declaration: ReplacementDeclaration,
  base: ComposedMessage,
  replacement: ComposedMessage
): void {
  if (
    base.owner.type !== "fragment" ||
    declaration.base.fragmentId !== base.owner.fragmentId ||
    declaration.base.version !== base.owner.fragmentVersion ||
    declaration.base.hash !== base.owner.fragmentHash
  ) {
    throw new Error(
      `Replacement ${declaration.exactKey} does not match its exact base fragment`
    );
  }
  if (
    !declaration.reason.trim() ||
    !declaration.provenance.decision.trim() ||
    !declaration.provenance.owner.trim() ||
    !declaration.provenance.source.trim()
  ) {
    throw new Error(
      `Replacement ${declaration.exactKey} requires reason, decision, owner, and source provenance`
    );
  }
  if (
    base.kind !== replacement.kind ||
    canonicalHash(base.valuesSchema) !==
      canonicalHash(replacement.valuesSchema) ||
    canonicalHash(base.resultSchema) !==
      canonicalHash(replacement.resultSchema) ||
    JSON.stringify([...(base.tags ?? [])].toSorted()) !==
      JSON.stringify([...(replacement.tags ?? [])].toSorted())
  ) {
    throw new Error(
      `Replacement ${declaration.exactKey} changes its public schema`
    );
  }
}

function replacementIdentity(
  declaration: ReplacementDeclaration
): ReplacementDeclaration {
  return {
    base: {
      fragmentId: declaration.base.fragmentId,
      hash: declaration.base.hash,
      version: declaration.base.version,
    },
    exactKey: declaration.exactKey,
    provenance: {
      decision: declaration.provenance.decision,
      owner: declaration.provenance.owner,
      source: declaration.provenance.source,
    },
    reason: declaration.reason,
  };
}

export function composeCatalog(source: CatalogSource): CompositionResult {
  const replacements = source.replacements ?? [];
  const replacementByPath = new Map<string, ReplacementDeclaration>();
  const messages = new Map<string, ComposedMessage>();
  const provenance: Array<{
    action: "add" | "replace";
    base?: string;
    path: string;
    replacement?: ReplacementDeclaration;
    source: string;
  }> = [];

  const add = (message: ComposedMessage): void => {
    assertSafePath(message.path, "Message path");
    for (const existing of messages.values()) {
      if (
        existing.path !== message.path &&
        prefixCollision(existing.path, message.path)
      ) {
        throw new Error(
          `Object/leaf collision between ${existing.path} (${existing.provenance}) and ${message.path} (${message.provenance})`
        );
      }
    }
    const existing = messages.get(message.path);
    if (!existing) {
      messages.set(message.path, message);
      provenance.push({
        action: "add",
        path: message.path,
        source: message.provenance,
      });
      return;
    }
    const declaration = replacementByPath.get(message.path);
    if (!declaration) {
      throw new Error(
        `Collision at ${message.path}: ${existing.provenance} conflicts with ${message.provenance}`
      );
    }
    assertReplacement(declaration, existing, message);
    messages.set(message.path, message);
    provenance.push({
      action: "replace",
      base: existing.provenance,
      path: message.path,
      replacement: declaration,
      source: message.provenance,
    });
  };

  for (const replacement of replacements) {
    assertSafePath(replacement.exactKey, "Replacement exact key");
    if (replacementByPath.has(replacement.exactKey)) {
      throw new Error(
        `Duplicate replacement declaration for ${replacement.exactKey}`
      );
    }
    replacementByPath.set(replacement.exactKey, replacement);
  }

  for (const fragment of source.fragments ?? []) {
    for (const message of mountedMessages(fragment)) {
      add(message);
    }
  }
  for (const message of source.messages) {
    add({ ...message, owner: { type: "app" } });
  }

  const usedReplacements = new Set(
    provenance
      .filter((entry) => entry.action === "replace")
      .map((entry) => entry.path)
  );
  for (const replacement of replacements) {
    if (!usedReplacements.has(replacement.exactKey)) {
      throw new Error(
        `Replacement ${replacement.exactKey} does not resolve one exact overlap`
      );
    }
  }

  const orderedMessages = [...messages.values()].toSorted((left, right) =>
    compareCanonicalStrings(left.path, right.path)
  );

  return {
    identity: {
      messageOwners: orderedMessages.map((message) => ({
        owner: message.owner,
        path: message.path,
      })),
      replacements: replacements
        .map(replacementIdentity)
        .toSorted((left, right) =>
          compareCanonicalStrings(left.exactKey, right.exactKey)
        ),
    },
    messages: orderedMessages,
    provenance,
  };
}
