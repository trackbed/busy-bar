import { describe, expect, it } from 'vitest';

import { BACK_DISPLAY, FRONT_DISPLAY, textWidth } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';
import { READY_COLORS } from './render.ts';

describe('preview', () => {
  const elements = preview().scenes.flatMap((scene) => scene.elements);

  it('shows a healthy queue, then a low one, then an empty one', () => {
    expect(
      elements.flatMap((element) =>
        element.type === 'text' && element.id === 'headline'
          ? [element.color]
          : [],
      ),
    ).toEqual([READY_COLORS.plenty, READY_COLORS.low, READY_COLORS.empty]);
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
