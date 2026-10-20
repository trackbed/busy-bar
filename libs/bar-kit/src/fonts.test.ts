import { describe, expect, it } from 'vitest';

import { ELLIPSIS, fitText, textWidth } from './fonts.ts';

// The Python kit's tests expect the same widths.
describe('textWidth', () => {
  it.each([
    ['3 NEED YOU', 'small', 42],
    ['quebec done 4m', 'tiny', 56],
    ['Hello, World!', 'normal', 61],
    ['09:05', 'extra_large', 35],
    ['', 'small', 0],
  ] as const)('measures %j in %s as %d px', (text, font, width) => {
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
