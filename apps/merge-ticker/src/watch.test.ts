import { describe, expect, it, vi } from 'vitest';

import type { StockSound } from '@busy-bar-apps/bar-kit';

import type { Checks, PullRequests } from './github.ts';
import { createTickerFetch, MergeWatch } from './watch.ts';

const NOW = new Date('2026-10-20T10:00:00Z');
const LATER = new Date('2026-10-20T10:01:00Z');

function pulls({
  merged = [],
  checks = [],
}: {
  merged?: number[];
  checks?: Checks[];
}): PullRequests {
  return {
    open: checks.map((state, index) => ({
      repo: 'a/b',
      number: 100 + index,
      title: `PR ${index}`,
      draft: false,
      autoMerge: false,
      checks: state,
    })),
    openCount: checks.length,
    mergedToday: merged.length,
    merged: merged.map((number) => ({
      repo: 'a/b',
      number,
      title: `Merged ${number}`,
      mergedAt: NOW,
    })),
  };
}

describe('MergeWatch', () => {
  it('takes the first reading as the baseline', () => {
    const watch = new MergeWatch();

    const { state, alert } = watch.observe(
      pulls({ merged: [1], checks: ['failing'] }),
      NOW,
    );

    expect(alert).toBeUndefined();
    expect(state.celebration).toBeUndefined();
  });

  it('celebrates a merge it has not seen before', () => {
    const watch = new MergeWatch();
    watch.observe(pulls({ merged: [1] }), NOW);

    const { state, alert } = watch.observe(pulls({ merged: [2, 1] }), LATER);

    expect(alert).toBe('merged');
    expect(state.celebration).toStrictEqual({
      merge: { repo: 'a/b', number: 2, title: 'Merged 2', mergedAt: NOW },
      noticedAt: LATER,
    });
  });

  it('keeps the last celebration until the next merge', () => {
    const watch = new MergeWatch();
    watch.observe(pulls({}), NOW);
    watch.observe(pulls({ merged: [5] }), NOW);

    const { state, alert } = watch.observe(pulls({ merged: [5] }), LATER);

    expect(alert).toBeUndefined();
    expect(state.celebration?.merge.number).toBe(5);
  });

  it('flags checks that just started failing, once', () => {
    const watch = new MergeWatch();
    watch.observe(pulls({ checks: ['pending'] }), NOW);

    expect(watch.observe(pulls({ checks: ['failing'] }), NOW).alert).toBe(
      'failing',
    );
    expect(
      watch.observe(pulls({ checks: ['failing'] }), LATER).alert,
    ).toBeUndefined();
  });

  it('prefers the merge when both happen at once', () => {
    const watch = new MergeWatch();
    watch.observe(pulls({ checks: ['pending'] }), NOW);

    const { alert } = watch.observe(
      pulls({ merged: [9], checks: ['failing'] }),
      LATER,
    );

    expect(alert).toBe('merged');
  });
});

describe('createTickerFetch', () => {
  const SIGNAL = new AbortController().signal;

  type Options = Parameters<typeof createTickerFetch>[0];

  function setup(overrides: Partial<Options> = {}) {
    const play = vi.fn<(sound: StockSound) => void>();
    const readings: PullRequests[] = [];
    const pullRequests = vi.fn<Options['pullRequests']>(() =>
      Promise.resolve(readings.shift() ?? pulls({})),
    );
    const fetch = createTickerFetch({
      pullRequests,
      play,
      now: () => NOW,
      ...overrides,
    });
    return { fetch, play, pullRequests, readings };
  }

  it('reads the pull requests as of now', async () => {
    const { fetch, pullRequests } = setup();

    const state = await fetch(SIGNAL);

    expect(pullRequests).toHaveBeenCalledWith(NOW, SIGNAL);
    expect(state).toStrictEqual({ pulls: pulls({}), celebration: undefined });
  });

  it('plays the sound for a merge, then for checks that broke', async () => {
    const { fetch, play, readings } = setup();
    readings.push(
      pulls({ checks: ['pending'] }),
      pulls({ merged: [1], checks: ['pending'] }),
      pulls({ merged: [1], checks: ['failing'] }),
    );

    await fetch(SIGNAL);
    await fetch(SIGNAL);
    await fetch(SIGNAL);

    expect(play.mock.calls).toStrictEqual([['event'], ['reminder']]);
  });
});
