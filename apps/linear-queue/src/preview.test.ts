import { describe, expect, it } from 'vitest';

import { overflowingText } from '@busy-bar-apps/bar-kit';

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
    expect(overflowingText(elements)).toEqual([]);
  });
});
