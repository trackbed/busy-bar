// Glyph widths of the bar's fonts, for laying out text. The fonts are
// proportional bitmaps, so a layout that has to fit measures its text.

import type { DisplayDrawParams, TextElement } from '@busy-app/busy-lib';
import { registerFontMaps, textWidth as measure } from '@busy-app/busy-lib';
import * as fontMaps from '@busy-app/busy-lib/fonts';

import { BACK_DISPLAY, FRONT_DISPLAY } from './display.ts';

/** A font the bar draws text in. */
export type BarFont = TextElement['font'];

/** What {@link fitText} puts after text it cuts short: the fonts have no `…`. */
export const ELLIPSIS = '..';

let registered = false;

const NOT_PRINTABLE = /[^\x20-\x7E]/u;

/**
 * How many pixels wide `text` is in `font`, from the font maps busy-lib
 * ships. Pass text through `toBarText` first: a character outside printable
 * ASCII is not drawn, so it throws a `RangeError`. The Python kit's
 * `text_width` gives the same widths and refuses the same text.
 */
export function textWidth(text: string, font: BarFont): number {
  const unprintable = NOT_PRINTABLE.exec(text)?.[0];
  if (unprintable !== undefined) {
    throw new RangeError(
      `${JSON.stringify(unprintable)} is not printable ASCII; use toBarText first.`,
    );
  }
  if (!registered) {
    for (const map of Object.values(fontMaps)) {
      registerFontMaps(map);
    }
    registered = true;
  }
  return measure(text, font);
}

/**
 * `text` if it fits in `width` pixels, otherwise cut short with `..`.
 * Returns an empty string when not even the `..` fits.
 */
export function fitText(text: string, font: BarFont, width: number): string {
  if (textWidth(text, font) <= width) {
    return text;
  }
  const room = width - textWidth(ELLIPSIS, font);
  if (room < 0) {
    return '';
  }
  let cut = text;
  while (cut.length > 0 && textWidth(cut, font) > room) {
    cut = cut.slice(0, -1);
  }
  return cut.trimEnd() + ELLIPSIS;
}

/**
 * The text elements that run past the left or right edge of their display,
 * placed the way the bar places them: a label is as wide as its `width`, or
 * as its text without one, and `align` says whether `x` is its left edge, its
 * middle, or the column just past its right edge. Tests check layouts with it;
 * the Python kit's `overflowing_text` gives the same answer.
 */
export function overflowingText(
  elements: Iterable<DisplayDrawParams['elements'][number]>,
): TextElement[] {
  return [...elements].flatMap((element) =>
    element.type === 'text' && !fitsDisplay(element) ? [element] : [],
  );
}

function fitsDisplay(element: TextElement): boolean {
  const display = element.display === 'back' ? BACK_DISPLAY : FRONT_DISPLAY;
  const width = element.width ?? textWidth(element.text, element.font);
  const x = element.x ?? 0;
  const align = element.align ?? 'top_left';
  const left = align.endsWith('left')
    ? x
    : align.endsWith('right')
      ? x - width
      : x - Math.floor(width / 2);
  return left >= 0 && left + width <= display.width;
}
