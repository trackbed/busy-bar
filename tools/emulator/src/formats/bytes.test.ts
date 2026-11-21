import { describe, expect, it } from 'vitest';

import { ascii, BitReader, byteAt, concat } from './bytes.ts';

describe('byteAt', () => {
  it('reads 0 past the end', () => {
    expect(byteAt(Uint8Array.of(7), 0)).toBe(7);
    expect(byteAt(Uint8Array.of(7), 1)).toBe(0);
  });
});

describe('ascii', () => {
  it('spells a tag one byte per character', () => {
    expect(ascii('RIFF')).toStrictEqual([0x52, 0x49, 0x46, 0x46]);
  });
});

describe('concat', () => {
  it('joins the parts in order', () => {
    expect(
      concat([Uint8Array.of(1, 2), new Uint8Array(0), Uint8Array.of(3)]),
    ).toStrictEqual(Uint8Array.of(1, 2, 3));
  });
});

describe('BitReader', () => {
  const overrun = () => new RangeError('Out of bits.');

  it('reads most significant bits first, across bytes', () => {
    const reader = new BitReader(
      Uint8Array.of(0b1010_0001, 0b1000_0000),
      { from: 0, to: 16 },
      overrun,
    );

    expect(reader.read(3)).toBe(0b101);
    expect(reader.read(6)).toBe(0b0_0001_1);
    expect(reader.done).toBe(false);
    expect(reader.read(7)).toBe(0);
    expect(reader.done).toBe(true);
  });

  it('starts at a bit offset and reads two’s complement', () => {
    const reader = new BitReader(
      Uint8Array.of(0xff, 0b1110_0000),
      { from: 8, to: 16 },
      overrun,
    );

    expect(reader.readSigned(3)).toBe(-1);
    expect(reader.readSigned(0)).toBe(0);
    expect(reader.readSigned(3)).toBe(0);
  });

  it('throws its error for a read past the end, and reads 0 past the bytes', () => {
    const reader = new BitReader(
      Uint8Array.of(0xff),
      { from: 0, to: 12 },
      overrun,
    );

    expect(reader.read(8)).toBe(0xff);
    expect(reader.read(4)).toBe(0);
    expect(() => reader.read(1)).toThrow(new RangeError('Out of bits.'));
  });
});
