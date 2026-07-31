import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type {
  IntlCheckFileIdentityV2,
  IntlCheckProviderResolutionV2,
  Sha256,
} from "@openmirai/intl-abi";

import { compareCanonicalStrings, decodeUtf8Fatal, sha256 } from "./canonical";

export type ProviderResolutionFrontierInput = Readonly<{
  controlFiles: ReadonlyArray<IntlCheckFileIdentityV2>;
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

function confinedPath(root: string, file: string): string {
  const path = relative(root, file).split(sep).join("/");
  if (!path || path.startsWith("../") || isAbsolute(path)) {
    throw new Error(
      `Provider resolution frontier escapes its workspace root: ${file}`
    );
  }
  return path.normalize("NFC");
}

async function present(
  path: string,
  kind: "directory" | "file"
): Promise<boolean> {
  const entry = await stat(path).catch(() => undefined);
  return kind === "directory"
    ? Boolean(entry?.isDirectory())
    : Boolean(entry?.isFile());
}

function probeIdentity(
  probe: Pick<
    ProviderResolutionFrontierInput["probes"][number],
    "kind" | "path"
  >
): string {
  return `${probe.path}\u0000${probe.kind}`;
}

export async function captureProviderResolutionFrontier(
  workspaceRoot: string,
  optionsHash: Sha256,
  input: ProviderResolutionFrontierInput
): Promise<IntlCheckProviderResolutionV2> {
  const root = resolve(workspaceRoot);
  const probes = input.probes
    .filter((probe) => resolve(probe.path) !== root)
    .map((probe) => ({
      ...probe,
      path: confinedPath(root, probe.path),
    }))
    .toSorted((left, right) =>
      compareCanonicalStrings(probeIdentity(left), probeIdentity(right))
    );
  for (const probe of probes) {
    const current = await present(resolve(root, probe.path), probe.kind);
    if (current !== probe.present) {
      throw new Error(
        `Semantic provider resolution frontier changed while source analysis ran: ${input.specifier}`
      );
    }
  }
  const controlFilesByPath = new Map<string, IntlCheckFileIdentityV2>();
  for (const entry of input.controlFiles) {
    const path = confinedPath(root, entry.path);
    const existing = controlFilesByPath.get(path);
    if (existing && existing.hash !== entry.hash) {
      throw new Error(
        `Provider resolution control changed while resolving ${input.specifier}`
      );
    }
    controlFilesByPath.set(path, { hash: entry.hash, path });
  }
  const controlFiles = [...controlFilesByPath.values()].toSorted(
    (left, right) => compareCanonicalStrings(left.path, right.path)
  );
  const realpaths = input.realpaths
    .filter((entry) => resolve(entry.path) !== root)
    .map((entry) => ({
      path: confinedPath(root, entry.path),
      target: confinedPath(root, entry.target),
    }))
    .toSorted((left, right) => compareCanonicalStrings(left.path, right.path));
  for (const entry of realpaths) {
    const target = await realpath(resolve(root, entry.path)).catch(
      () => undefined
    );
    if (!target || confinedPath(root, target) !== entry.target) {
      throw new Error(
        `Semantic provider realpath changed while source analysis ran: ${input.specifier}`
      );
    }
  }
  return {
    controlFiles,
    from: confinedPath(root, input.from),
    optionsHash,
    packageName: input.packageName,
    packageVersion: input.packageVersion,
    probes,
    realpaths,
    specifier: input.specifier,
  };
}

export async function verifyProviderResolutionFrontier(
  workspaceRoot: string,
  expectedOptionsHash: Sha256,
  resolution: IntlCheckProviderResolutionV2
): Promise<void> {
  if (resolution.optionsHash !== expectedOptionsHash) {
    throw new Error(
      `Mirai Intl provider resolver options are stale: ${resolution.specifier}`
    );
  }
  const root = resolve(workspaceRoot);
  for (const control of resolution.controlFiles) {
    const path = resolve(root, control.path);
    const bytes = await readFile(path).catch(() => undefined);
    if (
      !bytes ||
      confinedPath(root, path) !== control.path ||
      sha256(bytes) !== control.hash
    ) {
      throw new Error(
        `Mirai Intl provider resolution frontier is stale (control): ${resolution.specifier}`
      );
    }
    decodeUtf8Fatal(
      bytes,
      `Mirai Intl provider resolution control ${control.path}`
    );
  }
  for (const probe of resolution.probes) {
    const current = await present(resolve(root, probe.path), probe.kind);
    if (current !== probe.present) {
      throw new Error(
        `Mirai Intl provider resolution frontier is stale: ${resolution.specifier}`
      );
    }
  }
  for (const entry of resolution.realpaths) {
    const target = await realpath(resolve(root, entry.path)).catch(
      () => undefined
    );
    if (!target || confinedPath(root, target) !== entry.target) {
      throw new Error(
        `Mirai Intl provider realpath is stale: ${resolution.specifier}`
      );
    }
  }
}
