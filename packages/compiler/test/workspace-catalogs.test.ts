import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { discoverWorkspaceCatalogs } from "../src/workspace-catalogs";

async function writeFiles(root: string, files: ReadonlyArray<string>) {
  for (const file of files) {
    await mkdir(join(root, file, ".."), { recursive: true });
    await writeFile(join(root, file), "{}\n", "utf8");
  }
}

describe("workspace catalog discovery", () => {
  it("finds configured and package-root convention catalogs, and nothing in a nested workspace or deeper in a package", async () => {
    const root = await realpath(
      await mkdtemp(join(tmpdir(), "mirai-intl-workspace-catalogs-"))
    );
    try {
      await writeFiles(root, [
        "pnpm-workspace.yaml",
        "apps/staff/mirai-intl.config.json",
        "apps/staff/package.json",
        "packages/i18n/package.json",
        "packages/i18n/locales/en.json",
        // Another workspace inside this one: its own root checks it.
        "apps/landing/pnpm-workspace.yaml",
        "apps/landing/mirai-intl.config.json",
        "apps/landing/package.json",
        // Message files deep inside a package, with no package.json of their own.
        "services/email-consumer/package.json",
        "services/email-consumer/src/emails/locales/en.json",
      ]);
      await expect(discoverWorkspaceCatalogs(root)).resolves.toEqual([
        join(root, "apps/staff"),
        join(root, "packages/i18n"),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
