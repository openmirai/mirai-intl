import type {
  AnyRichDescriptor,
  AnyTextDescriptor,
  AnyValueDescriptor,
  DescriptorKind,
  MessageDescriptor,
  ResultOf,
  StrictArgs,
  ValuesOf,
} from "@openmirai/intl-abi";

import type { RichRenderValue } from "./rich";
import type {
  ComponentsOf,
  StrictIntlRuntime,
  StrictRichInput,
} from "./runtime";

type StringKeyOf<Value> = Extract<keyof Value, string>;

type NodeAtPath<
  Node,
  Path extends string,
> = Path extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Node
    ? NodeAtPath<Node[Head], Tail>
    : never
  : Path extends keyof Node
    ? Node[Path]
    : never;

export type NamespacePaths<Node> = {
  [Key in StringKeyOf<Node>]: Node[Key] extends MessageDescriptor
    ? never
    : Node[Key] extends object
      ? Key | `${Key}.${NamespacePaths<Node[Key]>}`
      : never;
}[StringKeyOf<Node>];

type MessagePaths<Node, Kind extends DescriptorKind> = {
  [Key in StringKeyOf<Node>]: Node[Key] extends MessageDescriptor<
    string,
    string,
    unknown,
    infer ActualKind,
    unknown,
    string
  >
    ? ActualKind extends Kind
      ? Key
      : never
    : Node[Key] extends object
      ? `${Key}.${MessagePaths<Node[Key], Kind>}`
      : never;
}[StringKeyOf<Node>];

type StaticTextMessagePaths<Node> = {
  [Key in StringKeyOf<Node>]: Node[Key] extends AnyTextDescriptor
    ? keyof ValuesOf<Node[Key]> extends never
      ? Key
      : never
    : Node[Key] extends object
      ? `${Key}.${StaticTextMessagePaths<Node[Key]>}`
      : never;
}[StringKeyOf<Node>];

export type ArgumentFreeTextMessagePaths<Node> = Extract<
  StaticTextMessagePaths<Node>,
  string
>;

type DescriptorAt<
  Node,
  Path extends string,
  Descriptor extends MessageDescriptor,
> = Extract<NodeAtPath<Node, Path>, Descriptor>;

type TextAt<Node, Path extends string> = DescriptorAt<
  Node,
  Path,
  AnyTextDescriptor
>;

type RichAt<Node, Path extends string> = DescriptorAt<
  Node,
  Path,
  AnyRichDescriptor
>;

type ValueAt<Node, Path extends string> = DescriptorAt<
  Node,
  Path,
  AnyValueDescriptor
>;

type NamespaceNode<Catalog, Namespace> = Namespace extends string
  ? Extract<NodeAtPath<Catalog, Namespace>, object>
  : Extract<Catalog, object>;

export type ArgumentFreeTextKeysFor<
  Catalog extends object,
  Namespace extends NamespacePaths<Catalog>,
> = ArgumentFreeTextMessagePaths<NamespaceNode<Catalog, Namespace>>;

export type DeferredTranslationKey<
  Namespace extends string,
  Key extends string,
> = `${Namespace}.${Key}` & {
  readonly [deferredTranslationKeyBrand]: Readonly<{
    key: Key;
    namespace: Namespace;
  }>;
};

declare const deferredTranslationKeyBrand: unique symbol;

export type DeferredTranslationKeyFor<
  Catalog extends object,
  Namespace extends NamespacePaths<Catalog>,
> = DeferredTranslationKey<
  Namespace,
  ArgumentFreeTextKeysFor<Catalog, Namespace>
>;

export interface TranslationKeyMarker<
  Catalog extends object,
  Namespace extends NamespacePaths<Catalog>,
> {
  <const Key extends ArgumentFreeTextKeysFor<Catalog, Namespace>>(
    key: Key
  ): DeferredTranslationKey<Namespace, Key>;

  (
    key: ArgumentFreeTextKeysFor<Catalog, Namespace>
  ): DeferredTranslationKeyFor<Catalog, Namespace>;
}

export type CreateTranslationKey<Catalog extends object> = <
  const Namespace extends NamespacePaths<Catalog>,
>(
  namespace: Namespace
) => TranslationKeyMarker<Catalog, Namespace>;

const unloweredTranslationKeyMarker = (): never => {
  throw new TypeError(
    "Translation key marker was not lowered by the Mirai Intl compiler"
  );
};

const unloweredTranslationKeyFactory = () => unloweredTranslationKeyMarker;

export function bindTranslationKeyFactory<
  Catalog extends object,
>(): CreateTranslationKey<Catalog> {
  return unloweredTranslationKeyFactory as CreateTranslationKey<Catalog>;
}

