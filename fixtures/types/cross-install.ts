/**
 * Simulates a prior `@openmirai/intl-abi` install whose MessageDescriptor
 * required an install-local `unique symbol` brand key. Catalogs generated
 * against that shape must still type-check against the current runtime.
 */
declare const legacyMessageBrand: unique symbol;

type LegacyDescriptorTypeBrand<
  CatalogId extends string,
  Path extends string,
  Values,
  Kind extends "rich" | "text" | "value",
  Result,
  Tags extends string,
> = Readonly<{
  catalogId: CatalogId;
  kind: Kind;
  path: Path;
  result: Result;
  runtimeAbi: "1.0.0";
  tags: Tags;
  values: Values;
}>;

type LegacyMessageDescriptor<
  CatalogId extends string = string,
  Path extends string = string,
  Values = unknown,
  Kind extends "rich" | "text" | "value" = "rich" | "text" | "value",
  Result = unknown,
  Tags extends string = string,
> = Readonly<{
  [legacyMessageBrand]: LegacyDescriptorTypeBrand<
    CatalogId,
    Path,
    Values,
    Kind,
    Result,
    Tags
  >;
  brand: "@mirai/intl-descriptor/1";
  buildToken: string;
  capabilitySetHash: `sha256:${string}`;
  catalogHash: `sha256:${string}`;
  catalogId: CatalogId;
  formatVersion: 1;
  kind: Kind;
  messageId: string;
  path: Path;
  rendererCapabilityId: "portable-ir-v1";
  runtimeAbi: "1.0.0";
  validatorId: number;
}>;

type LegacyTextDescriptor<
  Values = {},
  CatalogId extends string = string,
  Path extends string = string,
> = LegacyMessageDescriptor<CatalogId, Path, Values, "text", string, never>;

type LegacyCatalog = {
  readonly colorPreset: {
    readonly blue: LegacyTextDescriptor<
      {},
      "@legacy/catalog",
      "colorPreset.blue"
    >;
    readonly green: LegacyTextDescriptor<
      {},
      "@legacy/catalog",
      "colorPreset.green"
    >;
  };
  readonly greeting: LegacyTextDescriptor<
    { readonly name: string },
    "@legacy/catalog",
    "greeting"
  >;
};

import type {
  ArgumentFreeTextKeysFor,
  NamespacePaths,
  TranslationFunctionFor,
} from "@openmirai/intl-runtime";
import type {
  DescriptorKindOf,
  IsMessageDescriptor,
  MessageDescriptor,
  ValuesOf,
} from "@openmirai/intl-abi";

type LegacyBlue = LegacyCatalog["colorPreset"]["blue"];

type Assert<T extends true> = T;

type _legacyIsDescriptor = Assert<IsMessageDescriptor<LegacyBlue>>;
type _legacyKind = Assert<
  DescriptorKindOf<LegacyBlue> extends "text" ? true : false
>;
type _legacyAssignsToCurrent = Assert<
  LegacyBlue extends MessageDescriptor ? true : false
>;
type _legacyValues = Assert<
  ValuesOf<LegacyBlue> extends Record<string, never>
    ? true
    : keyof ValuesOf<LegacyBlue> extends never
      ? true
      : false
>;
type _legacyGreetingValues = Assert<
  ValuesOf<LegacyCatalog["greeting"]> extends { readonly name: string }
    ? true
    : false
>;

type LegacyNamespaces = NamespacePaths<LegacyCatalog>;
type _legacyNamespace = Assert<
  "colorPreset" extends LegacyNamespaces ? true : false
>;

type LegacyColorKeys = ArgumentFreeTextKeysFor<LegacyCatalog, "colorPreset">;
type _legacyColorKeys = Assert<
  "blue" | "green" extends LegacyColorKeys
    ? LegacyColorKeys extends "blue" | "green"
      ? true
      : false
    : false
>;

declare const t: TranslationFunctionFor<LegacyCatalog, "colorPreset">;
t("blue") satisfies string;
t("green") satisfies string;

declare const root: TranslationFunctionFor<LegacyCatalog>;
root("colorPreset.blue") satisfies string;
root("greeting", { name: "Ada" }) satisfies string;
