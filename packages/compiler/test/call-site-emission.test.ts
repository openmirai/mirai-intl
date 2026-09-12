import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { MessageDescriptor, RuntimeMessage } from "@openmirai/intl-abi";
import type { PrecompiledMessageRenderer } from "@openmirai/intl-runtime";
import {
  compileCatalog,
  emitArtifacts,
} from "@openmirai/intl-compiler/internal";
import type { CatalogSource } from "@openmirai/intl-compiler/internal";
import { afterAll, describe, expect, it } from "vitest";

import { catalogFixtureSource } from "../../../test/fixtures/catalog";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const evaluationRoot = join(workspaceRoot, ".tmp/call-site-emission");
/**
 * `@openmirai/intl` is published, not linked into this workspace, so the
 * emitted specifier is rewritten to the exact built entry it resolves to. The
 * helpers below are imported from the same entry so brands and the embedded
 * runtime-message registry come from one module instance. `pack:smoke` covers
 * the published specifier itself.
 */
const runtimeEntry = pathToFileURL(
  join(workspaceRoot, "packages/intl/dist/runtime.js")
).href;
const runtime = (await import(runtimeEntry)) as Readonly<{
  getEmbeddedRuntimeMessage: (value: unknown) => RuntimeMessage | undefined;
  getPrecompiledRenderer: (
    value: unknown
  ) => PrecompiledMessageRenderer | undefined;
}>;
const { getEmbeddedRuntimeMessage, getPrecompiledRenderer } = runtime;

function runtimeMessageWithoutPayload(
  message: RuntimeMessage
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(message).filter(
      ([key]) => key !== "localeNodes" && key !== "localeValues"
    )
  );
}

async function evaluateMessagesModule(
  source: CatalogSource,
  name: string
): Promise<
  Readonly<{
    module: Readonly<Record<string, MessageDescriptor>>;
    output: ReturnType<typeof compileCatalog>;
  }>
> {
  const output = compileCatalog(source);
  const artifacts = emitArtifacts(output, "precompiled", { compact: true });
  const messages = artifacts["catalog.messages.gen.mjs"];
  if (!messages) {
    throw new Error("Compact emission is missing catalog.messages.gen.mjs");
  }
  const directory = join(evaluationRoot, name);
  await mkdir(directory, { recursive: true });
  const file = join(directory, "catalog.messages.gen.mjs");
  await writeFile(
    file,
    messages.replaceAll(
      '"@openmirai/intl/runtime"',
      JSON.stringify(runtimeEntry)
    ),
    "utf8"
  );
  const module = (await import(
    `${pathToFileURL(file).href}?evaluated=${Date.now()}`
  )) as Readonly<Record<string, MessageDescriptor>>;
  return { module, output };
}

afterAll(async () => {
  await rm(evaluationRoot, { force: true, recursive: true });
});

describe("shared call-site emission", () => {
  it("reconstructs every descriptor and runtime message the compiler computed", async () => {
    const { module, output } = await evaluateMessagesModule(
      catalogFixtureSource,
      "portable-ir-v1"
    );

    expect(output.catalog.manifest.rendererCapabilityId).toBe("portable-ir-v1");
    expect(output.catalog.messages.length).toBeGreaterThan(0);
    for (const [index, message] of output.catalog.messages.entries()) {
      const emitted = module[`m${index}`];
      const descriptor = output.descriptors[index];
      if (!emitted || !descriptor) {
        throw new Error(`Emitted module is missing m${index}`);
      }

      expect({ ...emitted }).toStrictEqual({ ...descriptor });
      expect(getEmbeddedRuntimeMessage(emitted)).toStrictEqual(
        runtimeMessageWithoutPayload(message)
      );
    }
  });

  it("keeps the inline renderer exactly where the runtime reads it", async () => {
    const portable = await evaluateMessagesModule(
      catalogFixtureSource,
      "renderer-portable"
    );
    const precompiled = await evaluateMessagesModule(
      { ...catalogFixtureSource, rendererCapabilityId: "precompiled-v1" },
      "renderer-precompiled"
    );

    for (const [index, message] of portable.output.catalog.messages.entries()) {
      expect(
        getPrecompiledRenderer(portable.module[`m${index}`]) !== undefined
      ).toBe(message.kind !== "text");
    }
    for (const index of precompiled.output.catalog.messages.keys()) {
      expect(
        getPrecompiledRenderer(precompiled.module[`m${index}`])
      ).toBeTypeOf("function");
    }

    const greeting = precompiled.output.catalog.messages.findIndex(
      (message) => message.path === "greeting.morning"
    );
    const renderer = getPrecompiledRenderer(precompiled.module[`m${greeting}`]);

    expect(
      renderer?.({
        escapeValues: false,
        formatters: {},
        locale: "en",
        values: { name: "Mali" },
      })
    ).toBe("Good morning, Mali");
    expect(
      getPrecompiledRenderer(
        getEmbeddedRuntimeMessage(precompiled.module[`m${greeting}`])
      )
    ).toBe(renderer);
  });
});
