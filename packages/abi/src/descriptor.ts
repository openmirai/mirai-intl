import type { JsonValue } from "./json";

export const FORMAT_VERSION = 1 as const;
export const RUNTIME_ABI = "1.0.0" as const;
export const DESCRIPTOR_BRAND_VALUE = "@mirai/intl-descriptor/1" as const;

export type FormatVersion = typeof FORMAT_VERSION;
export type RuntimeAbi = typeof RUNTIME_ABI;
export type DescriptorKind = "rich" | "text" | "value";
export type RendererCapabilityId =
  | "portable-ir-v1"
  | "precompiled-v1"
  | "tfunction-bridge-v1";
export type Sha256 = `sha256:${string}`;

export const messageBrand: unique symbol = Symbol.for(
  DESCRIPTOR_BRAND_VALUE
) as never;

export type DescriptorTypeBrand<
  CatalogId extends string,
  Path extends string,
  Values,
  Kind extends DescriptorKind,
  Result,
  Tags extends string,
> = Readonly<{
  catalogId: CatalogId;
  kind: Kind;
  path: Path;
  result: Result;
  runtimeAbi: RuntimeAbi;
  tags: Tags;
  values: Values;
}>;

export type MessageDescriptor<
  CatalogId extends string = string,
  Path extends string = string,
  Values = unknown,
  Kind extends DescriptorKind = DescriptorKind,
  Result = unknown,
  Tags extends string = string,
> = Readonly<{
  [messageBrand]: DescriptorTypeBrand<
    CatalogId,
    Path,
    Values,
    Kind,
    Result,
    Tags
  >;
  brand: typeof DESCRIPTOR_BRAND_VALUE;
  buildToken: string;
  capabilitySetHash: Sha256;
  catalogHash: Sha256;
  catalogId: CatalogId;
  formatVersion: FormatVersion;
  kind: Kind;
  messageId: string;
  path: Path;
  rendererCapabilityId: RendererCapabilityId;
  runtimeAbi: RuntimeAbi;
  validatorId: number;
}>;

export type TextDescriptor<
  Values = Record<string, never>,
  CatalogId extends string = string,
  Path extends string = string,
> = MessageDescriptor<CatalogId, Path, Values, "text", string, never>;

export type RichDescriptor<
  Values = Record<string, never>,
  Tags extends string = string,
  CatalogId extends string = string,
  Path extends string = string,
> = MessageDescriptor<CatalogId, Path, Values, "rich", string, Tags>;

export type ValueDescriptor<
  Values = Record<string, never>,
  Result = JsonValue,
  CatalogId extends string = string,
  Path extends string = string,
> = MessageDescriptor<CatalogId, Path, Values, "value", Result, never>;

export type AnyTextDescriptor = MessageDescriptor<
  string,
  string,
  unknown,
  "text",
  string,
  never
>;

export type AnyRichDescriptor = MessageDescriptor<
  string,
  string,
  unknown,
  "rich",
  string,
  string
>;

export type AnyValueDescriptor = MessageDescriptor<
  string,
  string,
  unknown,
  "value",
  unknown,
  never
>;

export type ValuesOf<D extends MessageDescriptor> =
  D extends MessageDescriptor<
    string,
    string,
    infer Values,
    DescriptorKind,
    unknown,
    string
  >
    ? Values
    : never;

export type ResultOf<D extends MessageDescriptor> =
  D extends MessageDescriptor<
    string,
    string,
    unknown,
    DescriptorKind,
    infer Result,
    string
  >
    ? Result
    : never;

export type TagsOf<D extends MessageDescriptor> =
  D extends MessageDescriptor<
    string,
    string,
    unknown,
    DescriptorKind,
    unknown,
    infer Tags
  >
    ? Tags
    : never;

export type NoExtra<Actual, Schema> = Actual &
  Record<Exclude<keyof Actual, keyof Schema>, never>;

export type KeysOfUnion<Schema> = Schema extends unknown ? keyof Schema : never;

export type StrictArgs<Schema, Actual extends Schema = Schema> = [
  KeysOfUnion<Schema>,
] extends [never]
  ? []
  : [values: Actual & NoExtra<Actual, Schema>];

export type DescriptorInput<
  CatalogId extends string,
  Path extends string,
  Kind extends DescriptorKind,
> = Omit<
  MessageDescriptor<CatalogId, Path, never, Kind, never, never>,
  typeof messageBrand | "brand"
>;

export function defineMessageDescriptor<
  const CatalogId extends string,
  const Path extends string,
  Values,
  const Kind extends DescriptorKind,
  Result,
  Tags extends string,
>(
  input: DescriptorInput<CatalogId, Path, Kind>
): MessageDescriptor<CatalogId, Path, Values, Kind, Result, Tags> {
  const descriptor = {
    ...input,
    brand: DESCRIPTOR_BRAND_VALUE,
  };

  Object.defineProperty(descriptor, messageBrand, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      catalogId: input.catalogId,
      kind: input.kind,
      path: input.path,
      runtimeAbi: input.runtimeAbi,
    }),
    writable: false,
  });

  return Object.freeze(descriptor) as MessageDescriptor<
    CatalogId,
    Path,
    Values,
    Kind,
    Result,
    Tags
  >;
}
