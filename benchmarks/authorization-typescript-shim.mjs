import { pathToFileURL } from "node:url";

const typescriptPath = process.env.MIRAI_INTL_BENCHMARK_TYPESCRIPT;
if (!typescriptPath) {
  throw new Error("MIRAI_INTL_BENCHMARK_TYPESCRIPT is required");
}
const imported = await import(pathToFileURL(typescriptPath).href);
const original = imported.default ?? imported;
const wrapped = Object.create(original);
const counters = globalThis[Symbol.for("mirai-intl.benchmark.counters")];
if (!counters) {
  throw new Error("Mirai Intl benchmark counters are unavailable");
}

for (const name of Object.keys(counters)) {
  const factory = original[name];
  if (typeof factory !== "function") {
    continue;
  }
  Object.defineProperty(wrapped, name, {
    value(...args) {
      counters[name] += 1;
      return Reflect.apply(factory, original, args);
    },
  });
}

export default wrapped;
