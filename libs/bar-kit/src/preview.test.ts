import { describe, expect, it } from 'vitest';

import type { Preview } from './preview.ts';
import { printPreview } from './preview.ts';

describe('printPreview', () => {
  it('writes the preview as one line of JSON', () => {
    const preview: Preview = {
      summary: 'Says hi.',
      steps: [{ label: 'Draws', text: 'HI on the front' }],
      scenes: [
        {
          title: 'Hello',
          caption: 'The only scene.',
          elements: [
            { id: 'hi', type: 'text', text: 'HI', font: 'normal', x: 2, y: 2 },
          ],
        },
      ],
    };
    const written: string[] = [];

    printPreview(preview, {
      write: (chunk: string) => written.push(chunk) > 0,
    });

    expect(written).toHaveLength(1);
    expect(written[0]?.endsWith('\n')).toBe(true);
    expect(JSON.parse(written[0] ?? '')).toEqual(preview);
  });
});
