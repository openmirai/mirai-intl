import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureMiraiIntlCatalog } from "../src/lifecycle";

const dashboardFixture = resolve(
  import.meta.dirname,
  "../../../fixtures/convention/dashboard"
);

describe("catalog ensure idempotence", () => {
  it("preserves current generated outputs byte-for-byte without rewriting them", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-ensure-"));
    const root = join(container, "dashboard");
    await cp(dashboardFixture, root, { recursive: true });

    try {
      const first = await ensureMiraiIntlCatalog({ root });
      const selector = join(root, "src/i18n/generated/current.json");
      const selected = JSON.parse(await readFile(selector, "utf8")) as {
        directory: string;
      };
      const contract = join(
        first.loaded.outputRoot,
        selected.directory,
        "catalog.contract.gen.json"
      );
      const before = {
        contractContent: await readFile(contract, "utf8"),
        contractStat: await stat(contract),
        selectorContent: await readFile(selector, "utf8"),
        selectorStat: await stat(selector),
      };

      const repeated = await ensureMiraiIntlCatalog({ root });
      expect(repeated.changed).toBe(false);
      expect(await readFile(selector, "utf8")).toBe(before.selectorContent);
      expect(await readFile(contract, "utf8")).toBe(before.contractContent);
      expect((await stat(selector)).ino).toBe(before.selectorStat.ino);
      expect((await stat(selector)).mtimeMs).toBe(before.selectorStat.mtimeMs);
      expect((await stat(contract)).ino).toBe(before.contractStat.ino);
      expect((await stat(contract)).mtimeMs).toBe(before.contractStat.mtimeMs);
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 30_000);
});
