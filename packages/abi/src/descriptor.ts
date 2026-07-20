import type { JsonValue } from "./json";

export const FORMAT_VERSION = 1 as const;
export const RUNTIME_ABI = "1.0.0" as const;
export const DESCRIPTOR_BRAND_VALUE = "@mirai/intl-descriptor/1" as const;
export const DESCRIPTOR_TYPE_CARRIER = "__miraiIntl" as const;

export type FormatVersion = typeof FORMAT_VERSION;
export type RuntimeAbi = typeof RUNTIME_ABI;
export type DescriptorKind = "rich" | "text" | "value";
export type RendererCapabilityId =
  | "portable-ir-v1"
  | "precompiled-v1"
  | "tfunction-bridge-v1";
export type Sha256 = `sha256:${string}`;

/**
 * Runtime-only brand. Uses Symbol.for so duplicate package installs share the
 * same runtime symbol value.
 *
 * IMPORTANT: this must not be a *required* key on {@link MessageDescriptor}.
 * TypeScript treats `unique symbol` keys as install-local, so required symbol
 * keys break `extends` checks across duplicate `@openmirai/intl-abi` copies
 * (for example runtime@N depending on abi@N while generated catalogs still
 * import abi@N-1).
 */
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

/**
 * Structural descriptor shape. Type parameters are carried by a fixed string
 * key so descriptors remain assignable across duplicate abi package installs.
 */
export type MessageDescriptor<
  CatalogId extends string = string,
  Path extends string = string,
  Values = unknown,
  Kind extends DescriptorKind = DescriptorKind,
  Result = unknown,
  Tags extends string = string,
> = Readonly<{
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
  readonly [DESCRIPTOR_TYPE_CARRIER]?: DescriptorTypeBrand<
    CatalogId,
    Path,
    Values,
    Kind,
    Result,
    Tags
  >;
  /**
   * Optional so descriptors typed by another abi install (which may use a
   * different `unique symbol` identity) remain assignable.
   */
  readonly [messageBrand]?: DescriptorTypeBrand<
    CatalogId,
    Path,
    Values,
    Kind,
    Result,
    Tags
  >;
}>;

export type TextDescriptor<
  // Prefer `{}` over `Record<string, never>` so `keyof Values` is `never`
  // for argument-free messages (`keyof Record<string, never>` is `string | number`).
  Values = {},
  CatalogId extends string = string,
  Path extends string = string,
> = MessageDescriptor<CatalogId, Path, Values, "text", string, never>;

export type RichDescriptor<
  Values = {},
  Tags extends string = string,
  CatalogId extends string = string,
  Path extends string = string,
> = MessageDescriptor<CatalogId, Path, Values, "rich", string, Tags>;

export type ValueDescriptor<
  Values = {},
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

/** Structural detector that does not depend on install-local unique symbols. */
export type IsMessageDescriptor<Node> = Node extends {
  readonly brand: typeof DESCRIPTOR_BRAND_VALUE;
  readonly kind: DescriptorKind;
}
  ? true
  : false;

export type DescriptorKindOf<Node> = Node extends {
  readonly brand: typeof DESCRIPTOR_BRAND_VALUE;
  readonly kind: infer Kind extends DescriptorKind;
}
  ? Kind
  : never;

/**
 * Recover `values` from any brand payload key — including install-local
 * `unique symbol` keys from older `@openmirai/intl-abi` copies. String-key
 * carriers alone are not enough when generated catalogs still resolve an older
 * abi while runtime resolves a newer one.
 */
type BrandValues<D> = {
  [K in keyof D]-?: D[K] extends {
    readonly catalogId: string;
    readonly kind: DescriptorKind;
    readonly path: string;
    readonly values: infer Values;
  }
    ? Values
    : never;
}[keyof D];

type BrandResult<D> = {
  [K in keyof D]-?: D[K] extends {
    readonly catalogId: string;
    readonly kind: DescriptorKind;
    readonly path: string;
    readonly result: infer Result;
  }
    ? Result
    : never;
}[keyof D];

type BrandTags<D> = {
  [K in keyof D]-?: D[K] extends {
    readonly catalogId: string;
    readonly kind: DescriptorKind;
    readonly path: string;
    readonly tags: infer Tags extends string;
  }
    ? Tags
    : never;
}[keyof D];

export type ValuesOf<D> = [BrandValues<D>] extends [never]
  ? D extends MessageDescriptor<
      string,
      string,
      infer Values,
      DescriptorKind,
      unknown,
      string
    >
    ? Values
    : never
  : BrandValues<D>;

export type ResultOf<D> = [BrandResult<D>] extends [never]
  ? D extends MessageDescriptor<
      string,
      string,
      unknown,
      DescriptorKind,
      infer Result,
      string
    >
    ? Result
    : never
  : BrandResult<D>;

export type TagsOf<D> = [BrandTags<D>] extends [never]
  ? D extends MessageDescriptor<
      string,
      string,
      unknown,
      DescriptorKind,
      unknown,
      infer Tags
    >
    ? Tags
    : never
  : BrandTags<D>;

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
  typeof messageBrand | typeof DESCRIPTOR_TYPE_CARRIER | "brand"
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
