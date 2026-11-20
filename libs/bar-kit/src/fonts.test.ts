import { readFileSync } from 'node:fs';
import type { TextElement } from '@busy-app/busy-lib';
import { describe, expect, it } from 'vitest';

import type { BarFont } from './fonts.ts';
import { ELLIPSIS, fitText, overflowingText, textWidth } from './fonts.ts';

const FONTS: readonly BarFont[] = [
  'tiny',
  'small',
  'normal',
  'condensed',
  'bold',
  'large',
  'extra_large',
  'global',
  'superscript',
];
const PRINTABLE = Array.from({ length: 95 }, (_, index) =>
  String.fromCharCode(32 + index),
);

type Json = Readonly<Record<string, unknown>>;

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fontOf(name: unknown): BarFont {
  const font = FONTS.find((candidate) => candidate === name);
  if (font === undefined) {
    throw new TypeError(`Unknown font ${JSON.stringify(name)}.`);
  }
  return font;
}

// The widths both kits must give; the Python kit's tests read the same file.
const contract: unknown = JSON.parse(
  readFileSync(
    new URL('../../../bar-kit-text-widths.json', import.meta.url),
    'utf8',
  ),
);
if (
  !isJson(contract) ||
  !isJson(contract['advances']) ||
  !Array.isArray(contract['samples'])
) {
  throw new TypeError('bar-kit-text-widths.json has an unexpected shape.');
}
const advances = contract['advances'];
const samples = contract['samples'].map((sample: unknown) => {
  if (
    !isJson(sample) ||
    typeof sample['text'] !== 'string' ||
    typeof sample['width'] !== 'number'
  ) {
    throw new TypeError(`Malformed sample ${JSON.stringify(sample)}.`);
  }
  return [sample['text'], fontOf(sample['font']), sample['width']] as const;
});

/** Each printable character of `font` and its advance, from the file. */
function expectedAdvances(font: BarFont): Record<string, number> {
  const groups = advances[font];
  if (!isJson(groups)) {
    throw new TypeError(`bar-kit-text-widths.json has no ${font} font.`);
  }
  return Object.fromEntries(
    Object.entries(groups).flatMap(([width, characters]) =>
      typeof characters === 'string'
        ? Array.from(characters, (character) => [character, Number(width)])
        : [],
    ),
  );
}

describe('textWidth', () => {
  it('measures the fonts the shared table lists', () => {
    expect(Object.keys(advances)).toStrictEqual(FONTS);
  });

  it.each(FONTS)(
    'gives every printable character in %s the shared advance',
    (font) => {
      const measured = Object.fromEntries(
        PRINTABLE.map((character) => [character, textWidth(character, font)]),
      );

      expect(measured).toStrictEqual(expectedAdvances(font));
    },
  );

  it.each(samples)('measures %j in %s as %d px', (text, font, width) => {
    expect(textWidth(text, font)).toBe(width);
  });
});

describe('fitText', () => {
  it('keeps text that fits', () => {
    expect(fitText('quebec', 'small', 72)).toBe('quebec');
  });

  it('cuts text that does not fit and marks the cut', () => {
    const fitted = fitText('kuala-lumpur kramme-busy-bar-apps', 'small', 72);

    expect(fitted).toBe('kuala-lumpur kram..');
    expect(textWidth(fitted, 'small')).toBeLessThanOrEqual(72);
  });

  it('drops a trailing space before the marker', () => {
    expect(fitText('ab cd', 'small', 14)).toBe(`ab${ELLIPSIS}`);
  });

  it('returns nothing when even the marker does not fit', () => {
    expect(fitText('hello', 'small', 3)).toBe('');
  });
});

describe('overflowingText', () => {
  const width = textWidth('HELLO', 'small');
  const text = (id: string, fields: Partial<TextElement>): TextElement => ({
    id,
    type: 'text',
    text: 'HELLO',
    font: 'small',
    ...fields,
  });

  it('keeps left-aligned text that ends at the edge', () => {
    expect(overflowingText([text('fits', { x: 72 - width })])).toStrictEqual(
      [],
    );
  });

  it('finds left-aligned text one pixel too wide', () => {
    const wide = text('wide', { x: 72 - width + 1 });

    expect(overflowingText([wide])).toStrictEqual([wide]);
  });

  it('anchors right-aligned text on the column past its right edge', () => {
    const fits = text('fits', { x: 72, align: 'top_right' });
    const tooLong = text('long', { x: width - 1, align: 'mid_right' });
    const outside = text('outside', { x: 73, align: 'bottom_right' });

    expect(overflowingText([fits, tooLong, outside])).toStrictEqual([
      tooLong,
      outside,
    ]);
  });

  it('centres text on x', () => {
    const fits = text('fits', { x: Math.floor(width / 2), align: 'center' });
    const cut = text('cut', { x: Math.floor(width / 2) - 1, align: 'top_mid' });

    expect(overflowingText([fits, cut])).toStrictEqual([cut]);
  });

  it('measures the back display without the status bar', () => {
    const fits = text('fits', { x: 148 - width, display: 'back' });
    const covered = text('covered', { x: 148 - width + 1, display: 'back' });

    expect(overflowingText([fits, covered])).toStrictEqual([covered]);
  });

  it('uses the label width of scrolling text', () => {
    const scrolling = text('scrolling', {
      text: 'a label far longer than the front display is wide',
      width: 72,
    });

    expect(overflowingText([scrolling])).toStrictEqual([]);
  });

  it('ignores elements without text', () => {
    expect(
      overflowingText([
        { id: 'bar', type: 'rectangle', x: 100, width: 50, height: 1 },
      ]),
    ).toStrictEqual([]);
  });
});
