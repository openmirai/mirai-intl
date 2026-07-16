import {
  DESCRIPTOR_BRAND_VALUE,
  FORMAT_VERSION,
  RUNTIME_ABI,
  IntlRuntimeError,
  actualSummary,
  defineMessageDescriptor,
  messageBrand,
  validatedDynamicCallBrand,
  validateSchemaValue,
} from "@openmirai/intl-abi";
import type {
  AnyRichDescriptor,
  AnyTextDescriptor,
  AnyValueDescriptor,
  IntlDiagnostic,
  JsonObject,
  JsonValue,
  KeysOfUnion,
  MessageDescriptor,
  Result,
  ResultOf,
  RuntimeCatalog,
  RuntimeMessage,
  StrictArgs,
  TagsOf,
  ValidatedDynamicCall,
  ValuesOf,
} from "@openmirai/intl-abi";

import type { RendererBackend, RuntimeFormatter } from "./backend";
import { validateDynamicCall } from "./dynamic";
import {
  getEmbeddedRuntimeMessage,
  getPrecompiledRenderer,
} from "./representations";
import type { RichComponent, RichComponentMap, RichRenderValue } from "./rich";

export type ComponentsOf<
  D extends AnyRichDescriptor,
  RenderValue = RichRenderValue,
> = Readonly<{
  [Tag in TagsOf<D>]: RichComponent<RenderValue>;
}>;

export type StrictRichInput<
  D extends AnyRichDescriptor,
  ActualValues extends ValuesOf<D>,
  ActualComponents extends ComponentsOf<D, RenderValue>,
  RenderValue = RichRenderValue,
> = ([KeysOfUnion<ValuesOf<D>>] extends [never]
  ? object
  : {
      values: ActualValues &
        Record<Exclude<keyof ActualValues, keyof ValuesOf<D>>, never>;
    }) & {
  components: ActualComponents &
    Record<
      Exclude<keyof ActualComponents, keyof ComponentsOf<D, RenderValue>>,
      never
    >;
};

export type IntlRuntimeOptions = Readonly<{
  backend: RendererBackend;
  catalog: RuntimeCatalog;
  diagnosticSink?: (diagnostic: IntlDiagnostic) => void;
  escapeValues?: boolean;
  formatters?: Readonly<Record<string, RuntimeFormatter>>;
  locale: string;
  trustedRichComponents?: Readonly<Record<string, RichComponentMap>>;
}>;

export type LanguageChangedSource = Readonly<{
  off: (
    event: "languageChanged",
    listener: (locale: string) => void
  ) => unknown;
  on: (event: "languageChanged", listener: (locale: string) => void) => unknown;
}>;

type ValidatedDescriptor = Readonly<{
  descriptor: MessageDescriptor;
  message: RuntimeMessage;
  sourceDescriptor: MessageDescriptor;
}>;

type InspectedDescriptor = Readonly<{
  descriptor: MessageDescriptor;
  sourceDescriptor: MessageDescriptor;
}>;

const descriptorFields = [
  "brand",
  "buildToken",
  "capabilitySetHash",
  "catalogHash",
  "catalogId",
  "formatVersion",
  "kind",
  "messageId",
  "path",
  "rendererCapabilityId",
  "runtimeAbi",
  "validatorId",
] as const;

const omittedValues = Symbol("@openmirai/intl-runtime/omitted-values");

