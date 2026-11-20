import { describe, expect, it } from 'vitest';

import { overflowingText } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';

describe('preview', () => {
  const elements = preview().scenes.flatMap((scene) => scene.elements);

  it('focuses on failing checks, then the queue, then a merge', () => {
    expect(
      elements.flatMap((element) =>
        element.type === 'text' && element.id === 'headline'
          ? [element.text]
          : [],
      ),
    ).toEqual(['1 FAILING', '2 QUEUED', 'MERGED!']);
  });

  it('fits every text on its display', () => {
    expect(overflowingText(elements)).toEqual([]);
  });
});
