// XPM2 bitmaps for the `xpmbitmap` element, with the firmware's subset and
// rules (lib/xpm in the firmware): at most 32 colours and 4 characters per
// pixel, `#` colours with 1 to 4 hex digits per channel, a handful of colour
// names, and a per-display preference between colour and grey keys.

import type { DisplayName } from '../render/display.ts';
import type { Bitmap } from './png.ts';

/** Which rule a bitmap breaks, phrased to follow "must". */
export class XpmError extends Error {
  override readonly name = 'XpmError';
}

const MAX_COLORS = 32;
const MAX_CHARS_PER_PIXEL = 4;

type Rgba = readonly [number, number, number, number];

const NAMES = new Map<string, Rgba>([
  ['none', [0, 0, 0, 0]],
  ['black', [0, 0, 0, 255]],
  ['white', [255, 255, 255, 255]],
  ['red', [255, 0, 0, 255]],
  ['green', [0, 255, 0, 255]],
  ['blue', [0, 0, 255, 255]],
  ['yellow', [255, 255, 0, 255]],
  ['cyan', [0, 255, 255, 255]],
  ['magenta', [255, 0, 255, 255]],
  ['gray', [128, 128, 128, 255]],
  ['grey', [128, 128, 128, 255]],
]);

// The front prefers colour keys, the greyscale back prefers grey keys.
const KEY_ORDER: Readonly<Record<DisplayName, readonly string[]>> = {
  front: ['c', 'g', 'g4', 'm'],
  back: ['g', 'g4', 'c', 'm'],
};

/**
 * Decode an XPM2 bitmap for `display`, whose size bounds the bitmap. On the
 * back, colours become luma, `(77R + 150G + 29B) >> 8`, as the firmware does.
 */
export function parseXpm(
  data: string,
  display: DisplayName,
  limit: { readonly width: number; readonly height: number },
): Bitmap {
  const lines = data.split(/\r?\n/u);
  if (lines[0]?.trim() !== '! XPM2') {
    throw new XpmError('have valid XPM header');
  }
  const values = (lines[1] ?? '').trim().split(/\s+/u).map(Number);
  const [width = 0, height = 0, colorCount = 0, cpp = 0] = values;
  if (
    values.length < 4 ||
    values.some((value) => !Number.isInteger(value) || value < 1)
  ) {
    throw new XpmError('have valid XPM header');
  }
  if (colorCount > MAX_COLORS || cpp > MAX_CHARS_PER_PIXEL) {
    throw new XpmError(
      `have <= ${MAX_COLORS} colors and <= ${MAX_CHARS_PER_PIXEL} chars per pixel`,
    );
  }
  if (width > limit.width || height > limit.height) {
    throw new XpmError(
      `be no larger than the display (${limit.width}x${limit.height})`,
    );
  }
  const palette = new Map<string, Rgba>();
  for (let i = 0; i < colorCount; i += 1) {
    const line = lines[2 + i];
    if (line === undefined || line.length <= cpp) {
      throw new XpmError('have valid XPM color table');
    }
    const color = pickColor(line.slice(cpp), display);
    if (color === undefined) {
      throw new XpmError('have valid XPM color table');
    }
    palette.set(line.slice(0, cpp), display === 'back' ? toLuma(color) : color);
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const row = lines[2 + colorCount + y];
    if (row === undefined || row.length < width * cpp) {
      throw new XpmError('have valid XPM pixel data');
    }
    for (let x = 0; x < width; x += 1) {
      const color = palette.get(row.slice(x * cpp, (x + 1) * cpp));
      if (color === undefined) {
        throw new XpmError('have valid XPM pixel data');
      }
      rgba.set(color, (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

function pickColor(spec: string, display: DisplayName): Rgba | undefined {
  const tokens = spec.trim().split(/\s+/u);
  const byKey = new Map<string, string>();
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const key = tokens[i];
    const value = tokens[i + 1];
    if (key !== undefined && value !== undefined) {
      byKey.set(key.toLowerCase(), value);
    }
  }
  for (const key of KEY_ORDER[display]) {
    const value = byKey.get(key);
    if (value !== undefined) {
      return parseValue(value);
    }
  }
  return undefined;
}

function parseValue(value: string): Rgba | undefined {
  const named = NAMES.get(value.toLowerCase());
  if (named !== undefined) {
    return named;
  }
  const match = /^#((?:[0-9a-f]{3}){1,4})$/iu.exec(value);
  if (match === null) {
    return undefined;
  }
  const hex = match[1] ?? '';
  const digits = hex.length / 3;
  const max = 16 ** digits - 1;
  const channel = (index: number): number =>
    Math.round(
      (Number.parseInt(hex.slice(index * digits, (index + 1) * digits), 16) *
        255) /
        max,
    );
  return [channel(0), channel(1), channel(2), 255];
}

function toLuma([r, g, b, a]: Rgba): Rgba {
  const luma = (77 * r + 150 * g + 29 * b) >> 8;
  return [luma, luma, luma, a];
}
