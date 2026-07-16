import { fileURLToPath } from "node:url";

import { ensureMiraiIntlCatalog } from "./lifecycle";
import type { MiraiIntlTransformOptions } from "./transform";

type JsonValue =
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | Readonly<{ [key: string]: JsonValue }>;

type TurbopackLoader = Readonly<{
  loader: string;
  options: Readonly<Record<string, JsonValue>>;
}>;

type TurbopackRule = Readonly<{
  condition?: Readonly<{ not: "foreign" }>;
  loaders?: ReadonlyArray<string | TurbopackLoader>;
}>;

type TurbopackRuleCollection =
  | TurbopackRule
  | ReadonlyArray<string | TurbopackLoader | TurbopackRule>;

type WebpackConfig = Readonly<{
  module?: Readonly<{ rules?: ReadonlyArray<unknown> }>;
  plugins?: ReadonlyArray<unknown>;
  [key: string]: unknown;
}>;

type NextConfig = Readonly<{
  turbopack?: Readonly<{
    rules?: Readonly<Record<string, TurbopackRuleCollection>>;
    [key: string]: unknown;
  }>;
  webpack?: ((config: WebpackConfig, context: unknown) => WebpackConfig) | null;
  [key: string]: unknown;
}>;

export type MiraiIntlNextConfig = NextConfig;

const extensions = [
  "*.js",
  "*.jsx",
  "*.ts",
  "*.tsx",
  "*.mjs",
  "*.mts",
  "*.cjs",
  "*.cts",
] as const;

function loaderOptions(
  options: MiraiIntlTransformOptions
): Readonly<Record<string, JsonValue>> {
  return {
    generatedDirectory: options.generatedDirectory ?? "src/i18n/generated",
    root: options.root ?? process.cwd(),
  };
}

function appendTurbopackRule(
  existing: TurbopackRuleCollection | undefined,
  rule: TurbopackRule
): TurbopackRuleCollection {
  if (!existing) {
    return rule;
  }
  return Array.isArray(existing)
    ? [
        ...(existing as ReadonlyArray<
          string | TurbopackLoader | TurbopackRule
        >),
        rule,
      ]
    : [existing as TurbopackRule, rule];
}

export function withMiraiIntl<Config extends object>(
  config: Config,
  options: MiraiIntlTransformOptions = {}
): Config & MiraiIntlNextConfig {
  const nextConfig = config as unknown as NextConfig;
  const loader = fileURLToPath(new URL("./next-loader.js", import.meta.url));
  const configuredOptions = loaderOptions(options);
  const loaderItem = { loader, options: configuredOptions };
  const rule = {
    condition: { not: "foreign" },
    loaders: [loaderItem],
  } satisfies TurbopackRule;
  const existingRules = nextConfig.turbopack?.rules ?? {};
  const rules = { ...existingRules };
  for (const extension of extensions) {
    rules[extension] = appendTurbopackRule(existingRules[extension], rule);
  }

  const previousWebpack = nextConfig.webpack;
  const ensurePlugin = {
    apply(
      compiler: Readonly<{
        hooks: Readonly<{
          beforeCompile: Readonly<{
            tapPromise(name: string, callback: () => Promise<unknown>): void;
          }>;
        }>;
      }>
    ): void {
      compiler.hooks.beforeCompile.tapPromise("MiraiIntl", () =>
        ensureMiraiIntlCatalog(options)
      );
    },
  };
  return {
    ...config,
    turbopack: {
      ...nextConfig.turbopack,
      rules,
    },
    webpack(webpackConfig: WebpackConfig, context: unknown): WebpackConfig {
      const configured = previousWebpack
        ? previousWebpack(webpackConfig, context)
        : webpackConfig;
      return {
        ...configured,
        module: {
          ...configured.module,
          rules: [
            ...(configured.module?.rules ?? []),
            {
              enforce: "pre",
              exclude: /node_modules/u,
              test: /\.[cm]?[jt]sx?$/u,
              use: [{ loader, options: configuredOptions }],
            },
          ],
        },
        plugins: [...(configured.plugins ?? []), ensurePlugin],
      };
    },
  } as Config & MiraiIntlNextConfig;
}
