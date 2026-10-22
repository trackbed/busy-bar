// A catalogue app with stand-in screenshots, for tests that do not draw.

import type { CatalogueApp } from '../catalogue.ts';

export const FRONT_PNG = Uint8Array.from([1, 2, 3]);
export const BACK_PNG = Uint8Array.from([4, 5, 6]);

export function catalogueApp(
  overrides: Partial<CatalogueApp> = {},
): CatalogueApp {
  return {
    project: {
      name: 'clock',
      root: 'apps/clock',
      language: 'TypeScript',
      preview: { command: 'node src/preview.ts', cwd: 'apps/clock' },
    },
    summary: 'The time on the front display.',
    steps: [{ label: 'Draws', text: 'HH:MM over a seconds bar.' }],
    scenes: [
      {
        title: 'Morning',
        caption: 'Twenty seconds into 09:41.',
        screenshots: { front: FRONT_PNG, back: BACK_PNG },
        text: { front: '09:41', back: '' },
      },
    ],
    ...overrides,
  };
}
