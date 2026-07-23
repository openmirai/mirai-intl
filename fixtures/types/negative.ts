import {
  countText,
  greetingText,
  intl,
  nameText,
  richNotice,
  settingsValue,
  staticRich,
  staticText,
  staticValue,
  useTranslations,
} from "./descriptors";
import {
  bindFormSchema,
  bindTranslationKeyFactory,
  bindTranslationKeyParser,
  createTranslationFunction,
} from "@openmirai/intl-runtime";
import type {
  ExactCatalogLocale,
  FixtureCatalog,
  FixtureCatalogManifest,
} from "./descriptors";
import type { ArgumentFreeTextKeysFor } from "@openmirai/intl-runtime/react";
import type { TextDescriptor } from "@openmirai/intl-abi";

const renderChildren = (children: ReadonlyArray<unknown>): unknown => children;

interface FormSchemaFixtureCatalog {
  form: {
    error: {
      form: {
        required: TextDescriptor;
      };
    };
  };
}

const createFormSchema = bindFormSchema<FormSchemaFixtureCatalog>();
declare const formErrorPrefix: `error.form.${string}`;

// @ts-expect-error Form-schema helpers cannot accept raw strings.
createFormSchema.helper((message: string) => ({ message }));

// @ts-expect-error Form-schema helpers cannot accept unbranded error prefixes.
createFormSchema.helper((message: typeof formErrorPrefix) => ({ message }));

// @ts-expect-error Form-schema helpers cannot give errors raw-string defaults.
createFormSchema.helper((message = "error.form.required") => ({ message }));

// @ts-expect-error A no-value text descriptor accepts no values argument.
intl.t(staticText, {});

// @ts-expect-error A no-value structured descriptor accepts no values argument.
intl.value(staticValue, {});

// @ts-expect-error Required translation values cannot be omitted.
intl.t(greetingText);

// @ts-expect-error Required translation properties cannot be omitted.
intl.t(greetingText, { name: "Ada" });

// @ts-expect-error Fresh translation values cannot contain extra properties.
intl.t(greetingText, { count: 1, extra: true, name: "Ada" });

// @ts-expect-error Translation value properties retain their generated types.
intl.t(greetingText, { count: "1", name: "Ada" });

const inferredExtraValues = { count: 1, extra: true, name: "Ada" };
// @ts-expect-error Inferred variables cannot bypass exact value checking.
intl.t(greetingText, inferredExtraValues);

// @ts-expect-error Rich values are required when the descriptor declares them.
intl.rich(richNotice, {
  components: { link: renderChildren, strong: renderChildren },
});

intl.rich(richNotice, {
  components: { link: renderChildren, strong: renderChildren },
  // @ts-expect-error Rich values cannot contain extra properties.
  values: { extra: true, name: "Ada" },
});

intl.rich(richNotice, {
  // @ts-expect-error Rich component maps must include every generated tag.
  components: { strong: renderChildren },
  values: { name: "Ada" },
});

intl.rich(staticRich, {
  components: { strong: renderChildren },
  // @ts-expect-error Rich descriptors without scalar values do not accept a values field.
  values: {},
});

// @ts-expect-error Text operations accept only text descriptors.
intl.t(richNotice, { name: "Ada" });

// @ts-expect-error Rich operations accept only rich descriptors.
intl.rich(greetingText, {
  components: {},
  values: { count: 1, name: "Ada" },
});

// @ts-expect-error Value operations accept only structured-value descriptors.
intl.value(greetingText, { count: 1, name: "Ada" });

// @ts-expect-error Text operations reject structured-value descriptors.
intl.t(settingsValue, { userId: "user-1" });

// @ts-expect-error Callers cannot select a structured return type generic.
intl.value<string>(settingsValue, { userId: "user-1" });

// @ts-expect-error The generated structured return type is not caller-selected.
void (intl.value(settingsValue, { userId: "user-1" }) satisfies string);

declare const incompatibleUnion: typeof countText | typeof nameText;

// @ts-expect-error Incompatible descriptor unions must be narrowed before use.
intl.t(incompatibleUnion, { name: "Ada" });

// @ts-expect-error Incompatible descriptor unions cannot use another branch's values.
intl.t(incompatibleUnion, { count: 1 });

// @ts-expect-error Incompatible descriptor unions cannot erase required values.
intl.t(incompatibleUnion);

enum MixedKey {
  COUNT = "count",
  NAME = "name",
}

const mixedByKey = {
  [MixedKey.COUNT]: countText,
  [MixedKey.NAME]: nameText,
} as const;

declare const mixedKey: keyof typeof mixedByKey;
// @ts-expect-error A typed index that produces an incompatible union must be narrowed.
intl.t(mixedByKey[mixedKey], { name: "Ada" });

declare const widenedString: string;
declare const widenedStrings: ReadonlyArray<string>;
declare const unknownDescriptor: unknown;
declare const unknownKey: unknown;

// @ts-expect-error Raw widened strings are not translation descriptors.
intl.t(widenedString);

// @ts-expect-error Unknown input is not a translation descriptor.
intl.t(unknownDescriptor);

// @ts-expect-error A widened string cannot index a generated descriptor tree.
void mixedByKey[widenedString];

const { t } = useTranslations("app");

