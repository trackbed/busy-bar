import { describe, expect, it, vi } from 'vitest';

import type { Bitmap } from '../formats/png.ts';
import {
  BLACK,
  Canvas,
  intersect,
  luminance,
  OPA_MIN,
  parseColor,
} from './canvas.ts';
import type { Box, Rgba } from './canvas.ts';

const RED: Rgba = { r: 255, g: 0, b: 0, a: 255 };
const GREEN: Rgba = { r: 0, g: 255, b: 0, a: 255 };
const BLUE: Rgba = { r: 0, g: 0, b: 255, a: 255 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

/** Every pixel's red channel, rows top to bottom. */
function reds(canvas: Canvas): number[][] {
  return Array.from({ length: canvas.height }, (_, y) =>
    Array.from({ length: canvas.width }, (_unused, x) => canvas.pixel(x, y).r),
  );
}

/** A bitmap of one row of pixels. */
function row(...colors: readonly Rgba[]): Bitmap {
  return {
    width: colors.length,
    height: 1,
    rgba: Uint8Array.from(colors.flatMap(({ r, g, b, a }) => [r, g, b, a])),
  };
}

/** A bitmap of one colour. */
function solid(width: number, height: number, { r, g, b, a }: Rgba): Bitmap {
  return {
    width,
    height,
    rgba: Uint8Array.from(
      Array.from({ length: width * height }, () => [r, g, b, a]).flat(),
    ),
  };
}

describe('parseColor', () => {
  it.each([
    ['#FF000080', { r: 255, g: 0, b: 0, a: 128 }],
    ['#00ff00', { r: 0, g: 255, b: 0, a: 255 }],
    ['#0A0B0C', { r: 10, g: 11, b: 12, a: 255 }],
    ['#aBcDeF00', { r: 0xab, g: 0xcd, b: 0xef, a: 0 }],
  ])('reads %s', (value, color) => {
    expect(parseColor(value)).toStrictEqual(color);
  });

  it.each([
    'red',
    '#FFF',
    '#FF000',
    '#FF00000',
    '#FF0000800',
    '#GG0000',
    'FF0000',
    '#FF0000 ',
    '',
  ])('rejects %j', (value) => {
    expect(parseColor(value)).toBeUndefined();
  });
});

describe('luminance', () => {
  it.each([
    [WHITE, 255],
    [BLACK, 0],
    [RED, 76],
    [GREEN, 150],
    [BLUE, 27],
    // (77 * 100 + 151 * 150 + 28 * 200) >> 8; alpha plays no part.
    [{ r: 100, g: 150, b: 200, a: 0 }, 140],
  ])('turns %j into %i like lv_color_luminance', (color, grey) => {
    expect(luminance(color)).toBe(grey);
  });
});

describe('intersect', () => {
  it.each([
    [
      'overlapping boxes',
      { x: 0, y: 0, width: 4, height: 4 },
      { x: 2, y: 1, width: 4, height: 2 },
      { x: 2, y: 1, width: 2, height: 2 },
    ],
    [
      'a box inside another',
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 2, y: 3, width: 4, height: 5 },
      { x: 2, y: 3, width: 4, height: 5 },
    ],
    [
      'boxes that only touch',
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 2, y: 0, width: 2, height: 2 },
      { x: 2, y: 0, width: 0, height: 2 },
    ],
    [
      'boxes apart',
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 5, y: 5, width: 2, height: 2 },
      { x: 5, y: 5, width: 0, height: 0 },
    ],
  ])('overlaps %s', (_name, a, b, overlap) => {
    expect(intersect(a, b)).toStrictEqual(overlap);
    expect(intersect(b, a)).toStrictEqual(overlap);
  });
});

