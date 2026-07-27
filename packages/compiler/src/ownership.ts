import { lstat, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type {
  IntlCheckCanonicalJsonV2,
  IntlCheckProjectV1,
  IntlCheckProjectV2,
} from "@openmirai/intl-abi";
import ts from "typescript";

import { sha256 } from "./canonical";

export type OwnedSourceFile = Readonly<{
  absolute: string;
  file: string;
  owner: string;
}>;

export type ConventionSourceUniverse = Readonly<{
  files: ReadonlyArray<OwnedSourceFile>;
  projects: ReadonlyArray<
    Omit<IntlCheckProjectV2, "configManifestHash" | "normalizedOptionsHash">
  >;
  workspaceRoot: string;
}>;

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;

function packageRelativePath(root: string, file: string): string {
  const path = relative(root, file).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("Check-project file must remain within its package root");
  }
  return path;
}

function receiptRelativePath(root: string, file: string): string {
  const path = relative(root, file).split(sep).join("/");
  if (!path || isAbsolute(path)) {
    throw new Error("Check-project source path must be relative");
  }
  return path;
}

function isWithin(root: string, path: string): boolean {
  const candidate = relative(root, path);
  return (
    candidate === "" ||
    (!candidate.startsWith(`..${sep}`) && !isAbsolute(candidate))
  );
}

async function findWorkspaceRoot(root: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  let directory = canonicalRoot;
  while (true) {
    const marker = join(directory, "pnpm-workspace.yaml");
    const entry = await lstat(marker).catch(() => undefined);
    if (entry) {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error("pnpm-workspace.yaml must be a regular file");
      }
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return canonicalRoot;
    }
    directory = parent;
  }
}

async function projectFiles(
  root: string,
  workspaceRoot: string,
  project: IntlCheckProjectV1
): Promise<
  Readonly<{
    evidence: Omit<
      IntlCheckProjectV2,
      "configManifestHash" | "normalizedOptionsHash"
    >;
    files: ReadonlySet<string>;
  }>
> {
  const configPath = resolve(root, project.path);
  if (packageRelativePath(root, configPath) !== project.path) {
    throw new Error(`Check project ${project.path} escapes its package root`);
  }
  const configEntry = await lstat(configPath).catch(() => undefined);
  if (!configEntry || configEntry.isSymbolicLink() || !configEntry.isFile()) {
    throw new Error(
      `Check project ${project.path} must be a readable regular file`
    );
  }
  const canonicalConfigPath = await realpath(configPath);
  if (!isWithin(workspaceRoot, canonicalConfigPath)) {
    throw new Error(`Check project ${project.path} escapes its workspace root`);
  }
  const configReads = new Set<string>();
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => undefined,
    readFile(path) {
      configReads.add(resolve(path));
      return ts.sys.readFile(path);
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(
    canonicalConfigPath,
    {},
    host
  );
  if (!parsed || parsed.errors.length > 0) {
    throw new Error(
      `Unable to parse check project ${project.path}: ${ts.flattenDiagnosticMessageText(parsed?.errors[0]?.messageText ?? "unknown error", " ")}`
    );
  }
  const files = await Promise.all(
    parsed.fileNames.map(async (file) => {
      const entry = await lstat(file).catch(() => undefined);
      if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(
          `Check project ${project.path} source ${file} must be a readable regular file`
        );
      }
      const canonical = await realpath(file);
      if (!isWithin(workspaceRoot, canonical)) {
        throw new Error(
          `Check project ${project.path} source ${file} escapes its workspace root`
        );
      }
      return canonical;
    })
  );
  const configPaths = new Set<string>([
    canonicalConfigPath,
    ...[...configReads].filter((path) => path.endsWith(".json")),
  ]);
  const pending = [canonicalConfigPath];
  const edges = new Map<
    string,
    Readonly<{
      extends: ReadonlyArray<string>;
      references: ReadonlyArray<string>;
    }>
  >();
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || edges.has(path)) {
      continue;
    }
    const transitiveEntry = await lstat(path).catch(() => undefined);
    if (
      !transitiveEntry ||
      transitiveEntry.isSymbolicLink() ||
      !transitiveEntry.isFile() ||
      !isWithin(workspaceRoot, await realpath(path))
    ) {
      throw new Error(
        `Check project ${project.path} transitive config must be a confined regular file`
      );
    }
    const source = await readFile(path, "utf8");
    const result = ts.parseConfigFileTextToJson(path, source);
    if (result.error || !result.config || typeof result.config !== "object") {
      throw new Error(`Unable to parse transitive check config ${path}`);
    }
    const config = result.config as {
      extends?: unknown;
      references?: unknown;
    };
    const resolveConfig = (specifier: string): string => {
      if (!specifier.startsWith(".") && !isAbsolute(specifier)) {
        try {
          return resolve(createRequire(path).resolve(specifier));
        } catch {
          // Continue to the confined path candidates for an actionable error.
        }
      }
      const direct = resolve(dirname(path), specifier);
      const candidates = [
        direct,
        direct.endsWith(".json") ? direct : `${direct}.json`,
        join(direct, "tsconfig.json"),
      ];
      const found = candidates.find(
        (candidate) =>
          configPaths.has(candidate) || ts.sys.fileExists(candidate)
      );
      if (!found) {
        throw new Error(
          `Check project ${project.path} has an unresolved transitive config ${specifier}`
        );
      }
      return found;
    };
    let extendsSpecifiers: ReadonlyArray<string> = [];
    if (typeof config.extends === "string") {
      extendsSpecifiers = [config.extends];
    } else if (Array.isArray(config.extends)) {
      extendsSpecifiers = config.extends.filter(
        (value): value is string => typeof value === "string"
      );
    }
    const referenceSpecifiers = Array.isArray(config.references)
      ? config.references.flatMap((entry) =>
          entry &&
          typeof entry === "object" &&
          typeof Reflect.get(entry, "path") === "string"
            ? [Reflect.get(entry, "path") as string]
            : []
        )
      : [];
    const extendsPaths = extendsSpecifiers.map(resolveConfig);
    const referencePaths = referenceSpecifiers.map(resolveConfig);
    edges.set(path, {
      extends: extendsPaths,
      references: referencePaths,
    });
    for (const dependency of [...extendsPaths, ...referencePaths]) {
      configPaths.add(dependency);
      pending.push(dependency);
    }
  }
  const configManifest = await Promise.all(
    [...edges]
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(async ([path, edge]) => ({
        extends: edge.extends
          .map((entry) => receiptRelativePath(workspaceRoot, entry))
          .toSorted(),
        hash: sha256(await readFile(path, "utf8")),
        path: receiptRelativePath(workspaceRoot, path),
        references: edge.references
          .map((entry) => receiptRelativePath(workspaceRoot, entry))
          .toSorted(),
      }))
  );
  const normalizeOption = (value: unknown): IntlCheckCanonicalJsonV2 => {
    if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number"
    ) {
      return value;
    }
    if (typeof value === "string") {
      const absolute = isAbsolute(value) ? resolve(value) : undefined;
      return absolute && isWithin(workspaceRoot, absolute)
        ? receiptRelativePath(workspaceRoot, absolute)
        : value.replaceAll("\\", "/").normalize("NFC");
    }
    if (Array.isArray(value)) {
      return value.map(normalizeOption);
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, entry]) => entry !== undefined)
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalizeOption(entry)])
      );
    }
    throw new Error(`Check project ${project.path} has non-canonical options`);
  };
  return {
    evidence: {
      configManifest,
      normalizedOptions: normalizeOption(parsed.options) as Readonly<
        Record<string, IntlCheckCanonicalJsonV2>
      >,
      path: project.path,
      role: project.role,
      rootFiles: files
        .map((file) => receiptRelativePath(workspaceRoot, file))
        .toSorted(),
    },
    files: new Set(files),
  };
}

