import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("generated artifact tooling configuration", () => {
  it.each([
    ".ignore",
    ".eslintignore",
    ".prettierignore",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    ".vscode/settings.json",
    ".zed/settings.json",
    "biome.json",
  ])("keeps generated outputs out of %s", async (configPath) => {
    const config = await readFile(path.join(workspaceRoot, configPath), "utf8");

    expect(config).toContain("src/i18n/generated");
    expect(config).toContain("test/generated");
  });
});
