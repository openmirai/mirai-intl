import { compareCanonicalStrings } from "./canonical";

export type SemanticProviderResolution = Readonly<{
  controlFiles: ReadonlyArray<
    Readonly<{
      hash: `sha256:${string}`;
      path: string;
    }>
  >;
  from: string;
  packageName: string | null;
  packageVersion: string | null;
  probes: ReadonlyArray<
    Readonly<{
      kind: "directory" | "file";
      path: string;
      present: boolean;
    }>
  >;
  realpaths: ReadonlyArray<
    Readonly<{
      path: string;
      target: string;
    }>
  >;
  specifier: string;
}>;

export type SemanticProvider = Readonly<{
  declarations: ReadonlyArray<
    Readonly<{ hash: `sha256:${string}`; path: string }>
  >;
  kind: "ambient" | "external" | "generated" | "workspace";
  resolutions: ReadonlyArray<SemanticProviderResolution>;
  root: string;
}>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => [key, stableValue(entry)] as const)
      .toSorted(([left], [right]) => compareCanonicalStrings(left, right));
  }
  return value;
}

export function mergeSemanticProviders(
  providers: ReadonlyArray<SemanticProvider>
): ReadonlyArray<SemanticProvider> {
  const merged = new Map<
    string,
    {
      declarations: Map<string, SemanticProvider["declarations"][number]>;
      kind: SemanticProvider["kind"];
      resolutions: Map<string, SemanticProviderResolution>;
      root: string;
    }
  >();
  const stableIdentity = (value: unknown): string =>
    JSON.stringify(stableValue(value));
  for (const provider of providers) {
    const identity = `${provider.root}\u0000${provider.kind}`;
    const entry = merged.get(identity) ?? {
      declarations: new Map(),
      kind: provider.kind,
      resolutions: new Map(),
      root: provider.root,
    };
    for (const declaration of provider.declarations) {
      const existing = entry.declarations.get(declaration.path);
      if (existing && existing.hash !== declaration.hash) {
        throw new Error(
          `Conflicting semantic provider declaration identity: ${declaration.path}`
        );
      }
      entry.declarations.set(declaration.path, declaration);
    }
    for (const resolution of provider.resolutions) {
      const resolutionIdentity = `${resolution.from}\u0000${resolution.specifier}`;
      const existing = entry.resolutions.get(resolutionIdentity);
      if (existing && stableIdentity(existing) !== stableIdentity(resolution)) {
        throw new Error(
          `Conflicting semantic provider resolution identity: ${resolutionIdentity}`
        );
      }
      entry.resolutions.set(resolutionIdentity, resolution);
    }
    merged.set(identity, entry);
  }
  return [...merged.values()]
    .map((provider) => ({
      declarations: [...provider.declarations.values()].toSorted(
        (left, right) => compareCanonicalStrings(left.path, right.path)
      ),
      kind: provider.kind,
      resolutions: [...provider.resolutions.values()].toSorted((left, right) =>
        compareCanonicalStrings(
          `${left.from}\u0000${left.specifier}`,
          `${right.from}\u0000${right.specifier}`
        )
      ),
      root: provider.root,
    }))
    .toSorted((left, right) =>
      compareCanonicalStrings(
        `${left.root}\u0000${left.kind}`,
        `${right.root}\u0000${right.kind}`
      )
    );
}
