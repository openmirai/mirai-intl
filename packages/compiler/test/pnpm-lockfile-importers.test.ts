import { describe, expect, it } from "vitest";

import { lockfileHasImporter } from "../src/catalog";

const singleDocumentLockfile = [
  "lockfileVersion: '9.0'",
  "importers:",
  "",
  "  .:",
  "    dependencies: {}",
  "",
  "  packages/i18n:",
  "    dependencies: {}",
  "",
  "packages: {}",
  "",
].join("\n");

const pnpm12Lockfile = [
  "---",
  "lockfileVersion: '9.0'",
  "",
  "importers:",
  "",
  "  .:",
  "    configDependencies: {}",
  "    packageManagerDependencies:",
  "      pnpm:",
  "        specifier: 12.0.0",
  "        version: 12.0.0",
  "",
  "packages: {}",
  "",
  "snapshots: {}",
  "",
  "---",
  "lockfileVersion: '9.0'",
  "",
  "settings:",
  "  autoInstallPeers: true",
  "  excludeLinksFromLockfile: false",
  "",
  "importers:",
  "",
  "  .:",
  "    devDependencies: {}",
  "",
  "  packages/i18n:",
  "    dependencies: {}",
  "",
  "packages: {}",
  "",
].join("\n");

describe("lockfileHasImporter", () => {
  it("reads importers from a single-document pnpm lockfile", () => {
    expect(lockfileHasImporter(singleDocumentLockfile, "packages/i18n")).toBe(
      true
    );
    expect(lockfileHasImporter(singleDocumentLockfile, "apps/admin")).toBe(
      false
    );
  });

  it("reads workspace importers from the last document of a pnpm 12 lockfile", () => {
    expect(lockfileHasImporter(pnpm12Lockfile, "packages/i18n")).toBe(true);
    expect(lockfileHasImporter(pnpm12Lockfile, ".")).toBe(true);
    expect(lockfileHasImporter(pnpm12Lockfile, "apps/admin")).toBe(false);
  });

  it("accepts a CRLF pnpm 12 lockfile", () => {
    expect(
      lockfileHasImporter(
        pnpm12Lockfile.replaceAll("\n", "\r\n"),
        "packages/i18n"
      )
    ).toBe(true);
  });
});
