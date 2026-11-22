import { describe, expect, it } from 'vitest';

import { overflowingText } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';
import { LEVEL_COLORS } from './render.ts';

describe('preview', () => {
  const elements = preview().scenes.flatMap((scene) => scene.elements);

  it('shows a cheap, a middling, then a dear price, then none', () => {
    const prices = elements.flatMap((element) =>
      element.type === 'text' && element.id === 'price' ? [element] : [],
    );

    expect(prices.slice(0, 3).map((price) => price.color)).toEqual([
      LEVEL_COLORS.low,
      LEVEL_COLORS.mid,
      LEVEL_COLORS.high,
    ]);
    expect(prices[3]?.text).toBe('PRICE ?');
  });

  it('shows the CO2 until rain is due this hour', () => {
    expect(
      elements.flatMap((element) =>
        element.type === 'text' && element.id === 'side' ? [element.text] : [],
      ),
    ).toEqual(['48g', '212g', 'RAIN']);
  });

  it('fits every text on its display', () => {
    expect(overflowingText(elements)).toEqual([]);
  });
});
