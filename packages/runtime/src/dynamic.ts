import {
  FORMAT_VERSION,
  RUNTIME_ABI,
  dynamicValidationLimits,
  validatedDynamicCallBrand,
  validateResourceLimits,
  validateSchemaValue,
} from "@openmirai/intl-abi";
import type {
  DescriptorKind,
  DynamicIntlCallV1,
  IntlDiagnostic,
  ObjectSchema,
  Result,
  RuntimeCatalog,
  ValidatedDynamicCall,
} from "@openmirai/intl-abi";

const fields = [
  "catalogId",
  "formatVersion",
  "hash",
  "kind",
  "locale",
  "messageId",
  "runtimeAbi",
  "values",
] as const;

type Field = (typeof fields)[number];

const fixedFields = [
  "catalogId",
  "formatVersion",
  "hash",
  "kind",
  "locale",
  "messageId",
  "runtimeAbi",
] as const satisfies ReadonlyArray<Field>;

const fixedWireSchema = {
  additionalProperties: false,
  properties: {
    catalogId: { maxLength: 256, type: "string" },
    formatVersion: { type: "literal", value: FORMAT_VERSION },
    hash: { maxLength: 128, type: "string" },
    kind: { type: "enum", values: ["text", "rich", "value"] },
    locale: { maxLength: 64, type: "string" },
    messageId: { maxLength: 256, type: "string" },
    runtimeAbi: { type: "literal", value: RUNTIME_ABI },
  },
  required: fixedFields,
  type: "object",
} as const satisfies ObjectSchema;

function diagnostic(
  code: IntlDiagnostic["code"],
  message: string,
  path = "$"
): Result<never, IntlDiagnostic> {
  return { error: { code, message, path }, ok: false };
}

function inspectExactRecord(
  input: unknown
): Result<Readonly<Record<Field, unknown>>, IntlDiagnostic> {
  try {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(input))
    ) {
      return diagnostic(
        "INTL_DYNAMIC_INVALID_OBJECT",
        "Dynamic call must be a plain object"
      );
    }
    if (Object.getOwnPropertySymbols(input).length > 0) {
      return diagnostic(
        "INTL_DYNAMIC_EXTRA_FIELD",
        "Dynamic call cannot contain symbols"
      );
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const actual = Object.keys(descriptors).toSorted();
    const expected = [...fields].toSorted();
    if (actual.join("\0") !== expected.join("\0")) {
      return diagnostic(
        "INTL_DYNAMIC_EXTRA_FIELD",
        "Dynamic call fields do not match the v1 wire contract"
      );
    }
    const output: Partial<Record<Field, unknown>> = {};
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor || !("value" in descriptor)) {
        return diagnostic(
          "INTL_DYNAMIC_ACCESSOR",
          "Dynamic call cannot contain accessors",
          `$.${field}`
        );
      }
      output[field] = descriptor.value;
    }
    return { ok: true, value: output as Record<Field, unknown> };
  } catch {
    return diagnostic(
      "INTL_DYNAMIC_INVALID_OBJECT",
      "Dynamic call could not be inspected safely"
    );
  }
}

function wireSchema(values: ObjectSchema): ObjectSchema {
  return {
    additionalProperties: false,
    properties: {
      ...fixedWireSchema.properties,
      values,
    },
    required: fields,
    type: "object",
  };
}

function validationDiagnostic(
  catalog: RuntimeCatalog,
  issue: Readonly<{
    actualType: string;
    code: string;
    expected: string;
    path: string;
  }>,
  fallbackCode: IntlDiagnostic["code"],
  message: string
): Result<never, IntlDiagnostic> {
  return {
    error: {
      actual: { type: issue.actualType },
      catalogHash: catalog.manifest.hash,
      catalogId: catalog.manifest.catalogId,
      code:
        issue.code === "limit" ? "INTL_DYNAMIC_LIMIT_EXCEEDED" : fallbackCode,
      expected: issue.expected,
      message,
      path: issue.path,
    },
    ok: false,
  };
}

