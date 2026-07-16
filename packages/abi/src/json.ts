export type JsonPrimitive = boolean | null | number | string;

export type JsonArray = Array<JsonValue>;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
