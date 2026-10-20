// Glyph widths of the bar's fonts, for laying out text. The fonts are
// proportional bitmaps, so a layout that has to fit measures its text.

import type { TextElement } from '@busy-app/busy-lib';
import { registerFontMaps, textWidth as measure } from '@busy-app/busy-lib';
import * as fontMaps from '@busy-app/busy-lib/fonts';

/** A font the bar draws text in. */
export type BarFont = TextElement['font'];

/** What {@link fitText} puts after text it cuts short: the fonts have no `…`. */
export const ELLIPSIS = '..';

let registered = false;

/**
 * How many pixels wide `text` is in `font`, from the font maps busy-lib
 * ships. Pass text through `toBarText` first: the fonts draw printable ASCII
 * only. The Python kit's `text_width` gives the same widths.
 */
export function textWidth(text: string, font: BarFont): number {
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
