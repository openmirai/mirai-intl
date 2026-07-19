import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { emptyObjectSchema } from "@openmirai/intl-abi";
import {
  compileCatalog,
  emitArtifacts,
  generatedSourceHeader,
} from "@openmirai/intl-compiler/internal";
import type {
  CatalogSource,
  MessageSource,
} from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

describe("compact catalog contracts", () => {
  it("emits one header-only private message module for an empty catalog", () => {
    const artifacts = emitArtifacts(
      compileCatalog({
        ...catalogFixtureSource,
        formatterVersions: {},
        messages: [],
      }),
      "precompiled",
      { compact: true }
    );
    const contract = artifacts["catalog.schema.gen.d.ts"];

    expect(contract).toContain("type _S={}");
    expect(contract).toContain("export type CatalogContract=_T<_S>");
    expect(contract).not.toContain("catalogTree");
    expect(artifacts).not.toHaveProperty("catalog.descriptors.gen.d.mts");
    expect(artifacts).not.toHaveProperty("catalog.descriptors.gen.mjs");
    expect(artifacts["catalog.messages.gen.mjs"]).toBe(
      `${generatedSourceHeader}\n`
    );
  });

  it("preserves exact catalog/path/value/kind/tag types in the public contract", async () => {
    const artifacts = emitArtifacts(
      compileCatalog(catalogFixtureSource),
      "precompiled",
      { compact: true }
    );
    const contract = artifacts["catalog.schema.gen.d.ts"];
    const root = await mkdtemp(resolve(tmpdir(), "mirai-intl-compact-types-"));
    try {
      await writeFile(
        resolve(root, "catalog.schema.gen.d.ts"),
        contract,
        "utf8"
      );
      await writeFile(
        resolve(root, "consumer.ts"),
        [
          'import type { RichDescriptor, TextDescriptor } from "@openmirai/intl-abi";',
          'import type { ValueDescriptor } from "@openmirai/intl-abi";',
          'import type { CatalogContract } from "./catalog.schema.gen";',
          'type Greeting = TextDescriptor<{ readonly name: string }, "catalog-fixture", "greeting.morning">;',
          'type Legal = RichDescriptor<{ readonly name: string }, "legal" | "strong", "catalog-fixture", "rich.legal">;',
          'type PassRate = ValueDescriptor<{}, number, "catalog-fixture", "statistics.passRate">;',
          "declare const catalog: CatalogContract;",
          "catalog.greeting.morning satisfies Greeting;",
          "catalog.rich.legal satisfies Legal;",
          "catalog.statistics.passRate satisfies PassRate;",
          'catalog.greeting.morning.path satisfies "greeting.morning";',
          "// @ts-expect-error compact identity must not widen to another path",
          'catalog.greeting.morning.path satisfies "greeting.evening";',
          "",
        ].join("\n"),
        "utf8"
      );
      await writeFile(
        resolve(root, "tsconfig.json"),
        `${JSON.stringify({
          compilerOptions: {
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            paths: {
              "@openmirai/intl-abi": [
                resolve(import.meta.dirname, "../../abi/src/index.ts"),
              ],
            },
            skipLibCheck: false,
            strict: true,
            target: "ES2024",
            types: [],
          },
          include: ["catalog.schema.gen.d.ts", "consumer.ts"],
        })}\n`,
        "utf8"
      );
      for (const alias of ["typescript-5-9", "typescript-6", "typescript-7"]) {
        const result = spawnSync(
          process.execPath,
          [
            resolve(
              import.meta.dirname,
              `../../../node_modules/${alias}/bin/tsc`
            ),
            "--project",
            resolve(root, "tsconfig.json"),
            "--pretty",
            "false",
          ],
          {
            encoding: "utf8",
            killSignal: "SIGKILL",
            maxBuffer: 1024 * 1024,
            shell: false,
            timeout: 30_000,
          }
        );

        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(`${result.stdout}${result.stderr}`).toBe("");
        expect(result.status).toBe(0);
      }
      expect(contract).toContain("export type CatalogContract=_T<_S>");
      expect(contract).not.toContain("catalogTree");
      expect(artifacts).not.toHaveProperty("catalog.descriptors.gen.mjs");
      expect(artifacts["catalog.provenance.gen.json"]).toContain(
        '"descriptorExport":"m0"'
      );
      expect(artifacts["catalog.provenance.gen.json"]).toMatch(
        /"module":"catalog\.messages\.gen\.mjs"/u
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);

  it("stays below the dashboard-sized declaration ceiling without private declarations", () => {
    const messages: Array<MessageSource> = Array.from(
      { length: 700 },
      (_, index) => ({
        kind: "text",
        path: `pages.locale.organization.detail.components.section${Math.floor(index / 20)}.message${index}`,
        provenance: `compact-declaration.test.ts:${index}`,
        resultSchema: { type: "string" },
        translations: { en: `Message ${index}`, th: `ข้อความ ${index}` },
        valuesSchema: emptyObjectSchema,
      })
    );
    const source = {
      buildId: "compact-size",
      catalogPackage: "@mirai/intl-catalog-compact-size",
      id: "compact-size",
      locales: ["en", "th"],
      messages,
      rendererCapabilityId: "precompiled-v1",
      sourceLocale: "en",
    } satisfies CatalogSource;

    const compactArtifacts = emitArtifacts(
      compileCatalog(source),
      "precompiled",
      {
        compact: true,
      }
    );
    const compact = compactArtifacts["catalog.schema.gen.d.ts"];
    const legacy = emitArtifacts(compileCatalog(source), "precompiled");
    const legacyContract = legacy["catalog.schema.gen.d.ts"];
    const privateModule = compactArtifacts["catalog.messages.gen.mjs"];
    if (!privateModule) {
      throw new Error("Compact output is missing catalog.messages.gen.mjs");
    }

    expect(Buffer.byteLength(compact, "utf8")).toBeLessThanOrEqual(34_610);
    expect(Buffer.byteLength(compact, "utf8")).toBeLessThan(
      Buffer.byteLength(legacyContract, "utf8") / 2
    );
    expect(privateModule.match(/export const m\d+ =/gu)).toHaveLength(700);
    expect(privateModule.match(/export const r\d+ =/gu)).toHaveLength(700);
    expect(privateModule).not.toContain("catalogTree");
    expect(privateModule).not.toContain("namespace_");
    expect(privateModule).not.toContain("registry");
    expect(
      Object.keys(compactArtifacts).some(
        (name) => name.startsWith("catalog.message.") && name.endsWith(".d.mts")
      )
    ).toBe(false);
    expect(compactArtifacts).not.toHaveProperty(
      "catalog.descriptors.gen.d.mts"
    );
  });
});
