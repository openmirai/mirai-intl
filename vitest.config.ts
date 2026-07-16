import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@openmirai/intl-compiler/internal",
        replacement: `${root}packages/compiler/src/internal.ts`,
      },
      {
        find: "@openmirai/intl-compiler",
        replacement: `${root}packages/compiler/src/index.ts`,
      },
      {
        find: "@openmirai/intl-abi",
        replacement: `${root}packages/abi/src/index.ts`,
      },
      {
        find: "@openmirai/intl-runtime",
        replacement: `${root}packages/runtime/src/index.ts`,
      },
    ],
  },
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
      provider: "v8",
    },
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
  },
});
