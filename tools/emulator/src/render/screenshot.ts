// PNG screenshots of the displays, for /emulator/screenshot.png and for
// tools that show what an app draws.

import { encodePng } from '../formats/png.ts';
import type { Canvas } from './canvas.ts';
import type { DisplayName } from './display.ts';

/**
 * A PNG of one display, `scale` times its size: the front as RGB, the
 * back at the 16 grey levels its panel shows.
 */
export function screenshotPng(
  canvas: Canvas,
  display: DisplayName,
  scale: number,
): Uint8Array {
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  const rgba = new Uint8Array(width * height * 4);
  const level = (value: number): number =>
    display === 'back' ? (value >> 4) * 17 : value;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = canvas.pixel(Math.floor(x / scale), Math.floor(y / scale));
      rgba.set(
        [level(color.r), level(color.g), level(color.b), 255],
        (y * width + x) * 4,
      );
    }
  }
  return encodePng({ width, height, rgba });
}