const diagnosticIdentifierFields = [
  "buildToken",
  "capabilitySetHash",
  "catalogHash",
  "catalogId",
  "kind",
  "locale",
  "messageId",
  "path",
  "provenanceRef",
  "runtimeAbi",
] as const satisfies ReadonlyArray<keyof IntlDiagnostic>;
const diagnosticIdentifierMaxLength = 96;
const safeDiagnosticIdentifier = /^[A-Za-z0-9@+./:_$\x5b\x5d\x2d]+$/;
const diagnosticCodes = new Set<IntlDiagnostic["code"]>([
  "INTL_ABI_MISMATCH",
  "INTL_CATALOG_MISMATCH",
  "INTL_COLLISION",
  "INTL_DESCRIPTOR_INVALID",
  "INTL_DIAGNOSTIC_SINK_FAILURE",
  "INTL_DYNAMIC_ACCESSOR",
  "INTL_DYNAMIC_EXTRA_FIELD",
  "INTL_DYNAMIC_INVALID_OBJECT",
  "INTL_DYNAMIC_LIMIT_EXCEEDED",
  "INTL_DYNAMIC_UNSUPPORTED",
  "INTL_FORMATTER_CAPABILITY_MISSING",
  "INTL_LOCALE_INVALID",
  "INTL_RENDERER_FAILURE",
  "INTL_REPLACEMENT_INVALID",
  "INTL_RICH_COMPONENT_INVALID",
  "INTL_SCHEMA_AMBIGUOUS",
  "INTL_STALE_DESCRIPTOR",
  "INTL_UNTRUSTED_TAG",
  "INTL_VALUES_INVALID",
  "INTL_WRONG_KIND",
]);

function sanitizeDiagnosticIdentifier(value: unknown): string {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= diagnosticIdentifierMaxLength &&
    safeDiagnosticIdentifier.test(value)
  ) {
    return value;
  }
  return `[redacted:${typeof value === "string" ? value.length : "invalid"}]`;
}

function sanitizeDiagnostic(diagnostic: IntlDiagnostic): IntlDiagnostic {
  const sanitized = { ...diagnostic };
  for (const field of diagnosticIdentifierFields) {
    const value = diagnostic[field];
    if (value === undefined) {
      continue;
    }
    Object.defineProperty(sanitized, field, {
      configurable: true,
      enumerable: true,
      value: sanitizeDiagnosticIdentifier(value),
      writable: true,
    });
  }
  return Object.freeze(sanitized);
}

const messageBrandFields = ["catalogId", "kind", "path", "runtimeAbi"] as const;

function hasExpectedMessageBrandPayload(
  payload: unknown,
  descriptorFieldsByName: Readonly<Record<string, PropertyDescriptor>>
): boolean {
  if (
    !payload ||
    typeof payload !== "object" ||
    Object.getPrototypeOf(payload) !== Object.prototype ||
    !Object.isFrozen(payload) ||
    Object.getOwnPropertySymbols(payload).length > 0
  ) {
    return false;
  }
  const payloadDescriptors = Object.getOwnPropertyDescriptors(payload);
  if (Object.keys(payloadDescriptors).length !== messageBrandFields.length) {
    return false;
  }
  return messageBrandFields.every((field) => {
    const payloadDescriptor = payloadDescriptors[field];
    const publicDescriptor = descriptorFieldsByName[field];
    return (
      payloadDescriptor !== undefined &&
      publicDescriptor !== undefined &&
      "value" in payloadDescriptor &&
      "value" in publicDescriptor &&
      payloadDescriptor.enumerable === true &&
      payloadDescriptor.value === publicDescriptor.value
    );
  });
}

function inspectDescriptor(
  candidate: unknown
): InspectedDescriptor | undefined {
  if (
    !candidate ||
    (typeof candidate !== "object" && typeof candidate !== "function")
  ) {
    return undefined;
  }
  try {
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    for (const field of descriptorFields) {
      const descriptor = descriptors[field];
      if (!descriptor || !("value" in descriptor)) {
        return undefined;
      }
    }
    const symbolDescriptor = Object.getOwnPropertyDescriptor(
      candidate,
      messageBrand
    );
    if (!symbolDescriptor || !("value" in symbolDescriptor)) {
      return undefined;
    }
    if (descriptors.brand?.value !== DESCRIPTOR_BRAND_VALUE) {
      return undefined;
    }
    if (!hasExpectedMessageBrandPayload(symbolDescriptor.value, descriptors)) {
      return undefined;
    }
    const snapshot: Record<string | symbol, unknown> = Object.create(null);
    for (const field of descriptorFields) {
      snapshot[field] = descriptors[field]?.value;
    }
    Object.defineProperty(snapshot, messageBrand, {
      value: symbolDescriptor.value,
    });
    return {
      descriptor: Object.freeze(snapshot) as MessageDescriptor,
      sourceDescriptor: candidate as MessageDescriptor,
    };
  } catch {
    return undefined;
  }
}