// @ts-expect-error Parameterized text is not an argument-free translation key.
const parameterizedTranslationKey: ArgumentFreeTextKeysFor<
  FixtureCatalog,
  "app"
> = "greeting";

// @ts-expect-error Rich messages are not argument-free text keys.
const richTranslationKey: ArgumentFreeTextKeysFor<FixtureCatalog, "app"> =
  "staticRich";

// @ts-expect-error Structured values are not argument-free text keys.
const valueTranslationKey: ArgumentFreeTextKeysFor<FixtureCatalog, "app"> =
  "staticValue";

// @ts-expect-error A conventional key retains its inferred required values.
t("greeting");

// @ts-expect-error Conventional values cannot omit required properties.
t("greeting", { name: "Ada" });

// @ts-expect-error Conventional values cannot contain extra properties.
t("greeting", { count: 1, extra: true, name: "Ada" });

const conventionalExtraValues = { count: 1, extra: true, name: "Ada" };
// @ts-expect-error Inferred variables cannot bypass exact conventional values.
t("greeting", conventionalExtraValues);

// @ts-expect-error Conventional values retain their generated scalar roles.
t("greeting", { count: "1", name: "Ada" });

// @ts-expect-error Text translation rejects rich-message keys.
t("richNotice", { name: "Ada" });

// @ts-expect-error Rich translation rejects text-message keys.
t.rich("greeting", {
  components: {},
  values: { count: 1, name: "Ada" },
});

t.rich("richNotice", {
  // @ts-expect-error Rich calls require every generated component tag.
  components: { strong: renderChildren },
  values: { name: "Ada" },
});

// @ts-expect-error Structured translation rejects text-message keys.
t.value("greeting", { count: 1, name: "Ada" });

// @ts-expect-error Unknown namespaces are rejected.
useTranslations("missing");

// @ts-expect-error Namespace translators reject widened strings.
t(widenedString);

// @ts-expect-error Namespace translators reject unknown keys.
t(unknownKey);

// @ts-expect-error Literal typos cannot fall through to the widened-string overload.
t("missing");

// @ts-expect-error Translation maps require finite readonly tuples.
t.map(widenedStrings);

// @ts-expect-error Parameterized messages cannot enter the no-values map.
t.map(["greeting"] as const);

// @ts-expect-error Rich messages cannot enter the text map.
t.map(["staticRich"] as const);

// @ts-expect-error Every matrix Cartesian path must be a static text message.
t.map(["toast.activate"] as const, ["error", "missing"] as const);

declare const widenedMap: Readonly<Record<string, "staticText">>;
// @ts-expect-error Record maps require finite known application keys.
t.map(widenedMap);

declare const incompatibleConventionalKey: "count" | "name";
// @ts-expect-error Incompatible conventional key unions must be narrowed.
t(incompatibleConventionalKey, { name: "Ada" });

const serverAppTranslations = createTranslationFunction<FixtureCatalog, "app">(
  intl
);
// @ts-expect-error Namespace-bound server translators accept relative keys only.
serverAppTranslations("app.greeting", { count: 1, name: "Ada" });

type _InvalidSourceLocaleManifest = FixtureCatalogManifest<
  readonly ["en", "th"],
  // @ts-expect-error The source locale must be a member of the exact locale tuple.
  "id"
>;

declare const unsupportedCatalogLocale: "id";
// @ts-expect-error CatalogLocaleOf retains the exact generated locale union.
void (unsupportedCatalogLocale satisfies ExactCatalogLocale);

const createTranslationKey = bindTranslationKeyFactory<FixtureCatalog>();
const parseTranslationKey = bindTranslationKeyParser<FixtureCatalog>();
const appKey = createTranslationKey("app");
const nestedStatusKey = createTranslationKey("app.status")("active");

const invalidStoredTranslationConfig: { labelKey: ReturnType<typeof appKey> } =
  {
    // @ts-expect-error Stored key fields reject raw strings that bypass the creator.
    labelKey: "staticText",
  };
void invalidStoredTranslationConfig;

// @ts-expect-error Deferred keys retain their exact creator namespace.
t(nestedStatusKey);

// @ts-expect-error Raw qualified literals are not deferred translation keys.
t("app.staticText");

// @ts-expect-error Unknown namespaces are rejected.
createTranslationKey("missing");

// @ts-expect-error Parser namespaces are catalog-bound.
parseTranslationKey("missing", widenedString);

// @ts-expect-error Parser namespaces cannot be widened.
parseTranslationKey(widenedString, widenedString);

// @ts-expect-error Widened namespaces are rejected.
createTranslationKey(widenedString);

// @ts-expect-error Unknown keys are rejected.
appKey("missing");

// @ts-expect-error Widened keys are rejected.
appKey(widenedString);

// @ts-expect-error Unknown keys are rejected.
appKey(unknownKey);

// @ts-expect-error Parameterized text is not a deferred static key.
appKey("greeting");

// @ts-expect-error Rich messages are not deferred text keys.
appKey("staticRich");

// @ts-expect-error Structured values are not deferred text keys.
appKey("staticValue");

// @ts-expect-error A key marker requires exactly one argument.
appKey();

// @ts-expect-error A key marker rejects extra arguments.
appKey("staticText", "extra");
