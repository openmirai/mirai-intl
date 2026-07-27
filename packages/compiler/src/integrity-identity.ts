import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Sha256 } from "@openmirai/intl-abi";

import {
  canonicalHash,
  canonicalJson,
  compareCanonicalStrings,
} from "./canonical";

export interface IntegrityManifestEntry {
  readonly hash: Sha256;
  readonly path: string;
  readonly size: number;
}

export interface IntegrityManifest {
  readonly entries: ReadonlyArray<IntegrityManifestEntry>;
  readonly hash: Sha256;
}

export interface CompilerImplementationIdentity {
  readonly hash: Sha256;
  readonly modules: IntegrityManifest;
}

export interface ResolvedPackageIdentity {
  readonly entry: IntegrityManifestEntry;
  readonly hash: Sha256;
  readonly name: string;
  readonly packageJsonHash: Sha256;
  readonly version: string;
}

export interface TypeScriptLibIdentity {
  readonly hash: Sha256;
  readonly libs: IntegrityManifest;
}

export interface ApplicationPackageIdentity {
  readonly hash: Sha256;
  readonly lock:
    | {
        readonly hash: Sha256;
        readonly name: string;
      }
    | undefined;
  readonly packageJsonHash: Sha256;
}

export interface ImmutableIntegrityIdentity {
  readonly compiler: CompilerImplementationIdentity;
  readonly icuParser: ResolvedPackageIdentity;
  readonly typescript: ResolvedPackageIdentity;
  readonly typescriptLibs: TypeScriptLibIdentity;
}

const EXECUTABLE_MODULE_PATTERN =
  /(?:^|\/)(?![^/]+\.(?:test|spec)\.)[^/]+\.(?:[cm]?[jt]sx?)$/u;
const NON_EXECUTABLE_MODULE_PATTERN = /\.(?:d\.[cm]?ts|map)$/u;
const TYPESCRIPT_LIB_PATTERN = /^lib(?:\.[a-z0-9._-]+)?\.d\.ts$/u;
const LOCK_NAMES = [
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

let immutableIdentity: Promise<ImmutableIntegrityIdentity> | undefined;

function hashBytes(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeManifestPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").normalize("NFC");
  if (
    normalized.length === 0 ||
    normalized !== path.replaceAll("\\", "/") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized)
  ) {
    throw new Error(`Invalid integrity manifest path ${JSON.stringify(path)}`);
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error(`Invalid integrity manifest path ${JSON.stringify(path)}`);
  }
  return normalized;
}

export function createIntegrityManifest(
  entries: ReadonlyArray<IntegrityManifestEntry>
): IntegrityManifest {
  const normalized = entries.map((entry) => ({
    hash: entry.hash,
    path: normalizeManifestPath(entry.path),
    size: entry.size,
  }));
  normalized.sort((left, right) =>
    compareCanonicalStrings(left.path, right.path)
  );

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]?.path === normalized[index]?.path) {
      throw new Error(
        `Duplicate integrity manifest path ${JSON.stringify(normalized[index]?.path)}`
      );
    }
  }

  return {
    entries: normalized,
    hash: canonicalHash(normalized),
  };
}

function confinedRelativePath(root: string, path: string): string {
  const relativePath = relative(root, path);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`Integrity path is outside its expected root`);
  }
  return normalizeManifestPath(relativePath);
}

async function readRegularFile(path: string): Promise<Buffer> {
  const before = await lstat(path);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Integrity input is not a regular file`);
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`Integrity input changed while it was read`);
  }
  return bytes;
}

async function assertPathHasNoSymlink(
  root: string,
  path: string
): Promise<void> {
  const relativePath = confinedRelativePath(root, path);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Integrity root is not a regular directory`);
  }
  const segments = relativePath.split("/");
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Integrity path contains a symlink or non-directory`);
    }
  }
}

async function manifestEntry(
  root: string,
  path: string
): Promise<IntegrityManifestEntry> {
  await assertPathHasNoSymlink(root, path);
  const bytes = await readRegularFile(path);
  return {
    hash: hashBytes(bytes),
    path: confinedRelativePath(root, path),
    size: bytes.byteLength,
  };
}

async function enumerateCompilerModules(
  root: string,
  directory = root
): Promise<Array<string>> {
  const directoryStat = await lstat(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`Compiler module directory is not a regular directory`);
  }

  const paths: Array<string> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      throw new Error(`Compiler module tree contains a symlink`);
    }
    if (stat.isDirectory()) {
      paths.push(...(await enumerateCompilerModules(root, path)));
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Compiler module tree contains a non-regular entry`);
    }
    const relativePath = confinedRelativePath(root, path);
    if (
      NON_EXECUTABLE_MODULE_PATTERN.test(relativePath) ||
      relativePath.endsWith(".test.ts") ||
      relativePath.endsWith(".test.js") ||
      relativePath.endsWith(".spec.ts") ||
      relativePath.endsWith(".spec.js")
    ) {
      continue;
    }
    if (!EXECUTABLE_MODULE_PATTERN.test(relativePath)) {
      throw new Error(
        `Unexpected compiler module path ${JSON.stringify(relativePath)}`
      );
    }
    paths.push(path);
  }
  return paths;
}

export async function computeCompilerImplementationIdentity(
  moduleRoot: string
): Promise<CompilerImplementationIdentity> {
  const root = resolve(moduleRoot);
  const entries = await Promise.all(
    (await enumerateCompilerModules(root)).map((path) =>
      manifestEntry(root, path)
    )
  );
  const modules = createIntegrityManifest(entries);
  return {
    hash: canonicalHash({ modulesHash: modules.hash }),
    modules,
  };
}

interface PackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
}

