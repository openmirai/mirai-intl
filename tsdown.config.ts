import { defineConfig } from "tsdown";

const shared = {
  deps: {
    skipNodeModulesBundle: true,
  },
  dts: {
    sourcemap: true,
  },
  fixedExtension: false,
  format: "esm",
  outDir: "dist",
  sourcemap: true,
  target: "es2024",
  tsconfig: "tsconfig.json",
} as const;

export default defineConfig([
  {
    ...shared,
    cwd: "packages/abi",
    entry: { index: "src/index.ts" },
    name: "@openmirai/intl-abi",
    platform: "neutral",
  },
  {
    ...shared,
    cwd: "packages/compiler",
    entry: {
      cli: "src/cli.ts",
      index: "src/index.ts",
      next: "src/next.ts",
      "next-loader": "src/next-loader.ts",
      transform: "src/transform.ts",
      vite: "src/vite.ts",
    },
    name: "@openmirai/intl-compiler",
    platform: "node",
  },
  {
    ...shared,
    cwd: "packages/runtime",
    entry: {
      index: "src/index.ts",
      node: "src/node.ts",
      react: "src/react.ts",
      "react-i18next": "src/react-i18next.ts",
      server: "src/server.ts",
    },
    name: "@openmirai/intl-runtime",
    platform: "neutral",
  },
]);
