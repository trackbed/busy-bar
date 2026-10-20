import { describe, expect, it } from 'vitest';

import { binFont, boxFont } from '../__tests__/font-fixture.ts';
import type { GlyphSpec } from '../__tests__/font-fixture.ts';
import { Font, readFont } from '../formats/font.ts';
import type { Glyph } from '../formats/font.ts';
import { Canvas } from './canvas.ts';
import type { Rgba } from './canvas.ts';
import { drawText, isMarker, layoutText, scrollOffset } from './text.ts';
import type { TextLayout } from './text.ts';

// Every printable ASCII character but the backtick is a 3x5 box advancing
// 4 px; lines are 6 px tall with the baseline 1 px up.
const BOX = readFont(boxFont());
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

const box = (codePoint: number): GlyphSpec => ({
  codePoint,
  rows: ['###', '###', '###', '###', '###'],
  advance: 4,
});

/** The canvas as rows of `#` (any red) and `.` (none). */
function ink(canvas: Canvas): string[] {
  return Array.from({ length: canvas.height }, (_, y) =>
    Array.from({ length: canvas.width }, (_unused, x) =>
      canvas.pixel(x, y).r > 0 ? '#' : '.',
    ).join(''),
  );
}

function texts(layout: TextLayout): string[] {
  return layout.lines.map((line) =>
    String.fromCodePoint(...line.map((letter) => letter.codePoint)),
  );
}

function advances(layout: TextLayout): number[][] {
  return layout.lines.map((line) => line.map((letter) => letter.advance));
}

function draw(
  width: number,
  height: number,
  font: Font,
  text: string,
  x = 0,
  y = 0,
  color = WHITE,
): Canvas {
  const canvas = new Canvas(width, height);
  drawText(canvas, layoutText(font, text), x, y, color);
  return canvas;
}

describe('layoutText', () => {
  it('measures a line as the sum of its advances, one line tall', () => {
    const layout = layoutText(BOX, 'AB');

    expect(layout.font).toBe(BOX);
    expect(layout.lines).toStrictEqual([
      [
        { codePoint: 0x41, advance: 4 },
        { codePoint: 0x42, advance: 4 },
      ],
    ]);
    expect(layout.width).toBe(8);
    expect(layout.height).toBe(6);
  });

  it('gives empty text one empty line', () => {
    const layout = layoutText(BOX, '');

    expect(layout.lines).toStrictEqual([[]]);
    expect(layout.width).toBe(0);
    expect(layout.height).toBe(6);
  });

  it.each([
    ['A\nB', ['A', 'B']],
    ['A\rB', ['A', 'B']],
    ['A\r\nB', ['A', '', 'B']],
    ['A\n', ['A', '']],
    ['\n\r', ['', '', '']],
    ['AB\nC', ['AB', 'C']],
  ])('ends a line at every CR or LF in %j', (text, lines) => {
    const layout = layoutText(BOX, text);

    expect(texts(layout)).toStrictEqual(lines);
    expect(layout.height).toBe(lines.length * 6);
    expect(layout.width).toBe(
      Math.max(...lines.map((line) => line.length * 4)),
    );
  });

  it('is as wide as its longest line', () => {
    const layout = layoutText(BOX, 'A\nBCD\nEF');

    expect(layout.width).toBe(12);
    expect(layout.height).toBe(18);
  });

  it('kerns each letter with the code point after it in the text', () => {
    const kerned = readFont(
      binFont({
        ascent: 5,
        descent: -1,
        glyphs: [box(0x41), box(0x42)],
        kerning: [{ left: 0x41, right: 0x42, value: -16 }],
      }),
    );

    expect(advances(layoutText(kerned, 'ABA'))).toStrictEqual([[3, 4, 4]]);
    expect(layoutText(kerned, 'AB').width).toBe(7);
    // A marker or a line break is the next code point too, so no kerning.
    expect(advances(layoutText(kerned, 'A​B'))).toStrictEqual([[4, 0, 4]]);
    expect(advances(layoutText(kerned, 'A\nB'))).toStrictEqual([[4], [4]]);
  });

  it('gives marker code points no advance', () => {
    const layout = layoutText(BOX, 'A\tB​C﻿');

    expect(advances(layout)).toStrictEqual([[4, 0, 4, 0, 4, 0]]);
    expect(layout.width).toBe(12);
  });

  it("advances over a missing glyph by LVGL's placeholder width", () => {
    expect(advances(layoutText(BOX, 'A`B'))).toStrictEqual([[4, 5, 4]]);
    expect(layoutText(BOX, '\u{1f600}').lines).toStrictEqual([
      [{ codePoint: 0x1f600, advance: 5 }],
    ]);
  });
});

describe('isMarker', () => {
  it.each([
    ['0000', true],
    ['000A', true],
    ['001F', true],
    ['0020', false],
    ['0041', false],
    ['061B', false],
    ['061C', true],
    ['061D', false],
    ['115E', false],
    ['115F', true],
    ['1160', true],
    ['1161', false],
    ['180A', false],
    ['180B', true],
    ['180E', true],
    ['180F', false],
    ['200A', false],
    ['200B', true],
    ['200F', true],
    ['2010', false],
    ['2027', false],
    ['2028', true],
    ['202F', true],
    ['2030', false],
    ['205E', false],
    ['205F', true],
    ['206F', true],
    ['2070', false],
    ['F8FE', false],
    ['F8FF', true],
    ['F900', false],
    ['FEFE', false],
    ['FEFF', true],
    ['FF00', false],
  ])('says U+%s is a marker: %s', (hex, marker) => {
    expect(isMarker(Number.parseInt(hex, 16))).toBe(marker);
  });
});

