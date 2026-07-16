import { resolve, sep } from "node:path";

import { regenerateMiraiIntlCatalog } from "./lifecycle";
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

function normalizedPath(path: string): string {
  return resolve(path).split(sep).join("/");
}

const restartMessage =
  "Translation sources changed. Restart Vite so mirai-intl can publish one reader-safe catalog before compilation.";

export function miraiIntlVite(
  options: MiraiIntlTransformOptions = {}
): MiraiIntlVitePlugin {
  let resolvedRoot = options.root;
  let localeRoots: ReadonlyArray<string> = [];
  let configuredLocaleRoot: string | undefined;
  const currentOptions = (): MiraiIntlTransformOptions =>
    resolvedRoot ? { ...options, root: resolvedRoot } : options;
  const isLocaleJson = (file: string): boolean => {
    if (localeRoots.length === 0 || !file.endsWith(".json")) {
      return false;
    }
    const normalized = normalizedPath(file);
    return [...localeRoots, configuredLocaleRoot].some(
      (root) =>
        root !== undefined &&
        (normalized === root || normalized.startsWith(`${root}/`))
    );
  };
  return {
    async buildStart() {
      const result = await regenerateMiraiIntlCatalog(currentOptions());
      const discovery = result.loaded.discovery;
      if (!discovery) {
        throw new Error("Vite intl adapter requires convention discovery");
      }
      localeRoots = result.loaded.watch.roots.map(normalizedPath);
      configuredLocaleRoot = normalizedPath(
        resolve(
          resolvedRoot ?? result.loaded.repositoryRoot,
          discovery.localeRoot
        )
      );
      this.addWatchFile(result.loaded.configPath);
      for (const root of localeRoots) {
        this.addWatchFile(root);
      }
      for (const file of result.loaded.watch.files) {
        this.addWatchFile(file);
      }
    },
    configResolved(config) {
      resolvedRoot ??= config.root;
    },
    configureServer(server) {
      const requireRestart = (file: string): void => {
        if (!isLocaleJson(file)) {
          return;
        }
        server.config.logger.error(restartMessage);
      };
      const roots =
        localeRoots.length > 0
          ? localeRoots
          : [resolve(resolvedRoot ?? process.cwd(), "src/locales")];
      for (const root of roots) {
        server.watcher.add(root);
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
      if (!isLocaleJson(context.file)) {
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
