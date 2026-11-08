import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type * as Transform from "../src/transform";
import { proveConventionCatalog } from "../src/proof";
import { verifyConventionBuildReceipt } from "../src/verify";

// Pads one source's semantic evidence past the receipt limit, as an analyzer
// that broke its own budget would, to prove the receipt writer refuses it.
const padding = vi.hoisted(() => ({ source: undefined as string | undefined }));
vi.mock("../src/transform", async (original) => {
  const actual = await original<typeof Transform>();
  return {
    ...actual,
    transformMiraiIntlOwnerBatch: (
      entries: Parameters<typeof actual.transformMiraiIntlOwnerBatch>[0],
      ...rest: Array<unknown>
    ) =>
      Reflect.apply(actual.transformMiraiIntlOwnerBatch, undefined, [
        entries.map((entry) => {
          const evidence = entry.authorizationEvidence;
          if (
            !evidence ||
            !padding.source ||
            !entry.id.endsWith(padding.source)
          ) {
            return entry;
          }
          return {
            ...entry,
            authorizationEvidence: {
              ...evidence,
              record(value: Transform.MiraiIntlSemanticEvidence) {
                const providers = [...value.providers];
                for (
                  let index = 0;
                  providers.length <= value.providerRootLimit;
                  index += 1
                ) {
                  providers.push({
                    declarations: [],
                    kind: "workspace",
                    resolutions: [],
                    root: `lib/padding-${index}.ts`,
                  });
                }
                evidence.record({ ...value, providers });
              },
            },
          };
        }),
        ...rest,
      ]),
  };
});

const roots: Array<string> = [];
afterEach(async () => {
  padding.source = undefined;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  );
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fixture(chainLength: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mirai-intl-provider-limit-"));
  roots.push(root);
  await writeJson(join(root, "package.json"), {
    dependencies: { "@example/provider": "1.0.0", vite: "8.1.4" },
    name: "@example/provider-limit",
    version: "1.0.0",
  });
  await writeJson(join(root, "node_modules/@example/provider/package.json"), {
    exports: { ".": "./index.js" },
    name: "@example/provider",
    types: "./index.d.ts",
    version: "1.0.0",
  });
  await writeFile(
    join(root, "node_modules/@example/provider/index.d.ts"),
    'export declare const key: "greeting";\n'
  );
  await mkdir(join(root, "lib"), { recursive: true });
  await writeFile(
    join(root, "lib/keys.ts"),
    'export { key } from "@example/provider";\nimport "./chain-0";\n'
  );
  for (let index = 0; index < chainLength; index += 1) {
    await writeFile(
      join(root, `lib/chain-${index}.ts`),
      index === chainLength - 1
        ? "export {};\n"
        : `import "./chain-${index + 1}";\nexport {};\n`
    );
  }
  await writeJson(join(root, "src/locales/global/en.json"), {
    group: { greeting: "Hello" },
  });
  await writeJson(join(root, "src/locales/global/th.json"), {
    group: { greeting: "สวัสดี" },
  });
  await writeFile(
    join(root, "src/page.ts"),
    [
      'import { key } from "../lib/keys";',
      'import { useTranslations } from "x";',
      'import { catalogManifest } from "./i18n/generated";',
      'const { t } = useTranslations("group");',
      "export const page = t(key);",
      "export const manifest = catalogManifest;",
      "",
    ].join("\n")
  );
  await writeJson(join(root, "tsconfig.json"), {
    include: ["lib/**/*", "src/**/*"],
  });
  await writeJson(join(root, "mirai-intl.config.json"), {
    checkProjects: [{ path: "tsconfig.json", role: "owner" }],
  });
  return root;
}

describe("provider closure limit", () => {
  it("writes a verifiable receipt when unrelated imports overflow the provider budget", async () => {
    const root = await fixture(80);
    const receipt = await proveConventionCatalog(root);
    const closure = receipt.providerClosures.find(
      (entry) => entry.source === "src/page.ts"
    );
    expect(closure?.providerRootLimit).toBe(64);
    expect(closure?.providers).toHaveLength(64);
    await expect(verifyConventionBuildReceipt(root)).resolves.toMatchObject({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    });
  }, 120_000);

  it("refuses a closure over the limit by name instead of writing a corrupt receipt", async () => {
    const root = await fixture(2);
    padding.source = "/src/page.ts";
    await expect(proveConventionCatalog(root)).rejects.toThrow(
      "Mirai Intl provider closure of src/page.ts has 65 providers, over its limit of 64"
    );
  }, 120_000);
});