describe('drawText', () => {
  it('draws each glyph box at the pen, from the line top plus the ascent', () => {
    expect(ink(draw(10, 8, BOX, 'AB', 1, 1))).toStrictEqual([
      '..........',
      '.###.###..',
      '.###.###..',
      '.###.###..',
      '.###.###..',
      '.###.###..',
      '..........',
      '..........',
    ]);
  });

  it('places glyphs by their offsets against the baseline', () => {
    // Line height 6, baseline 2 px up: glyph tops sit at 4 - height - offsetY.
    const font = readFont(
      binFont({
        ascent: 4,
        descent: -2,
        glyphs: [
          {
            codePoint: 0x41,
            rows: ['##', '#.'],
            advance: 3,
            offsetX: 1,
            offsetY: -1,
          },
          { codePoint: 0x42, rows: ['#'], advance: 2, offsetY: 2 },
        ],
      }),
    );

    expect(ink(draw(6, 6, font, 'AB'))).toStrictEqual([
      '......',
      '...#..',
      '......',
      '.##...',
      '.#....',
      '......',
    ]);
  });

  it('starts each line one line height lower', () => {
    expect(ink(draw(4, 12, BOX, 'A\nB'))).toStrictEqual([
      '###.',
      '###.',
      '###.',
      '###.',
      '###.',
      '....',
      '###.',
      '###.',
      '###.',
      '###.',
      '###.',
      '....',
    ]);
  });

  it('blends glyph coverage at the text opacity', () => {
    const glyph: Glyph = {
      advance16: 48,
      offsetX: 0,
      offsetY: 0,
      width: 3,
      height: 1,
      coverage: Uint8Array.from([0, 128, 255]),
    };
    const shaded = new Font({
      lineHeight: 2,
      baseLine: 0,
      cmaps: [{ kind: 'tiny', start: 0x41, length: 1, firstId: 1 }],
      glyphs: [glyph, glyph],
      kerning: undefined,
      kernScale: 0,
    });
    const reds = (canvas: Canvas): number[] =>
      [0, 1, 2].map((x) => canvas.pixel(x, 1).r);

    expect(reds(draw(3, 2, shaded, 'A'))).toStrictEqual([0, 127, 255]);
    expect(
      reds(draw(3, 2, shaded, 'A', 0, 0, { ...WHITE, a: 128 })),
    ).toStrictEqual([0, 63, 126]);
  });

  it('draws nothing for marker code points, even ones the font has', () => {
    const font = readFont(
      binFont({
        ascent: 5,
        descent: -1,
        glyphs: [box(0x09), box(0x41), box(0x200b)],
      }),
    );

    expect(ink(draw(8, 6, font, '\tA​'))).toStrictEqual([
      '###.....',
      '###.....',
      '###.....',
      '###.....',
      '###.....',
      '........',
    ]);
  });

  it('outlines a missing glyph as wide as its advance and a line tall', () => {
    expect(ink(draw(7, 7, BOX, '`', 1))).toStrictEqual([
      '.#####.',
      '.#...#.',
      '.#...#.',
      '.#...#.',
      '.#...#.',
      '.#####.',
      '.......',
    ]);
    expect(ink(draw(13, 6, BOX, 'A`B')).at(1)).toBe('###.#...####.');
  });

  it('draws the placeholder at the text opacity, like a glyph', () => {
    const canvas = draw(9, 6, BOX, 'A`', 0, 0, { ...WHITE, a: 128 });

    expect(canvas.pixel(0, 0)).toStrictEqual({
      r: 126,
      g: 126,
      b: 126,
      a: 255,
    });
    expect(canvas.pixel(4, 0)).toStrictEqual(canvas.pixel(0, 0));
  });

  it('draws the part of the text on the canvas', () => {
    expect(ink(draw(6, 6, BOX, 'AB', -2))).toStrictEqual([
      '#.###.',
      '#.###.',
      '#.###.',
      '#.###.',
      '#.###.',
      '......',
    ]);
  });
});

describe('scrollOffset', () => {
  // 100 px of text and 4 px spaces scroll 112 px; at 1120 px a minute that
  // takes 6 s, after a 1 s start delay and then 0.5 s between rounds.
  const SCROLL = { rate: 1120, startDelayMs: 1000, repeatDelayMs: 500 };

  it.each([
    [0, 0],
    [999, 0],
    [1000, 0],
    // Step 0 of 1024 until 6000 / 1024 ms have passed.
    [1005, 0],
    // Step 1: -112 / 1024, shifted right, rounds down to -1.
    [1006, -1],
    [4000, -56],
    // Step 1023 already floors to -112.
    [6999, -112],
    // The text holds there through the repeat delay, then starts over.
    [7000, -112],
    [7499, -112],
    [7500, 0],
    [10_500, -56],
  ])('after %i ms is offset by %i px', (elapsedMs, offset) => {
    expect(scrollOffset(100, 4, SCROLL, elapsedMs)).toStrictEqual({
      offset,
      distance: 112,
    });
  });

  it('starts the next round at once without a repeat delay', () => {
    const scroll = { ...SCROLL, repeatDelayMs: 0 };

    expect(scrollOffset(100, 4, scroll, 7000).offset).toBe(0);
    expect(scrollOffset(100, 4, scroll, 10_000).offset).toBe(-56);
  });

  it('stays put when the round takes no time', () => {
    const fast = { rate: 120_000, startDelayMs: 0, repeatDelayMs: 0 };

    expect(scrollOffset(1, 0, fast, 5000)).toStrictEqual({
      offset: 0,
      distance: 1,
    });
  });
});
