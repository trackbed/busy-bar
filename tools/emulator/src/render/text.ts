// Text the way LVGL lays out and draws a label on the bar (lv_text.c,
// lv_draw_label.c): lines break at every CR or LF, a line is as wide as the
// sum of its glyph advances, and a glyph the font lacks is drawn as a box.

import type { Font } from '../formats/font.ts';
import type { Canvas, Rgba } from './canvas.ts';

interface Letter {
  readonly codePoint: number;
  /** The pen advance, kerning with the following letter included. */
  readonly advance: number;
}

/** A measured block of text, ready to draw. */
export interface TextLayout {
  readonly font: Font;
  readonly lines: readonly (readonly Letter[])[];
  /** The longest line. */
  readonly width: number;
  readonly height: number;
}

/**
 * Measure `text` in `font`. Each CR or LF ends a line (so CRLF leaves an
 * empty line between), and a trailing break adds an empty last line.
 */
export function layoutText(font: Font, text: string): TextLayout {
  const codePoints = Array.from(
    text,
    (character) => character.codePointAt(0) ?? 0,
  );
  const lines: Letter[][] = [[]];
  codePoints.forEach((codePoint, index) => {
    if (codePoint === LF || codePoint === CR) {
      lines.push([]);
      return;
    }
    const advance = isMarker(codePoint)
      ? 0
      : font.advance(codePoint, codePoints[index + 1] ?? 0);
    lines.at(-1)?.push({ codePoint, advance });
  });
  return {
    font,
    lines,
    width: Math.max(
      ...lines.map((line) =>
        line.reduce((sum, letter) => sum + letter.advance, 0),
      ),
    ),
    height: lines.length * font.lineHeight,
  };
}

/**
 * Draw a layout with its top-left corner at (x, y), lines left-aligned.
 * `color.a` is the text's opacity.
 */
export function drawText(
  canvas: Canvas,
  layout: TextLayout,
  x: number,
  y: number,
  color: Rgba,
): void {
  const { font } = layout;
  const ascent = font.lineHeight - font.baseLine;
  layout.lines.forEach((line, row) => {
    const top = y + row * font.lineHeight;
    let pen = x;
    for (const letter of line) {
      if (!isMarker(letter.codePoint)) {
        const glyph = font.glyph(letter.codePoint);
        if (glyph === undefined) {
          drawPlaceholder(
            canvas,
            pen,
            top,
            letter.advance,
            font.lineHeight,
            color,
          );
        } else {
          const left = pen + glyph.offsetX;
          const glyphTop = top + ascent - glyph.height - glyph.offsetY;
          for (let gy = 0; gy < glyph.height; gy += 1) {
            for (let gx = 0; gx < glyph.width; gx += 1) {
              const coverage = glyph.coverage[gy * glyph.width + gx] ?? 0;
              if (coverage > 0) {
                canvas.blend(
                  left + gx,
                  glyphTop + gy,
                  { ...color, a: coverage },
                  color.a,
                );
              }
            }
          }
        }
      }
      pen += letter.advance;
    }
  });
}

/** LVGL's stand-in for a missing glyph: a one-pixel outline of its advance. */
function drawPlaceholder(
  canvas: Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgba,
): void {
  const ink = { ...color, a: 255 };
  for (let dx = 0; dx < width; dx += 1) {
    canvas.blend(x + dx, y, ink, color.a);
    canvas.blend(x + dx, y + height - 1, ink, color.a);
  }
  for (let dy = 1; dy < height - 1; dy += 1) {
    canvas.blend(x, y + dy, ink, color.a);
    canvas.blend(x + width - 1, y + dy, ink, color.a);
  }
}

const LF = 0x0a;
const CR = 0x0d;

/** Code points LVGL neither draws nor advances over (`lv_text_is_marker`). */
export function isMarker(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    codePoint === 0x061c ||
    codePoint === 0x115f ||
    codePoint === 0x1160 ||
    (codePoint >= 0x180b && codePoint <= 0x180e) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0x2028 && codePoint <= 0x202f) ||
    (codePoint >= 0x205f && codePoint <= 0x206f) ||
    codePoint === 0xfeff ||
    codePoint === 0xf8ff
  );
}

/** How a label scrolls when its text is wider than its box. */
export interface Scroll {
  /** Pixels per minute. */
  readonly rate: number;
  readonly startDelayMs: number;
  readonly repeatDelayMs: number;
}

/**
 * How far a circular scroll has moved after `elapsedMs`, as a negative x
 * offset, and the gap to the copy drawn behind the text. Mirrors LVGL's
 * label animation: it waits out the start delay, moves linearly by
 * `text width + 3 spaces` in `distance * 60000 / rate` ms, holds through
 * the repeat delay, and starts over.
 */
export function scrollOffset(
  textWidth: number,
  spaceAdvance: number,
  scroll: Scroll,
  elapsedMs: number,
): { readonly offset: number; readonly distance: number } {
  const distance = textWidth + WAIT_CHARS * spaceAdvance;
  const duration = Math.floor((distance * 60_000) / scroll.rate);
  const time = elapsedMs - scroll.startDelayMs;
  if (time < 0 || duration === 0) {
    return { offset: 0, distance };
  }
  const cycle = time % (duration + scroll.repeatDelayMs);
  if (cycle >= duration) {
    return { offset: -distance, distance };
  }
  // lv_anim_path_linear: a step out of 1024, then an arithmetic shift.
  const step = Math.floor((cycle * 1024) / duration);
  return { offset: (step * -distance) >> 10, distance };
}

// LV_LABEL_WAIT_CHAR_COUNT in the firmware's lv_conf.h.
const WAIT_CHARS = 3;
