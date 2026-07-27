import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { IntlCheckProjectV2 } from "@openmirai/intl-abi";

const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/u;
const DEFAULT_EXCLUDES = ["bower_components", "jspm_packages", "node_modules"];

type ConfigField = Readonly<{ origin: string; value: unknown }>;
type EffectiveConfig = Readonly<{
  allowJs: boolean;
  exclude: ConfigField | undefined;
  files: ConfigField | undefined;
  include: ConfigField | undefined;
  outDir: ConfigField | undefined;
  resolveJsonModule: boolean;
}>;

function workspacePath(root: string, file: string): string {
  const path = relative(root, file).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error("Check-project root file escapes its workspace root");
  }
  return path;
}

function jsonc(source: string, context: string): Record<string, unknown> {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index] as string;
    const next = source[index + 1];
    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }
    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        output += source[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      index += 1;
      continue;
    }
    output += current;
  }
  try {
    const value = JSON.parse(output.replace(/,\s*([}\]])/gu, "$1")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("not an object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Unable to parse check-project config ${context}`, {
      cause: error,
    });
  }
}

function stringArray(value: unknown, context: string): ReadonlyArray<string> {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`Check-project ${context} must be a string array`);
  }
  return value as ReadonlyArray<string>;
}

function globExpression(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/^\.\//u, "");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] as string;
    const next = normalized[index + 1];
    if (current === "*" && next === "*") {
      if (normalized[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (current === "*") {
      expression += "[^/]*";
    } else if (current === "?") {
      expression += "[^/]";
    } else {
      expression += current.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function hasGlob(pattern: string): boolean {
  return /[*?]/u.test(pattern);
}

function includeMatcher(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/");
  return globExpression(
    hasGlob(normalized) || /\.[^/]+$/u.test(normalized)
      ? normalized
      : `${normalized.replace(/\/$/u, "")}/**/*`
  );
}

function excludeMatcher(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/").replace(/\/$/u, "");
  return globExpression(
    hasGlob(normalized) ? normalized : `${normalized}/**/*`
  );
}

async function enumerateFiles(root: string): Promise<ReadonlyArray<string>> {
  const files: Array<string> = [];
  const visit = async (directory: string): Promise<void> => {
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Check-project expansion encountered a non-directory");
    }
    for (const child of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, child.name);
      if (child.isSymbolicLink()) {
        continue;
      }
      if (child.isDirectory()) {
        await visit(path);
      } else if (child.isFile()) {
        files.push(path);
      } else {
        throw new Error("Check-project expansion encountered a non-file");
      }
    }
  };
  await visit(root);
  return files;
}

function expansionRoot(origin: string, pattern: string): string {
  const normalized = pattern.replaceAll("\\", "/");
  const wildcard = normalized.search(/[*?]/u);
  const prefix = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
  const candidate = resolve(origin, prefix);
  if (wildcard === -1 && /\.[^/]+$/u.test(normalized)) {
    return dirname(candidate);
  }
  return candidate.endsWith(sep) ? candidate.slice(0, -1) : candidate;
}

function extensionPriority(path: string): Readonly<{
  identity: string;
  priority: number;
}> {
  for (const [suffix, priority] of [
    [".d.mts", 0],
    [".mts", 1],
    [".mjs", 2],
    [".d.cts", 0],
    [".cts", 1],
    [".cjs", 2],
    [".d.ts", 0],
    [".ts", 1],
    [".tsx", 2],
    [".js", 3],
    [".jsx", 4],
  ] as const) {
    if (path.endsWith(suffix)) {
      let family = "script";
      if (suffix.includes("mts") || suffix === ".mjs") {
        family = "module";
      } else if (suffix.includes("cts") || suffix === ".cjs") {
        family = "commonjs";
      }
      return {
        identity: `${path.slice(0, -suffix.length)}\u0000${family}`,
        priority,
      };
    }
  }
  return { identity: path, priority: 0 };
}

function applyExtensionPriority(
  files: ReadonlyArray<string>
): ReadonlyArray<string> {
  const selected = new Map<
    string,
    Readonly<{ path: string; priority: number }>
  >();
  for (const path of files) {
    const candidate = extensionPriority(path);
    const current = selected.get(candidate.identity);
    if (!current || candidate.priority < current.priority) {
      selected.set(candidate.identity, {
        path,
        priority: candidate.priority,
      });
    }
  }
  return [...selected.values()].map(({ path }) => path).toSorted();
}

function mergeConfig(
  inherited: EffectiveConfig,
  source: Record<string, unknown>,
  origin: string
): EffectiveConfig {
  const compilerOptions =
    source.compilerOptions &&
    typeof source.compilerOptions === "object" &&
    !Array.isArray(source.compilerOptions)
      ? (source.compilerOptions as Record<string, unknown>)
      : {};
  const field = (name: string): ConfigField | undefined =>
    Object.hasOwn(source, name) ? { origin, value: source[name] } : undefined;
  return {
    allowJs:
      typeof compilerOptions.allowJs === "boolean"
        ? compilerOptions.allowJs
        : inherited.allowJs,
    exclude: field("exclude") ?? inherited.exclude,
    files: field("files") ?? inherited.files,
    include: field("include") ?? inherited.include,
    outDir: Object.hasOwn(compilerOptions, "outDir")
      ? { origin, value: compilerOptions.outDir }
      : inherited.outDir,
    resolveJsonModule:
      typeof compilerOptions.resolveJsonModule === "boolean"
        ? compilerOptions.resolveJsonModule
        : inherited.resolveJsonModule,
  };
}

/**
 * Reconstruct TypeScript root-file expansion from receipt-bound config bytes
 * without importing TypeScript or any semantic compiler module.
 */
export async function reconstructProjectRootFiles(
  workspaceRoot: string,
  project: IntlCheckProjectV2
): Promise<ReadonlyArray<string>> {
  const root = resolve(workspaceRoot);
  const manifests = new Map(
    project.configManifest.map((entry) => [entry.path, entry])
  );
  const configs = new Map<string, Record<string, unknown>>();
  await Promise.all(
    project.configManifest.map(async (entry) => {
      configs.set(
        entry.path,
        jsonc(await readFile(resolve(root, entry.path), "utf8"), entry.path)
      );
    })
  );
  const resolving = new Set<string>();
  const resolved = new Map<string, EffectiveConfig>();
  const visit = (path: string): EffectiveConfig => {
    const cached = resolved.get(path);
    if (cached) {
      return cached;
    }
    if (resolving.has(path)) {
      throw new Error("Check-project config closure contains a cycle");
    }
    const manifest = manifests.get(path);
    const config = configs.get(path);
    if (!manifest || !config) {
      throw new Error(`Check-project config closure is incomplete: ${path}`);
    }
    resolving.add(path);
    let effective: EffectiveConfig = {
      allowJs: false,
      exclude: undefined,
      files: undefined,
      include: undefined,
      outDir: undefined,
      resolveJsonModule: false,
    };
    for (const parent of manifest.extends) {
      const inherited = visit(parent);
      effective = {
        allowJs: inherited.allowJs,
        exclude: inherited.exclude ?? effective.exclude,
        files: inherited.files ?? effective.files,
        include: inherited.include ?? effective.include,
        outDir: inherited.outDir ?? effective.outDir,
        resolveJsonModule: inherited.resolveJsonModule,
      };
    }
    effective = mergeConfig(effective, config, dirname(resolve(root, path)));
    resolving.delete(path);
    resolved.set(path, effective);
    return effective;
  };
  const effective = visit(project.path);
  const extensions = effective.allowJs ? SOURCE_EXTENSION : /\.[cm]?tsx?$/u;
  const explicitFiles = effective.files
    ? await Promise.all(
        stringArray(effective.files.value, `${project.path}.files`).map(
          async (entry) => {
            const path = resolve(effective.files?.origin ?? root, entry);
            const stat = await lstat(path).catch(() => undefined);
            if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
              throw new Error(`Check-project root file is missing: ${entry}`);
            }
            return workspacePath(root, path);
          }
        )
      )
    : [];
  let include: ReadonlyArray<string> = ["**/*"];
  if (effective.include) {
    include = stringArray(effective.include.value, `${project.path}.include`);
  } else if (effective.files) {
    include = [];
  }
  const includeOrigin =
    effective.include?.origin ?? dirname(resolve(root, project.path));
  const excludes = effective.exclude
    ? stringArray(effective.exclude.value, `${project.path}.exclude`)
    : DEFAULT_EXCLUDES;
  const excludeOrigin =
    effective.exclude?.origin ?? dirname(resolve(root, project.path));
  const outDir =
    typeof effective.outDir?.value === "string"
      ? resolve(effective.outDir.origin, effective.outDir.value)
      : undefined;
  const expansionRoots = [
    ...new Set(include.map((pattern) => expansionRoot(includeOrigin, pattern))),
  ];
  const candidates = [
    ...new Set(
      (
        await Promise.all(
          expansionRoots.map(async (directory) => {
            const stat = await lstat(directory).catch(() => undefined);
            return stat?.isDirectory() && !stat.isSymbolicLink()
              ? enumerateFiles(directory)
              : [];
          })
        )
      ).flat()
    ),
  ];
  const includedFiles = candidates
    .filter((file) => {
      if (
        (!extensions.test(file) &&
          !(effective.resolveJsonModule && file.endsWith(".json"))) ||
        (outDir && file.startsWith(`${outDir}${sep}`))
      ) {
        return false;
      }
      const includedPath = relative(includeOrigin, file).split(sep).join("/");
      if (
        !include.some((pattern) => includeMatcher(pattern).test(includedPath))
      ) {
        return false;
      }
      const excludedPath = relative(excludeOrigin, file).split(sep).join("/");
      return !excludes.some((pattern) =>
        excludeMatcher(pattern).test(excludedPath)
      );
    })
    .map((file) => workspacePath(root, file));
  return applyExtensionPriority([
    ...new Set([...explicitFiles, ...includedFiles]),
  ]);
}
