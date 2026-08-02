const shim = new URL("./authorization-typescript-shim.mjs", import.meta.url)
  .href;
const mutationShim = new URL(
  "./authorization-mutation-fs-shim.mjs",
  import.meta.url
).href;

export function resolve(specifier, context, nextResolve) {
  if (
    specifier === "typescript" &&
    context.parentURL?.includes("/packages/compiler/dist/")
  ) {
    return { shortCircuit: true, url: shim };
  }
  if (
    specifier === "node:fs/promises" &&
    process.env.MIRAI_INTL_BENCHMARK_MUTATION_TARGET &&
    context.parentURL?.includes("/packages/compiler/dist/")
  ) {
    return { shortCircuit: true, url: mutationShim };
  }
  return nextResolve(specifier, context);
}
