import type { DescriptorKind, RuntimeAbi, Sha256 } from "./descriptor";

export type IntlDiagnosticCode =
  | "INTL_ABI_MISMATCH"
  | "INTL_CATALOG_MISMATCH"
  | "INTL_COLLISION"
  | "INTL_DESCRIPTOR_INVALID"
  | "INTL_DIAGNOSTIC_SINK_FAILURE"
  | "INTL_DYNAMIC_ACCESSOR"
  | "INTL_DYNAMIC_EXTRA_FIELD"
  | "INTL_DYNAMIC_INVALID_OBJECT"
  | "INTL_DYNAMIC_LIMIT_EXCEEDED"
  | "INTL_DYNAMIC_UNSUPPORTED"
  | "INTL_FORMATTER_CAPABILITY_MISSING"
  | "INTL_LOCALE_INVALID"
  | "INTL_RENDERER_FAILURE"
  | "INTL_REPLACEMENT_INVALID"
  | "INTL_RICH_COMPONENT_INVALID"
  | "INTL_SCHEMA_AMBIGUOUS"
  | "INTL_STALE_DESCRIPTOR"
  | "INTL_UNTRUSTED_TAG"
  | "INTL_VALUES_INVALID"
  | "INTL_WRONG_KIND";

export type SanitizedActual = Readonly<{
  length?: number;
  type: string;
}>;

export type IntlDiagnostic = Readonly<{
  actual?: SanitizedActual;
  buildToken?: string;
  capabilitySetHash?: Sha256;
  catalogHash?: Sha256;
  catalogId?: string;
  code: IntlDiagnosticCode;
  expected?: string;
  kind?: DescriptorKind;
  locale?: string;
  message: string;
  messageId?: string;
  path?: string;
  provenanceRef?: string;
  runtimeAbi?: RuntimeAbi | string;
  secondaryCode?: IntlDiagnosticCode;
}>;

export class IntlRuntimeError extends Error {
  override readonly name = "IntlRuntimeError";

  constructor(readonly diagnostic: IntlDiagnostic) {
    super(diagnostic.message);
  }
}

export function actualSummary(value: unknown): SanitizedActual {
  try {
    if (typeof value === "string") {
      return { length: value.length, type: "string" };
    }
    if (Array.isArray(value)) {
      return { length: value.length, type: "array" };
    }
    if (value === null) {
      return { type: "null" };
    }
    if (typeof value === "object") {
      return {
        length: Reflect.ownKeys(value).length,
        type:
          Object.getPrototypeOf(value) === Object.prototype
            ? "object"
            : "instance",
      };
    }
    return { type: typeof value };
  } catch {
    return { type: "uninspectable" };
  }
}
