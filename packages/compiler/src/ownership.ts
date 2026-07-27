import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { IntlCheckProjectV1 } from "@openmirai/intl-abi";
import ts from "typescript";

export type OwnedSourceFile = Readonly<{
  absolute: string;
  file: string;
  owner: string;
}>;

export type ConventionSourceUniverse = Readonly<{
  files: ReadonlyArray<OwnedSourceFile>;
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
): Promise<ReadonlySet<string>> {
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
  const read = ts.readConfigFile(canonicalConfigPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(
      `Unable to read check project ${project.path}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(canonicalConfigPath),
    undefined,
    canonicalConfigPath
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      `Unable to parse check project ${project.path}: ${ts.flattenDiagnosticMessageText(parsed.errors[0]?.messageText ?? "unknown error", " ")}`
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
  return new Set(files);
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
      files: await projectFiles(canonicalRoot, workspaceRoot, project),
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
  return { files, workspaceRoot };
}
