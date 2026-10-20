import { describe, expect, it } from 'vitest';

import type { EventSnapshot } from './event.ts';
import { boothView, EventWatch } from './event.ts';
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
