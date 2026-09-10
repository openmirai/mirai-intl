import { readFileSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { generateConventionCatalog } from "../src/catalog";
import { proveConventionCatalog } from "../src/proof";
import { readConventionCheckReceipt } from "../src/check-receipt";
import {
  buildIntlCheckReceiptV3,
  hashIntlCheckReceiptV3,
  parseIntlCheckReceiptV3,
} from "../src/authorization-snapshot";
import { sha256 } from "../src/canonical";
import {
  exportAuthorityBundle,
  reuseAuthorityBundle,
  verifyConventionBuildReceipt,
} from "../src/verify";

const source = `import { useTranslations } from '@/i18n/adapter';
export function Probe() { const { t } = useTranslations('pages.auth.signin'); return t('greeting'); }\n`;
async function fixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "semantic-receipt-"))
  );
  const root = join(directory, "producer"),
    app = join(root, "apps/app");
  await mkdir(join(app, "src/i18n"), { recursive: true });
  await mkdir(join(app, "locales/pages/auth/signin"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  await writeFile(
    join(root, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  apps/app:\n    dependencies: {}\n"
  );
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({
      name: "@fixture/app",
      version: "1.0.0",
      dependencies: { vite: "8.1.4" },
    })
  );
  await writeFile(
    join(app, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
    })
  );
  await writeFile(
    join(app, "src/i18n/adapter.d.ts"),
    "export declare function useTranslations(namespace?: string): { t: (key: string) => string };\n"
  );
  await writeFile(join(app, "src/page.tsx"), source);
  for (const locale of ["en", "th"]) {
    await writeFile(
      join(app, `locales/pages/auth/signin/${locale}.json`),
      JSON.stringify({ greeting: locale === "en" ? "Hello" : "สวัสดี" })
    );
  }
  const consumer = join(directory, "consumer");
  await cp(root, consumer, { recursive: true });
  await generateConventionCatalog(app, { collectEnvironment: false });
  await proveConventionCatalog(app);
  const selected = await readConventionCheckReceipt(app);
  const options = {
    readSourceBytes: (path: string) => readFileSync(join(root, path)),
  };
  const receipt = parseIntlCheckReceiptV3(selected.receipt, undefined, options);
  const archive = join(directory, "authority.tar");
  await exportAuthorityBundle({ root, archive });
  return { directory, root, app, consumer, receipt, options, archive };
}
let state: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  state = await fixture();
}, 60_000);
afterAll(async () => {
  if (state) {
    await rm(state.directory, { recursive: true, force: true });
  }
});

it("generated and proved semantic activity verifies and reuses after portable remount", async () => {
  const observation = state.receipt.tables.unknownBoundaries.find(
    (entry) => entry.kind === "semantic-source"
  );
  expect(observation).toMatchObject({
    source: "apps/app/src/page.tsx",
    reason: "semantic-analysis-required",
    nodeKind: "SourceFile",
    byteStart: 0,
    byteEnd: Buffer.byteLength(source),
    sourceSliceHash: sha256(source),
  });
  const before = await verifyConventionBuildReceipt(state.app);
  const archiveHash = sha256(await readFile(state.archive));
  expect(
    await reuseAuthorityBundle({ root: state.consumer, archive: state.archive })
  ).toMatchObject({ status: "reused", bundle: { catalogs: ["apps/app"] } });
  const after = await verifyConventionBuildReceipt(
    join(state.consumer, "apps/app")
  );
  expect(after.receipt).toEqual(before.receipt);
  expect(after).toMatchObject({
    verifiedCatalogs: 1,
    catalogCompilations: 0,
    artifactEmissions: 0,
    buildSemanticAnalysisRuns: 0,
  });
  expect(sha256(await readFile(state.archive))).toBe(archiveHash);
  expect(
    await readFile(join(state.consumer, "apps/app/src/page.tsx"), "utf8")
  ).toBe(source);
}, 60_000);

function forgedObservation(change: "kind" | "reason" | "range") {
  return {
    ...state.receipt,
    tables: {
      ...state.receipt.tables,
      unknownBoundaries: state.receipt.tables.unknownBoundaries.map((entry) => {
        if (entry.kind !== "semantic-source") {
          return entry;
        }
        const altered = {
          ...entry,
          ...(change === "kind" ? { kind: "import" as const } : {}),
          ...(change === "reason"
            ? { reason: "nonliteral-specifier" as const }
            : {}),
          ...(change === "range"
            ? {
                byteEnd: entry.byteEnd - 1,
                sourceSliceHash: sha256(Buffer.from(source).subarray(0, -1)),
              }
            : {}),
        };
        return {
          ...altered,
          nodeHash: hashIntlCheckReceiptV3("unknown-boundary-node", [
            altered.kind,
            altered.nodeKind,
            altered.observationOrdinal,
            altered.reason,
            altered.source,
            altered.byteStart,
            altered.byteEnd,
            altered.sourceSliceHash,
          ]),
        };
      }),
    },
  };
}

it.each(["kind", "reason"] as const)(
  "rejects a forged semantic %s pairing through actual receipt parsing",
  (change) => {
    expect(() =>
      parseIntlCheckReceiptV3(
        forgedObservation(change),
        undefined,
        state.options
      )
    ).toThrow(/semantic activity must bind the complete source file/u);
  }
);

it("rejects a truncated whole-source observation after public rebuilding recomputes named hashes", () => {
  expect(
    buildIntlCheckReceiptV3({ ...state.receipt }, undefined, state.options)
  ).toEqual(state.receipt);
  // The public builder recomputes receipt hashes before relationship validation;
  // the supplied node and slice hashes also match the forged shortened range.
  expect(() =>
    buildIntlCheckReceiptV3(
      forgedObservation("range"),
      undefined,
      state.options
    )
  ).toThrow(
    /semantic activity must cover the complete receipt-bound source bytes/u
  );
});

it("rejects same-length source mutation during receipt validation, verification and reuse", async () => {
  const changed = source.replace("greeting", "missingx");
  expect(Buffer.byteLength(changed)).toBe(Buffer.byteLength(source));
  const producerPath = join(state.app, "src/page.tsx");
  const consumerPath = join(state.consumer, "apps/app/src/page.tsx");
  await writeFile(producerPath, changed);
  await writeFile(consumerPath, changed);
  try {
    expect(() =>
      parseIntlCheckReceiptV3(state.receipt, undefined, state.options)
    ).toThrow(/sourceSliceHash/u);
    await expect(verifyConventionBuildReceipt(state.app)).rejects.toThrow(
      "Mirai Intl selected check receipt V3 is invalid"
    );
    expect(
      await reuseAuthorityBundle({
        root: state.consumer,
        archive: state.archive,
      })
    ).toMatchObject({
      status: "miss",
      reason: "candidate-rejected",
      recoverySafe: true,
    });
    expect(await readFile(consumerPath, "utf8")).toBe(changed);
  } finally {
    await writeFile(producerPath, source);
    await writeFile(consumerPath, source);
  }
}, 60_000);
