import type {
  RichDescriptor,
  TextDescriptor,
  ValueDescriptor,
} from "@openmirai/intl-abi";
import type {
  CatalogLocaleOf,
  StrictIntlRuntime,
  TypedCatalogManifest,
  UseTranslations,
} from "@openmirai/intl-runtime";

export type NoValues = Readonly<Record<never, never>>;
export type GreetingValues = Readonly<{ count: number; name: string }>;
export type NameValues = Readonly<{ name: string }>;
export type CountValues = Readonly<{ count: number }>;
export type SettingsValues = Readonly<{ userId: string }>;
export type SettingsResult = Readonly<{
  alerts: boolean;
  theme: "dark" | "light";
}>;

export declare const intl: StrictIntlRuntime;
export declare const staticText: TextDescriptor<
  NoValues,
  "fixture",
  "app.staticText"
>;
export declare const greetingText: TextDescriptor<
  GreetingValues,
  "fixture",
  "app.greeting"
>;
export declare const alternateGreetingText: TextDescriptor<
  GreetingValues,
  "fixture",
  "app.alternateGreeting"
>;
export declare const nameText: TextDescriptor<
  NameValues,
  "fixture",
  "app.name"
>;
export declare const countText: TextDescriptor<
  CountValues,
  "fixture",
  "app.count"
>;
export declare const staticRich: RichDescriptor<
  NoValues,
  "strong",
  "fixture",
  "app.staticRich"
>;
export declare const richNotice: RichDescriptor<
  NameValues,
  "link" | "strong",
  "fixture",
  "app.richNotice"
>;
export declare const settingsValue: ValueDescriptor<
  SettingsValues,
  SettingsResult,
  "fixture",
  "app.settings"
>;
export declare const staticValue: ValueDescriptor<
  NoValues,
  ReadonlyArray<string>,
  "fixture",
  "app.staticValue"
>;

export interface FixtureCatalog {
  app: {
    alternateGreeting: typeof alternateGreetingText;
    count: typeof countText;
    greeting: typeof greetingText;
    name: typeof nameText;
    richNotice: typeof richNotice;
    settings: typeof settingsValue;
    staticRich: typeof staticRich;
    staticText: typeof staticText;
    staticValue: typeof staticValue;
    status: {
      active: typeof staticText;
      inactive: typeof staticText;
    };
    toast: {
      activate: {
        error: typeof staticText;
        success: typeof staticText;
      };
      delete: {
        error: typeof staticText;
        success: typeof staticText;
      };
    };
  };
}

export type FixtureCatalogManifest<
  Locales extends ReadonlyArray<string> = ReadonlyArray<string>,
  SourceLocale extends Locales[number] = Locales[number],
> = TypedCatalogManifest<FixtureCatalog, Locales, SourceLocale>;

export declare const useTranslations: UseTranslations<FixtureCatalog>;
export declare const catalogManifest: TypedCatalogManifest<FixtureCatalog>;
export declare const exactCatalogManifest: TypedCatalogManifest<
  FixtureCatalog,
  readonly ["en", "th"],
  "en"
>;
export type ExactCatalogLocale = CatalogLocaleOf<typeof exactCatalogManifest>;
