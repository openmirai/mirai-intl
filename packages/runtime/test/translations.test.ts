import type {
  JsonValue,
  MessageDescriptor,
  RichDescriptor,
  TextDescriptor,
  ValueDescriptor,
} from "@openmirai/intl-abi";
import { IntlRuntimeError, emptyObjectSchema } from "@openmirai/intl-abi";
import { compileCatalog } from "@openmirai/intl-compiler/internal";
import {
  createIntlRuntime,
  createPrecompiledBackend,
  createTFunctionBridgeBackend,
} from "@openmirai/intl-runtime";
import { createInstance } from "i18next";
import ICU from "i18next-icu";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";

import { createUseIntl, createUseTranslations } from "../src/react";
import { createServerIntl, createTranslationFunction } from "../src/server";
import type { StrictIntlRuntime } from "../src/runtime";
import type {
  FormErrorMessage,
  TranslationFunction,
} from "../src/translations";
import {
  createCompilerFormErrorTranslator,
  createCompilerFormSchema,
  createCompilerDynamicTextRegistry,
  bindFormSchema,
  parseCompilerTranslationKey,
  translateCompilerDynamicText,
} from "../src/translations";
import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const compiled = compileCatalog(catalogFixtureSource);
const staticRichCompiled = compileCatalog({
  buildId: "static-rich-fixture-build",
  catalogPackage: "@openmirai/intl-static-rich-fixture",
  formatterVersions: {},
  id: "static-rich-fixture",
  locales: ["en", "th"],
  messages: [
    {
      kind: "rich",
      path: "rich.static",
      provenance: "packages/runtime/test/translations.test.ts:rich.static",
      resultSchema: { type: "string" },
      tags: ["strong"],
      translations: {
        en: "Read <strong>terms</strong>",
        th: "อ่าน<strong>ข้อกำหนด</strong>",
      },
      valuesSchema: emptyObjectSchema,
    },
    {
      kind: "text",
      path: "text.static",
      provenance: "packages/runtime/test/translations.test.ts:text.static",
      resultSchema: { type: "string" },
      translations: {
        en: "Static text",
        th: "ข้อความคงที่",
      },
      valuesSchema: emptyObjectSchema,
    },
  ],
  rendererCapabilityId: "portable-ir-v1",
  sourceLocale: "en",
});
const formatters = Object.freeze({
  money: Object.freeze({
    format(value: JsonValue, locale: string, options?: string): string {
      if (typeof value !== "number") {
        throw new TypeError("Money fixture values must be numeric");
      }
      return `${locale}/${options ?? "default"}/${value}`;
    },
    version: "1.0.0",
  }),
});

function runtimeFor(locale: string): StrictIntlRuntime {
  return createIntlRuntime({
    backend: createPrecompiledBackend(),
    catalog: compiled.catalog,
    formatters,
    locale,
  });
}

function staticRichRuntime(): StrictIntlRuntime {
  return createIntlRuntime({
    backend: createPrecompiledBackend(),
    catalog: staticRichCompiled.catalog,
    locale: "en",
  });
}

interface BridgeResources {
  [locale: string]: {
    translation: Record<string, string>;
  };
}

