import { describe, expect, it, vi } from 'vitest';

import { BACK_PNG, FRONT_PNG } from './__tests__/fixtures.ts';
import type { AppProject } from './apps.ts';
import type { DrawScene } from './catalogue.ts';
import { catalogueApp } from './catalogue.ts';
import { CatalogueError } from './error.ts';
import type { Preview } from './preview.ts';

const PROJECT: AppProject = {
  name: 'clock',
  root: 'apps/clock',
  language: 'TypeScript',
  preview: { command: 'node src/preview.ts', cwd: 'apps/clock' },
};

const ELEMENTS = [
  { id: 'time', type: 'text', text: '09:41' },
  { id: 'bar', type: 'rectangle', display: 'front' },
  { id: 'date', type: 'text', display: 'back', text: 'Wed 21 Oct' },
  { id: 'zone', type: 'text', display: 'back', text: 'CET' },
  'not an element',
];

const PREVIEW: Preview = {
  summary: 'The time.',
  steps: [{ label: 'Draws', text: 'The time.' }],
  scenes: [{ title: 'Morning', caption: 'At 09:41.', elements: ELEMENTS }],
};

const NOW = Date.parse('2026-10-21T09:00:00Z');

describe('catalogueApp', () => {
  it('draws each scene as the app, at the given moment', async () => {
    const draw = vi.fn<DrawScene>(() =>
      Promise.resolve({ front: FRONT_PNG, back: BACK_PNG }),
    );

    const app = await catalogueApp(PROJECT, PREVIEW, draw, NOW);

    expect(draw).toHaveBeenCalledWith(
      { application_name: 'clock', elements: ELEMENTS },
      NOW,
    );
    expect(app).toStrictEqual({
      project: PROJECT,
      summary: 'The time.',
      steps: PREVIEW.steps,
      scenes: [
        {
          title: 'Morning',
          caption: 'At 09:41.',
          screenshots: { front: FRONT_PNG, back: BACK_PNG },
          text: { front: '09:41', back: 'Wed 21 Oct CET' },
        },
      ],
    });
  });

  it('names the scene the bar would refuse', async () => {
    const draw = (): Promise<never> =>
      Promise.reject(new Error('Elements array is empty'));

    await expect(catalogueApp(PROJECT, PREVIEW, draw, NOW)).rejects.toThrow(
      new CatalogueError(
        'clock: the bar would refuse scene "Morning": Elements array is empty',
      ),
    );
  });
});
