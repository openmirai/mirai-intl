import { createHash } from "node:crypto";

import type { Sha256 } from "@openmirai/intl-abi";

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON cannot encode a non-finite number");
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  return JSON.stringify(value);
}

export function compareCanonicalStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Any code point outside ASCII. ASCII text is already in NFC and normalizes to
 * itself, so only text this matches needs `normalize("NFC")` or the key checks.
 */
const nonAsciiText = /[\u0080-\u{10FFFF}]/u;

/**
 * The NFC checks and code-unit order of an object's keys when any key is not
 * ASCII: two keys with one NFC form, then a key that is not NFC, are refused in
 * that order.
 */
function canonicalEntries(
  value: object
): ReadonlyArray<readonly [string, unknown]> {
  const entries = Object.entries(value);
  const originalByNormalizedKey = new Map<string, string>();

  for (const [key] of entries) {
    const normalized = key.normalize("NFC");
    const prior = originalByNormalizedKey.get(normalized);
    if (prior !== undefined && prior !== key) {
      throw new TypeError(
        `Canonical JSON object keys ${JSON.stringify(prior)} and ${JSON.stringify(key)} have the same NFC form`
      );
    }
    originalByNormalizedKey.set(normalized, key);
  }

  for (const [key] of entries) {
    if (key.normalize("NFC") !== key) {
      throw new TypeError(
        `Canonical JSON object key ${JSON.stringify(key)} is not NFC-normalized`
      );
    }
  }

  return entries.toSorted(([left], [right]) =>
    compareCanonicalStrings(left, right)
  );
}

/**
 * The encodings one canonicalization (or one encoder) has produced. Values are
 * encoded by identity, so a structure shared by many parents is traversed once;
 * a Map (not a WeakMap) because it lives only as long as its encoder.
 */
type CanonicalEncodingCache = Readonly<{
  objects: Map<object, string>;
  strings: Map<string, string>;
}>;

function encodeCanonicalString(
  value: string,
  cache: CanonicalEncodingCache
): string {
  const cached = cache.strings.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const encoded = JSON.stringify(
    nonAsciiText.test(value) ? value.normalize("NFC") : value
  );
  cache.strings.set(value, encoded);
  return encoded;
}

function encodeCanonicalJson(
  value: unknown,
  cache: CanonicalEncodingCache
): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return canonicalNumber(value);
  }
  if (typeof value === "string") {
    return encodeCanonicalString(value, cache);
  }
  if (Array.isArray(value)) {
    const cached = cache.objects.get(value);
    if (cached !== undefined) {
      return cached;
    }
    // A hole encodes as nothing between its commas, as Array#map + join do.
    let encoded = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        encoded += ",";
      }
      if (index in value) {
        encoded += encodeCanonicalJson(value[index], cache);
      }
    }
    encoded += "]";
    cache.objects.set(value, encoded);
    return encoded;
  }

  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON requires plain objects");
  }
  const cached = cache.objects.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const keys = Object.keys(value);
  let encoded = "{";
  if (keys.some((key) => nonAsciiText.test(key))) {
    let separator = "";
    for (const [key, entry] of canonicalEntries(value)) {
      encoded += `${separator}${encodeCanonicalString(key, cache)}:${encodeCanonicalJson(entry, cache)}`;
      separator = ",";
    }
  } else {
    // Distinct ASCII keys are NFC and never share an NFC form; the default
    // sort is the code-unit order of compareCanonicalStrings.
    keys.sort();
    let separator = "";
    for (const key of keys) {
      encoded += `${separator}${encodeCanonicalString(key, cache)}:${encodeCanonicalJson(Reflect.get(value, key), cache)}`;
      separator = ",";
    }
  }
  encoded += "}";
  cache.objects.set(value, encoded);
  return encoded;
}

export function canonicalJson(value: unknown): string {
  // Receipts intentionally intern repeated immutable structures. Encoding a
  // shared object once per canonicalization preserves byte-for-byte output
  // while avoiding repeated traversal of the same provider/frontier graph.
  return encodeCanonicalJson(value, { objects: new Map(), strings: new Map() });
}

/**
 * One encoder for several canonicalizations of values that share structure,
 * such as one catalog's messages hashed once per locale: a structure already
 * encoded by this encoder is not traversed again. The bytes equal
 * `canonicalJson` of each value. Use it only within one synchronous
 * computation over values nothing mutates while the encoder lives.
 */
export function createCanonicalJsonEncoder(): (value: unknown) => string {
  const cache: CanonicalEncodingCache = {
    objects: new Map(),
    strings: new Map(),
  };
  return (value) => encodeCanonicalJson(value, cache);
}

export function sha256(value: string | Uint8Array): Sha256 {
  const hash = createHash("sha256");
  if (typeof value === "string") {
    hash.update(value, "utf8");
  } else {
    hash.update(value);
  }
  return `sha256:${hash.digest("hex")}`;
}

export function decodeUtf8Fatal(value: Uint8Array, context: string): string {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(value);
  } catch {
    throw new Error(`${context} must contain valid UTF-8`);
  }
}

export function canonicalHash(value: unknown): Sha256 {
  return sha256(canonicalJson(value));
}
