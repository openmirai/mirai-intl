import type {
  DescriptorKind,
  FormatVersion,
  RendererCapabilityId,
  RuntimeAbi,
  Sha256,
} from "./descriptor";
import type { JsonValue } from "./json";
import type { ObjectSchema, ValueSchema } from "./schema";

export type IrNode =
  | Readonly<{ type: "argument"; name: string }>
  | Readonly<{ style?: string; type: "date"; name: string }>
  | Readonly<{ value: string; type: "literal" }>
  | Readonly<{ style?: string; type: "number"; name: string }>
  | Readonly<{ type: "pound" }>
  | Readonly<{
      name: string;
      options: Readonly<Record<string, ReadonlyArray<IrNode>>>;
      type: "select";
    }>
  | Readonly<{
      name: string;
      offset: number;
      options: Readonly<Record<string, ReadonlyArray<IrNode>>>;
      pluralType: "cardinal" | "ordinal";
      type: "plural";
    }>
  | Readonly<{ children: ReadonlyArray<IrNode>; name: string; type: "tag" }>
  | Readonly<{ style?: string; type: "time"; name: string }>;

export type RuntimeMessage = Readonly<{
  argumentSchema: ObjectSchema;
  formatterIds: ReadonlyArray<string>;
  id: string;
  kind: DescriptorKind;
  localeNodes?: Readonly<Record<string, ReadonlyArray<IrNode>>>;
  localeValues?: Readonly<Record<string, JsonValue>>;
  path: string;
  provenanceRef: string;
  resultSchema: ValueSchema;
  tags: ReadonlyArray<string>;
  validatorId: number;
}>;

export type CatalogManifest = Readonly<{
  buildId: string;
  buildToken: string;
  capabilitySetHash: Sha256;
  catalogId: string;
  catalogPackage: string;
  compilerVersion: string;
  formatVersion: FormatVersion;
  formatterVersions: Readonly<Record<string, string>>;
  hash: Sha256;
  localeHashes: Readonly<Record<string, Sha256>>;
  locales: ReadonlyArray<string>;
  rendererCapabilityId: RendererCapabilityId;
  runtimeAbi: RuntimeAbi;
  sourceLocale: string;
}>;

export type RuntimeCatalog = Readonly<{
  manifest: CatalogManifest;
  messages: ReadonlyArray<RuntimeMessage>;
}>;