type FiniteTuple<
  Value,
  Entries extends ReadonlyArray<Value>,
> = Entries extends readonly [Value, ...ReadonlyArray<Value>]
  ? number extends Entries["length"]
    ? never
    : Entries
  : never;

type FiniteRecord<
  Value,
  Entries extends Readonly<Record<string, Value>>,
> = string extends keyof Entries ? never : Entries;

type TranslationTupleResult<Keys extends ReadonlyArray<string>> = Readonly<{
  [Key in Keys[number]]: string;
}>;

type TranslationMatrixResult<
  Rows extends ReadonlyArray<string>,
  Columns extends ReadonlyArray<string>,
> = Readonly<{
  [Row in Rows[number]]: Readonly<{ [Column in Columns[number]]: string }>;
}>;

type TranslationRecordResult<Entries extends Readonly<Record<string, string>>> =
  Readonly<{ [Key in keyof Entries]: string }>;

export type TranslationFunctionFor<
  Catalog extends object,
  Namespace extends NamespacePaths<Catalog> | undefined = undefined,
  RichResult = RichRenderValue,
> = Namespace extends string
  ? NamespaceTranslationFunction<Catalog, Namespace, RichResult>
  : TranslationFunction<NamespaceNode<Catalog, Namespace>, RichResult>;

export interface NamespaceTranslationFunction<
  Catalog extends object,
  Namespace extends NamespacePaths<Catalog>,
  RichResult = RichRenderValue,
> extends TranslationFunction<NamespaceNode<Catalog, Namespace>, RichResult> {
  <const Key extends DeferredTranslationKeyFor<Catalog, Namespace>>(
    key: Key
  ): string;
}

export interface TranslationFunction<
  Catalog extends object,
  RichResult = RichRenderValue,
> {
  <
    const Key extends MessagePaths<Catalog, "text">,
    const Actual extends ValuesOf<TextAt<Catalog, Key>>,
  >(
    key: Key,
    ...values: StrictArgs<ValuesOf<TextAt<Catalog, Key>>, Actual>
  ): string;

  rich<
    const Key extends MessagePaths<Catalog, "rich">,
    const Descriptor extends RichAt<Catalog, Key>,
    const ActualValues extends ValuesOf<Descriptor>,
    const ActualComponents extends ComponentsOf<Descriptor, RichResult>,
  >(
    key: Key,
    input: StrictRichInput<
      Descriptor,
      ActualValues,
      ActualComponents,
      RichResult
    >
  ): RichResult;

  value<
    const Key extends MessagePaths<Catalog, "value">,
    const Descriptor extends ValueAt<Catalog, Key>,
    const Actual extends ValuesOf<Descriptor>,
  >(
    key: Key,
    ...values: StrictArgs<ValuesOf<Descriptor>, Actual>
  ): ResultOf<Descriptor>;

  map<const Keys extends ReadonlyArray<StaticTextMessagePaths<Catalog>>>(
    keys: FiniteTuple<StaticTextMessagePaths<Catalog>, Keys>
  ): TranslationTupleResult<Keys>;

  map<
    const Rows extends ReadonlyArray<string>,
    const Columns extends ReadonlyArray<string>,
  >(
    rows: FiniteTuple<string, Rows>,
    columns: FiniteTuple<string, Columns> &
      (JoinMatrixPaths<Rows, Columns> extends StaticTextMessagePaths<Catalog>
        ? unknown
        : never)
  ): TranslationMatrixResult<Rows, Columns>;

  map<
    const Entries extends Readonly<
      Record<string, StaticTextMessagePaths<Catalog>>
    >,
  >(
    entries: FiniteRecord<StaticTextMessagePaths<Catalog>, Entries>
  ): TranslationRecordResult<Entries>;
}

type JoinMatrixPaths<
  Rows extends ReadonlyArray<string>,
  Columns extends ReadonlyArray<string>,
> = `${Rows[number]}.${Columns[number]}`;

export type UseTranslations<
  Catalog extends object,
  RichResult = RichRenderValue,
> = <const Namespace extends NamespacePaths<Catalog> | undefined = undefined>(
  namespace?: Namespace
) => Readonly<{
  t: TranslationFunctionFor<Catalog, Namespace, RichResult>;
}>;

function loweredDescriptor(input: unknown): MessageDescriptor {
  if (!input || (typeof input !== "object" && typeof input !== "function")) {
    throw new TypeError(
      "Named translation key was not lowered to a generated descriptor"
    );
  }
  return input as MessageDescriptor;
}

const dynamicTextRegistries = new WeakSet<object>();

function dynamicRegistryRecord(input: unknown): Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(input)) ||
    Object.getOwnPropertySymbols(input).length > 0
  ) {
    throw new TypeError("Dynamic translation registry is malformed");
  }
  return input as Record<string, unknown>;
}

