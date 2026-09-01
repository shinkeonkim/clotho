import { PluginError, type JsonValue } from './types';

export function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function toJsonValue(value: unknown, pluginId?: string): JsonValue {
  try {
    assertJsonCompatible(value, new WeakSet<object>());
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('value is not JSON serializable');
    const parsed = JSON.parse(encoded) as JsonValue;
    assertFiniteNumbers(parsed);
    return parsed;
  } catch (error) {
    throw new PluginError(
      'invalid-json',
      `${pluginId ?? 'pipeline'} returned a non-JSON value`,
      pluginId,
      { cause: error },
    );
  }
}

function assertJsonCompatible(value: unknown, seen: WeakSet<object>): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JSON numbers must be finite');
    return;
  }
  if (typeof value !== 'object') {
    throw new Error(`unsupported JSON value: ${typeof value}`);
  }
  if (seen.has(value)) throw new Error('cyclic values are not JSON serializable');
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => assertJsonCompatible(item, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('JSON objects must use a plain object prototype');
    }
    Object.values(value).forEach((item) => assertJsonCompatible(item, seen));
  }
  seen.delete(value);
}

function assertFiniteNumbers(value: JsonValue): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('JSON numbers must be finite');
  }
  if (Array.isArray(value)) {
    value.forEach(assertFiniteNumbers);
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(assertFiniteNumbers);
  }
}

export function freezeJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => freezeJson(item));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => freezeJson(item));
  }
  return Object.freeze(value);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(toJsonValue(value)));
}

function sortValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
