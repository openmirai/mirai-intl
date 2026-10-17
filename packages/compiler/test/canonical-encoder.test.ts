import { describe, expect, it } from "vitest";

import { canonicalJson, createCanonicalJsonEncoder } from "../src/canonical";

/*
 * The 0.4.2 encoder, kept verbatim as the oracle: every hash and receipt byte
 * the compiler writes comes from canonicalJson, so the faster encoder must
 * return exactly these bytes and refuse exactly these values.
 */
function oracleCompare(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function oracleNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Canonical JSON cannot encode a non-finite number");
  }
  if (Object.is(value, -0)) {
    return "0";
  }
  return JSON.stringify(value);
}

function oracleEntries(
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
  return entries.toSorted(([left], [right]) => oracleCompare(left, right));
}

function oracleEncode(
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
    return oracleNumber(value);
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
      .map((entry) => oracleEncode(entry, encodedObjects, encodedStrings))
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
  const encoded = `{${oracleEntries(value)
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key.normalize("NFC"))}:${oracleEncode(entry, encodedObjects, encodedStrings)}`
    )
    .join(",")}}`;
  encodedObjects.set(value, encoded);
  return encoded;
}

function oracle(value: unknown): string {
  return oracleEncode(value, new WeakMap(), new Map());
}

function outcome(encode: (value: unknown) => string, value: unknown) {
  try {
    return { encoded: encode(value) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.constructor.name : "non-error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Deterministic xorshift32, so a failing case can be replayed from its seed. */
function random(seed: number): () => number {
  // Spread neighbouring seeds apart and drop the first outputs, which a small
  // xorshift seed keeps small.
  let state = Math.imul(seed, 0x9e_37_79_b1) | 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_00_00_00_00;
  };
  for (let index = 0; index < 8; index += 1) {
    next();
  }
  return next;
}

const textPieces = [
  "",
  "a",
  "Z",
  "path/to/file.ts",
  "sha256:0f",
  "10",
  "9",
  "-1",
  "__proto__",
  "constructor",
  "é",
  "é",
  "K",
  "K",
  "กิ",
  "\u{1f600}",
  "\ud800",
  '"quoted"\\',
  "line\nbreak\u0000\u001f\u007f",
  "Å",
  "Å",
];

/** Pieces whose every concatenation is NFC, so most keys are accepted. */
const nfcPieces = textPieces.filter(
  (piece) =>
    piece.normalize("NFC") === piece &&
    !["\ud800", "e\u0301", "A\u030a", "\u212a"].includes(piece)
);

function generate(
  next: () => number,
  depth: number,
  shared: Array<object>
): unknown {
  const pick = <T>(values: ReadonlyArray<T>): T =>
    values[Math.floor(next() * values.length)] as T;
  const text = (pieces: ReadonlyArray<string> = textPieces) =>
    Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(pieces)).join(
      ""
    );
  const key = () => text(next() < 0.97 ? nfcPieces : textPieces);
  const roll = next();
  if (depth <= 0 || roll < 0.3) {
    return pick<unknown>([
      null,
      true,
      false,
      0,
      -0,
      1.5,
      -42,
      1e21,
      2 ** 53,
      text(),
      text(),
    ]);
  }
  if (roll < 0.4 && shared.length > 0) {
    return pick(shared);
  }
  if (roll < 0.65) {
    const array: Array<unknown> = Array.from(
      { length: Math.floor(next() * 5) },
      () => generate(next, depth - 1, shared)
    );
    shared.push(array);
    return array;
  }
  const object: Record<string, unknown> =
    next() < 0.1 ? Object.create(null) : {};
  const size = Math.floor(next() * 6);
  for (let index = 0; index < size; index += 1) {
    Reflect.set(object, key(), generate(next, depth - 1, shared));
  }
  shared.push(object);
  return object;
}

describe("canonical JSON encoder", () => {
  it("writes the oracle's bytes and refuses what the oracle refuses for generated values", () => {
    for (let seed = 1; seed <= 3000; seed += 1) {
      const value = generate(random(seed), 5, []);
      const expected = outcome(oracle, value);
      expect(outcome(canonicalJson, value), `seed ${seed}`).toEqual(expected);
    }
  });

  it("keeps the oracle's answer for every edge it defines", () => {
    const sparse = [1, , 3]; // oxlint-disable-line no-sparse-arrays
    const shared = { leaf: ["x", { y: 1 }] };
    const cases: ReadonlyArray<unknown> = [
      { b: 1, a: 2, "10": 3, "9": 4, A: 5, _: 6 },
      { é: 1, e: 2, z: 3 },
      { value: "é" },
      { kelvin: "K" },
      { K: 1 },
      { K: 1, K: 2 },
      { K: 1, K: 2 },
      { é: 1 },
      { é: 1, é: 2 },
      { zero: -0, big: 1e21, small: 5e-7 },
      sparse,
      [undefined],
      { missing: undefined },
      { nan: Number.NaN },
      { infinite: Number.POSITIVE_INFINITY },
      { date: new Date(0) },
      { map: new Map() },
      { fn: () => 1 },
      { big: 1n },
      { symbol: Symbol("s") },
      Object.assign(Object.create(null), { b: 1, a: 2 }),
      JSON.parse('{"__proto__": {"x": 1}, "a": 2}'),
      { first: shared, second: shared, third: [shared, shared] },
      { lone: "\ud800", pair: "😀", "\ud800": 1 },
      "",
      [],
      {},
    ];
    for (const [index, value] of cases.entries()) {
      expect(outcome(canonicalJson, value), `case ${index}`).toEqual(
        outcome(oracle, value)
      );
    }
  });

  it("answers each value as canonicalJson does when one encoder serves many values", () => {
    const encode = createCanonicalJsonEncoder();
    const schema = {
      properties: { count: { type: "number" } },
      type: "object",
    };
    const tags = ["plural", "é"];
    for (const locale of ["en", "th", "ja"]) {
      const value = [
        { argumentSchema: schema, locale, payload: [locale], tags },
        { argumentSchema: schema, locale, payload: [], tags },
      ];
      expect(encode(value)).toBe(oracle(value));
    }
    for (let seed = 1; seed <= 300; seed += 1) {
      const value = generate(random(seed), 4, []);
      expect(outcome(encode, value), `seed ${seed}`).toEqual(
        outcome(oracle, value)
      );
    }
  });
});
