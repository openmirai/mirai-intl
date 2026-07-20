import {
  FORMAT_VERSION,
  RUNTIME_ABI,
  IntlRuntimeError,
  defineMessageDescriptor,
  dynamicValidationLimits,
  messageBrand,
  validatedDynamicCallBrand,
} from "@openmirai/intl-abi";
import type {
  IrNode,
  IntlDiagnostic,
  JsonObject,
  JsonValue,
  MessageDescriptor,
  RuntimeCatalog,
  TextDescriptor,
  ValidatedDynamicCall,
} from "@openmirai/intl-abi";
import { compileCatalog } from "@openmirai/intl-compiler/internal";
import type {
  CatalogSource,
  MessageSource,
} from "@openmirai/intl-compiler/internal";
import {
  createIntlRuntime,
  createPrecompiledBackend,
  renderPrecompiledNodes,
  renderPrecompiledNumber,
  renderPrecompiledSelect,
  validateDynamicCall,
} from "@openmirai/intl-runtime";
import { describe, expect, it, vi } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";
import { renderRich } from "../src/rich";

const textEncoder = new TextEncoder();
const securityCompilation = compileCatalog(catalogFixtureSource);
const securityFormatters = {
  money: {
    format(value: JsonValue): string {
      return String(value);
    },
    version: "1.0.0",
  },
} as const;

