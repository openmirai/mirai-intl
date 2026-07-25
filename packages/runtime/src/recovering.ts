import type {
  AnyRichDescriptor,
  AnyTextDescriptor,
  AnyValueDescriptor,
  IntlDiagnostic,
  JsonValue,
  Result,
  ResultOf,
  StrictArgs,
  ValidatedDynamicCall,
  ValuesOf,
} from "@openmirai/intl-abi";

import type { RichRenderValue } from "./rich";
import * as runtime from "./runtime";

export type IntlRecoveryOperation =
  | "dynamic"
  | "locale"
  | "map"
  | "rich"
  | "text"
  | "value";

/** Privacy-safe recovery event. Deliberately excludes values, children and errors. */
export type IntlRecoveryDiagnostic = Readonly<{
  locale: string;
  operation: IntlRecoveryOperation;
  proofIdentity: string;
  recovery: "terminal";
  release: string;
  stage: "runtime";
}>;

export type RecoveringIntlRuntimeOptions = Omit<
  runtime.IntlRuntimeOptions,
  "diagnosticSink"
> &
  Readonly<{
    diagnosticSink?: (diagnostic: IntlRecoveryDiagnostic) => void;
    /** Bounded deployment release identifier; never includes user content. */
    release?: string;
    /** Finalized build-proof identity for telemetry correlation. */
    proofIdentity?: string;
    /** A non-throwing rich fallback for non-React renderers. */
    richFallback?: () => RichRenderValue;
    /** Exact-value fallback used only when a value operation cannot render. */
    valueFallback?: () => JsonValue;
  }>;

type RecoveryControls = Pick<
  RecoveringIntlRuntimeOptions,
  | "diagnosticSink"
  | "proofIdentity"
  | "release"
  | "richFallback"
  | "valueFallback"
>;

const recoveryWindowMs = 5 * 60 * 1000;
const recoveryCapacity = 1024;
const sharedRecentRecoveries = new Map<string, number>();

function terminalValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      terminalValue(entry);
    }
  } else {
    for (const entry of Object.values(value)) {
      terminalValue(entry);
    }
  }
  return Object.freeze(value) as unknown as JsonValue;
}

/**
 * Production-only total adapter. Strict runtimes retain validation and throw;
 * this wrapper converts failures at public translation operations into bounded,
 * telemetry-safe terminal values.
 */
export class RecoveringIntlRuntime {
  readonly #runtime: runtime.StrictIntlRuntime;
  readonly #diagnosticSink: RecoveringIntlRuntimeOptions["diagnosticSink"];
  readonly #richFallback: () => RichRenderValue;
  readonly #valueFallback: () => JsonValue;
  readonly #proofIdentity: string;
  readonly #release: string;

  constructor(options: RecoveringIntlRuntimeOptions);
  constructor(
    options: RecoveryControls,
    strictRuntime: runtime.StrictIntlRuntime
  );
  constructor(
    options: RecoveringIntlRuntimeOptions | RecoveryControls,
    strictRuntime?: runtime.StrictIntlRuntime
  ) {
    const {
      diagnosticSink,
      proofIdentity,
      release,
      richFallback,
      valueFallback,
    } = options;
    if (strictRuntime) {
      this.#runtime = strictRuntime;
    } else {
      const strictInput = options as RecoveringIntlRuntimeOptions;
      const {
        diagnosticSink: _recoveryDiagnosticSink,
        proofIdentity: _proofIdentity,
        release: _release,
        richFallback: _richFallback,
        valueFallback: _valueFallback,
        ...strictOptions
      } = strictInput;
      this.#runtime = new runtime.StrictIntlRuntime(strictOptions);
    }
    this.#diagnosticSink = diagnosticSink;
    this.#proofIdentity = proofIdentity ?? "unknown";
    this.#release = release ?? "unknown";
    this.#richFallback = richFallback ?? (() => "" as RichRenderValue);
    this.#valueFallback = valueFallback ?? (() => null);
  }

  get locale(): string {
    return this.#runtime.locale;
  }

  readonly subscribe = (listener: () => void): (() => void) =>
    this.#runtime.subscribe(listener);

  setLocale(locale: string): void {
    try {
      this.#runtime.setLocale(locale);
    } catch {
      this.#recover("locale");
    }
  }

  t<const D extends AnyTextDescriptor, const Actual extends ValuesOf<D>>(
    descriptor: D,
    ...values: StrictArgs<ValuesOf<D>, Actual>
  ): string {
    try {
      return this.#runtime.t(descriptor, ...values);
    } catch {
      this.#recover("text");
      return "";
    }
  }

  rich<
    const D extends AnyRichDescriptor,
    const ActualValues extends ValuesOf<D>,
    const ActualComponents extends runtime.ComponentsOf<D>,
  >(
    descriptor: D,
    input: runtime.StrictRichInput<D, ActualValues, ActualComponents>
  ): RichRenderValue {
    try {
      return this.#runtime.rich(descriptor, input);
    } catch {
      this.#recover("rich");
      try {
        return this.#richFallback();
      } catch {
        return "" as RichRenderValue;
      }
    }
  }

  value<const D extends AnyValueDescriptor, const Actual extends ValuesOf<D>>(
    descriptor: D,
    ...values: StrictArgs<ValuesOf<D>, Actual>
  ): ResultOf<D> {
    try {
      return this.#runtime.value(descriptor, ...values);
    } catch {
      this.#recover("value");
      try {
        return terminalValue(this.#valueFallback()) as ResultOf<D>;
      } catch {
        return null as ResultOf<D>;
      }
    }
  }

  validateDynamic(call: unknown): Result<ValidatedDynamicCall, IntlDiagnostic> {
    return this.#runtime.validateDynamic(call);
  }

  renderDynamic(call: ValidatedDynamicCall): JsonValue | RichRenderValue {
    try {
      return this.#runtime.renderDynamic(call);
    } catch {
      this.#recover("dynamic");
      return "";
    }
  }

  /** @internal Used by the unlowered translation-function map fallback. */
  recoverMap(): void {
    this.#recover("map");
  }

  #recover(operation: IntlRecoveryOperation): void {
    const now = Date.now();
    const key = `${operation}:${this.locale}:${this.#release}:${this.#proofIdentity}`;
    const previous = sharedRecentRecoveries.get(key);
    if (previous !== undefined && now - previous < recoveryWindowMs) {
      return;
    }
    sharedRecentRecoveries.delete(key);
    sharedRecentRecoveries.set(key, now);
    if (sharedRecentRecoveries.size > recoveryCapacity) {
      sharedRecentRecoveries.delete(
        sharedRecentRecoveries.keys().next().value as string
      );
    }
    try {
      this.#diagnosticSink?.({
        locale: this.locale,
        operation,
        proofIdentity: this.#proofIdentity,
        recovery: "terminal",
        release: this.#release,
        stage: "runtime",
      });
    } catch {
      // Observability is never allowed to affect rendering.
    }
  }
}

export function createRecoveringIntlRuntime(
  options: RecoveringIntlRuntimeOptions
): RecoveringIntlRuntime {
  return new RecoveringIntlRuntime(options);
}

/** @internal Adapter bridge for integrations that already construct strict runtimes. */
export function createRecoveringRuntimeFrom(
  strictRuntime: runtime.StrictIntlRuntime,
  options: RecoveryControls = {}
): RecoveringIntlRuntime {
  return new RecoveringIntlRuntime(options, strictRuntime);
}