function ownDataRecord(
  input: unknown
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      ![null, Object.prototype].includes(Object.getPrototypeOf(input))
    ) {
      return undefined;
    }
    if (Object.getOwnPropertySymbols(input).length > 0) {
      return undefined;
    }
    const output: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(input)
    )) {
      if (!("value" in descriptor)) {
        return undefined;
      }
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return undefined;
  }
}

function nestedDiagnosticCode(
  error: unknown
): IntlDiagnostic["code"] | undefined {
  try {
    if (
      !error ||
      typeof error !== "object" ||
      Reflect.get(error, "name") !== "IntlRuntimeError"
    ) {
      return undefined;
    }
    const nested = Reflect.get(error, "diagnostic");
    if (!nested || typeof nested !== "object") {
      return undefined;
    }
    const code: unknown = Reflect.get(nested, "code");
    return typeof code === "string" &&
      diagnosticCodes.has(code as IntlDiagnostic["code"])
      ? (code as IntlDiagnostic["code"])
      : undefined;
  } catch {
    return undefined;
  }
}

function inspectValidatedDynamicCall(
  candidate: unknown
): ValidatedDynamicCall | undefined {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }
  try {
    const brand = Object.getOwnPropertyDescriptor(
      candidate,
      validatedDynamicCallBrand
    );
    if (!brand || !("value" in brand) || brand.value !== true) {
      return undefined;
    }
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
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const snapshot: Record<string | symbol, unknown> = Object.create(null);
    for (const field of fields) {
      const descriptor = descriptors[field];
      if (!descriptor || !("value" in descriptor)) {
        return undefined;
      }
      snapshot[field] = descriptor.value;
    }
    Object.defineProperty(snapshot, validatedDynamicCallBrand, { value: true });
    return Object.freeze(snapshot) as ValidatedDynamicCall;
  } catch {
    return undefined;
  }
}

export class StrictIntlRuntime {
  readonly #backend: RendererBackend;
  readonly #catalog: RuntimeCatalog;
  readonly #diagnosticSink: IntlRuntimeOptions["diagnosticSink"];
  readonly #escapeValues: boolean;
  readonly #formatters: Readonly<Record<string, RuntimeFormatter>>;
  readonly #localeListeners = new Set<() => void>();
  readonly #trustedRichComponents: Readonly<Record<string, RichComponentMap>>;
  #locale: string;
  #sinkDispatching = false;

  constructor(options: IntlRuntimeOptions) {
    this.#backend = options.backend;
    this.#catalog = options.catalog;
    this.#diagnosticSink = options.diagnosticSink;
    this.#escapeValues = options.escapeValues ?? false;
    this.#formatters = options.formatters ?? {};
    this.#trustedRichComponents = options.trustedRichComponents ?? {};
    this.#assertCatalogCompatibility();
    this.#locale = this.#resolveLocale(options.locale);
  }

  get locale(): string {
    return this.#locale;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#localeListeners.add(listener);
    return () => {
      this.#localeListeners.delete(listener);
    };
  };

  bindLanguageChanged(source: LanguageChangedSource): () => void {
    const listener = (locale: string): void => {
      this.setLocale(locale);
    };
    source.on("languageChanged", listener);
    return () => {
      source.off("languageChanged", listener);
    };
  }

