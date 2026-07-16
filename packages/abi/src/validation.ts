import type { JsonArray, JsonObject, JsonValue } from "./json";
import type { ObjectSchema, ValueSchema } from "./schema";

const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const utcDateTime =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d{1,9})?Z$/u;

export type ValidationLimits = Readonly<{
  maxAggregateEntries: number;
  maxDepth: number;
  maxStringBytes: number;
  maxTotalBytes: number;
}>;

export type ValidationIssue = Readonly<{
  actualType: string;
  code: "accessor" | "extra" | "limit" | "missing" | "type" | "unsafe-key";
  expected: string;
  path: string;
}>;

export type ValidationResult =
  | Readonly<{ ok: false; issue: ValidationIssue }>
  | Readonly<{ ok: true; value: JsonValue }>;

export const dynamicValidationLimits = {
  maxAggregateEntries: 256,
  maxDepth: 20,
  maxStringBytes: 16 * 1024,
  maxTotalBytes: 64 * 1024,
} as const satisfies ValidationLimits;

interface ValidationState {
  aggregateEntries: number;
  canonicalBytes: number;
  seen: WeakSet<object>;
}

type ArrayInspection =
  | Readonly<{
      descriptors: Readonly<Record<string, PropertyDescriptor>>;
      length: number;
      ok: true;
    }>
  | Readonly<{ ok: false; result: ValidationResult }>;

const textEncoder = new TextEncoder();
const maxDiagnosticPathLength = 512;
const maxDiagnosticSegmentLength = 80;
const safeDiagnosticCharacter = /^[\dA-Za-z_$-]$/u;

function diagnosticSegment(value: string): string {
  let output = "";
  for (const character of value) {
    const encoded = safeDiagnosticCharacter.test(character)
      ? character
      : `_u${character.codePointAt(0)?.toString(16) ?? "0"}_`;
    if (output.length + encoded.length > maxDiagnosticSegmentLength) {
      return `${output}~${value.length}`;
    }
    output += encoded;
  }
  return output || "_empty_";
}

function boundedPath(path: string): string {
  if (path.length <= maxDiagnosticPathLength) {
    return path;
  }
  return `${path.slice(0, maxDiagnosticPathLength - 12)}~${path.length}`;
}

function propertyPath(path: string, key: string): string {
  return boundedPath(`${path}.${diagnosticSegment(key)}`);
}

function indexPath(path: string, index: number): string {
  return boundedPath(`${path}[${index}]`);
}

function typeName(value: unknown): string {
  try {
    if (value === null) {
      return "null";
    }
    if (Array.isArray(value)) {
      return "array";
    }
    if (typeof value === "object") {
      return Object.getPrototypeOf(value) === Object.prototype
        ? "object"
        : "instance";
    }
    return typeof value;
  } catch {
    return "uninspectable";
  }
}

function failure(
  code: ValidationIssue["code"],
  path: string,
  expected: string,
  value: unknown
): ValidationResult {
  return {
    issue: { actualType: typeName(value), code, expected, path },
    ok: false,
  };
}

function isValidUtcDateTime(value: string): boolean {
  const match = utcDateTime.exec(value);
  if (!match?.groups) {
    return false;
  }
  const epochMilliseconds = Date.parse(value);
  if (!Number.isFinite(epochMilliseconds)) {
    return false;
  }
  const date = new Date(epochMilliseconds);
  return (
    date.getUTCFullYear() === Number(match.groups.year) &&
    date.getUTCMonth() + 1 === Number(match.groups.month) &&
    date.getUTCDate() === Number(match.groups.day) &&
    date.getUTCHours() === Number(match.groups.hour) &&
    date.getUTCMinutes() === Number(match.groups.minute) &&
    date.getUTCSeconds() === Number(match.groups.second)
  );
}

function checkSize(
  state: ValidationState,
  limits: ValidationLimits,
  path: string,
  value: unknown
): ValidationResult | undefined {
  if (
    state.aggregateEntries > limits.maxAggregateEntries ||
    state.canonicalBytes > limits.maxTotalBytes
  ) {
    return failure("limit", path, "within resource limits", value);
  }
  return undefined;
}

function accountBytes(
  state: ValidationState,
  limits: ValidationLimits,
  path: string,
  value: unknown,
  bytes: number
): ValidationResult | undefined {
  state.canonicalBytes += bytes;
  return checkSize(state, limits, path, value);
}

