import { describe, expect, it } from 'vitest';

import { BACK_DISPLAY, FRONT_DISPLAY, textWidth } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';

describe('preview', () => {
  it('fits every text on its display', () => {
    const overflowing = preview()
      .scenes.flatMap((scene) => scene.elements)
      .filter(
        (element) =>
          element.type === 'text' &&
          textWidth(element.text, element.font) >
            (element.display === 'back' ? BACK_DISPLAY : FRONT_DISPLAY).width,
      );

    expect(overflowing).toEqual([]);
  });
});
