import { formatIntlDiagnosticForDeveloper } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

describe("formatIntlDiagnosticForDeveloper", () => {
  it("explains how to repair a missing resource without exposing runtime values", () => {
    expect(
      formatIntlDiagnosticForDeveloper({
        code: "INTL_MISSING_RESOURCE",
        locale: "en",
        message: "Translation resource is unavailable",
        path: "pages.home.title",
      })
    ).toBe(
      "Mirai Intl INTL_MISSING_RESOURCE while resolving `pages.home.title` for locale `en`. Add the key to every required locale, run `pnpm intl:generate` and `pnpm intl:check`. If this key belongs to a third-party react-i18next library, render that library beneath its own I18nextProvider instead of the host catalog."
    );
  });

  it("directs stale artifacts to regeneration", () => {
    expect(
      formatIntlDiagnosticForDeveloper({
        code: "INTL_STALE_DESCRIPTOR",
        message: "Stale descriptor",
        path: "pages.home.title",
      })
    ).toContain("Regenerate the catalog");
  });
});
