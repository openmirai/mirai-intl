import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  FORMAT_VERSION,
  RUNTIME_ABI,
  IntlRuntimeError,
  defineMessageDescriptor,
} from "@openmirai/intl-abi";
import type {
  IntlDiagnostic,
  JsonObject,
  JsonValue,
  MessageDescriptor,
  ObjectSchema,
  RichDescriptor,
  RuntimeCatalog,
  RuntimeMessage,
  TextDescriptor,
  ValidatedDynamicCall,
  ValueDescriptor,
} from "@openmirai/intl-abi";
import {
  compileCatalog,
  emitArtifacts,
} from "@openmirai/intl-compiler/internal";
import type { DescriptorRepresentation } from "@openmirai/intl-compiler/internal";
import {
  MissingResourceError,
  createIntlRuntime,
  createPrecompiledBackend,
  createTFunctionBridgeBackend,
} from "@openmirai/intl-runtime";
import type {
  RenderRequest,
  RendererBackend,
  RuntimeFormatter,
  StrictIntlRuntime,
} from "@openmirai/intl-runtime";
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { createUseIntl } from "../src/react";
import {
  catalogFixtureSource,
  catalogRuntimeCases,
} from "../../../test/fixtures/catalog";

const compiled = compileCatalog(catalogFixtureSource);
const bridgeMoneyArgument = "__mirai_money_amount_compact";
const bridgeCalls: Array<string> = [];

const catalogFormatters = Object.freeze({
  money: Object.freeze({
    format(value: JsonValue, locale: string, options?: string): string {
      if (typeof value !== "number") {
        throw new TypeError("Money value must be numeric");
      }
      return `${locale}/${options ?? "default"}/${value}`;
    },
    version: "1.0.0",
  }),
});

type FormatterMap = Readonly<Record<string, RuntimeFormatter>>;

type BridgeResources = Record<string, { translation: Record<string, string> }>;

function createBridgeResources(): BridgeResources {
  const resources: BridgeResources = {};
  for (const locale of ["en", "th"] as const) {
    const translation: Record<string, string> = {};
    for (const message of catalogFixtureSource.messages) {
      const source = message.translations[locale];
      if (typeof source !== "string") {
        continue;
      }
      translation[message.path] = source.replace(
        "{amount, number, custom:money:compact}",
        `{${bridgeMoneyArgument}}`
      );
    }
    resources[locale] = { translation };
  }
  return resources;
}

const bridgeI18n = createInstance();
await bridgeI18n
  .use(
    new ICU({
      escapeVariables: false,
      formats: {
        date: {
          long: {
            day: "numeric",
            month: "long",
            timeZone: "UTC",
            year: "numeric",
          },
        },
        number: { percent: { style: "percent" } },
        time: {
          long: {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
            timeZone: "UTC",
            timeZoneName: "short",
          },
        },
      },
      parseErrorHandler(error) {
        throw error;
      },
    })
  )
  .init({
    defaultNS: "translation",
    fallbackLng: false,
    initAsync: false,
    keySeparator: false,
    lng: "en",
    resources: createBridgeResources(),
    supportedLngs: [...catalogFixtureSource.locales],
  });

function messageAt(path: string) {
  const message = compiled.catalog.messages.find(
    (candidate) => candidate.path === path
  );
  if (!message) {
    throw new Error(`Missing fixture message ${path}`);
  }
  return message;
}

function descriptorAt(path: string): MessageDescriptor {
  const descriptor = compiled.descriptors.find(
    (candidate) => candidate.path === path
  );
  if (!descriptor) {
    throw new Error(`Missing fixture descriptor ${path}`);
  }
  return descriptor;
}

