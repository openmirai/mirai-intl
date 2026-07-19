const catalogResourceLoaders = new Map([
  ["en", () => import("./catalog.resource.0.gen.mjs").then(({ catalogResource }) => catalogResource)],
  ["th", () => import("./catalog.resource.1.gen.mjs").then(({ catalogResource }) => catalogResource)],
]);

export function isCatalogLocale(locale) {
  return typeof locale === "string" && catalogResourceLoaders.has(locale);
}

export async function loadCatalogResource(locale) {
  if (!isCatalogLocale(locale)) {
    throw new RangeError(`Unknown catalog locale ${typeof locale === "string" ? JSON.stringify(locale) : typeof locale}`);
  }
  const load = catalogResourceLoaders.get(locale);
  if (!load) {
    throw new RangeError(`Unknown catalog locale ${JSON.stringify(locale)}`);
  }
  return load();
}
