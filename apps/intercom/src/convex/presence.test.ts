import { describe, expect, it } from 'vitest';

import type { Presence } from './presence.ts';
import { samePresence } from './presence.ts';

const ALL: readonly Presence[] = [
  { state: 'free' },
  { state: 'busy', endsAt: 1000 },
  { state: 'busy', endsAt: null },
  { state: 'resting', endsAt: 1000 },
  { state: 'resting', endsAt: 2000 },
  { state: 'paused', leftMs: 1000 },
  { state: 'paused', leftMs: null },
];

describe('samePresence', () => {
  it('matches each presence only with an equal one', () => {
    for (const [i, a] of ALL.entries()) {
      for (const [j, b] of ALL.entries()) {
        expect(samePresence(a, b), `${i} vs ${j}`).toBe(i === j);
      }
    }
  });

  it('compares values, not objects', () => {
    expect(
      samePresence(
        { state: 'paused', leftMs: 5 },
        { state: 'paused', leftMs: 5 },
      ),
    ).toBe(true);
  });
});