async function loadGeneratedModule(
  representation: DescriptorRepresentation,
  output: ReturnType<typeof compileCatalog> = compiled
): Promise<Readonly<Record<string, unknown>>> {
  const root = await mkdtemp(join(import.meta.dirname, ".generated-"));
  const modulePath = join(root, "catalog.descriptors.gen.mjs");
  const artifacts = emitArtifacts(output, representation);
  await writeFile(modulePath, artifacts["catalog.descriptors.gen.mjs"], "utf8");
  try {
    const generated: unknown = await import(pathToFileURL(modulePath).href);
    if (!generated || typeof generated !== "object") {
      throw new TypeError("Generated descriptor module is not an object");
    }
    return generated as Readonly<Record<string, unknown>>;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function loadGeneratedTree(
  representation: DescriptorRepresentation
): Promise<unknown> {
  return Reflect.get(await loadGeneratedModule(representation), "catalogTree");
}

function generatedDescriptorAt(tree: unknown, path: string): MessageDescriptor {
  let current = tree;
  for (const part of path.split(".")) {
    if (
      !current ||
      (typeof current !== "object" && typeof current !== "function")
    ) {
      throw new TypeError(`Generated descriptor path ${path} is missing`);
    }
    current = Reflect.get(current, part);
  }
  if (
    !current ||
    (typeof current !== "object" && typeof current !== "function") ||
    Reflect.get(current, "path") !== path
  ) {
    throw new TypeError(`Generated descriptor path ${path} is invalid`);
  }
  return current as MessageDescriptor;
}

function textDescriptorAt(
  path: string
): TextDescriptor<Record<string, unknown>> {
  const descriptor = descriptorAt(path);
  if (descriptor.kind !== "text") {
    throw new Error(`${path} is not text`);
  }
  return descriptor as TextDescriptor<Record<string, unknown>>;
}

function richDescriptorAt(path: string): RichDescriptor {
  const descriptor = descriptorAt(path);
  if (descriptor.kind !== "rich") {
    throw new Error(`${path} is not rich`);
  }
  return descriptor as RichDescriptor;
}

function createFixtureBridgeBackend(formatters: FormatterMap): RendererBackend {
  return createTFunctionBridgeBackend(
    (key, options = {}) => {
      bridgeCalls.push(key);
      return bridgeI18n.t(key, { ...options });
    },
    {
      customFormatValues(request: RenderRequest): JsonObject {
        if (request.message.path !== "payout.total") {
          return {};
        }
        const formatter = formatters.money;
        if (!formatter) {
          throw new Error("Bridge money formatter is missing");
        }
        const amount = request.values.amount;
        if (amount === undefined) {
          throw new Error("Bridge money amount is missing");
        }
        return {
          [bridgeMoneyArgument]: formatter.format(
            amount,
            request.locale,
            "compact"
          ),
        };
      },
      resourceExists(key, locale) {
        return bridgeI18n.exists(key, { lng: locale });
      },
    }
  );
}

const backendMatrix = [
  {
    create: (_formatters: FormatterMap) => createPrecompiledBackend(),
    name: "precompiled-v1",
    supportsRich: true,
  },
  {
    create: createFixtureBridgeBackend,
    name: "tfunction-bridge-v1",
    supportsRich: false,
  },
] as const;

type BackendCase = (typeof backendMatrix)[number];

type RuntimeOverrides = Readonly<{
  catalog?: RuntimeCatalog;
  diagnosticSink?: (diagnostic: IntlDiagnostic) => void;
  escapeValues?: boolean;
  formatters?: FormatterMap;
  locale?: string;
  missingMessageFallback?: string | ((diagnostic: IntlDiagnostic) => string);
  strictValidation?: boolean;
  trustedRichComponents?: Readonly<
    Record<
      string,
      Readonly<Record<string, (children: ReadonlyArray<unknown>) => unknown>>
    >
  >;
}>;

function runtimeFor(
  backendCase: BackendCase,
  overrides: RuntimeOverrides = {}
): StrictIntlRuntime {
  const formatters = overrides.formatters ?? catalogFormatters;
  return createIntlRuntime({
    backend: backendCase.create(formatters),
    catalog: overrides.catalog ?? compiled.catalog,
    formatters,
    locale: overrides.locale ?? "en",
    ...(overrides.diagnosticSink
      ? { diagnosticSink: overrides.diagnosticSink }
      : {}),
    ...(overrides.escapeValues === undefined
      ? {}
      : { escapeValues: overrides.escapeValues }),
    ...(overrides.missingMessageFallback === undefined
      ? {}
      : { missingMessageFallback: overrides.missingMessageFallback }),
    ...(overrides.strictValidation === undefined
      ? {}
      : { strictValidation: overrides.strictValidation }),
    ...(overrides.trustedRichComponents
      ? { trustedRichComponents: overrides.trustedRichComponents }
      : {}),
  });
}

function captureRuntimeError(action: () => unknown): IntlRuntimeError {
  try {
    action();
  } catch (error) {
    if (error instanceof IntlRuntimeError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected IntlRuntimeError");
}

function expectDynamicError(
  result: ReturnType<StrictIntlRuntime["validateDynamic"]>,
  code: IntlDiagnostic["code"]
): IntlDiagnostic {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected dynamic validation failure");
  }
  expect(result.error.code).toBe(code);
  return result.error;
}

function descriptorWith(
  descriptor: MessageDescriptor,
  overrides: Readonly<{
    buildToken?: string;
    capabilitySetHash?: `sha256:${string}`;
    catalogHash?: `sha256:${string}`;
    catalogId?: string;
    kind?: MessageDescriptor["kind"];
    messageId?: string;
    path?: string;
    validatorId?: number;
  }>
): MessageDescriptor {
  return defineMessageDescriptor({
    buildToken: overrides.buildToken ?? descriptor.buildToken,
    capabilitySetHash:
      overrides.capabilitySetHash ?? descriptor.capabilitySetHash,
    catalogHash: overrides.catalogHash ?? descriptor.catalogHash,
    catalogId: overrides.catalogId ?? descriptor.catalogId,
    formatVersion: descriptor.formatVersion,
    kind: overrides.kind ?? descriptor.kind,
    messageId: overrides.messageId ?? descriptor.messageId,
    path: overrides.path ?? descriptor.path,
    rendererCapabilityId: descriptor.rendererCapabilityId,
    runtimeAbi: descriptor.runtimeAbi,
    validatorId: overrides.validatorId ?? descriptor.validatorId,
  });
}

function renderCase(
  runtime: StrictIntlRuntime,
  testCase: (typeof catalogRuntimeCases)[number]
): unknown {
  return renderCaseWithDescriptor(
    runtime,
    testCase,
    descriptorAt(testCase.path)
  );
}

function renderCaseWithDescriptor(
  runtime: StrictIntlRuntime,
  testCase: (typeof catalogRuntimeCases)[number],
  descriptor: MessageDescriptor
): unknown {
  switch (descriptor.kind) {
    case "text":
      return runtime.t(
        descriptor as TextDescriptor<Record<string, unknown>>,
        testCase.values as never
      );
    case "rich":
      return runtime.rich(
        descriptor as RichDescriptor,
        {
          components: "components" in testCase ? testCase.components : {},
          values: testCase.values,
        } as never
      );
    case "value":
      return Reflect.apply(runtime.value, runtime, [
        descriptor as ValueDescriptor,
      ]);
  }
}

function dynamicWire(
  path: string,
  values: unknown,
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  const descriptor = descriptorAt(path);
  return {
    catalogId: compiled.catalog.manifest.catalogId,
    formatVersion: FORMAT_VERSION,
    hash: compiled.catalog.manifest.hash,
    kind: descriptor.kind,
    locale: "en",
    messageId: descriptor.messageId,
    runtimeAbi: RUNTIME_ABI,
    values,
    ...overrides,
  };
}

function catalogWithArgumentSchema(
  path: string,
  argumentSchema: ObjectSchema
): RuntimeCatalog {
  return {
    ...compiled.catalog,
    messages: compiled.catalog.messages.map((message) =>
      message.path === path ? { ...message, argumentSchema } : message
    ),
  };
}

function catalogWithoutRenderPayloads(): RuntimeCatalog {
  return {
    ...compiled.catalog,
    messages: compiled.catalog.messages.map((message) => ({
      argumentSchema: message.argumentSchema,
      formatterIds: message.formatterIds,
      id: message.id,
      kind: message.kind,
      path: message.path,
      provenanceRef: message.provenanceRef,
      resultSchema: message.resultSchema,
      tags: message.tags,
      validatorId: message.validatorId,
    })),
  };
}

describe.each(backendMatrix)("$name strict runtime", (backendCase) => {
  it("renders its supported EN/TH golden corpus", () => {
    const runtime = runtimeFor(backendCase);

    for (const locale of ["en", "th"] as const) {
      runtime.setLocale(locale);
      for (const testCase of catalogRuntimeCases) {
        if (
          messageAt(testCase.path).kind === "rich" &&
          !backendCase.supportsRich
        ) {
          continue;
        }
        expect(
          renderCase(runtime, testCase),
          `${locale}:${testCase.path}`
        ).toEqual(testCase.expectedByLocale[locale]);
      }
    }
  });

  it("preserves strict escaping and source-locale fallback", () => {
    const escaped = runtimeFor(backendCase, { escapeValues: true });
    expect(
      escaped.t(textDescriptorAt("greeting.morning"), {
        name: "<admin>",
      } as never)
    ).toBe("Good morning, &lt;admin&gt;");

    const fallback = runtimeFor(backendCase, { locale: "fr" });
    expect(fallback.locale).toBe("en");
    expect(
      fallback.t(textDescriptorAt("greeting.morning"), {
        name: "Mali",
      } as never)
    ).toBe("Good morning, Mali");
    expect(
      captureRuntimeError(() => fallback.setLocale("fr")).diagnostic.code
    ).toBe("INTL_LOCALE_INVALID");
  });

  it("rejects invalid, stale, and wrong-kind descriptors before rendering", () => {
    const runtime = runtimeFor(backendCase);
    const text = textDescriptorAt("greeting.morning");

    expect(
      captureRuntimeError(() =>
        runtime.t(
          {} as TextDescriptor<Record<string, unknown>>,
          { name: "Mali" } as never
        )
      ).diagnostic.code
    ).toBe("INTL_DESCRIPTOR_INVALID");
    expect(
      captureRuntimeError(() =>
        runtime.t(
          descriptorWith(text, {
            buildToken: "previous-build",
          }) as TextDescriptor<Record<string, unknown>>,
          { name: "Mali" } as never
        )
      ).diagnostic.code
    ).toBe("INTL_STALE_DESCRIPTOR");
    expect(
      captureRuntimeError(() =>
        runtime.t(
          descriptorWith(text, {
            catalogHash: "sha256:previous-catalog",
          }) as TextDescriptor<Record<string, unknown>>,
          { name: "Mali" } as never
        )
      ).diagnostic.code
    ).toBe("INTL_STALE_DESCRIPTOR");
    expect(
      captureRuntimeError(() =>
        runtime.value(
          text as unknown as ValueDescriptor<Record<string, unknown>>,
          undefined as never
        )
      ).diagnostic.code
    ).toBe("INTL_WRONG_KIND");
  });

  it("sanitizes hostile descriptor reflection failures", () => {
    const runtime = runtimeFor(backendCase);
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("descriptor proxy secret");
        },
      }
    );

    const error = captureRuntimeError(() =>
      runtime.t(
        hostile as TextDescriptor<Record<string, unknown>>,
        { name: "Mali" } as never
      )
    );

    expect(error.diagnostic.code).toBe("INTL_DESCRIPTOR_INVALID");
    expect(error.diagnostic.actual?.type).toBe("uninspectable");
    expect(JSON.stringify(error.diagnostic)).not.toContain("proxy secret");
  });

  it("rejects missing, extra, and wrongly typed values without fallback", () => {
    const runtime = runtimeFor(backendCase);
    const descriptor = textDescriptorAt("greeting.morning");

    const missing = captureRuntimeError(() =>
      runtime.t(descriptor, {} as never)
    );
    const extra = captureRuntimeError(() =>
      runtime.t(descriptor, { extra: true, name: "Mali" } as never)
    );
    const wrong = captureRuntimeError(() =>
      runtime.t(descriptor, { name: 42 } as never)
    );

    expect([
      missing.diagnostic.code,
      extra.diagnostic.code,
      wrong.diagnostic.code,
    ]).toEqual([
      "INTL_VALUES_INVALID",
      "INTL_VALUES_INVALID",
      "INTL_VALUES_INVALID",
    ]);
    expect(missing.diagnostic.path).toBe("$.name");
    expect(extra.diagnostic.path).toBe("$.extra");
    expect(wrong.diagnostic.path).toBe("$.name");
  });

  it("rejects missing, extra, and untrusted rich components with their strict codes", () => {
    const runtime = runtimeFor(backendCase);
    const descriptor = richDescriptorAt("rich.deactivate");
    const values = { name: "Mali" };

    const missing = captureRuntimeError(() =>
      runtime.rich(descriptor, { components: {}, values } as never)
    );
    const extra = captureRuntimeError(() =>
      runtime.rich(descriptor, {
        components: {
          extra: (children: ReadonlyArray<unknown>) => children,
          medium: (children: ReadonlyArray<unknown>) => children,
        },
        values,
      } as never)
    );
    const untrusted = captureRuntimeError(() =>
      runtime.rich(descriptor, {
        components: { medium: "strong" },
        values,
      } as never)
    );

    expect(missing.diagnostic.code).toBe("INTL_RICH_COMPONENT_INVALID");
    expect(extra.diagnostic.code).toBe("INTL_RICH_COMPONENT_INVALID");
    expect(untrusted.diagnostic.code).toBe("INTL_UNTRUSTED_TAG");
  });

  it("sanitizes renderer failures", () => {
    const formatters = {
      money: {
        format(): string {
          throw new Error("raw formatter secret");
        },
        version: "1.0.0",
      },
    } satisfies FormatterMap;
    const runtime = runtimeFor(backendCase, { formatters });
    const error = captureRuntimeError(() =>
      runtime.t(textDescriptorAt("payout.total"), { amount: 1200 } as never)
    );

    expect(error.diagnostic.code).toBe("INTL_RENDERER_FAILURE");
    expect(error.diagnostic.actual?.type).toBe("instance");
    expect(JSON.stringify(error.diagnostic)).not.toContain(
      "raw formatter secret"
    );
  });

  it("fails catalog ABI and formatter capability checks during construction", () => {
    const incompatibleCatalog = {
      ...compiled.catalog,
      manifest: { ...compiled.catalog.manifest, runtimeAbi: "2.0.0" as never },
    };

    expect(
      captureRuntimeError(() =>
        runtimeFor(backendCase, { catalog: incompatibleCatalog })
      ).diagnostic.code
    ).toBe("INTL_ABI_MISMATCH");
    expect(
      captureRuntimeError(() => runtimeFor(backendCase, { formatters: {} }))
        .diagnostic.code
    ).toBe("INTL_FORMATTER_CAPABILITY_MISSING");
  });

  it("validates and renders an exact dynamic call", () => {
    const runtime = runtimeFor(backendCase);
    const result = runtime.validateDynamic(
      dynamicWire("greeting.morning", { name: "Mali" })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(runtime.renderDynamic(result.value)).toBe("Good morning, Mali");
  });

  it("rejects dynamic accessors, inherited records, extra fields, and unsafe keys", () => {
    const runtime = runtimeFor(backendCase);
    const accessor = { ...dynamicWire("greeting.morning", { name: "Mali" }) };
    let accessorReads = 0;
    Object.defineProperty(accessor, "values", {
      enumerable: true,
      get() {
        accessorReads += 1;
        return { name: "Mali" };
      },
    });
    const inherited = Object.create(
      dynamicWire("greeting.morning", { name: "Mali" })
    );
    const extra = {
      ...dynamicWire("greeting.morning", { name: "Mali" }),
      debug: true,
    };
    const unsafeValues: Record<string, unknown> = Object.create(null);
    Object.defineProperty(unsafeValues, "name", {
      enumerable: true,
      value: "Mali",
    });
    Object.defineProperty(unsafeValues, "__proto__", {
      enumerable: true,
      value: "pollution",
    });

    expectDynamicError(
      runtime.validateDynamic(accessor),
      "INTL_DYNAMIC_ACCESSOR"
    );
    expect(accessorReads).toBe(0);
    expectDynamicError(
      runtime.validateDynamic(inherited),
      "INTL_DYNAMIC_INVALID_OBJECT"
    );
    expectDynamicError(
      runtime.validateDynamic(extra),
      "INTL_DYNAMIC_EXTRA_FIELD"
    );
    const unsafe = expectDynamicError(
      runtime.validateDynamic(dynamicWire("greeting.morning", unsafeValues)),
      "INTL_VALUES_INVALID"
    );
    expect(unsafe.path).toBe("$.values.__proto__");
  });

  it("sanitizes hostile dynamic reflection failures", () => {
    const runtime = runtimeFor(backendCase);
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("dynamic proxy secret");
        },
      }
    );

    const diagnostic = expectDynamicError(
      runtime.validateDynamic(hostile),
      "INTL_DYNAMIC_INVALID_OBJECT"
    );
    expect(JSON.stringify(diagnostic)).not.toContain("proxy secret");
    expect(
      captureRuntimeError(() =>
        runtime.renderDynamic(hostile as ValidatedDynamicCall)
      ).diagnostic.code
    ).toBe("INTL_DESCRIPTOR_INVALID");
  });

  it("rejects dynamic cycles, non-finite numbers, and resource-limit attacks", () => {
    expect.hasAssertions();
    const runtime = runtimeFor(backendCase);
    expectDynamicError(
      runtime.validateDynamic(
        dynamicWire("results.summary", { count: Number.NaN })
      ),
      "INTL_VALUES_INVALID"
    );
    expectDynamicError(
      runtime.validateDynamic(
        dynamicWire("greeting.morning", { name: "x".repeat(16 * 1024 + 1) })
      ),
      "INTL_DYNAMIC_LIMIT_EXCEEDED"
    );

    const cycleSchema = {
      additionalProperties: false,
      properties: {
        payload: {
          additionalProperties: false,
          properties: {
            child: {
              additionalProperties: false,
              properties: {},
              required: [],
              type: "object",
            },
          },
          required: ["child"],
          type: "object",
        },
      },
      required: ["payload"],
      type: "object",
    } satisfies ObjectSchema;
    const payload: Record<string, unknown> = {};
    payload.child = payload;
    const cycleRuntime = runtimeFor(backendCase, {
      catalog: catalogWithArgumentSchema("greeting.morning", cycleSchema),
    });
    expectDynamicError(
      cycleRuntime.validateDynamic(
        dynamicWire("greeting.morning", { payload })
      ),
      "INTL_VALUES_INVALID"
    );

    const aggregateSchema = {
      additionalProperties: false,
      properties: { items: { items: { type: "string" }, type: "array" } },
      required: ["items"],
      type: "object",
    } satisfies ObjectSchema;
    const aggregateRuntime = runtimeFor(backendCase, {
      catalog: catalogWithArgumentSchema("greeting.morning", aggregateSchema),
    });
    expectDynamicError(
      aggregateRuntime.validateDynamic(
        dynamicWire("greeting.morning", {
          items: Array.from({ length: 257 }, () => "x"),
        })
      ),
      "INTL_DYNAMIC_LIMIT_EXCEEDED"
    );
  });

  it.each(["t", "renderDynamic"] as const)(
    "guards diagnostic-sink reentrancy when the sink invokes %s",
    (nestedOperation) => {
      const events: Array<string> = [];
      const diagnosticSink = (diagnostic: IntlDiagnostic): void => {
        events.push(`sink:${diagnostic.code}`);
        if (nestedOperation === "t") {
          runtime.t(
            {} as TextDescriptor<Record<string, unknown>>,
            { name: "nested" } as never
          );
          return;
        }
        runtime.renderDynamic({
          ...dynamicWire("greeting.morning", { name: "nested" }),
          messageId: "missing-message",
        } as ValidatedDynamicCall);
      };
      const runtime = runtimeFor(backendCase, { diagnosticSink });

      const error = captureRuntimeError(() =>
        runtime.value(
          textDescriptorAt("greeting.morning") as unknown as ValueDescriptor<
            Record<string, unknown>
          >,
          undefined as never
        )
      );
      events.push("caught");

      expect(events).toEqual(["sink:INTL_WRONG_KIND", "caught"]);
      expect(error.diagnostic.code).toBe("INTL_WRONG_KIND");
      expect(error.diagnostic.secondaryCode).toBe("INTL_DESCRIPTOR_INVALID");
    }
  );

  it("cannot let a throwing diagnostic sink replace the original error", () => {
    const runtime = runtimeFor(backendCase, {
      diagnosticSink() {
        throw new Error("sink secret");
      },
    });
    const error = captureRuntimeError(() =>
      runtime.t(
        {} as TextDescriptor<Record<string, unknown>>,
        { name: "Mali" } as never
      )
    );

    expect(error.diagnostic.code).toBe("INTL_DESCRIPTOR_INVALID");
    expect(error.diagnostic.secondaryCode).toBe("INTL_DIAGNOSTIC_SINK_FAILURE");
    expect(JSON.stringify(error.diagnostic)).not.toContain("sink secret");
  });
});

