import type { JsonPrimitive, JsonValue } from "./json";

export type StringSchema = Readonly<{
  type: "string";
  maxLength?: number;
  minLength?: number;
}>;

export type ScalarSchema = Readonly<{ type: "scalar" }>;

export type NumberSchema = Readonly<{
  type: "number";
  finite: true;
  integer?: boolean;
  maximum?: number;
  minimum?: number;
  safeInteger?: boolean;
}>;

export type BooleanSchema = Readonly<{ type: "boolean" }>;

export type DateTimeSchema = Readonly<{ type: "date-time" }>;

export type LiteralSchema = Readonly<{
  type: "literal";
  value: JsonPrimitive;
}>;

export type EnumSchema = Readonly<{
  type: "enum";
  values: ReadonlyArray<JsonPrimitive>;
}>;

export type ArraySchema = Readonly<{
  type: "array";
  items: ValueSchema;
  maxItems?: number;
  minItems?: number;
}>;

export type ObjectSchema = Readonly<{
  type: "object";
  additionalProperties: false;
  properties: Readonly<Record<string, ValueSchema>>;
  required: ReadonlyArray<string>;
}>;

export type ValueSchema =
  | ArraySchema
  | BooleanSchema
  | DateTimeSchema
  | EnumSchema
  | LiteralSchema
  | NumberSchema
  | ObjectSchema
  | ScalarSchema
  | StringSchema;

export type InferSchema<S extends ValueSchema> = S extends ScalarSchema
  ? string | number
  : S extends StringSchema
    ? string
    : S extends NumberSchema
      ? number
      : S extends BooleanSchema
        ? boolean
        : S extends DateTimeSchema
          ? string
          : S extends LiteralSchema
            ? S["value"]
            : S extends EnumSchema
              ? S["values"][number]
              : S extends ArraySchema
                ? Array<InferSchema<S["items"]>>
                : S extends ObjectSchema
                  ? {
                      [K in S["required"][number] &
                        keyof S["properties"]]: InferSchema<S["properties"][K]>;
                    } & {
                      [K in Exclude<
                        keyof S["properties"],
                        S["required"][number]
                      >]?: InferSchema<S["properties"][K]>;
                    }
                  : JsonValue;

export const emptyObjectSchema = {
  additionalProperties: false,
  properties: {},
  required: [],
  type: "object",
} as const satisfies ObjectSchema;
