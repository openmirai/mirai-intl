import { readFile, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type {
  IntlCheckCanonicalJsonV2,
  IntlCheckFileIdentityV2,
  IntlCheckProviderResolutionV2,
} from "@openmirai/intl-abi";

import { compareCanonicalStrings, sha256 } from "./canonical";

export type ProviderResolutionInput = Readonly<{
  from: string;
  packageName: string | null;
  packageVersion: string | null;
  specifier: string;
}>;

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".d.ts",
  ".mts",
  ".d.mts",
  ".cts",
  ".d.cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

function confinedPath(root: string, file: string): string {
  const path = relative(root, file).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("Provider resolution path escapes its workspace root");
  }
  return path.normalize("NFC");
}

async function regularFile(path: string): Promise<boolean> {
  const entry = await stat(path).catch(() => undefined);
  return Boolean(entry?.isFile());
}

async function directory(path: string): Promise<boolean> {
  const entry = await stat(path).catch(() => undefined);
  return Boolean(entry?.isDirectory());
}

function packageSpecifier(
  specifier: string
): Readonly<{ name: string; subpath: string }> {
  const parts = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const name = scoped ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
  return {
    name,
    subpath: parts.slice(scoped ? 2 : 1).join("/"),
  };
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readPackageJson(
  path: string
): Promise<Readonly<{ bytes: string; value: Record<string, unknown> }>> {
  const bytes = await readFile(path, "utf8");
  const value = jsonObject(JSON.parse(bytes) as unknown);
  if (!value) {
    throw new Error(
      `Provider package manifest must contain an object: ${path}`
    );
  }
  return { bytes, value };
}

function packageTarget(value: unknown, subpath: string): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = packageTarget(entry, subpath);
      if (target) {
        return target;
      }
    }
    return undefined;
  }
  const object = jsonObject(value);
  if (!object) {
    return undefined;
  }
  const subpathKeys = Object.keys(object).filter((key) => key.startsWith("."));
  if (subpathKeys.length > 0) {
    const key = subpath === "" ? "." : `./${subpath}`;
    const exact = object[key];
    if (exact !== undefined) {
      return packageTarget(exact, subpath);
    }
    for (const pattern of subpathKeys.toSorted(compareCanonicalStrings)) {
      const star = pattern.indexOf("*");
      if (
        star === -1 ||
        !key.startsWith(pattern.slice(0, star)) ||
        !key.endsWith(pattern.slice(star + 1))
      ) {
        continue;
      }
      const replacement = key.slice(
        star,
        key.length - (pattern.length - star - 1)
      );
      const target = packageTarget(object[pattern], subpath);
      return target?.replaceAll("*", replacement);
    }
    return undefined;
  }
  for (const condition of ["types", "import", "default", "require"]) {
    if (object[condition] !== undefined) {
      const target = packageTarget(object[condition], subpath);
      if (target) {
        return target;
      }
    }
  }
  return undefined;
}

function substitutedCandidates(path: string): ReadonlyArray<string> {
  if (
    path.endsWith(".d.mts") ||
    path.endsWith(".d.cts") ||
    path.endsWith(".d.ts")
  ) {
    return [path];
  }
  if (path.endsWith(".mjs")) {
    const base = path.slice(0, -4);
    return [`${base}.mts`, `${base}.d.mts`, path];
  }
  if (path.endsWith(".cjs")) {
    const base = path.slice(0, -4);
    return [`${base}.cts`, `${base}.d.cts`, path];
  }
  if (path.endsWith(".js")) {
    const base = path.slice(0, -3);
    return [`${base}.ts`, `${base}.tsx`, `${base}.d.ts`, path];
  }
  if (path.endsWith(".jsx")) {
    const base = path.slice(0, -4);
    return [`${base}.tsx`, `${base}.ts`, `${base}.d.ts`, path];
  }
  if (extname(path) !== "") {
    return [path];
  }
  return SOURCE_EXTENSIONS.map((extension) => `${path}${extension}`);
}

