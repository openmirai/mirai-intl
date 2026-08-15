import { access, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { loadConventionCatalog } from "./catalog";
import type { LoadedConventionCatalog } from "./catalog";
import { verifyConventionBuildReceipt } from "./check-receipt";
import { ensureMiraiIntlCatalogOnce } from "./lifecycle";
import {
  authorizePrivateMessageSliceRequest,
  loadPrivateMessageSlice,
} from "./private-module";
import {
  invalidateMiraiIntlCatalogCache,
  transformMiraiIntlSource,
} from "./transform";
import { findWorkspaceRoot } from "./ownership";
import type {
  MiraiIntlSourceMap,
  MiraiIntlTransformOptions,
} from "./transform";

export type MiraiIntlVitePlugin = Readonly<{
  buildStart(
    this: Readonly<{ addWatchFile(file: string): void }>
  ): Promise<void>;
  configResolved(config: Readonly<{ root: string }>): void;
  closeBundle(): Promise<void>;
  configureServer(server: MiraiIntlViteServer): () => void;
  enforce: "pre";
  handleHotUpdate(context: MiraiIntlHotUpdateContext): Promise<[] | undefined>;
  load(
    this: Readonly<{ addWatchFile(file: string): void }>,
    id: string
  ): Promise<string | null>;
  name: "mirai-intl";
  transform(
    code: string,
    id: string
  ): Promise<Readonly<{ code: string; map: MiraiIntlSourceMap }> | null>;
}>;

export type MiraiIntlViteOptions = MiraiIntlTransformOptions & Readonly<{}>;

type MiraiIntlViteBuildConfig = Readonly<{
  build?: Readonly<{ outDir?: string; ssr?: boolean | string }>;
  root: string;
}>;

type MiraiIntlViteWatcher = Readonly<{
  add(path: string): void;
  off(event: "add" | "unlink", listener: (path: string) => void): void;
  on(event: "add" | "unlink", listener: (path: string) => void): void;
}>;

type MiraiIntlViteServer = Readonly<{
  config: Readonly<{
    logger: Readonly<{ error(message: string): void }>;
  }>;
  restart(): Promise<void>;
  watcher: MiraiIntlViteWatcher;
}>;

type MiraiIntlHotUpdateContext = Readonly<{
  file: string;
  server: MiraiIntlViteServer;
}>;

type WatchRegistrar = Readonly<{ addWatchFile(file: string): void }>;

function normalizedPath(path: string): string {
  return resolve(path).split(sep).join("/");
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return normalizedPath(await realpath(path));
  } catch {
    return normalizedPath(path);
  }
}

