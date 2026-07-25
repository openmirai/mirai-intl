import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { IntlCheckProjectV1 } from "@openmirai/intl-abi";
import ts from "typescript";

export type OwnedSourceFile = Readonly<{
  file: string;
  owner: string;
}>;

function relativeProjectPath(root: string, file: string): string {
  const path = relative(root, file).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("Check-project file must remain within its package root");
  }
  return path;
}

async function projectFiles(
  root: string,
  project: IntlCheckProjectV1
): Promise<ReadonlySet<string>> {
  const configPath = resolve(root, project.path);
  if (relativeProjectPath(root, configPath) !== project.path) {
    throw new Error(`Check project ${project.path} escapes its package root`);
  }
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(
      `Unable to read check project ${project.path}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    root,
    undefined,
    configPath
  );
  if (parsed.errors.length > 0) {
    throw new Error(
      `Unable to parse check project ${project.path}: ${ts.flattenDiagnosticMessageText(parsed.errors[0]?.messageText ?? "unknown error", " ")}`
    );
  }
  return new Set(
    await Promise.all(parsed.fileNames.map((file) => realpath(file)))
  );
}

/** Resolve direct tsconfig roots once; checker projects never own source files. */
export async function resolveSourceOwnership(
  root: string,
  projects: ReadonlyArray<IntlCheckProjectV1>,
  sourceFiles: ReadonlyArray<string>
): Promise<ReadonlyArray<OwnedSourceFile>> {
  if (projects.length === 0) {
    throw new Error(
      "Authorizing checks require at least one checkProjects owner"
    );
  }
  const owners = projects.filter((project) => project.role === "owner");
  if (owners.length === 0) {
    throw new Error("Authorizing checks require at least one owner project");
  }
  // Every declared project is parsed before any receipt is authorized. Checker
  // projects contribute validation evidence but intentionally cannot claim
  // ownership of a deployable source file.
  const projectsWithFiles = await Promise.all(
    projects.map(async (project) => ({
      files: await projectFiles(root, project),
      project,
    }))
  );
  const roots = projectsWithFiles.filter(
    ({ project }) => project.role === "owner"
  );
  return Promise.all(
    sourceFiles.map(async (file) => {
      const canonical = await realpath(file);
      const matching = roots.filter((entry) => entry.files.has(canonical));
      if (matching.length !== 1) {
        throw new Error(
          `Source ${relativeProjectPath(root, canonical)} must have exactly one owner; found ${matching.length}`
        );
      }
      const owner = matching[0]?.project.path;
      if (!owner) {
        throw new Error("Source owner resolution failed");
      }
      return { file: relativeProjectPath(root, canonical), owner };
    })
  );
}
