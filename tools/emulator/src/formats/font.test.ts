import { describe, expect, it } from 'vitest';

import { binFont, boxFont } from '../__tests__/font-fixture.ts';
import type { FontSpec, GlyphSpec } from '../__tests__/font-fixture.ts';
import { FontError, placeholderWidth, readFont } from './font.ts';

const A: GlyphSpec = {
  codePoint: 0x41,
  rows: ['.#.', '#.#', '###'],
  advance: 4,
  offsetY: 1,
};
const B: GlyphSpec = {
  codePoint: 0x42,
  rows: ['##', '##'],
  advance: 3,
  offsetX: -1,
};
const D: GlyphSpec = { codePoint: 0x44, rows: ['#'], advance: 2 };

function font(overrides: Partial<FontSpec> = {}): ReturnType<typeof readFont> {
  return readFont(
    binFont({ ascent: 7, descent: -2, glyphs: [A, B, D], ...overrides }),
  );
}

describe('readFont', () => {
  it('reads the metrics LVGL derives from ascent and descent', () => {
    const decoded = font();

    expect(decoded.lineHeight).toBe(9);
    expect(decoded.baseLine).toBe(2);
  });

  it('decodes glyph boxes, offsets, and coverage', () => {
    const glyph = font().glyph(0x41);

    expect(glyph).toMatchObject({
      advance16: 64,
      offsetX: 0,
      offsetY: 1,
      width: 3,
      height: 3,
    });
    expect(Array.from(glyph?.coverage ?? [])).toStrictEqual([
      0, 255, 0, 255, 0, 255, 255, 255, 255,
    ]);
    expect(font().glyph(0x42)?.offsetX).toBe(-1);
  });

  it.each([0, 1, 2, 3])(
    'finds glyphs through a format %i cmap',
    (cmapFormat) => {
      const glyphs =
        cmapFormat === 2 ? [A, B, { ...D, codePoint: 0x43 }] : [A, B, D];
      const decoded = font({ cmapFormat, glyphs });

      expect(decoded.glyph(0x41)?.width).toBe(3);
      expect(decoded.glyph(0x42)?.width).toBe(2);
      expect(decoded.glyph(cmapFormat === 2 ? 0x43 : 0x44)?.width).toBe(1);
      expect(decoded.glyph(0x40)).toBeUndefined();
      expect(decoded.glyph(0x45)).toBeUndefined();
      expect(decoded.glyph(0)).toBeUndefined();
    },
  );

  it('treats a zero offset after the first code point of a full range as missing', () => {
    expect(font({ cmapFormat: 0 }).glyph(0x43)).toBeUndefined();
  });

  it('reads 32-bit glyph offsets and scales deeper coverage', () => {
    const decoded = font({ locFormat: 1, bpp: 2 });

    expect(Array.from(decoded.glyph(0x44)?.coverage ?? [])).toStrictEqual([
      255,
    ]);
  });

  it('advances by the glyph width, rounding sixteenths of a pixel', () => {
    const whole = font();

    expect(whole.advance(0x41, 0)).toBe(4);
    expect(whole.advance(0x42, 0x41)).toBe(3);

    const fractional = font({
      advanceFormat: 1,
      glyphs: [
        { ...A, advance: 72 },
        { ...B, advance: 71 },
      ],
    });

    expect(fractional.advance(0x41, 0)).toBe(5);
    expect(fractional.advance(0x42, 0)).toBe(4);
  });

  it('applies kerning scaled by the kerning scale, only between known glyphs', () => {
    const kerning = [{ left: 0x41, right: 0x42, value: -16 }];
    const decoded = font({ kerning });

    expect(decoded.advance(0x41, 0x42)).toBe(3);
    expect(decoded.advance(0x41, 0x44)).toBe(4);
    expect(decoded.advance(0x41, 0x58)).toBe(4);
    expect(font({ kerning, kernScale: 32 }).advance(0x41, 0x42)).toBe(2);
    expect(font({ kerning, idFormat: 1 }).advance(0x41, 0x42)).toBe(3);
  });

  it("advances over a missing glyph like LVGL's placeholder box", () => {
    expect(font().advance(0x263a, 0)).toBe(placeholderWidth(9) + 2);
    expect(placeholderWidth(9)).toBe(4);
  });

  it('reads the box font the other tests draw with', () => {
    const decoded = readFont(boxFont());

    expect(decoded.lineHeight).toBe(6);
    expect(decoded.glyph(0x20)?.width).toBe(0);
    expect(decoded.glyph(0x60)).toBeUndefined();
    expect(decoded.advance(0x5a, 0x20)).toBe(4);
  });

  it.each([
    ['a file without a head table', () => new Uint8Array(4)],
    [
      'a mislabelled table',
      () => {
        const bytes = binFont({ ascent: 7, descent: -2, glyphs: [A] });
        bytes.set([0x78, 0x78, 0x78, 0x78], 48 + 4);
        return bytes;
      },
    ],
    [
      'an unsupported depth',
      () => binFont({ ascent: 7, descent: -2, glyphs: [A], bpp: 3 }),
    ],
    [
      'compressed glyphs',
      () => binFont({ ascent: 7, descent: -2, glyphs: [A], compression: 1 }),
    ],
    [
      'an unknown cmap format',
      () => binFont({ ascent: 7, descent: -2, glyphs: [A], cmapFormat: 9 }),
    ],
    [
      'class-based kerning',
      () =>
        binFont({
          ascent: 7,
          descent: -2,
          glyphs: [A, B],
          kerning: [{ left: 0x41, right: 0x42, value: 1 }],
          kerningFormat: 3,
        }),
    ],
    [
      'a glyph cut short',
      () => {
        const bytes = binFont({
          ascent: 7,
          descent: -2,
          glyphs: [{ ...A, rows: ['#'.repeat(30)] }],
        });
        return bytes.subarray(0, bytes.length - 4);
      },
    ],
  ])('refuses %s', (_name, build) => {
    expect(() => readFont(build())).toThrow(FontError);
  });

  it('refuses a glyph whose offset points past the end of the file', () => {
    const bytes = binFont({ ascent: 7, descent: -2, glyphs: [A] });
    const view = new DataView(bytes.buffer);
    // The loca table follows the 48-byte head and the cmap; its entries
    // start 12 bytes in, so glyph 1's 16-bit offset is at 14.
    const loca = 48 + view.getUint32(48, true);
    view.setUint16(loca + 14, bytes.length, true);

    expect(() => readFont(bytes)).toThrow(FontError);
    expect(() => readFont(bytes)).toThrow(
      'A glyph runs past the end of the file.',
    );
  });
});