function accountJsonString(
  state: ValidationState,
  limits: ValidationLimits,
  path: string,
  value: string,
  maxBytes = limits.maxStringBytes
): ValidationResult | undefined {
  const effectiveMaxBytes = Math.min(maxBytes, limits.maxStringBytes);
  if (value.length > effectiveMaxBytes) {
    return failure(
      "limit",
      path,
      `UTF-8 string byte length <= ${effectiveMaxBytes}`,
      value
    );
  }
  const bytes = textEncoder.encode(value).byteLength;
  if (bytes > effectiveMaxBytes) {
    return failure(
      "limit",
      path,
      `UTF-8 string byte length <= ${effectiveMaxBytes}`,
      value
    );
  }
  return accountBytes(
    state,
    limits,
    path,
    value,
    textEncoder.encode(JSON.stringify(value)).byteLength
  );
}

function accountJsonScalar(
  state: ValidationState,
  limits: ValidationLimits,
  path: string,
  value: null | boolean | number | string
): ValidationResult | undefined {
  if (typeof value === "string") {
    return accountJsonString(state, limits, path, value);
  }
  return accountBytes(
    state,
    limits,
    path,
    value,
    textEncoder.encode(JSON.stringify(value)).byteLength
  );
}

function ownPropertyDescriptors(
  value: object
): Readonly<Record<string, PropertyDescriptor>> {
  return Object.getOwnPropertyDescriptors(value);
}

function inspectArray(
  input: ReadonlyArray<unknown>,
  path: string
): ArrayInspection {
  const descriptors = ownPropertyDescriptors(input);
  if (Object.getOwnPropertySymbols(input).length > 0) {
    return {
      ok: false,
      result: failure("extra", path, "indexed array properties", input),
    };
  }
  const lengthDescriptor = descriptors.length;
  if (!lengthDescriptor || !("value" in lengthDescriptor)) {
    return {
      ok: false,
      result: failure("accessor", path, "data length property", undefined),
    };
  }
  const length: unknown = lengthDescriptor.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    return {
      ok: false,
      result: failure("type", path, "valid array length", length),
    };
  }
  for (const key of Object.keys(descriptors)) {
    if (key === "length") {
      continue;
    }
    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      return {
        ok: false,
        result: failure(
          "extra",
          propertyPath(path, key),
          "canonical array index",
          undefined
        ),
      };
    }
  }
  return { descriptors, length, ok: true };
}

function arrayElement(
  inspection: Extract<ArrayInspection, { ok: true }>,
  input: ReadonlyArray<unknown>,
  index: number,
  path: string
): PropertyDescriptor | ValidationResult {
  const descriptor = inspection.descriptors[String(index)];
  if (!descriptor) {
    return failure("missing", indexPath(path, index), "array element", input);
  }
  if (!("value" in descriptor)) {
    return failure(
      "accessor",
      indexPath(path, index),
      "data property",
      undefined
    );
  }
  return descriptor;
}

function validateObject(
  schema: ObjectSchema,
  input: unknown,
  limits: ValidationLimits,
  state: ValidationState,
  depth: number,
  path: string
): ValidationResult {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input))
  ) {
    return failure("type", path, "plain object", input);
  }
  if (state.seen.has(input)) {
    return failure("type", path, "acyclic object", input);
  }
  state.seen.add(input);

  const descriptors = Object.getOwnPropertyDescriptors(input);
  const symbolKeys = Object.getOwnPropertySymbols(input);
  if (symbolKeys.length > 0) {
    return failure("extra", path, "string-keyed object", input);
  }

  const keys = Object.keys(descriptors);
  state.aggregateEntries += keys.length;
  const sizeFailure = accountBytes(
    state,
    limits,
    path,
    input,
    2 + Math.max(0, keys.length - 1)
  );
  if (sizeFailure) {
    return sizeFailure;
  }

  for (const required of schema.required) {
    if (!Object.hasOwn(descriptors, required)) {
      return failure(
        "missing",
        propertyPath(path, required),
        "required property",
        undefined
      );
    }
  }

  const output: JsonObject = Object.create(null) as JsonObject;
  for (const key of keys.toSorted()) {
    const keyPath = propertyPath(path, key);
    const keySizeFailure = accountJsonString(state, limits, keyPath, key);
    if (keySizeFailure) {
      return keySizeFailure;
    }
    const separatorSizeFailure = accountBytes(state, limits, keyPath, key, 1);
    if (separatorSizeFailure) {
      return separatorSizeFailure;
    }
    if (forbiddenKeys.has(key)) {
      return failure("unsafe-key", keyPath, "safe property name", undefined);
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      return failure("accessor", keyPath, "data property", undefined);
    }
    const propertySchema = schema.properties[key];
    if (!propertySchema) {
      return failure("extra", keyPath, "declared property", descriptor.value);
    }
    const result = validateInternal(
      propertySchema,
      descriptor.value,
      limits,
      state,
      depth + 1,
      keyPath
    );
    if (!result.ok) {
      return result;
    }
    output[key] = result.value;
  }
  return { ok: true, value: output };
}

