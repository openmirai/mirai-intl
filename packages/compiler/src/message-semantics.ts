import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";
import compilerPackage from "../package.json" with { type: "json" };

export type MessageSemanticsLimits = Readonly<{
  maxEntries?: number;
  maxBytes?: number;
}>;
type Stage = "syntax" | "inferred" | "parsed" | "compiled";
type Entry = Readonly<{ stage: Stage; key: string; value: unknown }>;
export type MessageSemanticsStats = Readonly<{
  hits: number;
  misses: number;
  skipped: number;
  entries: number;
  bytes: number;
}>;
export type MessageSemanticsSession = Readonly<{
  run<T>(callback: () => T): T;
  stats(): MessageSemanticsStats;
  serialize(): string;
}>;
const maxSnapshotBytes = 32 * 1024 * 1024;
const maxSnapshotEntries = 100_000;
const storage = new AsyncLocalStorage<
  (stage: Stage, input: unknown, compute: () => unknown) => unknown
>();

function identity() {
  return {
    version: 1,
    compiler: compilerPackage.version,
    parser: compilerPackage.dependencies["@formatjs/icu-messageformat-parser"],
    node: process.versions.node,
    icu: process.versions.icu,
    unicode: process.versions.unicode,
    cldr: process.versions.cldr,
    tz: process.versions.tz,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// This encoding deliberately preserves raw UTF-16, property order and -0.
// Exotic objects, accessors, symbols, holes and cycles bypass the memo entirely.
function exactKey(input: unknown, limit: number): string | undefined {
  let remaining = limit;
  const active = new Set<object>();
  function encode(value: unknown, depth: number): string {
    if (depth > 100) {
      throw new Error("depth");
    }
    let encoded: string;
    if (value === null) {
      encoded = "null";
    } else if (value === undefined) {
      encoded = "undefined";
    } else if (typeof value === "string") {
      encoded = JSON.stringify(value);
    } else if (typeof value === "boolean") {
      encoded = String(value);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      encoded = Object.is(value, -0) ? "-0" : String(value);
    } else if (typeof value === "object") {
      if (types.isProxy(value) || active.has(value)) {
        throw new Error("proxy or cycle");
      }
      const array = Array.isArray(value);
      if (
        Object.getPrototypeOf(value) !==
        (array ? Array.prototype : Object.prototype)
      ) {
        throw new Error("prototype");
      }
      active.add(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string")) {
        throw new Error("symbol");
      }
      if (array) {
        if (keys.length !== value.length + 1) {
          throw new Error("sparse array");
        }
        for (let index = 0; index < value.length; index += 1) {
          if (!Object.hasOwn(descriptors, String(index))) {
            throw new Error("sparse array");
          }
        }
      }
      const parts: Array<string> = [];
      for (const key of keys) {
        if (typeof key !== "string" || (array && key === "length")) {
          continue;
        }
        const descriptor = descriptors[key];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new Error("descriptor");
        }
        parts.push(
          `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`
        );
      }
      active.delete(value);
      encoded = `${array ? "[" : "{"}${parts.join(",")}${array ? "]" : "}"}`;
    } else {
      throw new Error("unsupported");
    }
    remaining -= encoded.length * 2;
    if (remaining < 0) {
      throw new Error("size");
    }
    return encoded;
  }
  try {
    return encode(input, 0);
  } catch {
    return undefined;
  }
}

function freezeOwned<T>(value: T): T {
  const owned: T = structuredClone(value);
  function freeze(current: unknown): void {
    if (current !== null && typeof current === "object") {
      for (const child of Object.values(current)) {
        freeze(child);
      }
      Object.freeze(current);
    }
  }
  freeze(owned);
  return owned;
}

function limits(options: MessageSemanticsLimits) {
  const entries = options.maxEntries ?? maxSnapshotEntries;
  const bytes = options.maxBytes ?? maxSnapshotBytes;
  if (
    !Number.isSafeInteger(entries) ||
    entries < 0 ||
    entries > maxSnapshotEntries ||
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > maxSnapshotBytes
  ) {
    throw new Error("Invalid message semantics limits");
  }
  return { entries, bytes };
}

function createSession(
  options: MessageSemanticsLimits,
  initial: ReadonlyArray<Entry>
): MessageSemanticsSession {
  const bound = limits(options);
  const context = identity();
  const cache = new Map<string, Entry>();
  // Reserve framing/identity space; account entries as their actual JSON bytes.
  let bytes = Buffer.byteLength(
    JSON.stringify({ identity: context, entries: [] })
  );
  let hits = 0;
  let misses = 0;
  let skipped = 0;
  function add(entry: Entry): boolean {
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (cache.size >= bound.entries || bytes + size > bound.bytes) {
      return false;
    }
    cache.set(`${entry.stage}:${entry.key}`, freezeOwned(entry));
    bytes += size;
    return true;
  }
  for (const entry of initial) {
    if (cache.has(`${entry.stage}:${entry.key}`) || !add(entry)) {
      throw new Error(
        "Invalid message semantics snapshot bounds or duplicate entry"
      );
    }
  }
  const memo = (
    stage: Stage,
    input: unknown,
    compute: () => unknown
  ): unknown => {
    const key = exactKey(input, bound.bytes);
    if (key === undefined) {
      skipped += 1;
      return compute();
    }
    const found = cache.get(`${stage}:${key}`);
    if (found) {
      hits += 1;
      return found.value;
    }
    misses += 1;
    const value = compute();
    // Never retain failures or non-JSON compiler output.
    const outputKey = exactKey(value, bound.bytes);
    const json = outputKey === undefined ? undefined : JSON.stringify(value);
    if (
      json !== undefined &&
      outputKey === exactKey(JSON.parse(json), bound.bytes) &&
      add({ stage, key, value })
    ) {
      return cache.get(`${stage}:${key}`)?.value;
    }
    skipped += 1;
    return value;
  };
  return Object.freeze({
    run<T>(callback: () => T): T {
      return storage.run(memo, callback);
    },
    stats: () =>
      Object.freeze({
        hits,
        misses,
        skipped,
        entries: cache.size,
        bytes: cache.size === 0 ? 0 : bytes,
      }),
    serialize: () => {
      const serialized = JSON.stringify({
        identity: context,
        entries: [...cache.values()],
      });
      if (Buffer.byteLength(serialized) > maxSnapshotBytes) {
        throw new Error("Message semantics snapshot exceeds transport bound");
      }
      return serialized;
    },
  });
}

export function createMessageSemanticsSession(
  options: MessageSemanticsLimits = {}
): MessageSemanticsSession {
  return createSession(options, []);
}

/** Internal compiler seam. No cache is active unless an operation installs a session. */
export function memoizeMessageSemantics<T>(
  stage: Stage,
  input: unknown,
  compute: () => T
): T {
  const memo = storage.getStore();
  return memo ? (memo(stage, input, compute) as T) : compute();
}

/** Trusted coordinator IPC only. Shape/context checks do not authenticate IR. */
export function receiveMessageSemanticsSnapshot(
  serialized: string,
  options: MessageSemanticsLimits = {}
): MessageSemanticsSession {
  if (Buffer.byteLength(serialized) > maxSnapshotBytes) {
    throw new Error("Message semantics snapshot exceeds transport bound");
  }
  const snapshot: unknown = JSON.parse(serialized);
  if (
    !record(snapshot) ||
    JSON.stringify(snapshot.identity) !== JSON.stringify(identity()) ||
    !Array.isArray(snapshot.entries) ||
    snapshot.entries.length > maxSnapshotEntries ||
    Object.keys(snapshot).length !== 2
  ) {
    throw new Error("Invalid message semantics snapshot context");
  }
  const entries: Array<Entry> = [];
  for (const entry of snapshot.entries) {
    if (
      !record(entry) ||
      typeof entry.key !== "string" ||
      Object.keys(entry).length !== 3 ||
      exactKey(entry.value, maxSnapshotBytes) === undefined ||
      !validValue(entry.stage, entry.value)
    ) {
      throw new Error("Invalid message semantics snapshot entry");
    }
    entries.push({ stage: entry.stage, key: entry.key, value: entry.value });
  }
  return createSession(options, entries);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function strings(value: unknown): value is Array<string> {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
function nodes(value: unknown, depth = 0): boolean {
  if (depth > 100 || !Array.isArray(value)) {
    return false;
  }
  return value.every((node: unknown) => {
    if (!record(node)) {
      return false;
    }
    switch (node.type) {
      case "literal":
        return (
          exactFields(node, ["type", "value"]) && typeof node.value === "string"
        );
      case "pound":
        return exactFields(node, ["type"]);
      case "argument":
        return (
          exactFields(node, ["type", "name"]) && typeof node.name === "string"
        );
      case "date":
      case "time":
      case "number":
        return (
          exactFields(node, ["type", "name"], ["style"]) &&
          typeof node.name === "string" &&
          (node.style === undefined || typeof node.style === "string")
        );
      case "tag":
        return (
          exactFields(node, ["type", "name", "children"]) &&
          typeof node.name === "string" &&
          nodes(node.children, depth + 1)
        );
      case "select":
      case "plural":
        return (
          exactFields(
            node,
            node.type === "select"
              ? ["type", "name", "options"]
              : ["type", "name", "options", "offset", "pluralType"]
          ) &&
          typeof node.name === "string" &&
          record(node.options) &&
          Object.values(node.options).every((child) =>
            nodes(child, depth + 1)
          ) &&
          (node.type === "select" ||
            (typeof node.offset === "number" &&
              Number.isFinite(node.offset) &&
              (node.pluralType === "cardinal" ||
                node.pluralType === "ordinal")))
        );
      default:
        return false;
    }
  });
}
function exactFields(
  value: Record<string, unknown>,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string> = []
): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key)
    )
  );
}

