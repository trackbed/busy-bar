// A pixel surface for one display, blending the way LVGL's software
// renderer does on the bar: RGB888 for the front display, 8-bit grey (L8)
// for the back one.

import { byteAt } from '../formats/bytes.ts';
import type { Bitmap } from '../formats/png.ts';

/** An 8-bit RGBA colour. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** A rectangle in display pixels. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** How a canvas stores pixels: RGB, or 8-bit grey like the back display. */
export type ColorMode = 'rgb' | 'l8';

export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 255 };

/** Parse `#RRGGBBAA` or `#RRGGBB`; anything else is undefined. */
export function parseColor(value: string): Rgba | undefined {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/iu.exec(value);
  if (match === null) {
    return undefined;
  }
  const rgb = Number.parseInt(match[1] ?? '000000', 16);
  return {
    r: (rgb >> 16) & 0xff,
    g: (rgb >> 8) & 0xff,
    b: rgb & 0xff,
    a: match[2] === undefined ? 255 : Number.parseInt(match[2], 16),
  };
}

/** LVGL's `lv_color_luminance`, how colours land on an L8 display. */
export function luminance(color: Rgba): number {
  return (77 * color.r + 151 * color.g + 28 * color.b) >> 8;
}

// LVGL's LV_OPA_MIN and LV_OPA_MAX: at or below the first an element draws
// nothing, at or above the second a mix replaces the pixel.
export const OPA_MIN = 2;
const OPA_MAX = 253;

/** One display's pixels. Drawing outside the clip box is ignored. */
export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly mode: ColorMode;
  /** RGB bytes per pixel in `rgb` mode, one grey byte in `l8` mode. */
  readonly pixels: Uint8Array;
  #clip: Box;

  constructor(width: number, height: number, mode: ColorMode = 'rgb') {
    this.width = width;
    this.height = height;
    this.mode = mode;
    this.pixels = new Uint8Array(width * height * (mode === 'rgb' ? 3 : 1));
    this.#clip = { x: 0, y: 0, width, height };
  }

  /** The current clip box. */
  get clip(): Box {
    return this.#clip;
  }

  /** Paint every pixel, ignoring the clip box and alpha. */
  fill(color: Rgba): void {
    if (this.mode === 'l8') {
      this.pixels.fill(luminance(color));
      return;
    }
    for (let i = 0; i < this.pixels.length; i += 3) {
      this.pixels[i] = color.r;
      this.pixels[i + 1] = color.g;
      this.pixels[i + 2] = color.b;
    }
  }

  /** Run `draw` with the clip box narrowed to `box`. */
  clipped(box: Box, draw: () => void): void {
    const previous = this.#clip;
    this.#clip = intersect(previous, box);
    try {
      draw();
    } finally {
      this.#clip = previous;
    }
  }

  /**
   * Blend one pixel. `color.a` is the pixel's own alpha (or coverage) and
   * `opacity` the element's; as in LVGL, an opaque element mixes by the
   * pixel alpha alone, any other by their product over 256.
   */
  blend(x: number, y: number, color: Rgba, opacity = 255): void {
    const { x: cx, y: cy, width, height } = this.#clip;
    if (x < cx || y < cy || x >= cx + width || y >= cy + height) {
      return;
    }
    const mix = opacity >= OPA_MAX ? color.a : (color.a * opacity) >> 8;
    if (mix === 0) {
      return;
    }
    const pixel = y * this.width + x;
    if (this.mode === 'l8') {
      this.pixels[pixel] = mixChannel(
        byteAt(this.pixels, pixel),
        luminance(color),
        mix,
      );
      return;
    }
    const at = pixel * 3;
    this.pixels[at] = mixChannel(byteAt(this.pixels, at), color.r, mix);
    this.pixels[at + 1] = mixChannel(byteAt(this.pixels, at + 1), color.g, mix);
    this.pixels[at + 2] = mixChannel(byteAt(this.pixels, at + 2), color.b, mix);
  }

  /** Fill a rectangle with one colour. */
  fillBox(box: Box, color: Rgba, opacity = 255): void {
    const clip = intersect(box, this.#clip);
    for (let y = clip.y; y < clip.y + clip.height; y += 1) {
      for (let x = clip.x; x < clip.x + clip.width; x += 1) {
        this.blend(x, y, color, opacity);
      }
    }
  }

  /** Draw a bitmap with its top-left corner at (x, y). */
  drawBitmap(bitmap: Bitmap, x: number, y: number, opacity = 255): void {
    this.clipped({ x, y, width: bitmap.width, height: bitmap.height }, () => {
      const { rgba } = bitmap;
      for (let row = 0; row < bitmap.height; row += 1) {
        for (let column = 0; column < bitmap.width; column += 1) {
          const at = (row * bitmap.width + column) * 4;
          this.blend(
            x + column,
            y + row,
            {
              r: byteAt(rgba, at),
              g: byteAt(rgba, at + 1),
              b: byteAt(rgba, at + 2),
              a: byteAt(rgba, at + 3),
            },
            opacity,
          );
        }
      }
    });
  }

  /** The colour at (x, y); grey canvases answer with equal channels. */
  pixel(x: number, y: number): Rgba {
    const pixel = y * this.width + x;
    if (this.mode === 'l8') {
      const grey = byteAt(this.pixels, pixel);
      return { r: grey, g: grey, b: grey, a: 255 };
    }
    const at = pixel * 3;
    return {
      r: byteAt(this.pixels, at),
      g: byteAt(this.pixels, at + 1),
      b: byteAt(this.pixels, at + 2),
      a: 255,
    };
  }

  /** The pixels as an opaque RGBA bitmap, for encoding. */
  toBitmap(): Bitmap {
    const rgba = new Uint8Array(this.width * this.height * 4);
    for (let pixel = 0; pixel < this.width * this.height; pixel += 1) {
      const color = this.pixel(
        pixel % this.width,
        Math.floor(pixel / this.width),
      );
      rgba.set([color.r, color.g, color.b, 255], pixel * 4);
    }
    return { width: this.width, height: this.height, rgba };
  }
}

function mixChannel(under: number, over: number, mix: number): number {
  return mix >= OPA_MAX ? over : (over * mix + under * (255 - mix)) >> 8;
}

/** The overlap of two boxes, empty when they do not meet. */
export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}
