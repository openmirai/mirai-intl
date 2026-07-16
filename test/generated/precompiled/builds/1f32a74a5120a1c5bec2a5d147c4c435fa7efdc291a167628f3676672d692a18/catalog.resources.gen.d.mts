import type { JsonObject } from "@openmirai/intl-abi";

export type CatalogLocale="en" | "th";
export type CatalogResource=Readonly<{readonly translation:JsonObject}>;
export declare function isCatalogLocale(locale:unknown):locale is CatalogLocale;
export declare function loadCatalogResource(locale:string):Promise<CatalogResource>;