describe.each(backendMatrix)("$name production trust mode", (backendCase) => {
  it("skips exact value schema validation while keeping brand fail-closed", () => {
    const runtime = runtimeFor(backendCase, { strictValidation: false });
    expect(runtime.strictValidation).toBe(false);
    const descriptor = textDescriptorAt("greeting.morning");

    expect(runtime.t(descriptor, { name: "Mali" } as never)).toBe(
      "Good morning, Mali"
    );
    expect(runtime.t(descriptor, { extra: true, name: "Mali" } as never)).toBe(
      "Good morning, Mali"
    );

    expect(
      captureRuntimeError(() =>
        runtime.t(
          {} as TextDescriptor<Record<string, unknown>>,
          { name: "Mali" } as never
        )
      ).diagnostic.code
    ).toBe("INTL_DESCRIPTOR_INVALID");
  });

  it("skips stale hash re-checks while still rejecting wrong kind", () => {
    const runtime = runtimeFor(backendCase, { strictValidation: false });
    const text = textDescriptorAt("greeting.morning");

    expect(
      runtime.t(
        descriptorWith(text, {
          buildToken: "previous-build",
        }) as TextDescriptor<Record<string, unknown>>,
        { name: "Mali" } as never
      )
    ).toBe("Good morning, Mali");

    expect(
      captureRuntimeError(() =>
        runtime.value(
          text as unknown as ValueDescriptor<Record<string, unknown>>,
          undefined as never
        )
      ).diagnostic.code
    ).toBe("INTL_WRONG_KIND");
  });

  it("soft-fails missing resources without returning dotted key paths", () => {
    const diagnostics: Array<IntlDiagnostic> = [];
    const runtime = createIntlRuntime({
      backend: {
        id: "tfunction-bridge-v1",
        render() {
          throw new MissingResourceError("TFunction resource is unavailable");
        },
        supportsPortableIr: true,
      },
      catalog: compiled.catalog,
      diagnosticSink(diagnostic) {
        diagnostics.push(diagnostic);
      },
      formatters: catalogFormatters,
      locale: "en",
      missingMessageFallback: "Content is unavailable.",
      strictValidation: false,
    });
    const rendered = runtime.t(textDescriptorAt("greeting.morning"), {
      name: "Mali",
    } as never);

    expect(rendered).toBe("Content is unavailable.");
    expect(rendered).not.toContain("greeting.morning");
    expect(diagnostics.map((entry) => entry.code)).toEqual([
      "INTL_MISSING_RESOURCE",
    ]);
  });

  it("still throws for missing resources under strict validation", () => {
    const runtime = createIntlRuntime({
      backend: {
        id: "tfunction-bridge-v1",
        render() {
          throw new MissingResourceError("TFunction resource is unavailable");
        },
        supportsPortableIr: true,
      },
      catalog: compiled.catalog,
      formatters: catalogFormatters,
      locale: "en",
      strictValidation: true,
    });

    expect(
      captureRuntimeError(() =>
        runtime.t(textDescriptorAt("greeting.morning"), {
          name: "Mali",
        } as never)
      ).diagnostic.code
    ).toBe("INTL_RENDERER_FAILURE");
  });
});

