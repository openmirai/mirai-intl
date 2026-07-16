import type {
  DescriptorKind,
  JsonValue,
  ObjectSchema,
  RendererCapabilityId,
  Sha256,
  ValueSchema,
} from "@openmirai/intl-abi";

export type MessageSource = Readonly<{
  formatterIds?: ReadonlyArray<string>;
  kind: DescriptorKind;
  path: string;
  provenance: string;
  resultSchema: ValueSchema;
  tags?: ReadonlyArray<string>;
  translations: Readonly<Record<string, JsonValue>>;
  valuesSchema: ObjectSchema;
}>;

export type IntlFragmentContent = Readonly<{
  id: string;
  locales: ReadonlyArray<string>;
  messages: ReadonlyArray<MessageSource>;
  version: string;
}>;

export type IntlFragment = IntlFragmentContent & Readonly<{ hash: Sha256 }>;

export type MountedFragment = Readonly<{
  at: ReadonlyArray<string>;
  fragment: IntlFragment;
}>;

export type ReplacementDeclaration = Readonly<{
  base: Readonly<{
    fragmentId: string;
    hash: Sha256;
    version: string;
  }>;
  exactKey: string;
  provenance: Readonly<{
    decision: string;
    owner: string;
    source: string;
  }>;
  reason: string;
}>;

export type CatalogSource = Readonly<{
  buildId: string;
  catalogPackage: string;
  formatterVersions?: Readonly<Record<string, string>>;
  fragments?: ReadonlyArray<MountedFragment>;
  id: string;
  locales: ReadonlyArray<string>;
  messages: ReadonlyArray<MessageSource>;
  rendererCapabilityId: RendererCapabilityId;
  replacements?: ReadonlyArray<ReplacementDeclaration>;
  sourceLocale: string;
}>;

export function defineIntlFragment<const Fragment extends IntlFragment>(
  fragment: Fragment
): Fragment {
  return fragment;
}

export function mount(
  fragment: IntlFragment,
  options: Readonly<{ at: ReadonlyArray<string> }>
): MountedFragment {
  return { at: options.at, fragment };
}

export function defineIntlConfig<const Source extends CatalogSource>(
  source: Source
): Source {
  return source;
}

export function replaceIntlMessage(
  declaration: ReplacementDeclaration
): ReplacementDeclaration {
  return declaration;
}
