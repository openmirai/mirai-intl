import { access, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import { loadConventionCatalog } from "./catalog";
import type { LoadedConventionCatalog } from "./catalog";
import { ensureMiraiIntlCatalogOnce } from "./lifecycle";
import {
  authorizePrivateMessageSliceRequest,
  loadPrivateMessageSlice,
} from "./private-module";
import { transformMiraiIntlSource } from "./transform";
import type {
  MiraiIntlSourceMap,
  MiraiIntlTransformOptions,
} from "./transform";

export type MiraiIntlVitePlugin = Readonly<{
  buildStart(
    this: Readonly<{ addWatchFile(file: string): void }>
  ): Promise<void>;
  configResolved(config: Readonly<{ root: string }>): void;
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

type MiraiIntlViteWatcher = Readonly<{
  add(path: string): void;
  off(event: "add" | "unlink", listener: (path: string) => void): void;
  on(event: "add" | "unlink", listener: (path: string) => void): void;
}>;

type MiraiIntlViteServer = Readonly<{
  config: Readonly<{
    logger: Readonly<{ error(message: string): void }>;
  }>;
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
  "Translation sources changed. Restart Vite so mirai-intl can publish one reader-safe catalog before compilation.";

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
  options: MiraiIntlTransformOptions = {}
): MiraiIntlVitePlugin {
  let resolvedRoot = options.root;
  let localeRoots: ReadonlyArray<string> = [];
  let configuredLocaleRoot: string | undefined;
  let discoveryReady: Promise<void> = Promise.resolve();
  const currentOptions = (): MiraiIntlTransformOptions =>
    resolvedRoot ? { ...options, root: resolvedRoot } : options;
  const packageRoot = (): string =>
    resolve(resolvedRoot ?? options.root ?? process.cwd());
  const applyDiscovery = (loaded: LoadedConventionCatalog): void => {
    const discovery = loaded.discovery;
    if (!discovery) {
      throw new Error("Vite intl adapter requires convention discovery");
    }
    localeRoots = loaded.watch.roots.map(normalizedPath);
    configuredLocaleRoot = normalizedPath(
      resolve(loaded.repositoryRoot, discovery.localeRoot)
    );
  };
  const registerBuildWatches = (
    registrar: WatchRegistrar,
    loaded: LoadedConventionCatalog
  ): void => {
    // Watch config + locale roots only. Per-file watches are redundant with
    // configureServer root watches and amplify Vite graph invalidation.
    registrar.addWatchFile(loaded.configPath);
    for (const root of loaded.watch.roots.map(normalizedPath)) {
      registrar.addWatchFile(root);
    }
  };
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
        registerBuildWatches(this, loaded);
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
        registerBuildWatches(this, loaded);
      }
    },
    configResolved(config) {
      resolvedRoot ??= config.root;
    },
    configureServer(server) {
      const requireRestart = (file: string): void => {
        void isLocaleJson(file).then((matches) => {
          if (!matches) {
            return;
          }
          server.config.logger.error(restartMessage);
        });
      };
      const addLocaleWatchRoots = (): void => {
        const roots =
          localeRoots.length > 0
            ? localeRoots
            : [resolve(packageRoot(), "src/locales")];
        for (const root of roots) {
          server.watcher.add(root);
        }
      };
      // Discovery from buildStart is already available for fixtures; app boot
      // defers discovery and attaches watchers once it resolves.
      if (localeRoots.length > 0) {
        addLocaleWatchRoots();
      } else {
        void ensureDiscovery().then(addLocaleWatchRoots);
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
      await ensureDiscovery();
      if (!(await isLocaleJson(context.file))) {
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
    transform(code, id) {
      return transformMiraiIntlSource(code, id, currentOptions());
    },
  };
}