function validateInternal(
  schema: ValueSchema,
  input: unknown,
  limits: ValidationLimits,
  state: ValidationState,
  depth: number,
  path: string
): ValidationResult {
  if (depth > limits.maxDepth) {
    return failure("limit", path, `depth <= ${limits.maxDepth}`, input);
  }

  switch (schema.type) {
    case "scalar": {
      if (typeof input === "string") {
        const sizeFailure = accountJsonString(state, limits, path, input);
        return sizeFailure ?? { ok: true, value: input };
      }
      if (typeof input === "number" && Number.isFinite(input)) {
        const sizeFailure = accountBytes(
          state,
          limits,
          path,
          input,
          textEncoder.encode(JSON.stringify(input)).byteLength
        );
        return sizeFailure ?? { ok: true, value: input };
      }
      return failure("type", path, "string or finite number", input);
    }
    case "string": {
      if (typeof input !== "string") {
        return failure("type", path, "string", input);
      }
      if (input.length < (schema.minLength ?? 0)) {
        return failure(
          "type",
          path,
          "string length within schema limits",
          input
        );
      }
      const sizeFailure = accountJsonString(
        state,
        limits,
        path,
        input,
        schema.maxLength
      );
      return sizeFailure ?? { ok: true, value: input };
    }
    case "number": {
      if (typeof input !== "number" || !Number.isFinite(input)) {
        return failure("type", path, "finite number", input);
      }
      if (schema.integer && !Number.isInteger(input)) {
        return failure("type", path, "integer", input);
      }
      if (schema.safeInteger && !Number.isSafeInteger(input)) {
        return failure("type", path, "safe integer", input);
      }
      if (schema.minimum !== undefined && input < schema.minimum) {
        return failure("type", path, `number >= ${schema.minimum}`, input);
      }
      if (schema.maximum !== undefined && input > schema.maximum) {
        return failure("type", path, `number <= ${schema.maximum}`, input);
      }
      const sizeFailure = accountBytes(
        state,
        limits,
        path,
        input,
        textEncoder.encode(JSON.stringify(input)).byteLength
      );
      return sizeFailure ?? { ok: true, value: input };
    }
    case "boolean": {
      if (typeof input !== "boolean") {
        return failure("type", path, "boolean", input);
      }
      const sizeFailure = accountBytes(
        state,
        limits,
        path,
        input,
        textEncoder.encode(JSON.stringify(input)).byteLength
      );
      return sizeFailure ?? { ok: true, value: input };
    }
    case "date-time": {
      if (typeof input !== "string") {
        return failure("type", path, "RFC 3339 UTC string", input);
      }
      const sizeFailure = accountJsonString(state, limits, path, input);
      if (sizeFailure) {
        return sizeFailure;
      }
      return isValidUtcDateTime(input)
        ? { ok: true, value: input }
        : failure("type", path, "RFC 3339 UTC string", input);
    }
    case "literal": {
      if (!Object.is(input, schema.value)) {
        return failure("type", path, JSON.stringify(schema.value), input);
      }
      const sizeFailure = accountJsonScalar(state, limits, path, schema.value);
      return sizeFailure ?? { ok: true, value: schema.value };
    }
    case "enum": {
      const value = schema.values.find((candidate) =>
        Object.is(candidate, input)
      );
      if (value === undefined) {
        return failure("type", path, "declared enum member", input);
      }
      const sizeFailure = accountJsonScalar(state, limits, path, value);
      return sizeFailure ?? { ok: true, value };
    }
    case "array": {
      if (
        !Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Array.prototype
      ) {
        return failure("type", path, "array", input);
      }
      if (state.seen.has(input)) {
        return failure("type", path, "acyclic array", input);
      }
      state.seen.add(input);
      const inspection = inspectArray(input, path);
      if (!inspection.ok) {
        return inspection.result;
      }
      if (
        inspection.length < (schema.minItems ?? 0) ||
        inspection.length > (schema.maxItems ?? limits.maxAggregateEntries)
      ) {
        return failure(
          "limit",
          path,
          "array length within schema limits",
          input
        );
      }
      state.aggregateEntries += inspection.length;
      const sizeFailure = accountBytes(
        state,
        limits,
        path,
        input,
        2 + Math.max(0, inspection.length - 1)
      );
      if (sizeFailure) {
        return sizeFailure;
      }
      const output: JsonArray = [];
      for (let index = 0; index < inspection.length; index += 1) {
        const descriptor = arrayElement(inspection, input, index, path);
        if ("ok" in descriptor) {
          return descriptor;
        }
        const result = validateInternal(
          schema.items,
          descriptor.value,
          limits,
          state,
          depth + 1,
          indexPath(path, index)
        );
        if (!result.ok) {
          return result;
        }
        output.push(result.value);
      }
      return { ok: true, value: output };
    }
    case "object":
      return validateObject(schema, input, limits, state, depth, path);
  }
}

