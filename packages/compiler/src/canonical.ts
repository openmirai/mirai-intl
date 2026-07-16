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

export function canonicalJson(value: unknown): string {
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
    return JSON.stringify(value.normalize("NFC"));
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (typeof value !== "object") {
    throw new TypeError(`Canonical JSON cannot encode ${typeof value}`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON requires plain objects");
  }
  const entries = canonicalEntries(value);
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key.normalize("NFC"))}:${canonicalJson(entry)}`
    )
    .join(",")}}`;
}

export function sha256(value: string): Sha256 {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function canonicalHash(value: unknown): Sha256 {
  return sha256(canonicalJson(value));
}
