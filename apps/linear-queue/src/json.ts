// Reading untrusted JSON without casts: check each value's type as it is used.

/** A JSON object whose values are not checked yet. */
export type JsonObject = Readonly<Record<string, unknown>>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object at `key`, or an empty one when it is missing or not an object. */
export function objectAt(value: unknown, key: string): JsonObject {
  const child = isObject(value) ? value[key] : undefined;
  return isObject(child) ? child : {};
}

/** The array at `key`, or an empty one when it is missing or not an array. */
export function arrayAt(value: JsonObject, key: string): readonly unknown[] {
  const child = value[key];
  return Array.isArray(child) ? child : [];
}

export function stringAt(value: JsonObject, key: string): string | undefined {
  const child = value[key];
  return typeof child === 'string' ? child : undefined;
}