describe("renderer conformance evidence", () => {
  it("does not treat a backend-specific precompiled catalog as portable IR", () => {
    const backendSpecific = compileCatalog({
      ...catalogFixtureSource,
      rendererCapabilityId: "precompiled-v1",
    });
    const descriptor = backendSpecific.descriptors.find(
      (candidate) => candidate.path === "greeting.morning"
    );
    if (!descriptor || descriptor.kind !== "text") {
      throw new Error("Missing backend-specific text descriptor fixture");
    }
    const runtime = createIntlRuntime({
      backend: createPrecompiledBackend(),
      catalog: backendSpecific.catalog,
      formatters: catalogFormatters,
      locale: "en",
    });

    const error = captureRuntimeError(() =>
      runtime.t(
        descriptor as TextDescriptor<Record<string, unknown>>,
        { name: "Mali" } as never
      )
    );

    expect(error.diagnostic.code).toBe("INTL_RENDERER_FAILURE");
    expect(JSON.stringify(error.diagnostic)).not.toContain("emitted renderer");
  });

  it("renders dynamic calls from backend-specific runtime-message exports", async () => {
    const output = compileCatalog({
      ...catalogFixtureSource,
      rendererCapabilityId: "precompiled-v1",
    });
    const generated = await loadGeneratedModule("precompiled", output);
    const messages = output.catalog.messages.map((message) => {
      const exported = Reflect.get(
        generated,
        `runtimeMessage_${message.path.replaceAll(".", "_")}`
      );
      if (!exported || typeof exported !== "object") {
        throw new TypeError(`Missing runtime message export ${message.path}`);
      }
      return exported as RuntimeMessage;
    });
    const greeting = messages.find(
      (message) => message.path === "greeting.morning"
    );
    if (!greeting) {
      throw new Error("Missing generated greeting runtime message");
    }
    const selectedMessages: Array<RuntimeMessage> = [];
    selectedMessages[greeting.validatorId] = greeting;
    const catalog = {
      manifest: output.catalog.manifest,
      messages: selectedMessages,
    } satisfies RuntimeCatalog;
    expect(greeting.localeNodes).toBeUndefined();
    const runtime = createIntlRuntime({
      backend: createPrecompiledBackend(),
      catalog,
      formatters: catalogFormatters,
      locale: "en",
    });
    const validated = runtime.validateDynamic({
      catalogId: catalog.manifest.catalogId,
      formatVersion: catalog.manifest.formatVersion,
      hash: catalog.manifest.hash,
      kind: greeting.kind,
      locale: "en",
      messageId: greeting.id,
      runtimeAbi: catalog.manifest.runtimeAbi,
      values: { name: "Mali" },
    });

    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(validated.error.message);
    }
    expect(runtime.renderDynamic(validated.value)).toBe("Good morning, Mali");
  });

  it("routes every supported text ICU case through i18next TFunction", () => {
    bridgeCalls.length = 0;
    const runtime = runtimeFor(backendMatrix[1]);
    const expectedCalls = catalogRuntimeCases.filter(
      (testCase) => messageAt(testCase.path).kind === "text"
    );
    const expectedPaths = [
      ...new Set(expectedCalls.map((testCase) => testCase.path)),
    ].toSorted();

    for (const locale of ["en", "th"] as const) {
      runtime.setLocale(locale);
      for (const testCase of catalogRuntimeCases) {
        if (messageAt(testCase.path).kind === "text") {
          renderCase(runtime, testCase);
        }
      }
    }

    expect(bridgeI18n.isInitialized).toBe(true);
    expect([...new Set(bridgeCalls)].toSorted()).toEqual(expectedPaths);
    expect(bridgeCalls).toHaveLength(expectedCalls.length * 2);
  });

  it("renders trusted rich components through normalized IR when the TFunction resource exists", () => {
    const runtime = runtimeFor(backendMatrix[1]);
    const rendered = runtime.rich(richDescriptorAt("rich.deactivate"), {
      components: {
        medium: (children: ReadonlyArray<unknown>) =>
          `<strong>${children.join("")}</strong>`,
      },
      values: { name: "Mali" },
    } as never);

    expect(rendered).toEqual(["Deactivate ", "<strong>Mali</strong>", "?"]);
  });

  it("rejects rich bridge rendering when the upstream resource is missing", () => {
    const runtime = createIntlRuntime({
      backend: createTFunctionBridgeBackend((key) => key, {
        resourceExists: () => false,
      }),
      catalog: compiled.catalog,
      formatters: catalogFormatters,
      locale: "en",
    });
    const error = captureRuntimeError(() =>
      runtime.rich(richDescriptorAt("rich.deactivate"), {
        components: {
          medium: (children: ReadonlyArray<unknown>) => children.join(""),
        },
        values: { name: "Mali" },
      } as never)
    );

    expect(error.diagnostic.code).toBe("INTL_RENDERER_FAILURE");
    expect(error.diagnostic.kind).toBe("rich");
  });

  it("rejects a missing upstream resource instead of returning its raw key", () => {
    const runtime = createIntlRuntime({
      backend: createTFunctionBridgeBackend((key) => key, {
        resourceExists: () => false,
      }),
      catalog: compiled.catalog,
      formatters: catalogFormatters,
      locale: "en",
    });
    const error = captureRuntimeError(() =>
      runtime.t(textDescriptorAt("greeting.morning"), { name: "Mali" } as never)
    );

    expect(error.diagnostic.code).toBe("INTL_RENDERER_FAILURE");
    expect(error.message).toBe("Strict translation renderer failed");
    expect(error.diagnostic.actual?.type).toBe("instance");
    expect(JSON.stringify(error.diagnostic)).not.toContain("greeting.morning");
  });

  it.each(["constants", "proxy", "precompiled"] as const)(
    "renders the generated %s representation across compatible backends",
    async (representation) => {
      const tree = await loadGeneratedTree(representation);

      for (const backendCase of backendMatrix) {
        const runtime = runtimeFor(backendCase);
        for (const locale of ["en", "th"] as const) {
          runtime.setLocale(locale);
          for (const testCase of catalogRuntimeCases) {
            if (
              messageAt(testCase.path).kind === "rich" &&
              !backendCase.supportsRich
            ) {
              continue;
            }
            expect(
              renderCaseWithDescriptor(
                runtime,
                testCase,
                generatedDescriptorAt(tree, testCase.path)
              ),
              `${representation}:${backendCase.name}:${locale}:${testCase.path}`
            ).toEqual(testCase.expectedByLocale[locale]);
          }
        }
      }
    }
  );

  it("executes emitted message functions without catalog render payloads", async () => {
    const tree = await loadGeneratedTree("precompiled");
    const runtime = runtimeFor(backendMatrix[0], {
      catalog: catalogWithoutRenderPayloads(),
    });

    for (const locale of ["en", "th"] as const) {
      runtime.setLocale(locale);
      for (const testCase of catalogRuntimeCases) {
        expect(
          renderCaseWithDescriptor(
            runtime,
            testCase,
            generatedDescriptorAt(tree, testCase.path)
          ),
          `emitted:${locale}:${testCase.path}`
        ).toEqual(testCase.expectedByLocale[locale]);
      }
    }
  });

  it("renders an imported semantic precompiled descriptor from an empty sparse catalog", async () => {
    const output = compileCatalog({
      ...catalogFixtureSource,
      rendererCapabilityId: "precompiled-v1",
    });
    const generated = await loadGeneratedModule("precompiled", output);
    const tree = Reflect.get(generated, "catalogTree");
    const runtime = createIntlRuntime({
      backend: createPrecompiledBackend(),
      catalog: { manifest: output.catalog.manifest, messages: [] },
      formatters: catalogFormatters,
      locale: "en",
    });

    expect(
      runtime.t(
        generatedDescriptorAt(tree, "greeting.morning") as TextDescriptor<{
          name: string | number;
        }>,
        { name: "Mali" }
      )
    ).toBe("Good morning, Mali");
  });

  it("renders emitted custom date and time formatter styles", async () => {
    const output = compileCatalog({
      buildId: "custom-date-time-build",
      catalogPackage: "@mirai/intl-custom-date-time-fixture",
      formatterVersions: { clock: "1.0.0" },
      id: "custom-date-time-fixture",
      locales: ["en", "th"],
      messages: [
        {
          formatterIds: ["clock"],
          kind: "text",
          path: "schedule.when",
          provenance: "packages/runtime/test/runtime.test.ts:schedule.when",
          resultSchema: { type: "string" },
          translations: {
            en: "{value, date, custom:clock:date}|{value, time, custom:clock:time}",
            th: "{value, date, custom:clock:date}|{value, time, custom:clock:time}",
          },
          valuesSchema: {
            additionalProperties: false,
            properties: { value: { type: "date-time" } },
            required: ["value"],
            type: "object",
          },
        },
      ],
      rendererCapabilityId: "precompiled-v1",
      sourceLocale: "en",
    });
    const generated = await loadGeneratedModule("precompiled", output);
    const descriptor = generatedDescriptorAt(
      Reflect.get(generated, "catalogTree"),
      "schedule.when"
    ) as TextDescriptor<{ value: string }>;
    const runtime = createIntlRuntime({
      backend: createPrecompiledBackend(),
      catalog: { manifest: output.catalog.manifest, messages: [] },
      formatters: {
        clock: {
          format(value, locale, options): string {
            if (typeof value !== "string") {
              throw new TypeError("Clock value must be a date-time string");
            }
            return `${locale}/${options ?? "default"}/${value}`;
          },
          version: "1.0.0",
        },
      },
      locale: "en",
    });
    const value = "2026-07-14T12:34:56.000Z";

    expect(runtime.t(descriptor, { value })).toBe(
      `en/date/${value}|en/time/${value}`
    );
  });

  it("uses only own emitted select branches and preserves __proto__ selectors", async () => {
    const message = "{mode, select, __proto__ {special} other {fallback}}";
    const output = compileCatalog({
      buildId: "select-ownership-build",
      catalogPackage: "@mirai/intl-select-ownership-fixture",
      formatterVersions: {},
      id: "select-ownership-fixture",
      locales: ["en", "th"],
      messages: [
        {
          kind: "text",
          path: "security.select",
          provenance: "packages/runtime/test/runtime.test.ts:security.select",
          resultSchema: { type: "string" },
          translations: { en: message, th: message },
          valuesSchema: {
            additionalProperties: false,
            properties: { mode: { type: "string" } },
            required: ["mode"],
            type: "object",
          },
        },
      ],
      rendererCapabilityId: "precompiled-v1",
      sourceLocale: "en",
    });
    const generated = await loadGeneratedModule("precompiled", output);
    const descriptor = generatedDescriptorAt(
      Reflect.get(generated, "catalogTree"),
      "security.select"
    ) as TextDescriptor<{ mode: string }>;
    const runtime = createIntlRuntime({
      backend: createPrecompiledBackend(),
      catalog: { manifest: output.catalog.manifest, messages: [] },
      locale: "en",
    });

    expect(runtime.t(descriptor, { mode: "__proto__" })).toBe("special");
    expect(runtime.t(descriptor, { mode: "constructor" })).toBe("fallback");
    expect(runtime.t(descriptor, { mode: "polluted" })).toBe("fallback");
  });

  it("binds i18next languageChanged events to runtime subscriptions", async () => {
    const runtime = runtimeFor(backendMatrix[0]);
    const observed: Array<string> = [];
    const unsubscribe = runtime.subscribe(() => {
      observed.push(runtime.locale);
    });
    const unbind = runtime.bindLanguageChanged(bridgeI18n);

    try {
      await bridgeI18n.changeLanguage("th");
      expect(runtime.locale).toBe("th");
      expect(observed).toEqual(["th"]);

      unsubscribe();
      await bridgeI18n.changeLanguage("en");
      expect(runtime.locale).toBe("en");
      expect(observed).toEqual(["th"]);

      unbind();
      await bridgeI18n.changeLanguage("th");
      expect(runtime.locale).toBe("en");
    } finally {
      unbind();
      unsubscribe();
      await bridgeI18n.changeLanguage("en");
    }
  });

  it("renders the server snapshot and rerenders React on i18next languageChanged", async () => {
    const runtime = runtimeFor(backendMatrix[0]);
    const useIntl = createUseIntl(() => runtime);
    const LocaleProbe = (): ReturnType<typeof createElement> => {
      const intl = useIntl();
      return createElement("span", null, intl.locale);
    };
    const unbind = runtime.bindLanguageChanged(bridgeI18n);
    let renderer: ReactTestRenderer | undefined;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });

    try {
      expect(renderToString(createElement(LocaleProbe))).toBe(
        "<span>en</span>"
      );
      await act(() => {
        renderer = create(createElement(LocaleProbe));
      });
      expect(renderer?.toJSON()).toEqual({
        children: ["en"],
        props: {},
        type: "span",
      });

      await act(async () => {
        await bridgeI18n.changeLanguage("th");
      });
      expect(renderer?.toJSON()).toEqual({
        children: ["th"],
        props: {},
        type: "span",
      });
    } finally {
      unbind();
      await act(async () => {
        renderer?.unmount();
        await bridgeI18n.changeLanguage("en");
      });
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });
});