function isPathInside(parent: string, file: string): boolean {
  const relativePath = relative(parent, file);
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${sep}`) &&
    relativePath !== ".." &&
    !relativePath.startsWith(sep)
  );
}

const restartMessage =
  "Translation configuration or sources changed. Restart Vite so mirai-intl can publish one reader-safe catalog before compilation.";
const catalogRestartMessage =
  "Generated catalog selection changed. Restarting Vite so mirai-intl can compile against one reader-safe catalog.";

const defaultGeneratedDirectory = "src/i18n/generated";

async function hasPublishedCatalogPointer(
  root: string,
  generatedDirectory: string
): Promise<boolean> {
  try {
    await access(join(root, generatedDirectory, "current.json"));
    return true;
  } catch {
    return false;
  }
}

export function miraiIntlVite(
  options: MiraiIntlViteOptions = {}
): MiraiIntlVitePlugin {
  let resolvedRoot = options.root;
  let localeRoots: ReadonlyArray<string> = [];
  let identityFiles: ReadonlyArray<string> = [];
  let configuredLocaleRoot: string | undefined;
  let discoveryReady: Promise<void> = Promise.resolve();
  let restartPromise: Promise<void> | undefined;
  let workspaceRootPromise: Promise<string> | undefined;
  const currentOptions = (): MiraiIntlTransformOptions =>
    resolvedRoot ? { ...options, root: resolvedRoot } : options;
  const packageRoot = (): string =>
    resolve(resolvedRoot ?? options.root ?? process.cwd());
  const currentPointerPath = (): string =>
    resolve(
      packageRoot(),
      options.generatedDirectory ?? defaultGeneratedDirectory,
      "current.json"
    );
  const workspaceRoot = (): Promise<string> => {
    workspaceRootPromise ??= findWorkspaceRoot(packageRoot());
    return workspaceRootPromise;
  };
  const applyDiscovery = (loaded: LoadedConventionCatalog): void => {
    const discovery = loaded.discovery;
    if (!discovery) {
      throw new Error("Vite intl adapter requires convention discovery");
    }
    localeRoots = [
      ...new Set(loaded.watch.roots.map(normalizedPath)),
    ].toSorted();
    identityFiles = [
      ...new Set(
        loaded.watch.files
          .map(normalizedPath)
          .filter(
            (file) =>
              !localeRoots.some(
                (root) => file === root || isPathInside(root, file)
              )
          )
      ),
    ].toSorted();
    configuredLocaleRoot = normalizedPath(
      resolve(loaded.repositoryRoot, discovery.localeRoot)
    );
  };
  const registerBuildWatches = (registrar: WatchRegistrar): void => {
    // Locale roots cover every translation JSON without amplifying the Vite
    // graph. Configuration identities live outside those roots and must be
    // watched individually so a preset or tsconfig mutation invalidates the
    // catalog/check receipt.
    for (const file of [...identityFiles, ...localeRoots]) {
      registrar.addWatchFile(file);
    }
  };
  const isIdentityInput = async (file: string): Promise<boolean> =>
    identityFiles.includes(await canonicalPath(file));
  const isLocaleJson = async (file: string): Promise<boolean> => {
    if (!file.endsWith(".json")) {
      return false;
    }
    const normalized = await canonicalPath(file);
    const roots = await Promise.all(
      [...localeRoots, configuredLocaleRoot]
        .filter((root): root is string => root !== undefined)
        .map((root) => canonicalPath(root))
    );
    if (roots.length > 0) {
      return roots.some(
        (root) => normalized === root || isPathInside(root, normalized)
      );
    }
    // Discovery may still be deferred on app boot; treat package locale JSON
    // as translation sources so HMR still requests a restart.
    const root = await canonicalPath(packageRoot());
    return (
      isPathInside(root, normalized) &&
      (normalized.includes("/locales/") || normalized.includes("/src/locales/"))
    );
  };
  const isCurrentPointer = async (file: string): Promise<boolean> =>
    (await canonicalPath(file)) === (await canonicalPath(currentPointerPath()));
  const restartForCatalogRotation = (
    server: MiraiIntlViteServer
  ): Promise<void> => {
    // Transforms embed the selected content-addressed carrier path. Restart
    // before serving more modules so transform() and load() cannot observe
    // different current.json generations.
    if (!restartPromise) {
      server.config.logger.error(catalogRestartMessage);
      invalidateMiraiIntlCatalogCache(currentOptions());
      restartPromise = server.restart().finally(() => {
        restartPromise = undefined;
      });
    }
    return restartPromise;
  };
  const ensureDiscovery = (): Promise<void> => {
    if (localeRoots.length > 0) {
      return Promise.resolve();
    }
    discoveryReady = discoveryReady.then(async () => {
      if (localeRoots.length > 0) {
        return;
      }
      applyDiscovery(await loadConventionCatalog(packageRoot()));
    });
    return discoveryReady;
  };
  return {
    async buildStart() {
      const opts = currentOptions();
      const root = packageRoot();
      invalidateMiraiIntlCatalogCache(opts);
      if (opts.requireProof) {
        await verifyConventionBuildReceipt(root);
      }
      const generatedDirectory =
        opts.generatedDirectory ?? defaultGeneratedDirectory;
      const published = await hasPublishedCatalogPointer(
        root,
        generatedDirectory
      );

      if (!published) {
        // Fresh fixtures / first boot without `intl:ensure`.
        const loaded = (await ensureMiraiIntlCatalogOnce(opts)).loaded;
        applyDiscovery(loaded);
        registerBuildWatches(this);
        return;
      }

      // App `predev` already published a catalog. Do not regenerate or scan
      // discovery during Vite `buildStart` — that races SSR optimizeDeps and
      // wedges Nitro (`transport invoke timed out` / `ERR_OUTDATED_OPTIMIZED_DEP`).
      // Explicit `{ root }` (unit tests / programmatic Vite) still needs
      // discovery for watch assertions before `configureServer`.
      if (options.root !== undefined) {
        const loaded = await loadConventionCatalog(root);
        applyDiscovery(loaded);
        registerBuildWatches(this);
      }
    },
    async closeBundle() {
      // Vite/Nitro may relocate, prune, or mutate assets after this hook.
      // The package lifecycle runs prove-artifact only after the final output
      // is materialized, then finalizes the immutable byte proof.
    },
    configResolved(config: MiraiIntlViteBuildConfig) {
      resolvedRoot ??= config.root;
    },
    configureServer(server) {
      server.watcher.add(currentPointerPath());
      const requireRestart = (file: string): void => {
        void Promise.all([isLocaleJson(file), isIdentityInput(file)]).then(
          ([locale, identity]) => {
            if (!locale && !identity) {
              return;
            }
            server.config.logger.error(restartMessage);
          }
        );
      };
      const addDevelopmentWatchInputs = (): void => {
        const roots =
          localeRoots.length > 0
            ? localeRoots
            : [resolve(packageRoot(), "src/locales")];
        for (const input of new Set([...identityFiles, ...roots])) {
          server.watcher.add(input);
        }
      };
      // Discovery from buildStart is already available for fixtures; app boot
      // defers discovery and attaches watchers once it resolves.
      if (localeRoots.length > 0) {
        addDevelopmentWatchInputs();
      } else {
        void ensureDiscovery().then(addDevelopmentWatchInputs);
      }
      server.watcher.on("add", requireRestart);
      server.watcher.on("unlink", requireRestart);
      return () => {
        server.watcher.off("add", requireRestart);
        server.watcher.off("unlink", requireRestart);
      };
    },
    enforce: "pre",
    async handleHotUpdate(context) {
      if (await isCurrentPointer(context.file)) {
        await restartForCatalogRotation(context.server);
        return [];
      }
      await ensureDiscovery();
      if (
        !(await isLocaleJson(context.file)) &&
        !(await isIdentityInput(context.file))
      ) {
        return undefined;
      }
      context.server.config.logger.error(restartMessage);
      return [];
    },
    async load(id) {
      const request = await authorizePrivateMessageSliceRequest(
        id,
        currentOptions()
      );
      if (!request) {
        return null;
      }
      this.addWatchFile(request.currentFile);
      this.addWatchFile(request.file);
      this.addWatchFile(request.messageFile);
      return loadPrivateMessageSlice(request);
    },
    name: "mirai-intl",
    async transform(code, id) {
      return transformMiraiIntlSource(code, id, {
        ...currentOptions(),
        workspaceRoot: await workspaceRoot(),
      });
    },
  };
}
