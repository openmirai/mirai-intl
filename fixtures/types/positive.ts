import {
  bindFormSchema,
  bindTranslationKeyFactory,
  bindTranslationKeyParser,
  createI18nextCatalogBackend,
  createTranslationFunction,
} from "@openmirai/intl-runtime";
import { createUseTranslations } from "@openmirai/intl-runtime/react-i18next";
import type {
  CatalogContractOf,
  FormErrorMessage,
  FormSchemaPart,
  TranslationFunctionFor,
  UseTranslations,
} from "@openmirai/intl-runtime";
import type { TextDescriptor } from "@openmirai/intl-abi";
import type {
  ArgumentFreeTextKeysFor,
  DeferredTranslationKeyFor,
} from "@openmirai/intl-runtime/react";
import type { BackendModule } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  alternateGreetingText,
  catalogManifest,
  exactCatalogManifest,
  greetingText,
  intl,
  richNotice,
  settingsValue,
  staticRich,
  staticText,
  staticValue,
  useTranslations,
} from "./descriptors";
import type {
  ExactCatalogLocale,
  FixtureCatalog,
  SettingsResult,
} from "./descriptors";

const renderChildren = (children: ReadonlyArray<unknown>): unknown => children;

interface FormSchemaFixtureCatalog {
  form: {
    error: {
      form: {
        invalid: TextDescriptor;
        required: TextDescriptor;
      };
    };
  };
}

const createFormSchema = bindFormSchema<FormSchemaFixtureCatalog>();
declare const requiredFormMessage: FormErrorMessage<"error.form.required">;
const requiredFieldHelper = createFormSchema.helper(
  (input: Readonly<{ message: FormErrorMessage<"error.form.required"> }>) => ({
    message: input.message,
  })
);
const requiredField = requiredFieldHelper({ message: requiredFormMessage });
requiredField satisfies FormSchemaPart<{
  message: FormErrorMessage<"error.form.required">;
}>;
const formSchema = createFormSchema("form", ({ error }) => ({
  invalid: error("invalid"),
  required: requiredField,
}));
formSchema satisfies FormSchemaPart<{
  invalid: FormErrorMessage<"error.form.invalid">;
  required: typeof requiredField;
}>;

const staticTextResult = intl.t(staticText);
staticTextResult satisfies string;

const greetingResult = intl.t(greetingText, { count: 2, name: "Ada" });
greetingResult satisfies string;

const staticRichResult = intl.rich(staticRich, {
  components: { strong: renderChildren },
});
staticRichResult satisfies unknown;

const richResult = intl.rich(richNotice, {
  components: {
    link: renderChildren,
    strong: renderChildren,
  },
  values: { name: "Ada" },
});
richResult satisfies unknown;

const settingsResult = intl.value(settingsValue, { userId: "user-1" });
settingsResult satisfies SettingsResult;

const staticValueResult = intl.value(staticValue);
staticValueResult satisfies ReadonlyArray<string>;

declare const compatibleUnion:
  | typeof alternateGreetingText
  | typeof greetingText;
intl.t(compatibleUnion, { count: 1, name: "Ada" }) satisfies string;

enum GreetingKey {
  ALTERNATE = "alternate",
  PRIMARY = "primary",
}

const greetingByKey = {
  [GreetingKey.ALTERNATE]: alternateGreetingText,
  [GreetingKey.PRIMARY]: greetingText,
} as const;

declare const greetingKey: keyof typeof greetingByKey;
intl.t(greetingByKey[greetingKey], { count: 1, name: "Ada" }) satisfies string;

const { t } = useTranslations("app");
const staticArgumentFreeKey: ArgumentFreeTextKeysFor<FixtureCatalog, "app"> =
  "staticText";
const nestedArgumentFreeKey: ArgumentFreeTextKeysFor<FixtureCatalog, "app"> =
  "toast.activate.error";
t(staticArgumentFreeKey) satisfies string;
t(nestedArgumentFreeKey) satisfies string;
declare const namedAppKey: "staticText" | "status.active";
declare const widenedAppKey: string;
t(namedAppKey) satisfies string;
t("staticText") satisfies string;
t("greeting", { count: 2, name: "Ada" }) satisfies string;
t.rich("staticRich", {
  components: { strong: renderChildren },
}) satisfies unknown;
t.rich("richNotice", {
  components: {
    link: renderChildren,
    strong: renderChildren,
  },
  values: { name: "Ada" },
}) satisfies unknown;
t.value("settings", { userId: "user-1" }) satisfies SettingsResult;
t.value("staticValue") satisfies ReadonlyArray<string>;

