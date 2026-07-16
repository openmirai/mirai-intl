// @mirai-intl-selector {"contentHash":"sha256:1f32a74a5120a1c5bec2a5d147c4c435fa7efdc291a167628f3676672d692a18","directory":"builds/1f32a74a5120a1c5bec2a5d147c4c435fa7efdc291a167628f3676672d692a18","schemaVersion":1}
import { bindTranslationKeyFactory, bindTranslationKeyParser } from "@openmirai/intl-runtime";
import type { CatalogContract as BoundCatalogContract } from "./builds/1f32a74a5120a1c5bec2a5d147c4c435fa7efdc291a167628f3676672d692a18/catalog.schema.gen.js";
export type { CatalogContract } from "./builds/1f32a74a5120a1c5bec2a5d147c4c435fa7efdc291a167628f3676672d692a18/catalog.schema.gen.js";
export type { CatalogLocale } from "./builds/1f32a74a5120a1c5bec2a5d147c4c435fa7efdc291a167628f3676672d692a18/catalog.resources.gen.mjs";
export const createTranslationKey = /* @__PURE__ */ bindTranslationKeyFactory<BoundCatalogContract>();
export const parseTranslationKey = /* @__PURE__ */ bindTranslationKeyParser<BoundCatalogContract>();
export { catalogManifest } from "./builds/1f32a74a5120a1c5bec2a5d147c4c435fa7efdc291a167628f3676672d692a18/catalog.manifest.gen.mjs";
export { isCatalogLocale, loadCatalogResource } from "./builds/1f32a74a5120a1c5bec2a5d147c4c435fa7efdc291a167628f3676672d692a18/catalog.resources.gen.mjs";