async function createBridgeFixture(
  resources: BridgeResources,
  fallbackLng: false | string = false,
  locale = "en"
) {
  const i18n = createInstance();
  await i18n
    .use(
      new ICU({
        escapeVariables: false,
        parseErrorHandler(error) {
          throw error;
        },
      })
    )
    .init({
      defaultNS: "translation",
      fallbackLng,
      initAsync: false,
      keySeparator: false,
      lng: locale,
      resources,
      supportedLngs: ["en", "th"],
    });
  const backend = createTFunctionBridgeBackend(
    (key, options = {}) => i18n.t(key, { ...options }),
    {
      resourceExists: (key, requestedLocale) =>
        i18n.exists(key, { lng: requestedLocale }),
      resolveResourceLocale(key, requestedLocale) {
        const candidates = [
          requestedLocale,
          ...(typeof fallbackLng === "string" ? [fallbackLng] : []),
        ];
        return candidates.find(
          (candidate) =>
            i18n.getResource(candidate, "translation", key) !== undefined
        );
      },
    }
  );
  return {
    i18n,
    runtime: createIntlRuntime({
      backend,
      catalog: compiled.catalog,
      formatters,
      locale,
    }),
  };
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

function textDescriptorAt(path: string): TextDescriptor {
  const descriptor = descriptorAt(path);
  if (descriptor.kind !== "text") {
    throw new TypeError(`${path} is not a text descriptor`);
  }
  return descriptor as TextDescriptor;
}

function richDescriptorAt(path: string): RichDescriptor {
  const descriptor = descriptorAt(path);
  if (descriptor.kind !== "rich") {
    throw new TypeError(`${path} is not a rich descriptor`);
  }
  return descriptor as RichDescriptor;
}

function valueDescriptorAt(path: string): ValueDescriptor {
  const descriptor = descriptorAt(path);
  if (descriptor.kind !== "value") {
    throw new TypeError(`${path} is not a value descriptor`);
  }
  return descriptor as ValueDescriptor;
}

function staticRichDescriptor(): RichDescriptor {
  const descriptor = staticRichCompiled.descriptors.find(
    (candidate) => candidate.path === "rich.static"
  );
  if (!descriptor || descriptor.kind !== "rich") {
    throw new TypeError("Missing static rich fixture descriptor");
  }
  return descriptor as RichDescriptor;
}

function staticTextDescriptor(): TextDescriptor {
  const descriptor = staticRichCompiled.descriptors.find(
    (candidate) => candidate.path === "text.static"
  );
  if (!descriptor || descriptor.kind !== "text") {
    throw new TypeError("Missing static text fixture descriptor");
  }
  return descriptor as TextDescriptor;
}

function callLoweredText(
  translate: TranslationFunction<object>,
  descriptor: TextDescriptor,
  values?: unknown
): unknown {
  return Reflect.apply(translate, undefined, [descriptor, values]);
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

describe("conventional translation bindings", () => {
  it("renders relative and qualified compiler-lowered named keys and throws for misses", () => {
    const translate = createTranslationFunction(staticRichRuntime());
    const registry = createCompilerDynamicTextRegistry({
      ["schema.staticText"]: staticTextDescriptor(),
    });

    expect(
      translateCompilerDynamicText(translate, "staticText", "schema", registry)
    ).toBe("Static text");
    expect(
      translateCompilerDynamicText(
        translate,
        "schema.staticText",
        "schema",
        registry
      )
    ).toBe("Static text");
    expect(() =>
      translateCompilerDynamicText(translate, "missing", "schema", registry)
    ).toThrow("Named translation key is not registered for this namespace");
    expect(() =>
      translateCompilerDynamicText(
        translate,
        "other.staticText",
        "schema",
        registry
      )
    ).toThrow("Named translation key is not registered for this namespace");
  });

  it("parses relative and qualified boundary strings through the compiler registry", () => {
    const registry = createCompilerDynamicTextRegistry({
      ["schema.staticText"]: staticTextDescriptor(),
    });

    expect(parseCompilerTranslationKey("staticText", "schema", registry)).toBe(
      "schema.staticText"
    );
    expect(
      parseCompilerTranslationKey("schema.staticText", "schema", registry)
    ).toBe("schema.staticText");
    expect(
      parseCompilerTranslationKey("missing", "schema", registry)
    ).toBeUndefined();
    expect(
      parseCompilerTranslationKey("other.staticText", "schema", registry)
    ).toBeUndefined();
    expect(
      parseCompilerTranslationKey(null, "schema", registry)
    ).toBeUndefined();
    expect(() =>
      parseCompilerTranslationKey("staticText", "schema", {
        ["schema.staticText"]: staticTextDescriptor(),
      })
    ).toThrow("was not created by compiler lowering");
  });

  it("translates only known error.form keys through the compiler registry", () => {
    const translate = createTranslationFunction(staticRichRuntime());
    const translator = createCompilerFormErrorTranslator(
      translate,
      "pages.home",
      createCompilerDynamicTextRegistry({
        ["pages.home.error.form.required"]: staticTextDescriptor(),
      })
    );

    expect(translator.has("error.form.required")).toBe(true);
    expect(translator.has("pages.home.error.form.required")).toBe(true);
    expect(translator.has("error.form.unknown")).toBe(false);
    expect(translator.has("pages.home.title")).toBe(false);
    expect(translator("error.form.required")).toBe("Static text");
    expect(translator("server validation failed")).toBeUndefined();
  });

  it("builds schemas with closed relative form-error keys", () => {
    const registry = createCompilerDynamicTextRegistry({
      ["pages.home.error.form.required"]: staticTextDescriptor(),
    });
    const schema = createCompilerFormSchema(
      "pages.home",
      registry,
      ({ error }: { error: (key: string) => string }) => ({
        required: error("required"),
      })
    );

    expect(schema).toEqual({ required: "error.form.required" });
    expect(() =>
      createCompilerFormSchema(
        "pages.home",
        registry,
        ({ error }: { error: (key: string) => string }) => error("missing")
      )
    ).toThrow("not registered for this namespace");
    expect(() =>
      createCompilerFormSchema(
        "pages.home",
        registry,
        ({ error }: { error: (key: string) => string }) =>
          error("pages.home.error.form.required")
      )
    ).toThrow("not registered for this namespace");
    expect(() =>
      createCompilerFormSchema("pages.home", {}, () => undefined)
    ).toThrow("was not created by compiler lowering");
    expect(() =>
      createCompilerFormSchema("pages.home", registry, undefined)
    ).toThrow("builder must be a function");
  });

  it("keeps form-schema helpers as identity wrappers and the main factory unlowered", () => {
    const createFormSchema = bindFormSchema<object>();
    const helper = (value: FormErrorMessage) => ({ value });

    expect(createFormSchema.helper(helper)).toBe(helper);
    expect(() => createFormSchema("pages.home" as never, () => ({}))).toThrow(
      "was not lowered by the Mirai Intl compiler"
    );
  });

  it("rejects malformed dynamic registries without invoking accessors or inherited properties", () => {
    const translate = createTranslationFunction(staticRichRuntime());
    const registry = createCompilerDynamicTextRegistry({
      ["schema.staticText"]: staticTextDescriptor(),
    });
    let accessorCalls = 0;
    const accessorRegistry = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessorRegistry, "schema.staticText", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return staticTextDescriptor();
      },
    });

    expect(() => createCompilerDynamicTextRegistry(accessorRegistry)).toThrow(
      "Dynamic translation registry cannot use accessors"
    );
    expect(accessorCalls).toBe(0);
    expect(() =>
      translateCompilerDynamicText(translate, "schema.staticText", "schema", {
        ["schema.staticText"]: staticTextDescriptor(),
      })
    ).toThrow("was not created by compiler lowering");

    const inherited = Object.create({
      ["schema.staticText"]: staticTextDescriptor(),
    }) as Record<string, unknown>;
    expect(() => createCompilerDynamicTextRegistry(inherited)).toThrow(
      "Dynamic translation registry is malformed"
    );
    expect(() =>
      translateCompilerDynamicText(translate, 1, "schema", registry)
    ).toThrow("Dynamic translation key must be a string");
    expect(() =>
      translateCompilerDynamicText(
        translate,
        "schema.staticText",
        undefined,
        registry
      )
    ).toThrow("Dynamic translation namespace must be a string");
  });

  it("fails closed when a finite translation map was not compiler-lowered", () => {
    const t = createTranslationFunction(runtimeFor("en")) as unknown as {
      map: (...selectors: ReadonlyArray<unknown>) => unknown;
    };
    expect(() => t.map(["greeting.morning"] as const)).toThrow(
      "Translation map was not lowered by the Mirai Intl compiler"
    );
  });

  it("dispatches lowered descriptors for text, rich, and structured values", () => {
    const translate = createTranslationFunction(runtimeFor("en"));

    expect(
      callLoweredText(translate, textDescriptorAt("greeting.morning"), {
        name: "Mali",
      })
    ).toBe("Good morning, Mali");
    expect(
      Reflect.apply(translate.rich, undefined, [
        richDescriptorAt("rich.deactivate"),
        {
          components: {
            medium: (children: ReadonlyArray<unknown>) =>
              `<strong>${children.join("")}</strong>`,
          },
          values: { name: "Mali" },
        },
      ])
    ).toEqual(["Deactivate ", "<strong>Mali</strong>", "?"]);
    expect(
      Reflect.apply(translate.value, undefined, [
        valueDescriptorAt("certificate.verification"),
      ])
    ).toEqual({
      fields: [{ label: "Learner", value: "Verified" }],
      title: "Certificate verification",
    });
  });

  it.each([
    ["missing", {}],
    ["extra", { extra: true, name: "Mali" }],
    ["non-scalar", { name: { unsafe: true } }],
    ["inherited", Object.assign(Object.create({ name: "Mali" }), {})],
    [
      "accessor",
      Object.defineProperty({}, "name", {
        enumerable: true,
        get: () => "Mali",
      }),
    ],
  ])("preserves exact runtime rejection for %s values", (_case, values) => {
    const translate = createTranslationFunction(runtimeFor("en"));

    expect(
      captureRuntimeError(() =>
        callLoweredText(translate, textDescriptorAt("greeting.morning"), values)
      ).diagnostic.code
    ).toBe("INTL_VALUES_INVALID");
  });

  it("fails clearly when a named key reaches runtime without lowering", () => {
    const translate = createTranslationFunction(runtimeFor("en"));

    expect(() =>
      Reflect.apply(translate, undefined, [
        "greeting.morning",
        { name: "Mali" },
      ])
    ).toThrowError(
      new TypeError(
        "Named translation key was not lowered to a generated descriptor"
      )
    );
  });

  it("requires an exact top-level input for parameterized rich messages", () => {
    const translate = createTranslationFunction(runtimeFor("en"));
    const descriptor = richDescriptorAt("rich.deactivate");
    const component = (children: ReadonlyArray<unknown>): unknown => children;

    expect(
      captureRuntimeError(() =>
        Reflect.apply(translate.rich, undefined, [
          descriptor,
          {
            components: { medium: component },
            extra: true,
            values: { name: "Mali" },
          },
        ])
      ).diagnostic.code
    ).toBe("INTL_RICH_COMPONENT_INVALID");
  });

  it.each([
    ["an empty object", {}],
    ["null", null],
    ["undefined", undefined],
  ])(
    "distinguishes omitted values from explicit %s for zero-argument rich messages",
    (_case, values) => {
      const translate = createTranslationFunction(staticRichRuntime());
      const descriptor = staticRichDescriptor();
      const components = {
        strong: (children: ReadonlyArray<unknown>): unknown =>
          `<strong>${children.join("")}</strong>`,
      };

      expect(
        Reflect.apply(translate.rich, undefined, [descriptor, { components }])
      ).toEqual(["Read ", "<strong>terms</strong>"]);
      expect(
        captureRuntimeError(() =>
          Reflect.apply(translate.rich, undefined, [
            descriptor,
            { components, values },
          ])
        ).diagnostic.code
      ).toBe("INTL_RICH_COMPONENT_INVALID");
    }
  );

  it("distinguishes omitted values from explicit arguments for zero-argument text and value messages", () => {
    const staticTranslate = createTranslationFunction(staticRichRuntime());
    const staticText = staticTextDescriptor();
    const translate = createTranslationFunction(runtimeFor("en"));
    const structured = valueDescriptorAt("certificate.verification");

    expect(Reflect.apply(staticTranslate, undefined, [staticText])).toBe(
      "Static text"
    );
    expect(Reflect.apply(translate.value, undefined, [structured])).toEqual({
      fields: [{ label: "Learner", value: "Verified" }],
      title: "Certificate verification",
    });

    for (const values of [{}, null, undefined]) {
      expect(
        captureRuntimeError(() =>
          Reflect.apply(staticTranslate, undefined, [staticText, values])
        ).diagnostic.code
      ).toBe("INTL_VALUES_INVALID");
      expect(
        captureRuntimeError(() =>
          Reflect.apply(translate.value, undefined, [structured, values])
        ).diagnostic.code
      ).toBe("INTL_VALUES_INVALID");
    }
  });

  it("rejects extra positional translation arguments at runtime", () => {
    const translate = createTranslationFunction(runtimeFor("en"));
    const descriptor = textDescriptorAt("greeting.morning");

    expect(
      captureRuntimeError(() =>
        Reflect.apply(translate, undefined, [
          descriptor,
          { name: "Mali" },
          { name: "extra" },
        ])
      ).diagnostic.code
    ).toBe("INTL_VALUES_INVALID");
    expect(
      captureRuntimeError(() =>
        Reflect.apply(translate.rich, undefined, [
          richDescriptorAt("rich.deactivate"),
          {
            components: {
              medium: (children: ReadonlyArray<unknown>) => children,
            },
            values: { name: "Mali" },
          },
          "extra",
        ])
      ).diagnostic.code
    ).toBe("INTL_RICH_COMPONENT_INVALID");
  });

  it("renders text and rich messages with the same i18next fallback locale", async () => {
    const { runtime } = await createBridgeFixture(
      {
        en: {
          translation: {
            "greeting.morning": "Good morning, {name}",
            "rich.deactivate": "Deactivate <medium>{name}</medium>?",
          },
        },
        th: { translation: {} },
      },
      "en",
      "th"
    );
    const translate = createTranslationFunction(runtime);

    expect(
      callLoweredText(translate, textDescriptorAt("greeting.morning"), {
        name: "Mali",
      })
    ).toBe("Good morning, Mali");
    expect(
      Reflect.apply(translate.rich, undefined, [
        richDescriptorAt("rich.deactivate"),
        {
          components: {
            medium: (children: ReadonlyArray<unknown>) =>
              `<strong>${children.join("")}</strong>`,
          },
          values: { name: "Mali" },
        },
      ])
    ).toEqual(["Deactivate ", "<strong>Mali</strong>", "?"]);
  });

  it("keeps createUseTranslations reactive through the i18next TFunction bridge", async () => {
    const { i18n, runtime } = await createBridgeFixture({
      en: {
        translation: { "greeting.morning": "Good morning, {name}" },
      },
      th: {
        translation: { "greeting.morning": "สวัสดีตอนเช้า {name}" },
      },
    });
    const unbind = runtime.bindLanguageChanged(i18n);
    const useTranslations = createUseTranslations(createUseIntl(() => runtime));
    const greeting = textDescriptorAt("greeting.morning");
    const Greeting = (): ReturnType<typeof createElement> => {
      const { t } = useTranslations();
      return createElement(
        "span",
        null,
        callLoweredText(t, greeting, { name: "Mali" }) as string
      );
    };
    let renderer: ReactTestRenderer | undefined;
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });

    try {
      await act(() => {
        renderer = create(createElement(Greeting));
      });
      expect(renderer?.toJSON()).toEqual({
        children: ["Good morning, Mali"],
        props: {},
        type: "span",
      });

      await act(async () => {
        await i18n.changeLanguage("th");
      });
      expect(renderer?.toJSON()).toEqual({
        children: ["สวัสดีตอนเช้า Mali"],
        props: {},
        type: "span",
      });
    } finally {
      unbind();
      await act(() => renderer?.unmount());
      Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
    }
  });

  it("creates isolated request-scoped translators for server rendering", () => {
    const english = createServerIntl({
      backend: createPrecompiledBackend(),
      catalog: compiled.catalog,
      formatters,
      locale: "en",
    });
    const thai = createServerIntl({
      backend: createPrecompiledBackend(),
      catalog: compiled.catalog,
      formatters,
      locale: "th",
    });
    const englishT = createTranslationFunction(english);
    const thaiT = createTranslationFunction(thai);
    const greeting = textDescriptorAt("greeting.morning");

    expect(callLoweredText(englishT, greeting, { name: "Mali" })).toBe(
      "Good morning, Mali"
    );
    expect(callLoweredText(thaiT, greeting, { name: "Mali" })).toBe(
      "สวัสดีตอนเช้า Mali"
    );

    thai.setLocale("en");
    expect(english.locale).toBe("en");
    expect(callLoweredText(englishT, greeting, { name: "Mali" })).toBe(
      "Good morning, Mali"
    );
  });
});
