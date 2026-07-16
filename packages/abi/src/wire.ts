import type { DescriptorKind, RuntimeAbi, Sha256 } from "./descriptor";
import type { JsonObject } from "./json";

export type DynamicIntlCallV1 = Readonly<{
  catalogId: string;
  formatVersion: 1;
  hash: Sha256;
  kind: DescriptorKind;
  locale: string;
  messageId: string;
  runtimeAbi: RuntimeAbi;
  values: JsonObject;
}>;

export type Result<Value, Error> =
  | Readonly<{ ok: false; error: Error }>
  | Readonly<{ ok: true; value: Value }>;

export const validatedDynamicCallBrand: unique symbol = Symbol.for(
  "@mirai/intl-validated-dynamic-call/1"
) as never;

export type ValidatedDynamicCall = DynamicIntlCallV1 &
  Readonly<{ [validatedDynamicCallBrand]: true }>;