function validateResourcesInternal(
  input: unknown,
  limits: ValidationLimits,
  state: ValidationState,
  depth: number,
  path: string
): ValidationResult {
  if (depth > limits.maxDepth) {
    return failure("limit", path, `depth <= ${limits.maxDepth}`, input);
  }
  if (input === null) {
    const sizeFailure = accountBytes(state, limits, path, input, 4);
    return sizeFailure ?? { ok: true, value: null };
  }
  if (typeof input === "string") {
    const sizeFailure = accountJsonString(state, limits, path, input);
    return sizeFailure ?? { ok: true, value: input };
  }
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return failure("type", path, "finite JSON number", input);
    }
    const sizeFailure = accountBytes(
      state,
      limits,
      path,
      input,
      textEncoder.encode(JSON.stringify(input)).byteLength
    );
    return sizeFailure ?? { ok: true, value: input };
  }
  if (typeof input === "boolean") {
    const sizeFailure = accountBytes(
      state,
      limits,
      path,
      input,
      textEncoder.encode(JSON.stringify(input)).byteLength
    );
    return sizeFailure ?? { ok: true, value: input };
  }
  if (Array.isArray(input)) {
    if (Object.getPrototypeOf(input) !== Array.prototype) {
      return failure("type", path, "plain array", input);
    }
    if (state.seen.has(input)) {
      return failure("type", path, "acyclic array", input);
    }
    state.seen.add(input);
    const inspection = inspectArray(input, path);
    if (!inspection.ok) {
      return inspection.result;
    }
    state.aggregateEntries += inspection.length;
    const sizeFailure = accountBytes(
      state,
      limits,
      path,
      input,
      2 + Math.max(0, inspection.length - 1)
    );
    if (sizeFailure) {
      return sizeFailure;
    }
    const output: JsonArray = [];
    for (let index = 0; index < inspection.length; index += 1) {
      const descriptor = arrayElement(inspection, input, index, path);
      if ("ok" in descriptor) {
        return descriptor;
      }
      const result = validateResourcesInternal(
        descriptor.value,
        limits,
        state,
        depth + 1,
        indexPath(path, index)
      );
      if (!result.ok) {
        return result;
      }
      output.push(result.value);
    }
    return { ok: true, value: output };
  }
  if (
    typeof input !== "object" ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input))
  ) {
    return failure("type", path, "plain JSON data value", input);
  }
  if (state.seen.has(input)) {
    return failure("type", path, "acyclic object", input);
  }
  state.seen.add(input);

  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.getOwnPropertySymbols(input).length > 0) {
    return failure("extra", path, "string-keyed object", input);
  }
  const keys = Object.keys(descriptors);
  state.aggregateEntries += keys.length;
  const sizeFailure = accountBytes(
    state,
    limits,
    path,
    input,
    2 + Math.max(0, keys.length - 1)
  );
  if (sizeFailure) {
    return sizeFailure;
  }

  const output: JsonObject = Object.create(null) as JsonObject;
  for (const key of keys.toSorted()) {
    const keyPath = propertyPath(path, key);
    const keySizeFailure = accountJsonString(state, limits, keyPath, key);
    if (keySizeFailure) {
      return keySizeFailure;
    }
    const separatorSizeFailure = accountBytes(state, limits, keyPath, key, 1);
    if (separatorSizeFailure) {
      return separatorSizeFailure;
    }
    if (forbiddenKeys.has(key)) {
      return failure("unsafe-key", keyPath, "safe property name", undefined);
    }
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) {
      return failure("accessor", keyPath, "data property", undefined);
    }
    const result = validateResourcesInternal(
      descriptor.value,
      limits,
      state,
      depth + 1,
      keyPath
    );
    if (!result.ok) {
      return result;
    }
    output[key] = result.value;
  }
  return { ok: true, value: output };
}

export function validateResourceLimits(
  input: unknown,
  limits: ValidationLimits = dynamicValidationLimits
): ValidationResult {
  try {
    return validateResourcesInternal(
      input,
      limits,
      { aggregateEntries: 0, canonicalBytes: 0, seen: new WeakSet() },
      0,
      "$"
    );
  } catch {
    return failure("type", "$", "inspectable JSON data value", input);
  }
}

export function validateSchemaValue(
  schema: ValueSchema,
  input: unknown,
  limits: ValidationLimits = dynamicValidationLimits
): ValidationResult {
  try {
    return validateInternal(
      schema,
      input,
      limits,
      { aggregateEntries: 0, canonicalBytes: 0, seen: new WeakSet() },
      0,
      "$"
    );
  } catch {
    return failure("type", "$", "inspectable data value", input);
  }
}
