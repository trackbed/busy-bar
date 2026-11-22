import { describe, expect, it, vi } from 'vitest';

import type { StockSound } from '@busy-bar-apps/bar-kit';

import type { ChallengeStatus } from './challenge.ts';
import type { EventSnapshot } from './event.ts';
import { boothView, createEventFetch, EventWatch } from './event.ts';
import type { BoothState, BoothStatus } from './photocraft.ts';

const NOW = new Date('2026-10-20T10:00:00Z');
const QUIET_MS = 15 * 60_000;

function booth(
  boothSlug: string,
  state: BoothState,
  minutesSincePhoto?: number,
): BoothStatus {
  return {
    booth: { eventSlug: 'summit-2026', boothSlug },
    state,
    photos: minutesSincePhoto === undefined ? 0 : 10,
    latestPhotoAt:
      minutesSincePhoto === undefined
        ? undefined
        : new Date(NOW.getTime() - minutesSincePhoto * 60_000),
    problem: undefined,
  };
}

function snapshot(...booths: BoothStatus[]): EventSnapshot {
  return { booths, challenge: undefined, challengeProblem: undefined };
}

describe('boothView', () => {
  it('calls a live booth quiet once its wall stops moving', () => {
    expect(boothView(booth('a', 'live', 15), NOW, QUIET_MS)).toBe('live');
    expect(boothView(booth('a', 'live', 16), NOW, QUIET_MS)).toBe('quiet');
  });

  it('does not call a booth quiet before its first portrait', () => {
    expect(boothView(booth('a', 'live'), NOW, QUIET_MS)).toBe('live');
  });

  it('keeps the other states', () => {
    expect(boothView(booth('a', 'off', 60), NOW, QUIET_MS)).toBe('off');
  });
});

describe('EventWatch', () => {
  it('sounds when a live booth goes quiet or down, once', () => {
    const watch = new EventWatch(QUIET_MS);
    expect(
      watch.observe(
        snapshot(booth('a', 'live', 1), booth('b', 'live', 1)),
        NOW,
      ),
    ).toBeUndefined();

    expect(
      watch.observe(
        snapshot(booth('a', 'live', 20), booth('b', 'live', 1)),
        NOW,
      ),
    ).toBe('quiet');
    expect(
      watch.observe(
        snapshot(booth('a', 'live', 21), booth('b', 'live', 1)),
        NOW,
      ),
    ).toBeUndefined();
  });

  it('puts a booth going down ahead of one going quiet', () => {
    const watch = new EventWatch(QUIET_MS);
    watch.observe(snapshot(booth('a', 'live', 1), booth('b', 'live', 1)), NOW);

    expect(
      watch.observe(snapshot(booth('a', 'live', 20), booth('b', 'error')), NOW),
    ).toBe('down');
  });

  it('stays silent when a booth is paused or was not live', () => {
    const watch = new EventWatch(QUIET_MS);
    watch.observe(snapshot(booth('a', 'live', 1), booth('b', 'off')), NOW);

    expect(
      watch.observe(snapshot(booth('a', 'off'), booth('b', 'missing')), NOW),
    ).toBeUndefined();
  });
});

describe('createEventFetch', () => {
  const SIGNAL = new AbortController().signal;
  const LEADERBOARD: ChallengeStatus = {
    state: 'live',
    entries: 37,
    leader: { name: 'Ada', score: 1200 },
  };

  type Options = Parameters<typeof createEventFetch>[0];

  function setup(overrides: Partial<Options> = {}) {
    const log = { warn: vi.fn<Console['warn']>() };
    const play = vi.fn<(sound: StockSound) => void>();
    let statuses = [booth('a', 'live', 1)];
    const fetch = createEventFetch({
      name: 'test',
      photoCraft: {
        booths: [{ eventSlug: 'summit-2026', boothSlug: 'a' }],
        status: () => Promise.resolve(statuses[0] ?? booth('a', 'error')),
      },
      challenge: () => Promise.resolve(LEADERBOARD),
      quietMs: QUIET_MS,
      play,
      now: () => NOW,
      log,
      ...overrides,
    });
    const next = (state: BoothStatus): void => {
      statuses = [state];
    };
    return { fetch, play, log, next };
  }

  it('reads every booth and the leaderboard into one snapshot', async () => {
    const { fetch } = setup();

    expect(await fetch(SIGNAL)).toStrictEqual({
      booths: [booth('a', 'live', 1)],
      challenge: LEADERBOARD,
      challengeProblem: undefined,
    });
  });

  it('logs and shows why the leaderboard failed and keeps the booths', async () => {
    const failure = new Error('token expired');
    const { fetch, log } = setup({
      challenge: () => Promise.reject(failure),
    });

    expect(await fetch(SIGNAL)).toStrictEqual({
      booths: [booth('a', 'live', 1)],
      challenge: undefined,
      challengeProblem: 'token expired',
    });
    expect(log.warn).toHaveBeenCalledWith(
      '[test] Reading the challenge leaderboard failed:',
      failure,
    );
  });

  it('gives up on the leaderboard with the poll when it is aborted', async () => {
    const controller = new AbortController();
    const aborted = new Error('aborted');
    const { fetch } = setup({
      challenge: () => {
        controller.abort();
        return Promise.reject(aborted);
      },
    });

    await expect(fetch(controller.signal)).rejects.toBe(aborted);
  });

  it('reads no leaderboard when none is set up', async () => {
    const { fetch } = setup({ challenge: undefined });

    expect(await fetch(SIGNAL)).toMatchObject({
      challenge: undefined,
      challengeProblem: undefined,
    });
  });

  it('reads no booths when PhotoCraft is not set up', async () => {
    const { fetch } = setup({ photoCraft: undefined });

    expect(await fetch(SIGNAL)).toMatchObject({ booths: [] });
  });

  it('plays the sound for a booth that goes down or quiet', async () => {
    const { fetch, play, next } = setup();
    await fetch(SIGNAL);

    next(booth('a', 'error'));
    await fetch(SIGNAL);
    next(booth('a', 'live', 1));
    await fetch(SIGNAL);
    next(booth('a', 'live', 20));
    await fetch(SIGNAL);

    expect(play.mock.calls).toStrictEqual([['event'], ['reminder']]);
  });
});
