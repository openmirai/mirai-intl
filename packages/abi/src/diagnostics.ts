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
  | "INTL_MISSING_RESOURCE"
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

/**
 * Safe, actionable copy for development tooling. This deliberately uses only
 * sanitized diagnostic fields so it can be emitted without exposing runtime
 * arguments, rendered children, or caught exception text.
 */
export function formatIntlDiagnosticForDeveloper(
  diagnostic: IntlDiagnostic
): string {
  const target =
    diagnostic.path ?? diagnostic.messageId ?? "the requested message";
  const locale = diagnostic.locale
    ? ` for locale \`${diagnostic.locale}\``
    : "";
  const context = `Mirai Intl ${diagnostic.code} while resolving \`${target}\`${locale}.`;

  switch (diagnostic.code) {
    case "INTL_MISSING_RESOURCE":
      return `${context} Add the key to every required locale, run \`pnpm intl:generate\` and \`pnpm intl:check\`. If this key belongs to a third-party react-i18next library, render that library beneath its own I18nextProvider instead of the host catalog.`;
    case "INTL_ABI_MISMATCH":
    case "INTL_CATALOG_MISMATCH":
    case "INTL_STALE_DESCRIPTOR":
      return `${context} Regenerate the catalog and ensure the compiler, runtime, and generated artifacts use the same Mirai Intl release before rebuilding.`;
    case "INTL_DESCRIPTOR_INVALID":
    case "INTL_DYNAMIC_ACCESSOR":
    case "INTL_DYNAMIC_EXTRA_FIELD":
    case "INTL_DYNAMIC_INVALID_OBJECT":
    case "INTL_DYNAMIC_LIMIT_EXCEEDED":
    case "INTL_DYNAMIC_UNSUPPORTED":
    case "INTL_WRONG_KIND":
      return `${context} Pass a generated descriptor or a finite generated dynamic key; do not pass raw, widened, or foreign translation strings.`;
    case "INTL_VALUES_INVALID":
    case "INTL_RICH_COMPONENT_INVALID":
    case "INTL_UNTRUSTED_TAG":
      return `${context} Match the generated message value and rich-component schema exactly, then rerun the typecheck.`;
    case "INTL_FORMATTER_CAPABILITY_MISSING":
    case "INTL_RENDERER_FAILURE":
      return `${context} Verify the selected renderer, formatter policy, and generated catalog are compatible, then rerun \`pnpm intl:check\`.`;
    default:
      return `${context} Fix the reported catalog or descriptor contract and rerun \`pnpm intl:check\`.`;
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
