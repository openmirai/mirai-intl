// @mirai-intl-selector {"contentHash":"sha256:68eb134a0643f7841f282d9201d689c5c1ed36af72c070e4b51abae6c8d0592f","directory":"builds/68eb134a0643f7841f282d9201d689c5c1ed36af72c070e4b51abae6c8d0592f","schemaVersion":1}
import { bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl-runtime";
import type { CatalogContract as BoundCatalogContract } from "./builds/68eb134a0643f7841f282d9201d689c5c1ed36af72c070e4b51abae6c8d0592f/catalog.schema.gen.js";
export type { CatalogContract } from "./builds/68eb134a0643f7841f282d9201d689c5c1ed36af72c070e4b51abae6c8d0592f/catalog.schema.gen.js";
export type { CatalogLocale } from "./builds/68eb134a0643f7841f282d9201d689c5c1ed36af72c070e4b51abae6c8d0592f/catalog.resources.gen.mjs";
export const createTranslationKey = /* @__PURE__ */ bindTranslationKeyFactory<BoundCatalogContract>();
export const parseTranslationKey = /* @__PURE__ */ bindTranslationKeyParser<BoundCatalogContract>();
export { catalogManifest } from "./builds/68eb134a0643f7841f282d9201d689c5c1ed36af72c070e4b51abae6c8d0592f/catalog.manifest.gen.mjs";
export { isCatalogLocale, loadCatalogResource } from "./builds/68eb134a0643f7841f282d9201d689c5c1ed36af72c070e4b51abae6c8d0592f/catalog.resources.gen.mjs";
