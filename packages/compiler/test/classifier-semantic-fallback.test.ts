import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { analyzeConventionSources } from "../src/analyze-sources";
import { generateConventionCatalog } from "../src/catalog";
import {
  createMiraiIntlClassifierWorkspaceTransactionV3,
  revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3,
} from "../src/classifier-candidate";
import { validateMiraiIntlClassifierAuthorityV3 } from "../src/classifier-authority";
import { canonicalJson, sha256 } from "../src/canonical";

const roots: Array<string> = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
async function fixture(source: string) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "intl-semantic-fallback-"))
  );
  roots.push(root);
  await mkdir(join(root, "src/i18n"), { recursive: true });
  await mkdir(join(root, "locales/pages/auth/signin"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "semantic-fallback",
      version: "1.0.0",
      dependencies: { vite: "8.1.4" },
    })
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@/*": ["./src/*"] },
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
    })
  );
  for (const locale of ["en", "th"]) {
    await writeFile(
      join(root, `locales/pages/auth/signin/${locale}.json`),
      JSON.stringify({
        error: {
          form: {
            email: {
              required: locale === "en" ? "Email is required" : "กรุณากรอกอีเมล",
            },
          },
        },
      })
    );
  }
  // A resolvable local adapter, not an unresolved mock module named "x".
  // The supported hook returns an object containing t, as Auth's adapter does.
  await writeFile(
    join(root, "src/i18n/adapter.d.ts"),
    [
      "export declare function useTranslations(namespace?: string): { t: (key: string) => string };",
      "export declare function getServerTranslations(options: { namespace: string }): Promise<{ t: (key: string) => string }>;",
      "export declare const t: (key: string) => string;",
      "export default useTranslations;",
    ].join("\n")
  );
  await writeFile(join(root, "src/page.tsx"), source);
  await generateConventionCatalog(root, { collectEnvironment: false });
  return root;
}
const cases = [
  {
    name: "unknown key through resolved adapter hook",
    source: `import { useTranslations } from '@/i18n/adapter';
export function Probe() { const { t } = useTranslations('pages.auth.signin'); return t('strictnessMissing'); }`,
    diagnostic: /Unknown translation path pages.auth.signin.strictnessMissing/u,
  },
  {
    name: "widened dynamic key through resolved adapter hook",
    source: `import { useTranslations } from '@/i18n/adapter';
export function Probe({ key }: { key: string }) { const { t } = useTranslations('pages.auth.signin'); return t(key); }`,
    diagnostic: /Translation key expressions must be finite named-key unions/u,
  },
  {
    name: "valid aliased hook and destructured translator",
    source: `import { useTranslations as useAuth } from '@/i18n/adapter';
export function Probe() { const { t: translate } = useAuth('pages.auth.signin'); return translate('error.form.email.required'); }`,
  },
  {
    name: "unknown key through default imported hook",
    source: `import useTranslations from '@/i18n/adapter';
export function Probe() { const { t } = useTranslations('pages.auth.signin'); return t('strictnessMissing'); }`,
    diagnostic: /Unknown translation path pages.auth.signin.strictnessMissing/u,
  },
  {
    name: "unknown key through aliased server hook",
    source: `import { getServerTranslations as getAuth } from '@/i18n/adapter';
export async function Probe() { const { t } = await getAuth({ namespace: 'pages.auth.signin' }); return t('strictnessMissing'); }`,
    diagnostic: /Unknown translation path pages.auth.signin.strictnessMissing/u,
  },
  {
    name: "ordinary direct imported t preserves safe-unfiltered behavior",
    source: `import { t } from '@/i18n/adapter';
export const value = t('strictnessMissing');`,
  },
];

it.each(cases)(
  "approved filtering matches unfiltered semantics for $name",
  async ({ source, diagnostic }) => {
    const root = await fixture(source);
    const reference = await analyzeConventionSources(root, {
      classifier: { mode: "safe-unfiltered" },
    });
    // Assert the oracle itself reaches the intended predicate, not another error.
    expect(reference.diagnostics.length > 0).toBe(diagnostic !== undefined);
    expect(
      reference.diagnostics.map((entry) => entry.message).join("\n")
    ).toMatch(diagnostic ?? /^$/u);
    const transaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(root);
    const approved = await analyzeConventionSources(root, {
      classifier: { mode: "approved", transaction },
    });
    expect(approved.diagnostics).toEqual(reference.diagnostics);
    expect(approved.classifierProgramFiles).toContain(
      join(root, "src/page.tsx")
    );
    const authority = approved.classifierAuthorities[0];
    expect(authority).toBeDefined();
    if (!authority) {
      throw new Error("Missing approved owner authority");
    }
    expect(authority.indexBinding).toMatchObject({
      mode: "filtered",
      reasons: [],
    });
    expect(authority.sources).toContainEqual(
      expect.objectContaining({
        source: join(root, "src/page.tsx"),
        decision: "facade-unknown-active",
        requiresProgram: true,
      })
    );
    expect(approved.classifierProgramFiles).not.toContain(
      join(root, "src/i18n/adapter.d.ts")
    );
    expect(validateMiraiIntlClassifierAuthorityV3(authority)).toBe(authority);
    expect(() =>
      validateMiraiIntlClassifierAuthorityV3({
        ...authority,
        sources: authority.sources.map((entry) => ({
          ...entry,
          requiresProgram: false,
        })),
      })
    ).toThrow(/Invalid Mirai Intl classifier production authority/u);
    const finalized = await transaction.finalize();
    expect(finalized.authorities).toEqual(approved.classifierAuthorities);
    const projection = finalized.receiptProjections[0];
    const page = projection?.sources.find(
      (entry) => entry.source === join(root, "src/page.tsx")
    );
    if (!projection || !page) {
      throw new Error("Missing semantic source projection");
    }
    const observations = page.unknownBoundaries.filter(
      (entry) => entry.kind === "semantic-source"
    );
    expect(observations).toHaveLength(1);
    const observation = observations[0];
    if (!observation) {
      throw new Error("Missing semantic observation");
    }
    expect(observation).toMatchObject({
      reason: "semantic-analysis-required",
      source: join(root, "src/page.tsx"),
      nodeKind: "SourceFile",
      byteStart: 0,
      byteEnd: Buffer.byteLength(source),
      sourceSliceHash: sha256(source),
    });
    expect(observation.nodeHash).toBe(
      sha256(
        canonicalJson([
          "mirai-intl",
          "unknown-boundary-node",
          3,
          [
            observation.kind,
            observation.nodeKind,
            observation.observationOrdinal,
            observation.reason,
            observation.source,
            observation.byteStart,
            observation.byteEnd,
            observation.sourceSliceHash,
          ],
        ])
      )
    );
    // Transaction provenance rejects replacement projections, even before
    // their ledger hashes are examined. Receipt parser invariants are separate.
    for (const unknownBoundaries of [
      page.unknownBoundaries.filter(
        (entry) => entry.kind !== "semantic-source"
      ),
      page.unknownBoundaries.map((entry) => ({
        ...entry,
        byteEnd: entry.byteEnd + 1,
      })),
    ]) {
      await expect(
        revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3({
          ...finalized,
          receiptProjections: [
            {
              ...projection,
              sources: projection.sources.map((entry) =>
                entry === page ? { ...entry, unknownBoundaries } : entry
              ),
            },
          ],
        })
      ).rejects.toThrow(
        /Unapproved Mirai Intl classifier finalized transaction/u
      );
    }
    await revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(
      finalized
    );
  },
  60_000
);

it.each(["src/page.tsx", "src/i18n/adapter.d.ts"])(
  "rechecks semantic source/provider %s after finalized authority",
  async (path) => {
    const valid = cases.find(
      (entry) => entry.name === "valid aliased hook and destructured translator"
    );
    if (!valid) {
      throw new Error("Missing valid fixture");
    }
    const root = await fixture(valid.source);
    const transaction =
      await createMiraiIntlClassifierWorkspaceTransactionV3(root);
    const approved = await analyzeConventionSources(root, {
      classifier: { mode: "approved", transaction },
    });
    expect(approved.diagnostics).toEqual([]);
    expect(approved.classifierProgramFiles).toContain(
      join(root, "src/page.tsx")
    );
    const finalized = await transaction.finalize();
    const original = await readFile(join(root, path), "utf8");
    await writeFile(
      join(root, path),
      `${original}\nimport './new-boundary';\n`
    );
    await expect(
      revalidateMiraiIntlClassifierFinalizedTransactionForCommitV3(finalized)
    ).rejects.toThrow(/source mutated/u);
  },
  60_000
);
