import { DESCRIPTOR_BRAND_VALUE } from "@openmirai/intl-abi";
import type { MessageDescriptor } from "@openmirai/intl-abi";

type TranslationMockInput = string | MessageDescriptor;

function isTranslationMockInput(input: unknown): input is TranslationMockInput {
  return (
    typeof input === "string" ||
    (typeof input === "object" &&
      input !== null &&
      "brand" in input &&
      input.brand === DESCRIPTOR_BRAND_VALUE &&
      "path" in input &&
      typeof input.path === "string")
  );
}

/**
 * Resolves the value received by a mocked `t()` call to a path suitable for
 * test assertions. Compiler-lowered calls provide a `MessageDescriptor`;
 * literal strings remain supported for tests that do not run the compiler.
 */
export function resolveTranslationMockPath(
  input: unknown,
  namespace?: string
): string {
  if (!isTranslationMockInput(input)) {
    throw new TypeError(
      "Translation mock input must be a literal key or a compiler-lowered message descriptor"
    );
  }

  const path = typeof input === "string" ? input : input.path;
  const prefix = namespace ? `${namespace}.` : "";

  return prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
}