function validValue(stage: unknown, value: unknown): stage is Stage {
  if (!record(value)) {
    return false;
  }
  switch (stage) {
    case "syntax":
      return (
        exactFields(value, ["argumentNames", "tagNames", "nodes"]) &&
        strings(value.argumentNames) &&
        strings(value.tagNames) &&
        nodes(value.nodes)
      );
    case "inferred":
      return (
        exactFields(value, ["formatterIds", "tags", "kind", "valuesSchema"]) &&
        strings(value.formatterIds) &&
        strings(value.tags) &&
        (value.kind === "rich" || value.kind === "text") &&
        record(value.valuesSchema) &&
        exactFields(value.valuesSchema, [
          "type",
          "properties",
          "required",
          "additionalProperties",
        ]) &&
        value.valuesSchema.type === "object" &&
        record(value.valuesSchema.properties) &&
        strings(value.valuesSchema.required) &&
        value.valuesSchema.additionalProperties === false &&
        Object.values(value.valuesSchema.properties).every(
          (schema: unknown) =>
            record(schema) &&
            exactFields(
              schema,
              schema.type === "number" ? ["type", "finite"] : ["type"]
            ) &&
            ((schema.type === "number" && schema.finite === true) ||
              schema.type === "scalar" ||
              schema.type === "string" ||
              schema.type === "date-time")
        )
      );
    case "parsed":
      return (
        exactFields(value, [
          "nodes",
          "exactPluralBranches",
          "signature",
          "tagCounts",
          "pluralBranches",
        ]) &&
        nodes(value.nodes) &&
        strings(value.exactPluralBranches) &&
        record(value.signature) &&
        Object.values(value.signature).every(
          (item) => typeof item === "string"
        ) &&
        record(value.tagCounts) &&
        Object.values(value.tagCounts).every(
          (item) =>
            typeof item === "number" && Number.isSafeInteger(item) && item >= 0
        ) &&
        Array.isArray(value.pluralBranches) &&
        value.pluralBranches.every(
          (branch: unknown) =>
            record(branch) &&
            exactFields(branch, ["categories", "name", "pluralType"]) &&
            strings(branch.categories) &&
            typeof branch.name === "string" &&
            (branch.pluralType === "cardinal" ||
              branch.pluralType === "ordinal")
        )
      );
    case "compiled":
      return (
        exactFields(value, [
          "formatterIds",
          "tags",
          "kind",
          value.kind === "value" ? "localeValues" : "localeNodes",
        ]) &&
        strings(value.formatterIds) &&
        strings(value.tags) &&
        (value.kind === "value"
          ? record(value.localeValues)
          : (value.kind === "text" || value.kind === "rich") &&
            record(value.localeNodes) &&
            Object.values(value.localeNodes).every((item) => nodes(item)))
      );
    default:
      return false;
  }
}
