import { describe, expect, it } from 'vitest';

import { decodeRle, encodeRle } from './rle.ts';

const LITERAL = 0x80;

/** `count` copies of `block`, flattened. */
const repeat = (block: readonly number[], count: number): number[] =>
  Array.from({ length: count }, () => block).flat();

/** `count` blocks of `size` bytes, each unlike the one before. */
const distinct = (count: number, size: number): number[] =>
  Array.from(
    { length: count * size },
    (_, index) => Math.floor(index / size) % 256,
  );

describe('encodeRle', () => {
  it('writes a run of equal blocks as a count and one block', () => {
    expect(encodeRle(Uint8Array.from(repeat([1, 2, 3], 5)), 3)).toStrictEqual(
      Uint8Array.from([5, 1, 2, 3]),
    );
  });

  it('splits runs longer than 127 blocks', () => {
    expect(encodeRle(Uint8Array.from(repeat([7], 200)), 1)).toStrictEqual(
      Uint8Array.from([127, 7, 73, 7]),
    );
  });

  it('writes unlike blocks as a literal run, the count under the high bit', () => {
    expect(encodeRle(Uint8Array.from([1, 2, 3, 4]), 1)).toStrictEqual(
      Uint8Array.from([LITERAL | 4, 1, 2, 3, 4]),
    );
  });

  it('splits literal runs longer than 127 blocks', () => {
    const data = distinct(200, 1);

    expect(encodeRle(Uint8Array.from(data), 1)).toStrictEqual(
      Uint8Array.from([
        LITERAL | 127,
        ...data.slice(0, 127),
        LITERAL | 73,
        ...data.slice(127),
      ]),
    );
  });

  it('switches between runs and literals', () => {
    const a = [1, 1, 1];
    const b = [2, 0, 0];
    const c = [3, 0, 0];

    expect(
      encodeRle(Uint8Array.from([...repeat(a, 3), ...b, ...c]), 3),
    ).toStrictEqual(Uint8Array.from([3, ...a, LITERAL | 2, ...b, ...c]));
    expect(
      encodeRle(Uint8Array.from([...b, ...c, ...repeat(a, 6)]), 3),
    ).toStrictEqual(Uint8Array.from([LITERAL | 2, ...b, ...c, 6, ...a]));
  });

  it('encodes nothing as nothing', () => {
    expect(encodeRle(new Uint8Array(0), 3)).toStrictEqual(new Uint8Array(0));
  });

  it('leaves out a partial block at the end', () => {
    expect(encodeRle(Uint8Array.from([1, 2, 3, 4, 5]), 3)).toStrictEqual(
      Uint8Array.from([LITERAL | 1, 1, 2, 3]),
    );
  });
});

describe('decodeRle', () => {
  it('repeats a block or copies literal blocks', () => {
    expect(
      decodeRle(
        Uint8Array.from([2, 9, 8, 7, LITERAL | 2, 1, 2, 3, 4, 5, 6]),
        3,
      ),
    ).toStrictEqual(Uint8Array.from([9, 8, 7, 9, 8, 7, 1, 2, 3, 4, 5, 6]));
  });

  it('adds nothing for a count of 0', () => {
    expect(
      decodeRle(Uint8Array.from([0, 9, 9, 9, 9, LITERAL, 1, 5, 5, 5, 5]), 4),
    ).toStrictEqual(Uint8Array.from([5, 5, 5, 5]));
  });

  it('decodes nothing as nothing', () => {
    expect(decodeRle(new Uint8Array(0), 3)).toStrictEqual(new Uint8Array(0));
  });

  it.each([
    [
      'runs of every length up to past the limit',
      1,
      [1, 2, 3, 4, 5, 128, 254, 255].flatMap((count, index) =>
        repeat([index], count),
      ),
    ],
    [
      'runs of two, which may be written either way',
      3,
      [...repeat([1, 1, 1], 2), ...repeat([2, 2, 2], 2), 3, 3, 3],
    ],
    ['alternating pairs', 3, repeat([...repeat([5, 6, 7], 2), 0, 0, 0], 50)],
    [
      'blocks that differ in one byte',
      4,
      [1, 2, 3, 4, 1, 2, 3, 5, 1, 2, 3, 5, 1, 2, 3, 5],
    ],
    [
      'a 72x16 RGB frame',
      3,
      Array.from(
        { length: 72 * 16 * 3 },
        (_, index) => ((index * 7919) >> 6) % 3,
      ),
    ],
  ])('reverses encodeRle for %s', (_name, blockSize, data) => {
    const bytes = Uint8Array.from(data);

    expect(decodeRle(encodeRle(bytes, blockSize), blockSize)).toStrictEqual(
      bytes,
    );
  });
});