/**
 * Resolve the complete authorizing source universe from TypeScript's own
 * project file lists. Checker projects are validated but never own files.
 */
export async function resolveConventionSourceUniverse(
  root: string,
  projects: ReadonlyArray<IntlCheckProjectV1>,
  generatedRelative: string,
  discoveredFiles: ReadonlyArray<string> = []
): Promise<ConventionSourceUniverse> {
  if (projects.length === 0) {
    throw new Error(
      "Authorizing checks require at least one checkProjects owner"
    );
  }
  const owners = projects.filter((project) => project.role === "owner");
  if (owners.length === 0) {
    throw new Error("Authorizing checks require at least one owner project");
  }
  const canonicalRoot = await realpath(root);
  const workspaceRoot = await findWorkspaceRoot(canonicalRoot);
  const generatedRoot = resolve(canonicalRoot, generatedRelative);
  const projectsWithFiles = await Promise.all(
    projects.map(async (project) => ({
      ...(await projectFiles(canonicalRoot, workspaceRoot, project)),
      project,
    }))
  );
  const ownerProjects = projectsWithFiles.filter(
    ({ project }) => project.role === "owner"
  );
  const discoveredCanonical = await Promise.all(
    discoveredFiles.map(async (file) => {
      const entry = await lstat(file).catch(() => undefined);
      if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(
          `Discovered source ${file} must be a readable regular file`
        );
      }
      const canonical = await realpath(file);
      if (!isWithin(workspaceRoot, canonical)) {
        throw new Error(`Discovered source ${file} escapes its workspace root`);
      }
      return canonical;
    })
  );
  const sourceFiles = new Set(
    [
      ...ownerProjects.flatMap(({ files }) => [...files]),
      ...discoveredCanonical,
    ].filter(
      (file) =>
        SOURCE_EXTENSION.test(file) &&
        file !== generatedRoot &&
        !file.startsWith(`${generatedRoot}${sep}`)
    )
  );
  const files = [...sourceFiles]
    .toSorted((left, right) => left.localeCompare(right))
    .map((absolute) => {
      const matching = ownerProjects.filter((entry) =>
        entry.files.has(absolute)
      );
      if (matching.length !== 1) {
        throw new Error(
          `Source ${receiptRelativePath(workspaceRoot, absolute)} must have exactly one owner; found ${matching.length}`
        );
      }
      const owner = matching[0]?.project.path;
      if (!owner) {
        throw new Error("Source owner resolution failed");
      }
      return {
        absolute,
        file: receiptRelativePath(workspaceRoot, absolute),
        owner,
      };
    });
  return {
    files,
    projects: projectsWithFiles
      .map(({ evidence }) => evidence)
      .toSorted((left, right) => left.path.localeCompare(right.path)),
    workspaceRoot,
  };
}