async function resolveFile(path: string): Promise<string | undefined> {
  for (const candidate of substitutedCandidates(path)) {
    if (await regularFile(candidate)) {
      return candidate;
    }
  }
  if (!(await directory(path))) {
    return undefined;
  }
  const manifestPath = join(path, "package.json");
  if (await regularFile(manifestPath)) {
    const manifest = await readPackageJson(manifestPath);
    const target =
      (typeof manifest.value.types === "string" && manifest.value.types) ||
      (typeof manifest.value.typings === "string" && manifest.value.typings) ||
      (typeof manifest.value.main === "string" && manifest.value.main);
    if (target) {
      const resolved = await resolveFile(resolve(path, target));
      if (resolved) {
        return resolved;
      }
    }
  }
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = join(path, `index${extension}`);
    if (await regularFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function pathMappings(
  normalizedOptions: Readonly<Record<string, IntlCheckCanonicalJsonV2>>
): Readonly<Record<string, IntlCheckCanonicalJsonV2>> {
  return (
    (jsonObject(normalizedOptions.paths) as
      | Readonly<Record<string, IntlCheckCanonicalJsonV2>>
      | undefined) ?? {}
  );
}

async function resolveMapped(
  workspaceRoot: string,
  specifier: string,
  normalizedOptions: Readonly<Record<string, IntlCheckCanonicalJsonV2>>
): Promise<string | undefined> {
  const baseUrl =
    typeof normalizedOptions.baseUrl === "string"
      ? resolve(workspaceRoot, normalizedOptions.baseUrl)
      : workspaceRoot;
  for (const pattern of Object.keys(pathMappings(normalizedOptions)).toSorted(
    compareCanonicalStrings
  )) {
    const star = pattern.indexOf("*");
    const matches =
      star === -1
        ? specifier === pattern
        : specifier.startsWith(pattern.slice(0, star)) &&
          specifier.endsWith(pattern.slice(star + 1));
    if (!matches) {
      continue;
    }
    const replacement =
      star === -1
        ? ""
        : specifier.slice(star, specifier.length - (pattern.length - star - 1));
    const targets = pathMappings(normalizedOptions)[pattern];
    if (!Array.isArray(targets)) {
      continue;
    }
    for (const target of targets) {
      if (typeof target !== "string") {
        continue;
      }
      const resolved = await resolveFile(
        resolve(baseUrl, target.replaceAll("*", replacement))
      );
      if (resolved) {
        return resolved;
      }
    }
  }
  return undefined;
}

async function locatePackage(
  workspaceRoot: string,
  source: string,
  name: string
): Promise<string | undefined> {
  let currentDirectory = dirname(resolve(workspaceRoot, source));
  const boundary = resolve(workspaceRoot);
  for (;;) {
    const root = join(currentDirectory, "node_modules", name);
    if (await directory(root)) {
      return root;
    }
    if (
      currentDirectory === boundary ||
      !currentDirectory.startsWith(`${boundary}${sep}`)
    ) {
      return undefined;
    }
    currentDirectory = dirname(currentDirectory);
  }
}

async function resolvePackage(
  workspaceRoot: string,
  source: string,
  specifier: string
): Promise<Readonly<{ manifest: string; root: string }> | undefined> {
  const identity = packageSpecifier(specifier);
  const root = await locatePackage(workspaceRoot, source, identity.name);
  if (!root) {
    return undefined;
  }
  const manifest = join(root, "package.json");
  const parsed = await readPackageJson(manifest);
  const exportsTarget = packageTarget(parsed.value.exports, identity.subpath);
  let legacyTarget = "./index";
  if (identity.subpath !== "") {
    legacyTarget = `./${identity.subpath}`;
  } else if (typeof parsed.value.types === "string") {
    legacyTarget = parsed.value.types;
  } else if (typeof parsed.value.typings === "string") {
    legacyTarget = parsed.value.typings;
  } else if (typeof parsed.value.main === "string") {
    legacyTarget = parsed.value.main;
  }
  const target =
    exportsTarget ??
    (legacyTarget.startsWith("./") ? legacyTarget : `./${legacyTarget}`);
  if (!target.startsWith("./")) {
    return undefined;
  }
  const resolved = await resolveFile(resolve(root, target));
  return resolved ? { manifest, root: resolved } : undefined;
}

export async function reconstructProviderResolution(
  workspaceRoot: string,
  normalizedOptions: Readonly<Record<string, IntlCheckCanonicalJsonV2>>,
  resolution: Pick<
    IntlCheckProviderResolutionV2,
    "from" | "packageName" | "packageVersion" | "specifier"
  >
): Promise<
  Readonly<{
    controlFiles: ReadonlyArray<IntlCheckFileIdentityV2>;
    root: string;
  }>
> {
  const root = resolve(workspaceRoot);
  let resolved: string | undefined;
  let manifest: string | undefined;
  if (resolution.specifier.startsWith(".")) {
    resolved = await resolveFile(
      resolve(root, dirname(resolution.from), resolution.specifier)
    );
  } else {
    resolved = await resolveMapped(
      root,
      resolution.specifier,
      normalizedOptions
    );
    if (!resolved) {
      const packageResolution = await resolvePackage(
        root,
        resolution.from,
        resolution.specifier
      );
      resolved = packageResolution?.root;
      manifest = packageResolution?.manifest;
    }
  }
  if (!resolved) {
    throw new Error(
      `Mirai Intl provider resolution is stale: ${resolution.specifier}`
    );
  }
  const controlFiles = manifest
    ? [
        {
          hash: sha256(await readFile(manifest, "utf8")),
          path: confinedPath(root, manifest),
        },
      ]
    : [];
  if (manifest) {
    const parsed = await readPackageJson(manifest);
    if (
      parsed.value.name !== resolution.packageName ||
      parsed.value.version !== resolution.packageVersion
    ) {
      throw new Error(
        `Mirai Intl provider package identity is stale: ${resolution.specifier}`
      );
    }
  } else if (
    resolution.packageName !== null ||
    resolution.packageVersion !== null
  ) {
    throw new Error(
      `Mirai Intl provider package identity is stale: ${resolution.specifier}`
    );
  }
  return {
    controlFiles,
    root: confinedPath(root, resolved),
  };
}

export async function captureProviderResolutions(
  workspaceRoot: string,
  normalizedOptions: Readonly<Record<string, IntlCheckCanonicalJsonV2>>,
  expectedRoot: string,
  resolutions: ReadonlyArray<ProviderResolutionInput>
): Promise<ReadonlyArray<IntlCheckProviderResolutionV2>> {
  return Promise.all(
    resolutions
      .toSorted((left, right) =>
        compareCanonicalStrings(
          `${left.from}\u0000${left.specifier}`,
          `${right.from}\u0000${right.specifier}`
        )
      )
      .map(async (resolution) => {
        const current = await reconstructProviderResolution(
          workspaceRoot,
          normalizedOptions,
          resolution
        );
        if (current.root !== expectedRoot) {
          throw new Error(
            `Semantic provider resolution changed while source analysis ran: ${resolution.specifier}`
          );
        }
        return {
          ...resolution,
          controlFiles: current.controlFiles,
        };
      })
  );
}