function resolveLocale(
  locales: ReadonlyArray<string>,
  requested: string
): string | undefined {
  const exact = locales.find((entry) => entry === requested);
  if (exact) {
    return exact;
  }
  const separator = requested.indexOf("-");
  const primary = separator < 0 ? requested : requested.slice(0, separator);
  return locales.find((entry) => entry === primary);
}

export function validateDynamicCall(
  catalog: RuntimeCatalog,
  input: unknown
): Result<ValidatedDynamicCall, IntlDiagnostic> {
  const inspected = inspectExactRecord(input);
  if (!inspected.ok) {
    return inspected;
  }
  const raw = inspected.value;
  const resourceCheck = validateResourceLimits(raw, dynamicValidationLimits);
  if (!resourceCheck.ok) {
    return validationDiagnostic(
      catalog,
      resourceCheck.issue,
      "INTL_VALUES_INVALID",
      "Dynamic call failed resource preflight"
    );
  }

  const fixedInput = Object.fromEntries(
    fixedFields.map((field) => [field, raw[field]])
  );
  const fixed = validateSchemaValue(
    fixedWireSchema,
    fixedInput,
    dynamicValidationLimits
  );
  if (!fixed.ok) {
    return validationDiagnostic(
      catalog,
      fixed.issue,
      "INTL_DYNAMIC_UNSUPPORTED",
      "Dynamic call fixed envelope is unsupported"
    );
  }
  const envelope = fixed.value;
  if (!envelope || Array.isArray(envelope) || typeof envelope !== "object") {
    return diagnostic(
      "INTL_DYNAMIC_INVALID_OBJECT",
      "Validated dynamic envelope is invalid"
    );
  }
  const catalogId = envelope.catalogId;
  const hash = envelope.hash;
  const kind = envelope.kind;
  const localeRequest = envelope.locale;
  const messageId = envelope.messageId;
  if (
    typeof catalogId !== "string" ||
    typeof hash !== "string" ||
    typeof kind !== "string" ||
    typeof localeRequest !== "string" ||
    typeof messageId !== "string"
  ) {
    return diagnostic(
      "INTL_DYNAMIC_INVALID_OBJECT",
      "Validated dynamic envelope fields are invalid"
    );
  }

  const locale = resolveLocale(catalog.manifest.locales, localeRequest);
  if (
    catalogId !== catalog.manifest.catalogId ||
    hash !== catalog.manifest.hash ||
    !locale
  ) {
    return diagnostic(
      "INTL_DYNAMIC_UNSUPPORTED",
      "Dynamic call catalog, hash, message, or locale is unavailable"
    );
  }
  const message = catalog.messages.find((entry) => entry?.id === messageId);
  if (!message || kind !== message.kind) {
    return diagnostic(
      "INTL_DYNAMIC_UNSUPPORTED",
      "Dynamic call message or kind is unavailable"
    );
  }
  const validated = validateSchemaValue(
    wireSchema(message.argumentSchema),
    input,
    dynamicValidationLimits
  );
  if (!validated.ok) {
    return validationDiagnostic(
      catalog,
      validated.issue,
      "INTL_VALUES_INVALID",
      "Dynamic call failed exact schema validation"
    );
  }
  const value = validated.value;
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return diagnostic(
      "INTL_DYNAMIC_INVALID_OBJECT",
      "Validated wire value is invalid"
    );
  }
  Object.defineProperty(value, "locale", {
    configurable: false,
    enumerable: true,
    value: locale,
    writable: false,
  });
  Object.defineProperty(value, validatedDynamicCallBrand, {
    enumerable: false,
    value: true,
  });
  return { ok: true, value: Object.freeze(value) as ValidatedDynamicCall };
}

export function dynamicKind(value: DynamicIntlCallV1): DescriptorKind {
  return value.kind;
}