describe('Canvas', () => {
  it("uses LVGL's minimum opacity and opaque black", () => {
    expect(OPA_MIN).toBe(2);
    expect(BLACK).toStrictEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it('starts with every pixel at zero and the clip box on the display', () => {
    const rgb = new Canvas(3, 2);
    const grey = new Canvas(3, 2, 'l8');

    expect(rgb.mode).toBe('rgb');
    expect(rgb.pixels).toStrictEqual(new Uint8Array(3 * 2 * 3));
    expect(rgb.pixel(2, 1)).toStrictEqual(BLACK);
    expect(rgb.clip).toStrictEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(grey.mode).toBe('l8');
    expect(grey.pixels).toStrictEqual(new Uint8Array(3 * 2));
  });

  it('fills every pixel, ignoring alpha and the clip box', () => {
    const canvas = new Canvas(2, 2);

    canvas.clipped({ x: 0, y: 0, width: 1, height: 1 }, () => {
      canvas.fill({ r: 10, g: 20, b: 30, a: 0 });
    });

    expect(Array.from(canvas.pixels)).toStrictEqual(
      Array.from({ length: 4 }, () => [10, 20, 30]).flat(),
    );
  });

  it("fills an L8 canvas with the colour's luminance", () => {
    const canvas = new Canvas(2, 1, 'l8');

    canvas.fill(RED);

    expect(Array.from(canvas.pixels)).toStrictEqual([76, 76]);
  });

  // Red over white. The mix is the pixel alpha at an element opacity of 253
  // or more, else their product over 256; a mix of 0 draws nothing, 253 or
  // more replaces, and anything between truncates (so even white's red
  // channel drops to 254).
  it.each([
    [255, 255, { r: 255, g: 0 }],
    [253, 255, { r: 255, g: 0 }],
    [252, 255, { r: 254, g: 2 }],
    [128, 255, { r: 254, g: 126 }],
    [128, 253, { r: 254, g: 126 }],
    [255, 252, { r: 254, g: 3 }],
    [255, 127, { r: 254, g: 128 }],
    [128, 128, { r: 254, g: 190 }],
    [1, 255, { r: 254, g: 253 }],
    [2, 128, { r: 254, g: 253 }],
    [0, 255, { r: 255, g: 255 }],
    [255, 1, { r: 255, g: 255 }],
  ])('blends alpha %i at opacity %i like LVGL', (alpha, opacity, { r, g }) => {
    const canvas = new Canvas(1, 1);
    canvas.fill(WHITE);

    canvas.blend(0, 0, { ...RED, a: alpha }, opacity);

    expect(canvas.pixel(0, 0)).toStrictEqual({ r, g, b: g, a: 255 });
  });

  it('blends half-opaque red over black to 125, as the bar measures', () => {
    const canvas = new Canvas(1, 1);

    canvas.blend(0, 0, RED, 127);

    expect(canvas.pixel(0, 0)).toStrictEqual({ r: 125, g: 0, b: 0, a: 255 });
  });

  it('blends the luminance of the colour on an L8 canvas', () => {
    const canvas = new Canvas(3, 1, 'l8');
    canvas.fillBox({ x: 1, y: 0, width: 1, height: 1 }, WHITE);

    canvas.blend(0, 0, RED);
    canvas.blend(1, 0, { ...BLACK, a: 128 });
    canvas.blend(2, 0, GREEN, 127);

    expect(Array.from(canvas.pixels)).toStrictEqual([76, 126, 73]);
    expect(canvas.pixel(2, 0)).toStrictEqual({ r: 73, g: 73, b: 73, a: 255 });
  });

  it('ignores pixels outside the display', () => {
    const canvas = new Canvas(2, 2);

    canvas.blend(-1, 0, WHITE);
    canvas.blend(2, 0, WHITE);
    canvas.blend(0, -1, WHITE);
    canvas.blend(0, 2, WHITE);

    expect(canvas.pixels).toStrictEqual(new Uint8Array(2 * 2 * 3));
  });

  it('narrows the clip box to the overlap while drawing, then restores it', () => {
    const canvas = new Canvas(4, 2);
    const clips: Box[] = [];

    canvas.clipped({ x: 1, y: 0, width: 5, height: 1 }, () => {
      clips.push(canvas.clip);
      canvas.clipped({ x: 0, y: 0, width: 3, height: 2 }, () => {
        clips.push(canvas.clip);
        canvas.fillBox({ x: 0, y: 0, width: 4, height: 2 }, RED);
      });
      clips.push(canvas.clip);
    });

    expect(clips).toStrictEqual([
      { x: 1, y: 0, width: 3, height: 1 },
      { x: 1, y: 0, width: 2, height: 1 },
      { x: 1, y: 0, width: 3, height: 1 },
    ]);
    expect(canvas.clip).toStrictEqual({ x: 0, y: 0, width: 4, height: 2 });
    expect(reds(canvas)).toStrictEqual([
      [0, 255, 255, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('restores the clip box when drawing throws', () => {
    const canvas = new Canvas(2, 2);

    expect(() => {
      canvas.clipped({ x: 5, y: 5, width: 1, height: 1 }, () => {
        throw new Error('bug');
      });
    }).toThrow('bug');
    expect(canvas.clip).toStrictEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it('fills a box at an opacity, within the display', () => {
    const canvas = new Canvas(4, 2);

    canvas.fillBox({ x: -1, y: 1, width: 3, height: 5 }, RED, 127);

    expect(reds(canvas)).toStrictEqual([
      [0, 0, 0, 0],
      [125, 125, 0, 0],
    ]);
  });

  it('visits only the visible part of a filled box', () => {
    const canvas = new Canvas(4, 2);
    const blend = vi.spyOn(canvas, 'blend');

    canvas.clipped({ x: 1, y: 1, width: 2, height: 1 }, () => {
      canvas.fillBox({ x: -10, y: -10, width: 30, height: 30 }, RED);
    });

    expect(blend).toHaveBeenCalledTimes(2);
    expect(reds(canvas)).toStrictEqual([
      [0, 0, 0, 0],
      [0, 255, 255, 0],
    ]);
  });

  it('draws a bitmap with its pixel alpha times the element opacity', () => {
    const bitmap = row(RED, { ...RED, a: 128 }, { ...RED, a: 0 });
    const opaque = new Canvas(3, 1);
    const faded = new Canvas(3, 1);
    opaque.fill(WHITE);
    faded.fill(WHITE);

    opaque.drawBitmap(bitmap, 0, 0);
    faded.drawBitmap(bitmap, 0, 0, 128);

    expect([0, 1, 2].map((x) => opaque.pixel(x, 0))).toStrictEqual([
      RED,
      { r: 254, g: 126, b: 126, a: 255 },
      WHITE,
    ]);
    expect([0, 1, 2].map((x) => faded.pixel(x, 0))).toStrictEqual([
      { r: 254, g: 127, b: 127, a: 255 },
      { r: 254, g: 190, b: 190, a: 255 },
      WHITE,
    ]);
  });

  it('draws only the part of a bitmap inside the clip box', () => {
    const canvas = new Canvas(3, 2);
    const bitmap = solid(2, 2, RED);

    canvas.drawBitmap(bitmap, -1, -1);
    canvas.clipped({ x: 0, y: 0, width: 2, height: 2 }, () => {
      canvas.drawBitmap(bitmap, 1, 1);
    });

    expect(reds(canvas)).toStrictEqual([
      [255, 0, 0],
      [0, 255, 0],
    ]);
    expect(canvas.clip).toStrictEqual({ x: 0, y: 0, width: 3, height: 2 });
  });

  it('exports the pixels as an opaque RGBA bitmap', () => {
    const rgb = new Canvas(2, 1);
    rgb.blend(0, 0, BLUE);
    rgb.blend(1, 0, { ...GREEN, a: 128 });
    const grey = new Canvas(2, 1, 'l8');
    grey.blend(1, 0, WHITE);

    expect(rgb.toBitmap()).toStrictEqual({
      width: 2,
      height: 1,
      rgba: Uint8Array.from([0, 0, 255, 255, 0, 127, 0, 255]),
    });
    expect(grey.toBitmap()).toStrictEqual({
      width: 2,
      height: 1,
      rgba: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 255]),
    });
  });
});