const staticMessages = t.map(["staticText", "status.active"] as const);
staticMessages.staticText satisfies string;
staticMessages["status.active"] satisfies string;

const toastMessages = t.map(
  ["toast.activate", "toast.delete"] as const,
  ["error", "success"] as const
);
toastMessages["toast.activate"].error satisfies string;

const statusMessages = t.map({
  disabled: "status.inactive",
  enabled: "status.active",
} as const);
statusMessages.enabled satisfies string;

const useReactTranslations = createUseTranslations(
  catalogManifest,
  useTranslation
);
const reactTranslations = useReactTranslations("app");
reactTranslations.t.rich("staticRich", {
  components: { strong: () => "strong" },
}) satisfies ReactNode;

const rootTranslations = useTranslations();
rootTranslations.t("app.greeting", {
  count: 2,
  name: "Ada",
}) satisfies string;
// @ts-expect-error Root translators do not allow widened dynamic keys.
rootTranslations.t(widenedAppKey);

declare const compatibleConventionalKey: "alternateGreeting" | "greeting";
t(compatibleConventionalKey, { count: 1, name: "Ada" }) satisfies string;

const serverTranslations = createTranslationFunction<FixtureCatalog>(intl);
serverTranslations("app.greeting", {
  count: 1,
  name: "Ada",
}) satisfies string;

const serverAppTranslations = createTranslationFunction<FixtureCatalog, "app">(
  intl
);
serverAppTranslations("greeting", {
  count: 1,
  name: "Ada",
}) satisfies string;

type ReactLikeNode = string | Readonly<{ type: "strong" }>;
declare const reactLikeTranslations: UseTranslations<
  FixtureCatalog,
  ReactLikeNode
>;
const strongNode: ReactLikeNode = { type: "strong" };
const reactLikeRich = reactLikeTranslations("app").t.rich("staticRich", {
  components: {
    strong: () => strongNode,
  },
});
reactLikeRich satisfies ReactLikeNode;

declare const helperTranslations: TranslationFunctionFor<FixtureCatalog, "app">;
helperTranslations("greeting", {
  count: 1,
  name: "Ada",
}) satisfies string;

catalogManifest.locales satisfies ReadonlyArray<string>;
exactCatalogManifest.locales satisfies readonly ["en", "th"];
exactCatalogManifest.sourceLocale satisfies "en";
declare const exactCatalogLocale: ExactCatalogLocale;
exactCatalogLocale satisfies "en" | "th";
declare const exactCatalogContract: CatalogContractOf<
  typeof exactCatalogManifest
>;
exactCatalogContract satisfies FixtureCatalog;

declare const isFixtureLocale: (locale: string) => locale is ExactCatalogLocale;
declare const loadFixtureResource: (locale: string) => Promise<{
  translation: Record<string, string>;
}>;
const catalogBackend: BackendModule = createI18nextCatalogBackend({
  isCatalogLocale: isFixtureLocale,
  loadCatalogResource: loadFixtureResource,
});
catalogBackend.type satisfies "backend";

const createTranslationKey = bindTranslationKeyFactory<FixtureCatalog>();
const parseTranslationKey = bindTranslationKeyParser<FixtureCatalog>();
const appKey = createTranslationKey("app");
type AppTranslationKey = ReturnType<typeof appKey>;
const storedAppKey = appKey("staticText");
storedAppKey satisfies "app.staticText";
storedAppKey satisfies DeferredTranslationKeyFor<FixtureCatalog, "app">;
t(storedAppKey) satisfies string;
const storedNestedAppKey = appKey("status.active");
storedNestedAppKey satisfies "app.status.active";
t(storedNestedAppKey) satisfies string;
const storedTranslationConfig = {
  items: [
    { labelKey: appKey("staticText"), route: "/app" },
    { labelKey: appKey("status.active"), route: "/app/status" },
  ],
  titleKey: appKey("staticText"),
} satisfies {
  items: ReadonlyArray<{ labelKey: AppTranslationKey; route: string }>;
  titleKey: AppTranslationKey;
};
storedTranslationConfig.titleKey satisfies DeferredTranslationKeyFor<
  FixtureCatalog,
  "app"
>;
t(storedTranslationConfig.titleKey) satisfies string;
t(storedTranslationConfig.items[0]!.labelKey) satisfies string;
storedTranslationConfig.items[0]!.route satisfies string;
appKey("status.active") satisfies "app.status.active";
createTranslationKey("app.status")("inactive") satisfies "app.status.inactive";
declare const boundaryInput: unknown;
const parsedAppKey = parseTranslationKey("app", boundaryInput);
if (parsedAppKey) {
  t(parsedAppKey) satisfies string;
}
