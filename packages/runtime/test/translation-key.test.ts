import type { TextDescriptor } from "@openmirai/intl-abi";
import { describe, expect, it } from "vitest";

import { bindTranslationKeyFactory } from "../src/translations";

interface CatalogContract {
  schema: {
    required: TextDescriptor<
      Readonly<Record<never, never>>,
      "fixture",
      "schema.required"
    >;
  };
}

describe("deferred translation key marker", () => {
  it("binds without side effects and fails closed if a key call is unlowered", () => {
    const createTranslationKey = bindTranslationKeyFactory<CatalogContract>();
    const schemaKey = createTranslationKey("schema");

    expect(() => schemaKey("required")).toThrowError(
      new TypeError(
        "Translation key marker was not lowered by the Mirai Intl compiler"
      )
    );
  });
});
