import { resolve } from "node:path";

import { generateConventionCatalog, loadConventionCatalog } from "./catalog";
import type { LoadedConventionCatalog } from "./catalog";
import type { MiraiIntlTransformOptions } from "./transform";

export type GeneratedCatalogState = Readonly<{
  changed: boolean;
  loaded: LoadedConventionCatalog;
}>;

const generations = new Map<string, Promise<GeneratedCatalogState>>();
const activeEnsures = new Map<string, Promise<GeneratedCatalogState>>();
const processEnsures = new Map<string, Promise<GeneratedCatalogState>>();

function resolvedOptions(options: MiraiIntlTransformOptions): Readonly<{
  generatedRoot: string;
  key: string;
  root: string;
}> {
  const root = resolve(options.root ?? process.cwd());
  const generatedRoot = resolve(
    root,
    options.generatedDirectory ?? "src/i18n/generated"
  );
  return {
    generatedRoot,
    key: JSON.stringify([root, generatedRoot]),
    root,
  };
}

function serializeGeneration(
  options: MiraiIntlTransformOptions
): Promise<GeneratedCatalogState> {
  const { key, root } = resolvedOptions(options);
  const previous = generations.get(key);
  const run = (previous ?? Promise.resolve(undefined)).then(async () => {
    const result = await generateConventionCatalog(root, {
      collectEnvironment: false,
    });
    return {
      changed: result.write.changed,
      loaded: await loadConventionCatalog(root),
    };
  });
  const tracked = run.finally(() => {
    if (generations.get(key) === tracked) {
      generations.delete(key);
    }
  });
  generations.set(key, tracked);
  return tracked;
}

function cacheActiveEnsure(
  key: string,
  run: Promise<GeneratedCatalogState>
): Promise<GeneratedCatalogState> {
  const cached = run.finally(() => {
    if (activeEnsures.get(key) === cached) {
      activeEnsures.delete(key);
    }
  });
  activeEnsures.set(key, cached);
  return cached;
}

export function ensureMiraiIntlCatalog(
  options: MiraiIntlTransformOptions = {}
): Promise<GeneratedCatalogState> {
  const { key } = resolvedOptions(options);
  return (
    activeEnsures.get(key) ??
    cacheActiveEnsure(key, serializeGeneration(options))
  );
}

export function ensureMiraiIntlCatalogOnce(
  options: MiraiIntlTransformOptions = {}
): Promise<GeneratedCatalogState> {
  const { key } = resolvedOptions(options);
  const existing = processEnsures.get(key);
  if (existing) {
    return existing;
  }
  const run = ensureMiraiIntlCatalog(options).catch((error: unknown) => {
    if (processEnsures.get(key) === run) {
      processEnsures.delete(key);
    }
    throw error;
  });
  processEnsures.set(key, run);
  return run;
}

export function regenerateMiraiIntlCatalog(
  options: MiraiIntlTransformOptions = {}
): Promise<GeneratedCatalogState> {
  const { key } = resolvedOptions(options);
  const run = serializeGeneration(options).catch((error: unknown) => {
    if (processEnsures.get(key) === run) {
      processEnsures.delete(key);
    }
    throw error;
  });
  processEnsures.set(key, run);
  return run;
}