  setLocale(locale: string): void {
    const resolved =
      this.#catalog.manifest.locales.find((entry) => entry === locale) ??
      this.#catalog.manifest.locales.find(
        (entry) => entry === locale.split("-")[0]
      );
    if (!resolved) {
      this.#fail({
        actual: actualSummary(locale),
        catalogId: this.#catalog.manifest.catalogId,
        code: "INTL_LOCALE_INVALID",
        expected: this.#catalog.manifest.locales.join(" | "),
        locale,
        message: "Locale is not part of the active catalog",
      });
    }
    if (resolved === this.#locale) {
      return;
    }
    this.#locale = resolved;
    for (const listener of this.#localeListeners) {
      listener();
    }
  }

  t<const D extends AnyTextDescriptor, const Actual extends ValuesOf<D>>(
    descriptor: D,
    ...values: StrictArgs<ValuesOf<D>, Actual>
  ): string {
    if (values.length > 1) {
      this.#fail({
        code: "INTL_VALUES_INVALID",
        message: "Translation calls accept at most one values argument",
      });
    }
    const rendered = this.#renderStrict(
      "text",
      descriptor,
      values.length === 0 ? omittedValues : values[0]
    );
    if (typeof rendered !== "string") {
      this.#fail({
        code: "INTL_RENDERER_FAILURE",
        message: "Text operation produced a non-string result",
      });
    }
    return rendered;
  }

  rich<
    const D extends AnyRichDescriptor,
    const ActualValues extends ValuesOf<D>,
    const ActualComponents extends ComponentsOf<D>,
  >(
    descriptor: D,
    input: StrictRichInput<D, ActualValues, ActualComponents>
  ): RichRenderValue {
    if (arguments.length !== 2) {
      this.#fail({
        code: "INTL_RICH_COMPONENT_INVALID",
        message: "Rich translation calls require exactly one input argument",
      });
    }
    const validated = this.#validateDescriptor("rich", descriptor);
    const richInput = this.#validatedRichInput(validated.message, input);
    return this.#renderValidated(
      "rich",
      validated,
      richInput.values,
      richInput.components
    );
  }

  value<const D extends AnyValueDescriptor, const Actual extends ValuesOf<D>>(
    descriptor: D,
    ...values: StrictArgs<ValuesOf<D>, Actual>
  ): ResultOf<D> {
    if (values.length > 1) {
      this.#fail({
        code: "INTL_VALUES_INVALID",
        message: "Translation calls accept at most one values argument",
      });
    }
    return this.#renderStrict(
      "value",
      descriptor,
      values.length === 0 ? omittedValues : values[0]
    ) as ResultOf<D>;
  }

  validateDynamic(
    input: unknown
  ): Result<ValidatedDynamicCall, IntlDiagnostic> {
    return validateDynamicCall(this.#catalog, input);
  }

  renderDynamic(call: ValidatedDynamicCall): JsonValue | RichRenderValue {
    const inspectedCall = inspectValidatedDynamicCall(call);
    if (!inspectedCall) {
      this.#fail({
        code: "INTL_DESCRIPTOR_INVALID",
        message: "Dynamic call has not crossed the runtime validation boundary",
      });
    }
    const validatedCall = inspectedCall;
    if (validatedCall.runtimeAbi !== this.#catalog.manifest.runtimeAbi) {
      this.#fail({
        code: "INTL_ABI_MISMATCH",
        expected: this.#catalog.manifest.runtimeAbi,
        message: "Validated dynamic call uses another runtime ABI",
        runtimeAbi: validatedCall.runtimeAbi,
      });
    }
    if (validatedCall.catalogId !== this.#catalog.manifest.catalogId) {
      this.#fail({
        catalogId: validatedCall.catalogId,
        code: "INTL_CATALOG_MISMATCH",
        expected: this.#catalog.manifest.catalogId,
        message: "Validated dynamic call belongs to another catalog",
      });
    }
    if (validatedCall.hash !== this.#catalog.manifest.hash) {
      this.#fail({
        catalogHash: validatedCall.hash,
        code: "INTL_STALE_DESCRIPTOR",
        expected: this.#catalog.manifest.hash,
        message: "Validated dynamic call is stale",
      });
    }
    const message = this.#catalog.messages.find(
      (entry) => entry?.id === validatedCall.messageId
    );
    if (!message) {
      this.#fail({
        catalogId: validatedCall.catalogId,
        code: "INTL_DESCRIPTOR_INVALID",
        message: "Validated dynamic message is no longer registered",
        messageId: validatedCall.messageId,
      });
    }
    const descriptor = defineMessageDescriptor({
      buildToken: this.#catalog.manifest.buildToken,
      capabilitySetHash: this.#catalog.manifest.capabilitySetHash,
      catalogHash: this.#catalog.manifest.hash,
      catalogId: this.#catalog.manifest.catalogId,
      formatVersion: this.#catalog.manifest.formatVersion,
      kind: message.kind,
      messageId: message.id,
      path: message.path,
      rendererCapabilityId: this.#catalog.manifest.rendererCapabilityId,
      runtimeAbi: this.#catalog.manifest.runtimeAbi,
      validatorId: message.validatorId,
    });
    if (message.kind === "rich") {
      return this.#renderStrict(
        "rich",
        descriptor,
        Object.keys(message.argumentSchema.properties).length === 0
          ? omittedValues
          : validatedCall.values,
        this.#trustedRichComponents[message.id],
        validatedCall.locale
      );
    }
    return this.#renderStrict(
      message.kind,
      descriptor,
      Object.keys(message.argumentSchema.properties).length === 0
        ? omittedValues
        : validatedCall.values,
      undefined,
      validatedCall.locale
    );
  }

  #assertCatalogCompatibility(): void {
    const manifest = this.#catalog.manifest;
    if (manifest.formatVersion !== FORMAT_VERSION) {
      this.#fail({
        actual: actualSummary(manifest.formatVersion),
        code: "INTL_ABI_MISMATCH",
        expected: String(FORMAT_VERSION),
        message: "Catalog format version is unsupported",
      });
    }
    if (manifest.runtimeAbi !== RUNTIME_ABI) {
      this.#fail({
        code: "INTL_ABI_MISMATCH",
        expected: RUNTIME_ABI,
        message: "Catalog runtime ABI is unsupported",
        runtimeAbi: manifest.runtimeAbi,
      });
    }
    if (
      manifest.rendererCapabilityId !== "portable-ir-v1" &&
      manifest.rendererCapabilityId !== this.#backend.id
    ) {
      this.#fail({
        capabilitySetHash: manifest.capabilitySetHash,
        code: "INTL_FORMATTER_CAPABILITY_MISSING",
        expected: this.#backend.id,
        message:
          "Catalog renderer capability does not match the active backend",
      });
    }
    if (
      manifest.rendererCapabilityId === "portable-ir-v1" &&
      !this.#backend.supportsPortableIr
    ) {
      this.#fail({
        code: "INTL_FORMATTER_CAPABILITY_MISSING",
        message: "Active renderer does not support portable normalized IR",
      });
    }
    for (const [id, version] of Object.entries(manifest.formatterVersions)) {
      if (this.#formatters[id]?.version !== version) {
        this.#fail({
          code: "INTL_FORMATTER_CAPABILITY_MISSING",
          expected: `${id}@${version}`,
          message: "Required formatter implementation is unavailable",
        });
      }
    }
  }

  #resolveLocale(locale: string): string {
    return (
      this.#catalog.manifest.locales.find((entry) => entry === locale) ??
      this.#catalog.manifest.locales.find(
        (entry) => entry === locale.split("-")[0]
      ) ??
      this.#catalog.manifest.sourceLocale
    );
  }

  #validateDescriptor(
    expectedKind: MessageDescriptor["kind"],
    candidate: unknown
  ): ValidatedDescriptor {
    const inspected = inspectDescriptor(candidate);
    if (!inspected) {
      this.#fail({
        actual: actualSummary(candidate),
        code: "INTL_DESCRIPTOR_INVALID",
        message: "Translation descriptor brand is invalid",
      });
    }
    const descriptor = inspected.descriptor;
    const manifest = this.#catalog.manifest;
    if (descriptor.runtimeAbi !== manifest.runtimeAbi) {
      this.#fail({
        code: "INTL_ABI_MISMATCH",
        expected: manifest.runtimeAbi,
        message: "Descriptor runtime ABI does not match the catalog",
        runtimeAbi: descriptor.runtimeAbi,
      });
    }
    if (descriptor.catalogId !== manifest.catalogId) {
      this.#fail({
        catalogId: descriptor.catalogId,
        code: "INTL_CATALOG_MISMATCH",
        expected: manifest.catalogId,
        message: "Descriptor belongs to another catalog",
      });
    }
    if (
      descriptor.catalogHash !== manifest.hash ||
      descriptor.buildToken !== manifest.buildToken ||
      descriptor.capabilitySetHash !== manifest.capabilitySetHash
    ) {
      this.#fail({
        buildToken: descriptor.buildToken,
        capabilitySetHash: descriptor.capabilitySetHash,
        catalogHash: descriptor.catalogHash,
        code: "INTL_STALE_DESCRIPTOR",
        expected: manifest.hash,
        message: "Descriptor is stale or bound to another build",
      });
    }
    if (descriptor.kind !== expectedKind) {
      this.#fail({
        code: "INTL_WRONG_KIND",
        expected: expectedKind,
        kind: descriptor.kind,
        message: "Descriptor was used with the wrong strict operation",
      });
    }
    const message =
      this.#catalog.messages[descriptor.validatorId] ??
      getEmbeddedRuntimeMessage(inspected.sourceDescriptor);
    if (
      !message ||
      message.id !== descriptor.messageId ||
      message.path !== descriptor.path ||
      message.kind !== descriptor.kind
    ) {
      this.#fail({
        code: "INTL_DESCRIPTOR_INVALID",
        message: "Descriptor identity does not match the registered validator",
        messageId: descriptor.messageId,
        path: descriptor.path,
      });
    }
    return {
      descriptor,
      message,
      sourceDescriptor: inspected.sourceDescriptor,
    };
  }

  #validatedValues(message: RuntimeMessage, input: unknown): JsonObject {
    const acceptsValues =
      Object.keys(message.argumentSchema.properties).length > 0;
    if (input !== omittedValues && !acceptsValues) {
      this.#fail({
        actual: actualSummary(input),
        code: "INTL_VALUES_INVALID",
        expected: "no values argument",
        message: "This translation does not accept a values argument",
        messageId: message.id,
        provenanceRef: message.provenanceRef,
      });
    }
    const result = validateSchemaValue(
      message.argumentSchema,
      input === omittedValues ? {} : input
    );
    if (!result.ok) {
      this.#fail({
        actual: { type: result.issue.actualType },
        code: "INTL_VALUES_INVALID",
        expected: result.issue.expected,
        message: "Translation values failed exact runtime validation",
        messageId: message.id,
        path: result.issue.path,
        provenanceRef: message.provenanceRef,
      });
    }
    if (
      !result.value ||
      Array.isArray(result.value) ||
      typeof result.value !== "object"
    ) {
      this.#fail({
        code: "INTL_VALUES_INVALID",
        message: "Translation value validator returned a non-object",
        messageId: message.id,
      });
    }
    return result.value as JsonObject;
  }

  #validatedComponents(
    message: RuntimeMessage,
    input: unknown
  ): RichComponentMap {
    const record = ownDataRecord(input);
    if (!record) {
      this.#fail({
        actual: actualSummary(input),
        code: "INTL_RICH_COMPONENT_INVALID",
        message: "Rich components must be an exact plain data-property object",
        messageId: message.id,
      });
    }
    const actual = Object.keys(record).toSorted();
    const expected = [...message.tags].toSorted();
    if (actual.join("\0") !== expected.join("\0")) {
      this.#fail({
        code: "INTL_RICH_COMPONENT_INVALID",
        expected: expected.join(" | "),
        message: "Rich component keys do not match the generated tag contract",
        messageId: message.id,
      });
    }
    const output: Record<string, RichComponent> = {};
    for (const tag of expected) {
      const component = record[tag];
      if (typeof component !== "function") {
        this.#fail({
          code: "INTL_UNTRUSTED_TAG",
          expected: tag,
          message: "Rich tag does not map to a trusted component function",
          messageId: message.id,
        });
      }
      output[tag] = component as RichComponent;
    }
    return Object.freeze(output);
  }

  #validatedRichInput(
    message: RuntimeMessage,
    input: unknown
  ): Readonly<{ components: unknown; values: unknown }> {
    const record = ownDataRecord(input);
    if (!record || !Object.hasOwn(record, "components")) {
      this.#fail({
        actual: actualSummary(input),
        code: "INTL_RICH_COMPONENT_INVALID",
        message:
          "Rich input must be an exact plain data-property object with components",
        messageId: message.id,
      });
    }
    const acceptsValues =
      Object.keys(message.argumentSchema.properties).length > 0;
    const allowed = acceptsValues
      ? new Set(["components", "values"])
      : new Set(["components"]);
    const extra = Object.keys(record).find((key) => !allowed.has(key));
    if (extra !== undefined) {
      this.#fail({
        code: "INTL_RICH_COMPONENT_INVALID",
        expected: [...allowed].join(" | "),
        message: "Rich input keys do not match the generated contract",
        messageId: message.id,
        path: `$.${extra}`,
      });
    }
    return {
      components: record.components,
      values:
        acceptsValues && Object.hasOwn(record, "values")
          ? record.values
          : omittedValues,
    };
  }

  #renderStrict(
    kind: MessageDescriptor["kind"],
    descriptor: unknown,
    rawValues: unknown,
    rawComponents?: unknown,
    locale = this.#locale
  ): JsonValue | RichRenderValue {
    const validated = this.#validateDescriptor(kind, descriptor);
    return this.#renderValidated(
      kind,
      validated,
      rawValues,
      rawComponents,
      locale
    );
  }

  #renderValidated(
    kind: MessageDescriptor["kind"],
    validated: ValidatedDescriptor,
    rawValues: unknown,
    rawComponents?: unknown,
    locale = this.#locale
  ): JsonValue | RichRenderValue {
    const values = this.#validatedValues(validated.message, rawValues);
    const components =
      kind === "rich"
        ? this.#validatedComponents(validated.message, rawComponents)
        : undefined;
    try {
      const precompiledRenderer =
        getPrecompiledRenderer(validated.sourceDescriptor) ??
        getPrecompiledRenderer(validated.message);
      if (
        this.#catalog.manifest.rendererCapabilityId === "precompiled-v1" &&
        !precompiledRenderer
      ) {
        throw new Error(
          "Backend-specific precompiled catalog descriptor has no emitted renderer"
        );
      }
      const request = {
        escapeValues: this.#escapeValues,
        formatters: this.#formatters,
        locale,
        message: validated.message,
        ...(precompiledRenderer ? { precompiledRenderer } : {}),
        values,
      };
      if (kind === "rich") {
        if (!components) {
          throw new Error("Rich component validation returned no map");
        }
        if (!this.#backend.renderRich) {
          throw new Error(
            `Renderer ${this.#backend.id} does not support trusted rich components`
          );
        }
        return this.#backend.renderRich(request, components);
      }
      const rendered = this.#backend.render(request);
      if (kind === "text" && typeof rendered !== "string") {
        throw new TypeError("Text renderer returned a non-string value");
      }
      return rendered;
    } catch (error) {
      this.#fail({
        actual: actualSummary(error),
        code: "INTL_RENDERER_FAILURE",
        kind,
        locale,
        message: "Strict translation renderer failed",
        messageId: validated.message.id,
        provenanceRef: validated.message.provenanceRef,
      });
    }
  }

  #fail(diagnostic: IntlDiagnostic): never {
    const sanitizedDiagnostic = sanitizeDiagnostic(diagnostic);
    let secondaryCode: IntlDiagnostic["code"] | undefined;
    if (this.#diagnosticSink && !this.#sinkDispatching) {
      this.#sinkDispatching = true;
      try {
        this.#diagnosticSink(sanitizedDiagnostic);
      } catch (error) {
        secondaryCode =
          nestedDiagnosticCode(error) ?? "INTL_DIAGNOSTIC_SINK_FAILURE";
      } finally {
        this.#sinkDispatching = false;
      }
    }
    const finalDiagnostic = secondaryCode
      ? { ...sanitizedDiagnostic, secondaryCode }
      : sanitizedDiagnostic;
    throw new IntlRuntimeError(finalDiagnostic);
  }
}

export function createIntlRuntime(
  options: IntlRuntimeOptions
): StrictIntlRuntime {
  return new StrictIntlRuntime(options);
}