async function findPackageRoot(
  resolvedEntry: string,
  expectedName: string
): Promise<{
  packageJson: PackageJson;
  packageJsonPath: string;
  root: string;
}> {
  let directory = dirname(resolvedEntry);
  for (;;) {
    const packageJsonPath = join(directory, "package.json");
    try {
      const bytes = await readRegularFile(packageJsonPath);
      const packageJson = JSON.parse(bytes.toString("utf8")) as PackageJson;
      if (packageJson.name === expectedName) {
        return { packageJson, packageJsonPath, root: directory };
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot locate package.json for ${expectedName}`);
    }
    directory = parent;
  }
}

export async function computeResolvedPackageIdentity(
  packageName: string,
  resolveFrom: string
): Promise<ResolvedPackageIdentity> {
  const require = createRequire(join(resolve(resolveFrom), "package.json"));
  const resolvedEntry = await realpath(require.resolve(packageName));
  const { packageJson, packageJsonPath, root } = await findPackageRoot(
    resolvedEntry,
    packageName
  );
  if (
    typeof packageJson.name !== "string" ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error(`Package ${packageName} has invalid identity metadata`);
  }

  const packageJsonBytes = await readRegularFile(packageJsonPath);
  const parsedPackageJson = JSON.parse(
    packageJsonBytes.toString("utf8")
  ) as unknown;
  const packageJsonHash = hashBytes(
    Buffer.from(canonicalJson(parsedPackageJson), "utf8")
  );
  const entry = await manifestEntry(root, resolvedEntry);
  const baseIdentity = {
    entry,
    name: packageJson.name,
    packageJsonHash,
    version: packageJson.version,
  };
  return {
    ...baseIdentity,
    hash: canonicalHash(baseIdentity),
  };
}

export async function computeTypeScriptLibIdentity(
  typescriptPackageRoot: string,
  libPaths?: ReadonlyArray<string>
): Promise<TypeScriptLibIdentity> {
  const packageRoot = resolve(typescriptPackageRoot);
  const libRoot = join(packageRoot, "lib");
  const paths =
    libPaths === undefined
      ? (await readdir(libRoot, { withFileTypes: true }))
          .filter((entry) => TYPESCRIPT_LIB_PATTERN.test(entry.name))
          .map((entry) => {
            if (!entry.isFile() || entry.isSymbolicLink()) {
              throw new Error(
                `TypeScript lib manifest entry is not a regular file`
              );
            }
            return join(libRoot, entry.name);
          })
      : [...libPaths];

  const entries = await Promise.all(
    paths.map(async (path) => {
      const absolutePath = resolve(path);
      const relativePath = confinedRelativePath(libRoot, absolutePath);
      if (
        relativePath.includes("/") ||
        !TYPESCRIPT_LIB_PATTERN.test(relativePath)
      ) {
        throw new Error(
          `Unexpected TypeScript lib manifest path ${JSON.stringify(relativePath)}`
        );
      }
      return manifestEntry(libRoot, absolutePath);
    })
  );
  const libs = createIntegrityManifest(entries);
  return { hash: canonicalHash({ libsHash: libs.hash }), libs };
}

async function findWorkspaceLock(
  applicationRoot: string
): Promise<{ name: string; path: string } | undefined> {
  let directory = applicationRoot;
  for (;;) {
    const matches: Array<{ name: string; path: string }> = [];
    for (const name of LOCK_NAMES) {
      const path = join(directory, name);
      try {
        const stat = await lstat(path);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error(`Workspace lock is not a regular file`);
        }
        matches.push({ name, path });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
    }
    if (matches.length > 1) {
      throw new Error(`Multiple workspace lock files were found`);
    }
    if (matches[0] !== undefined) {
      return matches[0];
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

export async function computeApplicationPackageIdentity(
  applicationRoot: string
): Promise<ApplicationPackageIdentity> {
  const root = resolve(applicationRoot);
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Application root is not a regular directory`);
  }
  const packageJsonBytes = await readRegularFile(join(root, "package.json"));
  const packageJson = JSON.parse(packageJsonBytes.toString("utf8")) as unknown;
  const packageJsonHash = hashBytes(
    Buffer.from(canonicalJson(packageJson), "utf8")
  );
  const workspaceLock = await findWorkspaceLock(root);
  const lock =
    workspaceLock === undefined
      ? undefined
      : {
          hash: hashBytes(await readRegularFile(workspaceLock.path)),
          name: workspaceLock.name,
        };
  return {
    hash: canonicalHash({ lock, packageJsonHash }),
    lock,
    packageJsonHash,
  };
}

async function computeDefaultImmutableIntegrityIdentity(): Promise<ImmutableIntegrityIdentity> {
  const moduleRoot = dirname(fileURLToPath(import.meta.url));
  const resolveFrom = join(moduleRoot, "..");
  const [compiler, icuParser, typescript] = await Promise.all([
    computeCompilerImplementationIdentity(moduleRoot),
    computeResolvedPackageIdentity(
      "@formatjs/icu-messageformat-parser",
      resolveFrom
    ),
    computeResolvedPackageIdentity("typescript", resolveFrom),
  ]);
  const typescriptPackage = await findPackageRoot(
    await realpath(
      createRequire(join(resolveFrom, "package.json")).resolve("typescript")
    ),
    "typescript"
  );
  const typescriptLibs = await computeTypeScriptLibIdentity(
    typescriptPackage.root
  );
  return { compiler, icuParser, typescript, typescriptLibs };
}

export function getImmutableIntegrityIdentity(): Promise<ImmutableIntegrityIdentity> {
  immutableIdentity ??= computeDefaultImmutableIntegrityIdentity();
  return immutableIdentity;
}
