import type {
  CatalogManifest,
  RuntimeCatalog,
  RuntimeMessage,
} from "@openmirai/intl-abi";

declare const catalogContract: unique symbol;

export type TypedCatalogManifest<
  Contract extends object,
  Locales extends ReadonlyArray<string> = ReadonlyArray<string>,
  SourceLocale extends Locales[number] = Locales[number],
> = Omit<CatalogManifest, "locales" | "sourceLocale"> & {
  readonly [catalogContract]?: Contract;
  readonly locales: Locales;
  readonly sourceLocale: SourceLocale;
};

export type CatalogContractOf<Manifest extends CatalogManifest> =
  Manifest extends TypedCatalogManifest<
    infer Contract,
    infer _Locales,
    infer _SourceLocale
  >
    ? Contract
    : never;

export type CatalogLocaleOf<Manifest extends CatalogManifest> =
  Manifest["locales"][number];

const maximumValidatorId = 99_999;

export type RuntimeCatalogDefinition = Readonly<{
  manifest: CatalogManifest;
  messages: ReadonlyArray<RuntimeMessage>;
}>;

function ownString(message: RuntimeMessage, field: "id" | "path"): string {
  const property = Object.getOwnPropertyDescriptor(message, field);
  if (
    !property ||
    !("value" in property) ||
    typeof property.value !== "string"
  ) {
    throw new TypeError(
      `Runtime message ${field} must be a string data property`
    );
  }
  return property.value;
}

function validatorIdOf(message: RuntimeMessage): number {
  try {
    if (!message || typeof message !== "object") {
      throw new TypeError("Runtime message must be an object");
    }
    const property = Object.getOwnPropertyDescriptor(message, "validatorId");
    if (!property || !("value" in property)) {
      throw new TypeError(
        "Runtime message validatorId must be a data property"
      );
    }
    const validatorId: unknown = property.value;
    if (!Number.isInteger(validatorId) || Number(validatorId) < 0) {
      throw new TypeError(
        "Runtime message validatorId must be a non-negative integer"
      );
    }
    if (Number(validatorId) > maximumValidatorId) {
      throw new RangeError(
        `Runtime message validatorId exceeds the supported limit ${maximumValidatorId}`
      );
    }
    return Number(validatorId);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      throw error;
    }
    throw new TypeError("Runtime message validatorId cannot be inspected", {
      cause: error,
    });
  }
}

export function defineRuntimeCatalog(
  definition: RuntimeCatalogDefinition
): RuntimeCatalog {
  const { manifest, messages } = definition;
  const indexed: Array<RuntimeMessage> = [];
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const message of messages) {
    const validatorId = validatorIdOf(message);
    const id = ownString(message, "id");
    const path = ownString(message, "path");
    if (indexed[validatorId] !== undefined) {
      throw new TypeError(
        `Runtime catalog contains duplicate validatorId ${validatorId}`
      );
    }
    if (ids.has(id) || paths.has(path)) {
      throw new TypeError(
        `Runtime catalog contains duplicate message identity ${id} at ${path}`
      );
    }
    ids.add(id);
    paths.add(path);
    indexed[validatorId] = message;
  }
  return Object.freeze({
    manifest,
    messages: Object.freeze(indexed),
  });
}
