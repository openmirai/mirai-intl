import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ensureMiraiIntlCatalog,
  regenerateMiraiIntlCatalog,
} from "../src/lifecycle";

const dashboardFixture = resolve(
  import.meta.dirname,
  "../../../fixtures/convention/dashboard"
);

describe("catalog lifecycle caching", () => {
  it("deduplicates concurrent work while rechecking completed ensures for stale sources", async () => {
    const container = await mkdtemp(join(tmpdir(), "mirai-intl-lifecycle-"));
    const root = join(container, "dashboard");
    await cp(dashboardFixture, root, { recursive: true });
    const options = { root };

    try {
      const first = ensureMiraiIntlCatalog(options);
      const concurrent = ensureMiraiIntlCatalog(options);
      expect(concurrent).toBe(first);

      const state = await first;
      const repeated = ensureMiraiIntlCatalog(options);
      expect(repeated).not.toBe(first);
      await expect(repeated).resolves.toMatchObject({ changed: false });

      await writeFile(
        join(root, "src/locales/global/en.json"),
        `${JSON.stringify({ appName: "Changed dashboard" })}\n`,
        "utf8"
      );
      await writeFile(
        join(root, "src/locales/global/th.json"),
        `${JSON.stringify({ appName: "แดชบอร์ดที่เปลี่ยน" })}\n`,
        "utf8"
      );
      const stale = await ensureMiraiIntlCatalog(options);
      expect(stale.changed).toBe(true);
      expect(stale.loaded.inputs.sourceFiles).not.toEqual(
        state.loaded.inputs.sourceFiles
      );

      const regenerated = regenerateMiraiIntlCatalog(options);
      expect(regenerated).not.toBe(first);
      const regeneratedState = await regenerated;
      const afterRegeneration = ensureMiraiIntlCatalog(options);
      expect(afterRegeneration).not.toBe(regenerated);
      await expect(afterRegeneration).resolves.toMatchObject({
        changed: false,
        loaded: regeneratedState.loaded,
      });
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  }, 30_000);
});
