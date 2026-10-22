import { describe, expect, it } from 'vitest';

import { CatalogueError } from './error.ts';
import { parsePreview } from './preview.ts';

const VALID = {
  summary: ' Says hi. ',
  steps: [{ label: 'Draws', text: 'HI on the front' }],
  scenes: [
    {
      title: 'Hello',
      caption: 'The only scene.',
      elements: [{ id: 'hi', type: 'text', text: 'HI' }],
    },
  ],
};

function parse(value: unknown): ReturnType<typeof parsePreview> {
  return parsePreview('hello', JSON.stringify(value));
}

describe('parsePreview', () => {
  it('reads the summary, steps, and scenes, leaving elements to the emulator', () => {
    expect(parse(VALID)).toStrictEqual({
      summary: 'Says hi.',
      steps: [{ label: 'Draws', text: 'HI on the front' }],
      scenes: [
        {
          title: 'Hello',
          caption: 'The only scene.',
          elements: [{ id: 'hi', type: 'text', text: 'HI' }],
        },
      ],
    });
  });

  it('names the app when the output is not JSON', () => {
    expect(() => parsePreview('hello', 'Traceback')).toThrow(
      new CatalogueError('hello:preview did not print JSON.'),
    );
  });

  it.each([
    [[], 'something other than an object'],
    [{ ...VALID, summary: ' ' }, 'no summary for the app'],
    [{ ...VALID, steps: [] }, 'no steps, or steps that are not objects'],
    [
      { ...VALID, scenes: ['Hello'] },
      'no scenes, or scenes that are not objects',
    ],
    [{ ...VALID, steps: [{ label: 'Draws' }] }, 'no text for step 1'],
    [
      { ...VALID, scenes: [{ title: 'Hello', elements: [] }] },
      'no caption for scene 1',
    ],
  ])('refuses %j', (value, problem) => {
    expect(() => parse(value)).toThrow(
      new CatalogueError(`hello:preview printed ${problem}.`),
    );
  });
});
