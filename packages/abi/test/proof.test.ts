import type {
  IntlBuildVerificationCountersV2,
  IntlCheckReceiptV1,
  IntlCheckReceiptV2,
  IntlSemanticAuthorizationObservationV2,
} from "../src/index";
import { describe, expect, expectTypeOf, it } from "vitest";

const hash = "sha256:0123456789abcdef" as const;

const receipt = {
  application: {
    packageManifest: {
      hash,
      path: "package.json",
    },
    workspaceLockfile: {
      hash,
      path: "pnpm-lock.yaml",
    },
  },
  artifactAbi: "mirai-intl-artifact-v2",
  compilerManifest: [
    {
      hash,
      path: "node_modules/@openmirai/intl-compiler/dist/proof.js",
    },
  ],
  compilerManifestHash: hash,
  counters: {
    checkerProjects: 0,
    declarationFiles: 1,
    exceptions: 0,
    loadedLibFiles: 1,
    ownerProjects: 1,
    providerClosures: 1,
    providerRoots: 1,
    semanticAuthorizationRuns: 1,
    semanticFilesAnalyzed: 1,
    sourceFiles: 1,
    typescriptLibFiles: 1,
  },
  exceptions: [],
  exceptionsHash: hash,
  generationReceiptHash: hash,
  icu: {
    name: "@formatjs/icu-messageformat-parser",
    packageHash: hash,
    packageManifestHash: hash,
    version: "3.5.3",
  },
  projects: [
    {
      configManifest: [
        {
          extends: [],
          hash,
          path: "tsconfig.json",
          references: ["packages/app/tsconfig.json"],
        },
        {
          extends: ["../../tsconfig.json"],
          hash,
          path: "packages/app/tsconfig.json",
          references: [],
        },
      ],
      configManifestHash: hash,
      normalizedOptions: {
        module: "ESNext",
        noEmit: true,
        paths: { "@app/*": ["src/*"] },
        strict: true,
      },
      normalizedOptionsHash: hash,
      path: "packages/app/tsconfig.json",
      role: "owner",
      rootFiles: ["packages/app/src/page.ts"],
    },
  ],
  providerClosures: [
    {
      ambientTypeFileLimit: 32,
      closureHash: hash,
      declarationHash: hash,
      declarations: [
        {
          hash,
          path: "node_modules/@types/node/index.d.ts",
        },
      ],
      libHash: hash,
      libs: [
        {
          hash,
          path: "node_modules/typescript/lib/lib.es2024.d.ts",
        },
      ],
      providerBudgetExceeded: false,
      providerRootLimit: 16,
      providers: [
        {
          declarationHash: hash,
          declarations: [
            {
              hash,
              path: "node_modules/@types/node/index.d.ts",
            },
          ],
          hash,
          kind: "external",
          root: "node_modules/@types/node",
        },
      ],
      source: "packages/app/src/page.ts",
    },
  ],
  runtimeAbi: "1.0.0",
  schemaVersion: 2,
  sourceAuthorizationHash: hash,
  sources: [
    {
      file: "packages/app/src/page.ts",
      hash,
      owner: "packages/app/tsconfig.json",
      providerClosureHash: hash,
      verdict: "accepted",
    },
  ],
  typescript: {
    libHash: hash,
    libs: [
      {
        hash,
        path: "node_modules/typescript/lib/lib.es2024.d.ts",
      },
    ],
    package: {
      name: "typescript",
      packageHash: hash,
      packageManifestHash: hash,
      version: "6.0.3",
    },
  },
} as const satisfies IntlCheckReceiptV2;

function assertMigrationTypes(
  currentReceipt: IntlCheckReceiptV2,
  staleReceipt: IntlCheckReceiptV1
): void {
  // @ts-expect-error V2 receipts are immutable.
  currentReceipt.projects.push(currentReceipt.projects[0]);
  // @ts-expect-error V1 is not silently accepted as V2.
  const migratedReceipt: IntlCheckReceiptV2 = staleReceipt;
  expectTypeOf(migratedReceipt).toEqualTypeOf<IntlCheckReceiptV2>();
}

describe("IntlCheckReceiptV2", () => {
  it("exposes the complete canonical authorization identity", () => {
    expectTypeOf(receipt).toMatchTypeOf<IntlCheckReceiptV2>();
    expect(receipt).toMatchObject({
      artifactAbi: "mirai-intl-artifact-v2",
      runtimeAbi: "1.0.0",
      schemaVersion: 2,
    });
    expect(receipt.projects[0]?.configManifest).toHaveLength(2);
    expect(receipt.compilerManifest).toHaveLength(1);
    expect(receipt.providerClosures[0]?.providers).toHaveLength(1);
    expect(receipt.counters.semanticAuthorizationRuns).toBe(1);
    expect(receipt.typescript.libs).toHaveLength(1);
  });

  it("keeps V1 distinct for explicit migration handling", () => {
    expectTypeOf<IntlCheckReceiptV1>().not.toEqualTypeOf<IntlCheckReceiptV2>();
    expectTypeOf(receipt.schemaVersion).toEqualTypeOf<2>();
    expectTypeOf(assertMigrationTypes).toBeFunction();
  });

  it("exposes semantic authorization and build verification observations", () => {
    const authorization = {
      semanticAuthorizationRuns: 1,
      semanticFilesAnalyzed: 1,
    } satisfies IntlSemanticAuthorizationObservationV2;
    const build = {
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    } satisfies IntlBuildVerificationCountersV2;

    expect(authorization.semanticAuthorizationRuns).toBe(1);
    expect(build).toEqual({
      buildReceiptVerifications: 1,
      buildSemanticAnalysisRuns: 0,
    });
    expectTypeOf(build.buildSemanticAnalysisRuns).toEqualTypeOf<0>();
  });
});
