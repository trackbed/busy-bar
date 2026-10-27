import { describe, expect, it } from 'vitest';

import type { BusySnapshot } from '@busy-bar-apps/bar-kit';

import { presenceAt } from './timer.ts';

const AT = 1_761_480_000_000;
const MINUTE = 60_000;
const CARD = '00000000-0000-0000-0000-000000000000';
const SETTINGS = {
  theme: 'busy',
  show_work_phase_only: false,
  trigger_smart_home: true,
};

type Timer = BusySnapshot['snapshot'];

function snapshot(timer: Timer): BusySnapshot {
  return { snapshot: timer, snapshot_timestamp_ms: AT };
}

/** A 3-cycle interval timer of 20 working and 5 resting minutes. */
function interval(
  current: number,
  leftMs: number,
  options: { readonly paused?: boolean; readonly autostart?: boolean } = {},
): Timer {
  const total = (current % 2 === 0 ? 20 : 5) * MINUTE;
  return {
    type: 'INTERVAL',
    card_id: CARD,
    is_paused: options.paused ?? false,
    current_interval: current,
    current_interval_time_total_ms: total,
    current_interval_time_left_ms: leftMs,
    interval_settings: {
      type: 'INTERVAL',
      interval_work_ms: 20 * MINUTE,
      interval_rest_ms: 5 * MINUTE,
      interval_work_cycles_count: 3,
      is_autostart_enabled: options.autostart ?? true,
    },
    busy_bar_settings: SETTINGS,
  };
}

describe('presenceAt', () => {
  it('is free without a timer', () => {
    expect(
      presenceAt(
        snapshot({ type: 'NOT_STARTED', busy_bar_settings: SETTINGS }),
        AT,
      ),
    ).toStrictEqual({ state: 'free' });
  });

  it('is busy without an end while an infinite timer runs', () => {
    const timer: Timer = {
      type: 'INFINITE',
      card_id: CARD,
      is_paused: false,
      busy_bar_settings: SETTINGS,
    };

    expect(presenceAt(snapshot(timer), AT + 90 * MINUTE)).toStrictEqual({
      state: 'busy',
      endsAt: null,
    });
    expect(
      presenceAt(snapshot({ ...timer, is_paused: true }), AT),
    ).toStrictEqual({ state: 'paused', leftMs: null });
  });

  describe('a simple timer', () => {
    const timer = (leftMs: number, paused = false): Timer => ({
      type: 'SIMPLE',
      card_id: CARD,
      is_paused: paused,
      time_left_ms: leftMs,
      busy_bar_settings: SETTINGS,
    });

    it('ends its time left after the snapshot, not after now', () => {
      expect(
        presenceAt(snapshot(timer(25 * MINUTE)), AT + 10 * MINUTE),
      ).toStrictEqual({ state: 'busy', endsAt: AT + 25 * MINUTE });
    });

    it('is free once it has run out, though the bar still reports it', () => {
      expect(
        presenceAt(snapshot(timer(25 * MINUTE)), AT + 25 * MINUTE),
      ).toStrictEqual({ state: 'free' });
    });

    it('keeps its time left while paused', () => {
      expect(
        presenceAt(snapshot(timer(7 * MINUTE, true)), AT + 60 * MINUTE),
      ).toStrictEqual({ state: 'paused', leftMs: 7 * MINUTE });
    });
  });

  describe('an interval timer', () => {
    it('is busy until the work interval ends', () => {
      expect(
        presenceAt(snapshot(interval(0, 20 * MINUTE)), AT + MINUTE),
      ).toStrictEqual({ state: 'busy', endsAt: AT + 20 * MINUTE });
    });

    it('rests between work intervals', () => {
      expect(presenceAt(snapshot(interval(1, 5 * MINUTE)), AT)).toStrictEqual({
        state: 'resting',
        endsAt: AT + 5 * MINUTE,
      });
    });

    it('moves on through the intervals that started on their own', () => {
      // Work ends at 20, rest at 25, the next work at 45.
      expect(
        presenceAt(snapshot(interval(0, 20 * MINUTE)), AT + 22 * MINUTE),
      ).toStrictEqual({ state: 'resting', endsAt: AT + 25 * MINUTE });
      expect(
        presenceAt(snapshot(interval(0, 20 * MINUTE)), AT + 30 * MINUTE),
      ).toStrictEqual({ state: 'busy', endsAt: AT + 45 * MINUTE });
    });

    it('is free after the last work interval', () => {
      expect(
        presenceAt(snapshot(interval(4, 20 * MINUTE)), AT + 20 * MINUTE),
      ).toStrictEqual({ state: 'free' });
      expect(
        presenceAt(snapshot(interval(0, 20 * MINUTE)), AT + 95 * MINUTE),
      ).toStrictEqual({ state: 'free' });
    });

    it('waits for START at a new interval without autostart', () => {
      expect(
        presenceAt(
          snapshot(interval(0, 20 * MINUTE, { autostart: false })),
          AT + 21 * MINUTE,
        ),
      ).toStrictEqual({ state: 'paused', leftMs: 5 * MINUTE });
      expect(
        presenceAt(
          snapshot(interval(1, 5 * MINUTE, { autostart: false })),
          AT + 6 * MINUTE,
        ),
      ).toStrictEqual({ state: 'paused', leftMs: 20 * MINUTE });
    });

    it('keeps the interval time left while paused', () => {
      expect(
        presenceAt(
          snapshot(interval(2, 9 * MINUTE, { paused: true })),
          AT + 60 * MINUTE,
        ),
      ).toStrictEqual({ state: 'paused', leftMs: 9 * MINUTE });
    });
  });
});
