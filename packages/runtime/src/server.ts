import type { IntlRuntimeOptions } from "./runtime";
import { StrictIntlRuntime } from "./runtime";

export { createTranslationFunction } from "./translations";
export type {
  NamespacePaths,
  TranslationFunction,
  TranslationFunctionFor,
} from "./translations";

export function createServerIntl(
  options: IntlRuntimeOptions
): StrictIntlRuntime {
  return new StrictIntlRuntime(options);
}

export type { IntlRuntimeOptions, StrictIntlRuntime } from "./runtime";