/** @internal Compiler lowering target. Application code must not call this. */
export function createCompilerDynamicTextRegistry(input: unknown): unknown {
  const source = dynamicRegistryRecord(input);
  const registry = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(source)
  )) {
    if (!("value" in descriptor)) {
      throw new TypeError("Dynamic translation registry cannot use accessors");
    }
    loweredDescriptor(descriptor.value);
    Object.defineProperty(registry, key, {
      enumerable: true,
      value: descriptor.value,
    });
  }
  Object.freeze(registry);
  dynamicTextRegistries.add(registry);
  return registry;
}

/** @internal Compiler lowering target. Application code must not call this. */
export function translateCompilerDynamicText(
  translator: unknown,
  input: unknown,
  namespace: unknown,
  registry: unknown
): string {
  if (typeof input !== "string") {
    throw new TypeError("Dynamic translation key must be a string");
  }
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new TypeError("Dynamic translation namespace must be a string");
  }
  if (
    !registry ||
    typeof registry !== "object" ||
    !dynamicTextRegistries.has(registry)
  ) {
    throw new TypeError(
      "Dynamic translation registry was not created by compiler lowering"
    );
  }
  const prefix = `${namespace}.`;
  const normalized = input.startsWith(prefix) ? input : `${prefix}${input}`;
  const entry = Object.getOwnPropertyDescriptor(registry, normalized);
  if (!entry) {
    throw new TypeError(
      "Named translation key is not registered for this namespace"
    );
  }
  if (!("value" in entry)) {
    throw new TypeError("Dynamic translation registry cannot use accessors");
  }
  if (typeof translator !== "function") {
    throw new TypeError("Dynamic translation target must be a function");
  }
  return Reflect.apply(translator, undefined, [entry.value]) as string;
}

export type ParseTranslationKey<Catalog extends object> = <
  const Namespace extends NamespacePaths<Catalog>,
>(
  namespace: Namespace,
  input: unknown
) => DeferredTranslationKeyFor<Catalog, Namespace> | undefined;

const unloweredTranslationKeyParser = (): never => {
  throw new TypeError(
    "Translation key parser was not lowered by the Mirai Intl compiler"
  );
};

export function bindTranslationKeyParser<
  Catalog extends object,
>(): ParseTranslationKey<Catalog> {
  return unloweredTranslationKeyParser as ParseTranslationKey<Catalog>;
}

/** @internal Compiler lowering target. Application code must not call this. */
export function parseCompilerTranslationKey(
  input: unknown,
  namespace: unknown,
  registry: unknown
): string | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new TypeError("Translation key namespace must be a string");
  }
  if (
    !registry ||
    typeof registry !== "object" ||
    !dynamicTextRegistries.has(registry)
  ) {
    throw new TypeError(
      "Translation key registry was not created by compiler lowering"
    );
  }
  const prefix = `${namespace}.`;
  const normalized = input.startsWith(prefix) ? input : `${prefix}${input}`;
  const entry = Object.getOwnPropertyDescriptor(registry, normalized);
  if (!entry) {
    return undefined;
  }
  if (!("value" in entry)) {
    throw new TypeError("Dynamic translation registry cannot use accessors");
  }
  return normalized;
}

export function createTranslationFunction<
  Catalog extends object = object,
  Namespace extends NamespacePaths<Catalog> | undefined = undefined,
  RichResult = RichRenderValue,
>(
  runtime: StrictIntlRuntime
): TranslationFunctionFor<Catalog, Namespace, RichResult> {
  const translate = (descriptor: unknown, ...values: Array<unknown>): string =>
    Reflect.apply(runtime.t, runtime, [
      loweredDescriptor(descriptor) as AnyTextDescriptor,
      ...values,
    ]) as string;
  const rich = (
    descriptor: unknown,
    ...input: Array<unknown>
  ): RichRenderValue =>
    Reflect.apply(runtime.rich, runtime, [
      loweredDescriptor(descriptor) as AnyRichDescriptor,
      ...input,
    ]);
  const value = (descriptor: unknown, ...values: Array<unknown>): unknown =>
    Reflect.apply(runtime.value, runtime, [
      loweredDescriptor(descriptor) as AnyValueDescriptor,
      ...values,
    ]);
  const map = (): never => {
    throw new TypeError(
      "Translation map was not lowered by the Mirai Intl compiler"
    );
  };
  Object.defineProperties(translate, {
    map: { enumerable: true, value: map },
    rich: { enumerable: true, value: rich },
    value: { enumerable: true, value },
  });
  return Object.freeze(translate) as unknown as TranslationFunctionFor<
    Catalog,
    Namespace,
    RichResult
  >;
}
