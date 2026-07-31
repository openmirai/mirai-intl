import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

export const GATE_25_PACKAGE_PATHS = [
  "apps/admin",
  "apps/auth",
  "apps/instructor",
  "apps/learner",
  "packages/i18n",
] as const;

export const GATE_25_TOPOLOGY_PROBES = [
  "apps/admin/node_modules/@openmirai/intl",
  "apps/admin/node_modules/@tanstack/react-query",
  "apps/admin/node_modules/@tanstack/react-router",
  "apps/admin/node_modules/lucide-react",
  "apps/admin/node_modules/react",
] as const;

export type DependencyTopologyIdentity = Readonly<{
  hash: string;
  linkCount: number;
  lockfileHash: string;
  modulesHash: string;
  probes: ReadonlyArray<
    Readonly<{
      canonicalRelativePath: string;
      path: string;
      target: string;
    }>
  >;
}>;

export function gate25WorkerGroups(
  poolSize: number
): ReadonlyArray<
  Readonly<{ packagePaths: ReadonlyArray<string>; workerIndex: number }>
> {
  if (!Number.isSafeInteger(poolSize) || poolSize < 1 || poolSize > 4) {
    throw new Error("Gate 2.5 pool size must be an integer from 1 through 4");
  }
  const groups = Array.from({ length: poolSize }, (_, workerIndex) => ({
    packagePaths: [] as Array<string>,
    workerIndex,
  }));
  for (const [index, packagePath] of GATE_25_PACKAGE_PATHS.entries()) {
    groups[index % poolSize]?.packagePaths.push(packagePath);
  }
  return Object.freeze(
    groups
      .filter(({ packagePaths }) => packagePaths.length > 0)
      .map(({ packagePaths, workerIndex }) =>
        Object.freeze({
          packagePaths: Object.freeze([...packagePaths]),
          workerIndex,
        })
      )
  );
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

function assertWithinRoot(
  canonicalRoot: string,
  canonicalPath: string,
  context: string
): string {
  const path = normalizedRelative(canonicalRoot, canonicalPath);
  if (
    path === "" ||
    (!isAbsolute(path) && path !== ".." && !path.startsWith("../"))
  ) {
    return path;
  }
  throw new Error(
    `Gate 2.5 dependency topology escapes workspace root: ${context} -> ${canonicalPath}`
  );
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

async function dependencyLinkPaths(
  directory: string
): Promise<ReadonlyArray<string>> {
  if (!(await exists(directory))) {
    return [];
  }
  const links: Array<string> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      links.push(path);
    } else if (entry.isDirectory()) {
      links.push(...(await dependencyLinkPaths(path)));
    }
  }
  return links;
}

export function cloneInstalledWorkspace(
  seedRoot: string,
  destinationRoot: string
): void {
  const result = spawnSync("cp", ["-al", seedRoot, destinationRoot], {
    cwd: dirname(destinationRoot),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(
      [
        "Gate 2.5 failed to hardlink-clone the installed workspace seed",
        `status=${String(result.status)} signal=${String(result.signal)}`,
        result.error?.message ?? "",
        result.stdout,
        result.stderr,
      ].join("\n")
    );
  }
}

export async function dependencyTopologyIdentity(
  workspaceRoot: string
): Promise<DependencyTopologyIdentity> {
  const canonicalRoot = await realpath(workspaceRoot);
  const dependencyRoots = [
    join(workspaceRoot, "node_modules"),
    ...GATE_25_PACKAGE_PATHS.map((path) =>
      join(workspaceRoot, path, "node_modules")
    ),
  ];
  const linkPaths = [
    ...new Set(
      (await Promise.all(dependencyRoots.map(dependencyLinkPaths))).flat()
    ),
  ].toSorted();
  const links = await Promise.all(
    linkPaths.map(async (path) => {
      const canonicalPath = await realpath(path);
      return {
        canonicalRelativePath: assertWithinRoot(
          canonicalRoot,
          canonicalPath,
          normalizedRelative(workspaceRoot, path)
        ),
        path: normalizedRelative(workspaceRoot, path),
        target: await readlink(path),
      };
    })
  );
  const probes = await Promise.all(
    GATE_25_TOPOLOGY_PROBES.map(async (path) => {
      const absolutePath = join(workspaceRoot, path);
      const canonicalPath = await realpath(absolutePath);
      return {
        canonicalRelativePath: assertWithinRoot(
          canonicalRoot,
          canonicalPath,
          path
        ),
        path,
        target: await readlink(absolutePath),
      };
    })
  );
  const lockfileHash = sha256(
    await readFile(join(workspaceRoot, "pnpm-lock.yaml"))
  );
  const modulesHash = sha256(
    await readFile(join(workspaceRoot, "node_modules/.modules.yaml"))
  );
  return {
    hash: sha256(JSON.stringify({ links, lockfileHash, modulesHash, probes })),
    linkCount: links.length,
    lockfileHash,
    modulesHash,
    probes,
  };
}
