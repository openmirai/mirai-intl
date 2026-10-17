import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

/**
 * The peers a packed consumer installs next to the Mirai Intl tarballs. Each
 * version defaults to the repository's own devDependency, so the smokes run on
 * the versions the tests run on. Set the variable to prove another version of
 * the supported range, for example the lowest one.
 */
const smokePeerVariables = {
  i18next: "MIRAI_INTL_SMOKE_I18NEXT_VERSION",
  react: "MIRAI_INTL_SMOKE_REACT_VERSION",
} as const;

export type SmokePeerVersions = Readonly<{
  i18next: string;
  react: string;
  "react-dom": string;
}>;

export async function readSmokePeerVersions(
  repositoryRoot: string
): Promise<SmokePeerVersions> {
  const manifest: unknown = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8")
  );
  const devDependencies: unknown =
    manifest && typeof manifest === "object"
      ? Reflect.get(manifest, "devDependencies")
      : undefined;
  const version = (name: keyof typeof smokePeerVariables): string => {
    const override = process.env[smokePeerVariables[name]];
    if (override) {
      return override;
    }
    const declared: unknown =
      devDependencies && typeof devDependencies === "object"
        ? Reflect.get(devDependencies, name)
        : undefined;
    if (typeof declared !== "string" || declared.length === 0) {
      throw new Error(`The repository does not declare ${name} for the smoke`);
    }
    return declared;
  };
  const react = version("react");
  return { i18next: version("i18next"), react, "react-dom": react };
}

/** The real directory of `name` as Node resolves it from `fromFile`. */
export async function resolvePackageRoot(
  fromFile: string,
  name: string
): Promise<string> {
  let directory = dirname(createRequire(fromFile).resolve(name));
  for (;;) {
    try {
      const manifest: unknown = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8")
      );
      if (
        manifest &&
        typeof manifest === "object" &&
        Reflect.get(manifest, "name") === name
      ) {
        return await realpath(directory);
      }
    } catch (error) {
      if (Reflect.get(Object(error), "code") !== "ENOENT") {
        throw error;
      }
    }
    const parent = resolve(directory, "..");
    if (parent === directory) {
      throw new Error(`No package root for ${name} above ${fromFile}`);
    }
    directory = parent;
  }
}

/**
 * Fails unless every importer resolves one and the same copy of `name`. A
 * second i18next or React copy splits instances, contexts and types.
 */
export async function assertSingleCopy(
  name: string,
  importers: Readonly<Record<string, string>>
): Promise<string> {
  const roots = await Promise.all(
    Object.entries(importers).map(
      async ([importer, fromFile]) =>
        [importer, await resolvePackageRoot(fromFile, name)] as const
    )
  );
  const distinct = new Set(roots.map(([, root]) => root));
  if (distinct.size !== 1) {
    throw new Error(
      `Expected one ${name} copy, found ${distinct.size}: ${roots
        .map(([importer, root]) => `${importer} -> ${root}`)
        .join("; ")}`
    );
  }
  const [only] = distinct;
  if (only === undefined) {
    throw new Error(`No importer resolved ${name}`);
  }
  return only;
}
