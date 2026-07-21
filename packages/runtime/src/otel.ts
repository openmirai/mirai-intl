import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import type { IntlDiagnostic, IntlDiagnosticCode } from "@openmirai/intl-abi";

const DEFAULT_LOGGER_NAME = "openmirai.i18n";
const DEFAULT_CODES = [
  "INTL_MISSING_RESOURCE",
] as const satisfies ReadonlyArray<IntlDiagnosticCode>;
const DEFAULT_NAMESPACE = "translation";
const MAXIMUM_REPORTED_DIAGNOSTICS = 1_000;
const MAXIMUM_KEY_CHARACTERS = 256;
const MAXIMUM_NAMESPACE_CHARACTERS = 64;

export type CreateOtelDiagnosticSinkOptions = Readonly<{
  /**
   * Diagnostic codes to emit. Defaults to `INTL_MISSING_RESOURCE` only.
   */
  codes?: ReadonlyArray<IntlDiagnosticCode>;
  /**
   * OTel logger name. Defaults to `openmirai.i18n`.
   */
  loggerName?: string;
}>;

const resolveNamespace = (path: string | undefined): string => {
  if (path === undefined || path.length === 0) {
    return DEFAULT_NAMESPACE;
  }

  const separatorIndex = path.indexOf(".");
  if (separatorIndex <= 0) {
    return DEFAULT_NAMESPACE;
  }

  return path.slice(0, separatorIndex);
};

const rememberDiagnostic = (
  reported: Set<string>,
  signature: string
): boolean => {
  if (reported.has(signature)) {
    return false;
  }

  if (reported.size >= MAXIMUM_REPORTED_DIAGNOSTICS) {
    const oldestSignature = reported.values().next().value;
    if (typeof oldestSignature === "string") {
      reported.delete(oldestSignature);
    }
  }

  reported.add(signature);
  return true;
};

/**
 * Framework-agnostic OpenTelemetry Logs sink for mirai-intl diagnostics.
 *
 * Uses only `@opentelemetry/api-logs` (optional peer). Fail-open when the
 * LoggerProvider is missing or emit fails. Does not depend on React or any
 * app monitoring package.
 */
export function createOtelDiagnosticSink(
  options: CreateOtelDiagnosticSinkOptions = {}
): (diagnostic: IntlDiagnostic) => void {
  const loggerName = options.loggerName ?? DEFAULT_LOGGER_NAME;
  const codes = new Set<IntlDiagnosticCode>(options.codes ?? DEFAULT_CODES);
  const reported = new Set<string>();
  let otelLogger: ReturnType<typeof logs.getLogger> | null = null;

  const getLogger = (): ReturnType<typeof logs.getLogger> | null => {
    if (otelLogger !== null) {
      return otelLogger;
    }

    try {
      otelLogger = logs.getLogger(loggerName);
    } catch {
      // Logging must remain optional when the provider is unavailable.
    }

    return otelLogger;
  };

  return (diagnostic: IntlDiagnostic): void => {
    if (!codes.has(diagnostic.code)) {
      return;
    }

    const key = (diagnostic.path ?? diagnostic.messageId ?? "unknown").slice(
      0,
      MAXIMUM_KEY_CHARACTERS
    );
    const locale = diagnostic.locale ?? "unknown";
    const namespace = resolveNamespace(diagnostic.path).slice(
      0,
      MAXIMUM_NAMESPACE_CHARACTERS
    );
    const signature = `${diagnostic.code}\0${locale}\0${namespace}\0${key}`;

    if (!rememberDiagnostic(reported, signature)) {
      return;
    }

    const attributes = {
      "i18n.code": diagnostic.code,
      "i18n.key": key,
      "i18n.locale": locale,
      "i18n.namespace": namespace,
    } as const;

    if (
      typeof process !== "undefined" &&
      process.env.NODE_ENV === "development"
    ) {
      try {
        globalThis.console.warn("[WARN]", "Missing translation", attributes);
      } catch {
        // A broken console sink must not affect translation rendering.
      }
    }

    try {
      getLogger()?.emit({
        attributes,
        body: "Missing translation",
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
      });
    } catch {
      // Exporter/provider failures must not affect translation rendering.
    }
  };
}
