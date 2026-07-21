import * as compiler from "@openmirai/intl-compiler";
import { describe, expect, it } from "vitest";

describe("published compiler root", () => {
  it("exports only the convention production API", () => {
    expect(Object.keys(compiler).toSorted()).toEqual([
      "COMPILER_VERSION",
      "analyzeConventionSources",
      "generateConventionCatalog",
      "loadConventionCatalog",
      "verifyConventionCatalog",
    ]);
    expect(compiler).not.toHaveProperty("compileCatalog");
    expect(compiler).not.toHaveProperty("emitArtifacts");
    expect(compiler).not.toHaveProperty("writeArtifactSet");
    expect(compiler).not.toHaveProperty("catalogTree");
  });
});
