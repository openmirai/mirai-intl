/**
 * The default for how many dependency files one finite translation key
 * analysis may read from its provider closure. One dynamic key reaching a UI
 * kit's type graph used to crawl millions of files inside a single
 * synchronous transform; past the limit the analysis stops with a diagnostic
 * naming the module that pulled the closure in.
 */
export const defaultSemanticProgramFiles = 5000 as const;

/** The highest value `maximumSemanticProgramFiles` accepts (20 times the default). */
export const maximumConfigurableSemanticProgramFiles = 100_000 as const;

/** Process-wide spelling of the limit for the CLI, workers and option-less callers. */
export const semanticProgramFilesEnvironmentVariable =
  "MIRAI_INTL_MAX_SEMANTIC_PROGRAM_FILES" as const;

function assertSemanticProgramFileLimit(
  value: unknown,
  name: string
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumConfigurableSemanticProgramFiles
  ) {
    throw new TypeError(
      `${name} must be an integer from 1 through ${maximumConfigurableSemanticProgramFiles}`
    );
  }
}

/**
 * Resolve the per-analysis dependency-file limit: the explicit
 * `maximumSemanticProgramFiles` option, else the
 * MIRAI_INTL_MAX_SEMANTIC_PROGRAM_FILES environment variable, else 5000.
 * Refuses anything that is not an integer from 1 through 100000. Free of the
 * TypeScript compiler API so Next and Vite adapters can validate at config
 * time.
 */
export function resolveSemanticProgramFileLimit(option?: number): number {
  if (option !== undefined) {
    assertSemanticProgramFileLimit(option, "maximumSemanticProgramFiles");
    return option;
  }
  const raw = process.env[semanticProgramFilesEnvironmentVariable];
  if (raw === undefined) {
    return defaultSemanticProgramFiles;
  }
  const parsed = /^[0-9]+$/u.test(raw) ? Number(raw) : Number.NaN;
  assertSemanticProgramFileLimit(
    parsed,
    semanticProgramFilesEnvironmentVariable
  );
  return parsed;
}
