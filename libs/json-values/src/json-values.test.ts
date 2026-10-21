import { describe, expect, it } from 'vitest';

import { arrayAt, isObject, numberAt, objectAt, stringAt } from './index.ts';

describe('JSON values', () => {
  it('recognizes objects and preserves their unchecked values', () => {
    const value: unknown = JSON.parse(
      '{"nested":{"name":""},"items":[1,null]}',
    );

    expect(isObject(value)).toBe(true);
    expect(objectAt(value, 'nested')).toStrictEqual({ name: '' });
    expect(stringAt(objectAt(value, 'nested'), 'name')).toBe('');
    expect(arrayAt(objectAt({ value }, 'value'), 'items')).toStrictEqual([
      1,
      null,
    ]);
  });

  it.each([undefined, null, [], 0, true, 'text'])(
    'does not treat %j as an object',
    (value) => {
      expect(isObject(value)).toBe(false);
      expect(objectAt(value, 'nested')).toStrictEqual({});
      expect(objectAt({ nested: value }, 'nested')).toStrictEqual({});
    },
  );

  it('uses empty or absent values for missing fields', () => {
    expect(objectAt({}, 'missing')).toStrictEqual({});
    expect(arrayAt({}, 'missing')).toStrictEqual([]);
    expect(stringAt({}, 'missing')).toBeUndefined();
    expect(numberAt({}, 'missing')).toBeUndefined();
  });

  it.each([null, {}, 1, true, 'text'])(
    'does not coerce %j to an array',
    (value) => {
      expect(arrayAt({ value }, 'value')).toStrictEqual([]);
    },
  );

  it.each([null, {}, [], 1, true])(
    'does not coerce %j to a string',
    (value) => {
      expect(stringAt({ value }, 'value')).toBeUndefined();
    },
  );

  it.each([null, {}, [], true, '1'])(
    'does not coerce %j to a number',
    (value) => {
      expect(numberAt({ value }, 'value')).toBeUndefined();
    },
  );

  it.each([0, -1, 1.5, Number.MAX_VALUE])('reads finite number %s', (value) => {
    expect(numberAt({ value }, 'value')).toBe(value);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite number %s',
    (value) => {
      expect(numberAt({ value }, 'value')).toBeUndefined();
    },
  );

  it('reads a string without changing it', () => {
    expect(stringAt({ name: 'hello' }, 'name')).toBe('hello');
  });
});
