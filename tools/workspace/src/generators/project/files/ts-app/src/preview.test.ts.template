import { describe, expect, it } from 'vitest';

import { overflowingText } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';

describe('preview', () => {
  it('fits every text on its display', () => {
    const elements = preview().scenes.flatMap((scene) => scene.elements);

    expect(overflowingText(elements)).toEqual([]);
  });
});
