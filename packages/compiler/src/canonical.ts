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

function encodeCanonicalJson(
  value: unknown,
  encodedObjects: WeakMap<object, string>,
  encodedStrings: Map<string, string>
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
    const cached = encodedStrings.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const encoded = JSON.stringify(value.normalize("NFC"));
    encodedStrings.set(value, encoded);
    return encoded;
  }
  if (Array.isArray(value)) {
    const cached = encodedObjects.get(value);
    if (cached !== undefined) {
      return cached;
    }
    const encoded = `[${value
      .map((entry) =>
        encodeCanonicalJson(entry, encodedObjects, encodedStrings)
      )
      .join(",")}]`;
    encodedObjects.set(value, encoded);
    return encoded;
  }

  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON requires plain objects");
  }
  const cached = encodedObjects.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const entries = canonicalEntries(value);
  const encoded = `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key.normalize("NFC"))}:${encodeCanonicalJson(entry, encodedObjects, encodedStrings)}`
    )
    .join(",")}}`;
  encodedObjects.set(value, encoded);
  return encoded;
}

export function canonicalJson(value: unknown): string {
  // Receipts intentionally intern repeated immutable structures. Encoding a
  // shared object once per canonicalization preserves byte-for-byte output
  // while avoiding repeated traversal of the same provider/frontier graph.
  return encodeCanonicalJson(value, new WeakMap(), new Map());
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
