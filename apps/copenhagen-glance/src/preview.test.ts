import { describe, expect, it } from 'vitest';

import { BACK_DISPLAY, FRONT_DISPLAY, textWidth } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';
import { LEVEL_COLORS } from './render.ts';

describe('preview', () => {
  const elements = preview().scenes.flatMap((scene) => scene.elements);

  it('shows a cheap, a middling, then a dear price', () => {
    expect(
      elements.flatMap((element) =>
        element.type === 'text' && element.id === 'price'
          ? [element.color]
          : [],
      ),
    ).toEqual([LEVEL_COLORS.low, LEVEL_COLORS.mid, LEVEL_COLORS.high]);
  });

  it('shows the CO2 until rain is due this hour', () => {
    expect(
      elements.flatMap((element) =>
        element.type === 'text' && element.id === 'side' ? [element.text] : [],
      ),
    ).toEqual(['48g', '212g', 'RAIN']);
  });

  it('fits every text on its display', () => {
    const overflowing = elements.filter(
      (element) =>
        element.type === 'text' &&
        textWidth(element.text, element.font) >
          (element.display === 'back' ? BACK_DISPLAY : FRONT_DISPLAY).width,
    );

    expect(overflowing).toEqual([]);
  });
});
