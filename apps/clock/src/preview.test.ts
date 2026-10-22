import { describe, expect, it } from 'vitest';

import { BACK_DISPLAY, FRONT_DISPLAY, textWidth } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';

describe('preview', () => {
  const elements = preview().scenes.flatMap((scene) => scene.elements);

  it('shows the minute bar part full, then full', () => {
    expect(
      elements.flatMap((element) =>
        element.type === 'rectangle' ? [element.width] : [],
      ),
    ).toEqual([25, FRONT_DISPLAY.width]);
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
