import { describe, expect, it } from 'vitest';

import { overflowingText } from '@busy-bar-apps/bar-kit';

import { preview } from './preview.ts';
import { VIEW_COLORS } from './render.ts';

describe('preview', () => {
  const { scenes } = preview();
  const elements = scenes.flatMap((scene) => scene.elements);

  it('heads each scene with live booths, a quiet one, a down one, then the leaderboard', () => {
    expect(
      scenes.map((scene) =>
        scene.elements.flatMap((element) =>
          element.type === 'text' && element.id === 'headline'
            ? [[element.text, element.color]]
            : [],
        ),
      ),
    ).toEqual([
      [['3/3 LIVE 444', VIEW_COLORS.live]],
      [['3/3 LIVE 475', VIEW_COLORS.quiet]],
      [['2/3 LIVE 275', VIEW_COLORS.error]],
      [['LIVE 37', VIEW_COLORS.live]],
    ]);
  });

  it('fits every text on its display', () => {
    expect(overflowingText(elements)).toEqual([]);
  });
});
