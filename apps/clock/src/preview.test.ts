import { describe, expect, it } from 'vitest';

import { FRONT_DISPLAY, overflowingText } from '@busy-bar-apps/bar-kit';

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
    expect(overflowingText(elements)).toEqual([]);
  });
});
