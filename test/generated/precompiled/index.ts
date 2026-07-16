// @mirai-intl-selector {"contentHash":"sha256:8099b536aa02ace77eea29dc3dce0a22d3bfc829af0ad2165215f64a0035bcc5","directory":"builds/8099b536aa02ace77eea29dc3dce0a22d3bfc829af0ad2165215f64a0035bcc5","schemaVersion":1}
import { bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl-runtime";
import type { ArgumentFreeTextKeysFor, NamespacePaths } from "@openmirai/intl-runtime";
import type { CatalogContract as BoundCatalogContract } from "./builds/8099b536aa02ace77eea29dc3dce0a22d3bfc829af0ad2165215f64a0035bcc5/catalog.schema.gen.js";
export type { CatalogContract } from "./builds/8099b536aa02ace77eea29dc3dce0a22d3bfc829af0ad2165215f64a0035bcc5/catalog.schema.gen.js";
export type { CatalogLocale } from "./builds/8099b536aa02ace77eea29dc3dce0a22d3bfc829af0ad2165215f64a0035bcc5/catalog.resources.gen.mjs";
export type TranslationNamespace = NamespacePaths<BoundCatalogContract>;
export type TranslationKey<Namespace extends TranslationNamespace> = ArgumentFreeTextKeysFor<BoundCatalogContract, Namespace>;
export const createTranslationKey = /* @__PURE__ */ bindTranslationKeyFactory<BoundCatalogContract>();
export const parseTranslationKey = /* @__PURE__ */ bindTranslationKeyParser<BoundCatalogContract>();
export { catalogManifest } from "./builds/8099b536aa02ace77eea29dc3dce0a22d3bfc829af0ad2165215f64a0035bcc5/catalog.manifest.gen.mjs";
export { isCatalogLocale, loadCatalogResource } from "./builds/8099b536aa02ace77eea29dc3dce0a22d3bfc829af0ad2165215f64a0035bcc5/catalog.resources.gen.mjs";