function securityRuntime(
  catalog: RuntimeCatalog = securityCompilation.catalog,
  diagnosticSink?: (diagnostic: IntlDiagnostic) => void
) {
  return createIntlRuntime({
    backend: createPrecompiledBackend(),
    catalog,
    ...(diagnosticSink ? { diagnosticSink } : {}),
    formatters: securityFormatters,
    locale: "en",
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

function expectBoundedSanitizedDiagnostic(
  diagnostic: IntlDiagnostic,
  injected: string
): void {
  const serialized = JSON.stringify(diagnostic);
  const escapedInjection = JSON.stringify(injected).slice(1, -1);
  expect(serialized).not.toContain(injected);
  expect(serialized).not.toContain(escapedInjection);
  for (const value of Object.values(diagnostic)) {
    if (typeof value !== "string") {
      continue;
    }
    expect(value.length).toBeLessThanOrEqual(96);
    expect(
      [...value].every((character) => {
        const codePoint = character.codePointAt(0);
        return (
          codePoint !== undefined && codePoint >= 0x20 && codePoint <= 0x7e
        );
      })
    ).toBe(true);
  }
}

function textDescriptor(): MessageDescriptor {
  const descriptor = securityCompilation.descriptors.find(
    (candidate) => candidate.path === "greeting.morning"
  );
  if (!descriptor || descriptor.kind !== "text") {
    throw new Error("Missing security text descriptor fixture");
  }
  return descriptor;
}

function validatedDynamicCall(path: string, values: JsonObject) {
  const runtime = securityRuntime();
  const result = runtime.validateDynamic(
    dynamicWire(securityCompilation.catalog, path, values)
  );
  if (!result.ok) {
    throw new IntlRuntimeError(result.error);
  }
  return result.value;
}

function messageAt(catalog: RuntimeCatalog, path: string) {
  const message = catalog.messages.find((candidate) => candidate.path === path);
  if (!message) {
    throw new Error(`Missing runtime message ${path}`);
  }
  return message;
}

function dynamicWire(
  catalog: RuntimeCatalog,
  path: string,
  values: unknown,
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  const message = messageAt(catalog, path);
  return {
    catalogId: catalog.manifest.catalogId,
    formatVersion: FORMAT_VERSION,
    hash: catalog.manifest.hash,
    kind: message.kind,
    locale: "en",
    messageId: message.id,
    runtimeAbi: RUNTIME_ABI,
    values,
    ...overrides,
  };
}

function resourceBytes(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Resource measurement fixture is not JSON data");
  }
  return textEncoder.encode(serialized).byteLength;
}

function splitBudget(total: number): ReadonlyArray<string> {
  const values: Array<string> = [];
  let remaining = total;
  for (let index = 0; index < 4; index += 1) {
    const bytes = Math.min(dynamicValidationLimits.maxStringBytes, remaining);
    values.push(String(index).repeat(bytes));
    remaining -= bytes;
  }
  if (remaining !== 0) {
    throw new Error("Dynamic boundary fixture exceeds four string fields");
  }
  return values;
}

function compileStringCatalog(properties: ReadonlyArray<string>) {
  const valuesSchema = {
    additionalProperties: false,
    properties: Object.fromEntries(
      properties.map((property) => [property, { type: "string" } as const])
    ),
    required: properties,
    type: "object",
  } as const;
  const message = {
    kind: "text",
    path: "security.payload",
    provenance: "runtime/security.test.ts:security.payload",
    resultSchema: { type: "string" },
    translations: {
      en: properties.map((property) => `{${property}}`).join(""),
      th: properties.map((property) => `{${property}}`).join(""),
    },
    valuesSchema,
  } as const satisfies MessageSource;
  const source = {
    ...catalogFixtureSource,
    formatterVersions: {},
    fragments: [],
    messages: [message],
    replacements: [],
  } satisfies CatalogSource;
  return compileCatalog(source).catalog;
}

describe("runtime formatter dispatch security", () => {
  it("does not invoke a registered formatter through a bare ICU style", () => {
    let calls = 0;
    const state = {
      escapeValues: false,
      formatters: {
        money: {
          format(): string {
            calls += 1;
            return "UNDECLARED_FORMATTER_EXECUTED";
          },
          version: "1.0.0",
        },
      },
      locale: "en",
      values: { amount: 1_200 } satisfies JsonObject,
    };

    expect(() =>
      renderPrecompiledNumber(state, "amount", "money")
    ).toThrowError(/Unsupported number style money/u);
    expect(calls).toBe(0);
  });
});

describe("select branch dispatch security", () => {
  it.each(["constructor", "polluted"])(
    "falls back instead of selecting inherited %s branches",
    (value) => {
      const inheritedBranch = vi.fn(() => "inherited");
      const branches = Object.create({ [value]: inheritedBranch }) as Record<
        string,
        (state: unknown) => string
      >;
      Object.defineProperty(branches, "other", {
        enumerable: true,
        value: () => "fallback",
      });
      const state = {
        escapeValues: false,
        formatters: {},
        locale: "en",
        values: { mode: value } satisfies JsonObject,
      };

      expect(renderPrecompiledSelect(state, "mode", branches)).toBe("fallback");
      expect(inheritedBranch).not.toHaveBeenCalled();

      const inheritedOptions = Object.create({
        [value]: [{ type: "literal", value: "inherited" }],
      }) as Record<string, ReadonlyArray<IrNode>>;
      Object.defineProperty(inheritedOptions, "other", {
        enumerable: true,
        value: [{ type: "literal", value: "fallback" }],
      });
      const nodes = [
        { name: "mode", options: inheritedOptions, type: "select" },
      ] as const satisfies ReadonlyArray<IrNode>;

      expect(renderPrecompiledNodes(nodes, state)).toBe("fallback");
      expect(
        renderRich(nodes, {
          components: {},
          escapeValues: false,
          formatters: {},
          locale: "en",
          values: { mode: value },
        })
      ).toEqual(["fallback"]);
    }
  );
});

describe("dynamic wire security boundaries", () => {
  it("rejects a fixed-envelope limit before locale splitting or message lookup", () => {
    const compiled = compileCatalog(catalogFixtureSource).catalog;
    let messageLookups = 0;
    const guardedCatalog = {
      manifest: compiled.manifest,
      get messages(): RuntimeCatalog["messages"] {
        messageLookups += 1;
        throw new Error("semantic lookup must not run");
      },
    } satisfies RuntimeCatalog;
    const split = vi.spyOn(String.prototype, "split");

    const result = validateDynamicCall(
      guardedCatalog,
      dynamicWire(
        compiled,
        "greeting.morning",
        { name: "Mali" },
        {
          locale: `en-${"x".repeat(62)}`,
        }
      )
    );

    expect(result).toMatchObject({
      error: { code: "INTL_DYNAMIC_LIMIT_EXCEEDED" },
      ok: false,
    });
    expect(messageLookups).toBe(0);
    expect(split).not.toHaveBeenCalled();
    split.mockRestore();
  });

  it("reports resource exhaustion before an unavailable message", () => {
    const catalog = compileCatalog(catalogFixtureSource).catalog;
    const result = validateDynamicCall(
      catalog,
      dynamicWire(
        catalog,
        "greeting.morning",
        { name: "x".repeat(16 * 1024 + 1) },
        { messageId: "missing-message" }
      )
    );

    expect(result).toMatchObject({
      error: { code: "INTL_DYNAMIC_LIMIT_EXCEEDED" },
      ok: false,
    });
  });

  it("enforces the exact 16 KiB string boundary", () => {
    const catalog = compileStringCatalog(["payload"]);
    const exact = validateDynamicCall(
      catalog,
      dynamicWire(catalog, "security.payload", {
        payload: "x".repeat(dynamicValidationLimits.maxStringBytes),
      })
    );
    const overflow = validateDynamicCall(
      catalog,
      dynamicWire(catalog, "security.payload", {
        payload: "x".repeat(dynamicValidationLimits.maxStringBytes + 1),
      })
    );

    expect(exact.ok).toBe(true);
    expect(overflow).toMatchObject({
      error: { code: "INTL_DYNAMIC_LIMIT_EXCEEDED" },
      ok: false,
    });
  });

  it("enforces the exact 64 KiB aggregate boundary including keys", () => {
    const properties = ["a", "b", "c", "d"] as const;
    const catalog = compileStringCatalog(properties);
    const emptyValues = { a: "", b: "", c: "", d: "" };
    const emptyWire = dynamicWire(catalog, "security.payload", emptyValues);
    const budget =
      dynamicValidationLimits.maxTotalBytes - resourceBytes(emptyWire);
    const [a = "", b = "", c = "", d = ""] = splitBudget(budget);
    const exactValues = { a, b, c, d };
    const exactWire = dynamicWire(catalog, "security.payload", exactValues);
    const overflowWire = dynamicWire(catalog, "security.payload", {
      ...exactValues,
      d: `${d}x`,
    });

    expect(resourceBytes(exactWire)).toBe(
      dynamicValidationLimits.maxTotalBytes
    );
    expect(validateDynamicCall(catalog, exactWire).ok).toBe(true);
    expect(validateDynamicCall(catalog, overflowWire)).toMatchObject({
      error: { code: "INTL_DYNAMIC_LIMIT_EXCEEDED" },
      ok: false,
    });
  });
});

describe("runtime diagnostic boundary", () => {
  it("rejects forged, mutable, and mismatched descriptor brand payloads", () => {
    const base = textDescriptor();
    const matchingPayload = {
      catalogId: base.catalogId,
      kind: base.kind,
      path: base.path,
      runtimeAbi: base.runtimeAbi,
    };
    const payloads = [
      ["string", "brand\nPAYLOAD_SECRET"],
      ["mutable", matchingPayload],
      [
        "mismatched",
        Object.freeze({
          ...matchingPayload,
          path: "other\u202ePAYLOAD_SECRET",
        }),
      ],
      [
        "extra-field",
        Object.freeze({ ...matchingPayload, debug: "PAYLOAD_SECRET" }),
      ],
    ] as const;

    for (const [, payload] of payloads) {
      const candidate = { ...base };
      Object.defineProperty(candidate, messageBrand, { value: payload });
      const error = captureRuntimeError(() =>
        securityRuntime().t(
          candidate as TextDescriptor<Record<string, unknown>>,
          { name: "Mali" } as never
        )
      );

      expect(error.diagnostic.code).toBe("INTL_DESCRIPTOR_INVALID");
      expect(JSON.stringify(error)).not.toContain("PAYLOAD_SECRET");
    }
  });

  it("redacts hostile descriptor identifiers before the sink and error boundary", () => {
    const base = textDescriptor();
    const hostileFields = [
      ["buildToken", "build\nTOKEN_SECRET"],
      ["capabilitySetHash", "sha256:safe\u202eCAPABILITY_SECRET"],
      ["catalogHash", "sha256:safe\u001bHASH_SECRET"],
      ["catalogId", `catalog-${"x".repeat(256)}`],
      ["messageId", "message\nID_SECRET"],
      ["path", "path\u202ePATH_SECRET"],
      ["runtimeAbi", "1.0.0\u001bABI_SECRET"],
      ["kind", `text-${"x".repeat(256)}`],
    ] as const satisfies ReadonlyArray<
      readonly [keyof MessageDescriptor, string]
    >;

    for (const [field, injected] of hostileFields) {
      const diagnostics: Array<IntlDiagnostic> = [];
      const runtime = securityRuntime(undefined, (diagnostic) => {
        diagnostics.push(diagnostic);
      });
      const forged = defineMessageDescriptor({
        ...base,
        [field]: injected,
      } as never);
      const error = captureRuntimeError(() =>
        runtime.t(
          forged as TextDescriptor<Record<string, unknown>>,
          { name: "Mali" } as never
        )
      );
      const [sinkDiagnostic] = diagnostics;
      if (!sinkDiagnostic) {
        throw new Error(`Missing sink diagnostic for ${String(field)}`);
      }

      expect(diagnostics).toHaveLength(1);
      expectBoundedSanitizedDiagnostic(sinkDiagnostic, injected);
      expectBoundedSanitizedDiagnostic(error.diagnostic, injected);
      expect(JSON.stringify(error)).not.toContain(injected);
      expect(JSON.stringify(error)).not.toContain(
        JSON.stringify(injected).slice(1, -1)
      );
    }
  });

  it("preserves a safe descriptor identifier that remains useful for matching", () => {
    const base = textDescriptor();
    const forged = defineMessageDescriptor({
      ...base,
      catalogId: "another-safe-catalog",
    } as never);
    const error = captureRuntimeError(() =>
      securityRuntime().t(
        forged as TextDescriptor<Record<string, unknown>>,
        { name: "Mali" } as never
      )
    );

    expect(error.diagnostic.catalogId).toBe("another-safe-catalog");
  });

  it("does not accept a forged diagnostic code from a throwing sink", () => {
    const injected = "INTL_FORGED\nSINK_SECRET";
    const runtime = securityRuntime(undefined, () => {
      throw {
        diagnostic: { code: injected },
        name: "IntlRuntimeError",
      };
    });
    const error = captureRuntimeError(() => runtime.setLocale("zz"));

    expect(error.diagnostic.secondaryCode).toBe("INTL_DIAGNOSTIC_SINK_FAILURE");
    expect(JSON.stringify(error)).not.toContain("SINK_SECRET");
  });

  it("redacts hostile dynamic-call identifiers, including renderer locales", () => {
    const greeting = validatedDynamicCall("greeting.morning", {
      name: "Mali",
    });
    const number = validatedDynamicCall("formatting.number", { value: 42 });
    const hostileCalls = [
      [greeting, "catalogId", "catalog\nDYNAMIC_SECRET"],
      [greeting, "hash", "sha256:safe\u202eDYNAMIC_SECRET"],
      [greeting, "messageId", "message\u001bDYNAMIC_SECRET"],
      [greeting, "runtimeAbi", `1.0.0-${"x".repeat(256)}`],
      [number, "locale", "en\nLOCALE_SECRET"],
    ] as const;

    for (const [base, field, injected] of hostileCalls) {
      const diagnostics: Array<IntlDiagnostic> = [];
      const runtime = securityRuntime(undefined, (diagnostic) => {
        diagnostics.push(diagnostic);
      });
      const forged = { ...base, [field]: injected };
      Object.defineProperty(forged, validatedDynamicCallBrand, { value: true });
      const error = captureRuntimeError(() =>
        runtime.renderDynamic(forged as ValidatedDynamicCall)
      );
      const [sinkDiagnostic] = diagnostics;
      if (!sinkDiagnostic) {
        throw new Error(`Missing dynamic sink diagnostic for ${field}`);
      }

      expect(diagnostics).toHaveLength(1);
      expectBoundedSanitizedDiagnostic(sinkDiagnostic, injected);
      expectBoundedSanitizedDiagnostic(error.diagnostic, injected);
    }
  });

  it.each([
    "en\nLOCALE_SECRET",
    "en\u202eLOCALE_SECRET",
    "en\u001bLOCALE_SECRET",
    `zz-${"x".repeat(256)}`,
  ])("redacts an invalid locale before reporting it: %j", (injected) => {
    const diagnostics: Array<IntlDiagnostic> = [];
    const runtime = securityRuntime(undefined, (diagnostic) => {
      diagnostics.push(diagnostic);
    });
    const error = captureRuntimeError(() => runtime.setLocale(injected));
    const [sinkDiagnostic] = diagnostics;
    if (!sinkDiagnostic) {
      throw new Error("Missing invalid-locale sink diagnostic");
    }

    expect(error.diagnostic.code).toBe("INTL_LOCALE_INVALID");
    expectBoundedSanitizedDiagnostic(sinkDiagnostic, injected);
    expectBoundedSanitizedDiagnostic(error.diagnostic, injected);
  });

  it("rejects catalog format version 2 before runtime registration", () => {
    const incompatibleCatalog: RuntimeCatalog = {
      ...securityCompilation.catalog,
      manifest: {
        ...securityCompilation.catalog.manifest,
        formatVersion: 2 as never,
      },
    };
    const diagnostics: Array<IntlDiagnostic> = [];
    const error = captureRuntimeError(() =>
      securityRuntime(incompatibleCatalog, (diagnostic) => {
        diagnostics.push(diagnostic);
      })
    );

    expect(error.diagnostic).toMatchObject({
      actual: { type: "number" },
      code: "INTL_ABI_MISMATCH",
      expected: "1",
      message: "Catalog format version is unsupported",
    });
    expect(diagnostics).toEqual([error.diagnostic]);
  });
});

describe("stale runtime identities", () => {
  it("rejects a descriptor after only its argument schema changes", () => {
    const baseline = compileCatalog(catalogFixtureSource);
    const changedSource = {
      ...catalogFixtureSource,
      messages: catalogFixtureSource.messages.map((message) =>
        message.path === "greeting.morning"
          ? {
              ...message,
              valuesSchema: {
                ...message.valuesSchema,
                properties: {
                  ...message.valuesSchema.properties,
                  name: { maxLength: 128, type: "string" as const },
                },
              },
            }
          : message
      ),
    } satisfies CatalogSource;
    const changed = compileCatalog(changedSource);
    const descriptor = baseline.descriptors.find(
      (candidate) => candidate.path === "greeting.morning"
    );
    if (!descriptor || descriptor.kind !== "text") {
      throw new Error("Missing baseline text descriptor");
    }
    const runtime = createIntlRuntime({
      backend: createPrecompiledBackend(),
      catalog: changed.catalog,
      formatters: {
        money: {
          format(value: JsonValue): string {
            return String(value);
          },
          version: "1.0.0",
        },
      },
      locale: "en",
    });

    let error: unknown;
    try {
      runtime.t(
        descriptor as TextDescriptor<Record<string, unknown>>,
        { name: "Mali" } as never
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(IntlRuntimeError);
    expect((error as IntlRuntimeError).diagnostic.code).toBe(
      "INTL_STALE_DESCRIPTOR"
    );
  });
});
