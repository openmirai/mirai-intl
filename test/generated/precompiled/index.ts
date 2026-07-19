// @mirai-intl-selector {"contentHash":"sha256:53076d5871e90444936bedabfecd36f073e3bfc57557928f8f4c1fd87c4ff8ed","directory":"builds/53076d5871e90444936bedabfecd36f073e3bfc57557928f8f4c1fd87c4ff8ed","schemaVersion":1}
import { bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl-runtime";
import type { ArgumentFreeTextKeysFor, NamespacePaths } from "@openmirai/intl-runtime";
import type { CatalogContract as BoundCatalogContract } from "./builds/53076d5871e90444936bedabfecd36f073e3bfc57557928f8f4c1fd87c4ff8ed/catalog.schema.gen.js";
export type { CatalogContract } from "./builds/53076d5871e90444936bedabfecd36f073e3bfc57557928f8f4c1fd87c4ff8ed/catalog.schema.gen.js";
export type { CatalogLocale } from "./builds/53076d5871e90444936bedabfecd36f073e3bfc57557928f8f4c1fd87c4ff8ed/catalog.resources.gen.mjs";
export type TranslationNamespace = NamespacePaths<BoundCatalogContract>;
export type TranslationKey<Namespace extends TranslationNamespace> = ArgumentFreeTextKeysFor<BoundCatalogContract, Namespace>;
export const createTranslationKey = /* @__PURE__ */ bindTranslationKeyFactory<BoundCatalogContract>();
export const parseTranslationKey = /* @__PURE__ */ bindTranslationKeyParser<BoundCatalogContract>();
export { catalogManifest } from "./builds/53076d5871e90444936bedabfecd36f073e3bfc57557928f8f4c1fd87c4ff8ed/catalog.manifest.gen.mjs";
export { isCatalogLocale, loadCatalogResource } from "./builds/53076d5871e90444936bedabfecd36f073e3bfc57557928f8f4c1fd87c4ff8ed/catalog.resources.gen.mjs";
