import { DESCRIPTOR_BRAND_VALUE } from "@openmirai/intl-abi";
import type { MessageDescriptor } from "@openmirai/intl-abi";

type TranslationMockInput = string | MessageDescriptor;

export interface TranslationMockOptions {
  readonly messages?: Readonly<Record<string, string>>;
  readonly namespace?: string;
}

type TranslationMockValues = Readonly<Record<string, number | string>>;

function isTranslationMockInput(input: unknown): input is TranslationMockInput {
  return (
    typeof input === "string" ||
    ((typeof input === "object" || typeof input === "function") &&
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

/**
 * Creates a descriptor-aware text translator for component tests. Fixture
 * messages stay local to the test while descriptor handling and simple value
 * interpolation remain consistent across consumers.
 */
export function createTranslationMock(
  options: TranslationMockOptions = {}
): (input: unknown, values?: TranslationMockValues) => string {
  const { messages = {}, namespace } = options;

  return (input, values) => {
    const key = resolveTranslationMockPath(input, namespace);
    const message = messages[key] ?? key;

    return message.replace(
      /\{(?<name>[A-Za-z0-9_]+)\}/gu,
      (placeholder, name) => {
        const value = values?.[name];

        return value === undefined ? placeholder : String(value);
      }
    );
  };
}
