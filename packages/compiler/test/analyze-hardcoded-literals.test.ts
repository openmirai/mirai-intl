import { describe, expect, it } from "vitest";

import { analyzeHardcodedLiterals } from "../src/analyze-hardcoded-literals";

describe("analyzeHardcodedLiterals", () => {
  it("flags JSX prose and user-facing props", () => {
    const diagnostics = analyzeHardcodedLiterals({
      filePath: "/app/src/Button.tsx",
      packageRoot: "/app",
      source: `
        export function Button() {
          return <button title="Save changes">Click here now</button>;
        }
      `,
    });
    expect(diagnostics.map((entry) => entry.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("hardcoded title string"),
        expect.stringContaining("hardcoded JSX text"),
      ])
    );
  });

  it("flags Zod prose messages", () => {
    const diagnostics = analyzeHardcodedLiterals({
      filePath: "/app/src/schema.ts",
      packageRoot: "/app",
      source: `
        import { z } from "zod";
        export const schema = z.string().min(1, "Name is required");
      `,
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      "hardcoded Zod validation message"
    );
  });

  it("allows mirai-intl-allow-literal escapes", () => {
    const diagnostics = analyzeHardcodedLiterals({
      filePath: "/app/src/Button.tsx",
      packageRoot: "/app",
      source: `
        export function Button() {
          // mirai-intl-allow-literal
          return <button title="Save changes">Click here now</button>;
        }
      `,
    });
    expect(diagnostics).toEqual([]);
  });
});
