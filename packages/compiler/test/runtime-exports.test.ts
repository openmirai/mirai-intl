import {
  compileCatalog,
  emitArtifacts,
} from "@openmirai/intl-compiler/internal";
import { describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

function emittedJsonExport(module: string, name: string): unknown {
  const prefix = `export const ${name} = `;
  const line = module.split("\n").find((entry) => entry.startsWith(prefix));
  if (!line?.endsWith(";")) {
    throw new Error(`Missing emitted JSON export ${name}`);
  }
  return JSON.parse(line.slice(prefix.length, -1));
}

function requiredArtifact(
  artifacts: Readonly<Record<string, string>>,
  name: string
): string {
  const artifact = artifacts[name];
  if (artifact === undefined) {
    throw new Error(`Missing emitted artifact ${name}`);
  }
  return artifact;
}

function emittedPrecompiledRuntimeMessage(
  module: string,
  name: string
): unknown {
  const prefix = `export const ${name} = /* @__PURE__ */ createPrecompiledRuntimeMessage(`;
  const line = module.split("\n").find((entry) => entry.startsWith(prefix));
  const rendererMarker = ", precompiledRenderer_";
  const rendererStart = line?.lastIndexOf(rendererMarker) ?? -1;
  if (!line?.endsWith(");") || rendererStart < prefix.length) {
    throw new Error(`Missing emitted precompiled runtime message ${name}`);
  }
  return JSON.parse(line.slice(prefix.length, rendererStart));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectedI18nextResources(
  output: ReturnType<typeof compileCatalog>
): Readonly<Record<string, unknown>> {
  const resources: Record<string, unknown> = {};
  for (const locale of output.catalog.manifest.locales) {
    const translation: Record<string, unknown> = {};
    for (const message of output.composition.messages) {
      let current = translation;
      const parts = message.path.split(".");
      for (const [index, part] of parts.entries()) {
        if (index === parts.length - 1) {
          current[part] = message.translations[locale];
          continue;
        }
        const existing = current[part];
        if (isRecord(existing)) {
          current = existing;
        } else {
          const child: Record<string, unknown> = {};
          current[part] = child;
          current = child;
        }
      }
    }
    resources[locale] = { translation };
  }
  return resources;
}

describe("tree-shakeable runtime exports", () => {
  it("emits private descriptors, a minimal contract, and i18next resource parity", () => {
    const output = compileCatalog(catalogFixtureSource);
    const artifacts = emitArtifacts(output, "constants");
    const module = artifacts["catalog.descriptors.gen.mjs"];
    const descriptorDeclaration = artifacts["catalog.descriptors.gen.d.mts"];
    const contractDeclaration = artifacts["catalog.schema.gen.d.ts"];

    expect(emittedJsonExport(module, "catalogManifest")).toEqual(
      output.catalog.manifest
    );
    expect(
      emittedJsonExport(module, "runtimeMessage_greeting_morning")
    ).toEqual(
      output.catalog.messages.find(
        (message) => message.path === "greeting.morning"
      )
    );
    expect(descriptorDeclaration).toContain(
      "export declare const catalogManifest:CatalogManifest;"
    );
    expect(descriptorDeclaration).toContain(
      "export declare const runtimeMessage_greeting_morning: RuntimeMessage;"
    );
    expect(descriptorDeclaration).toContain(
      "export declare const catalogTree:CatalogContract;"
    );
    expect(contractDeclaration).toMatch(/export type CatalogContract\b/u);
    expect(contractDeclaration).not.toMatch(
      /catalogManifest|catalogTree|runtimeMessage_|message_/u
    );
    expect(descriptorDeclaration).not.toBe(contractDeclaration);
    expect(artifacts["catalog.manifest.gen.d.mts"]).toContain(
      'catalogManifest:TypedCatalogManifest<CatalogContract,readonly ["en","th"],"en">'
    );
    expect(artifacts["catalog.manifest.gen.d.mts"]).toContain(
      'from "./catalog.schema.gen.js"'
    );
    const expectedResources = expectedI18nextResources(output);
    for (const [index, locale] of output.catalog.manifest.locales.entries()) {
      expect(
        emittedJsonExport(
          requiredArtifact(artifacts, `catalog.resource.${index}.gen.mjs`),
          "catalogResource"
        )
      ).toEqual(expectedResources[locale]);
    }
    expect(artifacts["catalog.resources.gen.mjs"]).not.toContain(
      "Certificate verification"
    );
    expect(artifacts["catalog.resources.gen.mjs"]).toContain(
      'import("./catalog.resource.0.gen.mjs")'
    );
    expect(artifacts["catalog.resources.gen.mjs"]).toContain(
      "const catalogResourceLoaders = new Map(["
    );
    expect(artifacts["catalog.resources.gen.mjs"]).toContain(
      "catalogResourceLoaders.has(locale)"
    );
    expect(artifacts["catalog.resources.gen.d.mts"]).toContain(
      'export type CatalogLocale="en" | "th";'
    );
  });

  it("omits portable payload IR from precompiled runtime-message exports", () => {
    const output = compileCatalog(catalogFixtureSource);
    const module = emitArtifacts(output, "precompiled")[
      "catalog.descriptors.gen.mjs"
    ];
    const emitted = emittedPrecompiledRuntimeMessage(
      module,
      "runtimeMessage_greeting_morning"
    );

    expect(emitted).toEqual(
      Object.fromEntries(
        Object.entries(
          output.catalog.messages.find(
            (message) => message.path === "greeting.morning"
          ) ?? {}
        ).filter(([key]) => key !== "localeNodes" && key !== "localeValues")
      )
    );
    expect(emitted).not.toHaveProperty("localeNodes");
    expect(emitted).not.toHaveProperty("localeValues");
    expect(module).toContain(
      "const precompiledRenderer_greeting_morning = /* @__PURE__ */ createPrecompiledLocaleRenderer"
    );
    expect(module).toContain(
      "export const message_greeting_morning = /* @__PURE__ */ createPrecompiledDescriptor"
    );
  });

  it("emits compact catalogs as exact private message modules", () => {
    const output = compileCatalog(catalogFixtureSource);
    const artifacts = emitArtifacts(output, "precompiled", { compact: true });
    const provenance = JSON.parse(artifacts["catalog.provenance.gen.json"]) as {
      exports: ReadonlyArray<{
        descriptorExport: string;
        module: string;
        path: string;
        runtimeExport: string;
      }>;
    };
    const greeting = provenance.exports.find(
      ({ path }) => path === "greeting.morning"
    );
    expect(greeting).toMatchObject({
      descriptorExport: "m7",
      module: "catalog.messages.gen.mjs",
      runtimeExport: "r7",
    });
    const module = artifacts[greeting?.module ?? ""];
    expect(module).toContain("Good morning");
    expect(module).toContain("Certificate verification");
    expect(module).toContain("export const m7 =");
    expect(module).not.toContain("catalogTree");
    expect(artifacts).not.toHaveProperty("catalog.descriptors.gen.mjs");
    expect(
      Object.keys(artifacts).filter(
        (name) => name === "catalog.messages.gen.mjs"
      )
    ).toHaveLength(1);
    expect(Object.keys(artifacts)).toHaveLength(
      9 + output.catalog.manifest.locales.length
    );
  });

  it("keeps locale guards prototype-safe and congruent with the manifest", async () => {
    const output = compileCatalog(catalogFixtureSource);
    const artifacts = emitArtifacts(output, "precompiled", { compact: true });
    const root = await mkdtemp(join(tmpdir(), "mirai-intl-resources-"));
    try {
      for (const [name, source] of Object.entries(artifacts)) {
        if (name.endsWith(".mjs")) {
          await writeFile(join(root, name), source, "utf8");
        }
      }
      const resources = (await import(
        `${pathToFileURL(join(root, "catalog.resources.gen.mjs")).href}?test=${Date.now()}`
      )) as {
        isCatalogLocale(value: unknown): boolean;
        loadCatalogResource(locale: string): Promise<unknown>;
      };

      expect(
        output.catalog.manifest.locales.filter(resources.isCatalogLocale)
      ).toEqual(output.catalog.manifest.locales);
      for (const hostile of [
        "__proto__",
        "constructor",
        "toString",
        null,
        undefined,
        1,
        {},
      ]) {
        expect(resources.isCatalogLocale(hostile)).toBe(false);
      }
      await expect(resources.loadCatalogResource("__proto__")).rejects.toThrow(
        /Unknown catalog locale/u
      );
      await expect(resources.loadCatalogResource("en")).resolves.toEqual(
        expectedI18nextResources(output).en
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
