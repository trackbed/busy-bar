// The bar's BUSY timer as presence. The firmware records a snapshot only
// when its timer changes state (services/busy_timer/busy_timer.c): time
// left counts from `snapshot_timestamp_ms`, and a timer that ran out keeps
// its last snapshot until the next change, so this works out where it is.

import type { BusySnapshot } from '@busy-bar-apps/bar-kit';

import type { Presence } from './convex/presence.ts';

type Timer = BusySnapshot['snapshot'];
type IntervalTimer = Extract<Timer, { type: 'INTERVAL' }>;

const FREE: Presence = { state: 'free' };

/** What the BUSY timer in `snapshot` says at `now`, in epoch milliseconds. */
export function presenceAt(snapshot: BusySnapshot, now: number): Presence {
  const timer = snapshot.snapshot;
  const at = snapshot.snapshot_timestamp_ms;
  switch (timer.type) {
    case 'NOT_STARTED':
      return FREE;
    case 'INFINITE':
      return timer.is_paused
        ? { state: 'paused', leftMs: null }
        : { state: 'busy', endsAt: null };
    case 'SIMPLE': {
      if (timer.is_paused) {
        return { state: 'paused', leftMs: timer.time_left_ms };
      }
      const endsAt = at + timer.time_left_ms;
      return endsAt > now ? { state: 'busy', endsAt } : FREE;
    }
    case 'INTERVAL':
      return intervalAt(timer, at, now);
  }
}

/**
 * Intervals alternate work (even index) and rest, ending on the last work
 * interval. Without autostart the bar stops at the start of each new
 * interval and waits for START.
 */
function intervalAt(timer: IntervalTimer, at: number, now: number): Presence {
  if (timer.is_paused) {
    return { state: 'paused', leftMs: timer.current_interval_time_left_ms };
  }
  const settings = timer.interval_settings;
  const last = settings.interval_work_cycles_count * 2 - 2;
  let index = timer.current_interval;
  let endsAt = at + timer.current_interval_time_left_ms;
  while (endsAt <= now) {
    if (index >= last) {
      return FREE;
    }
    index += 1;
    const length =
      index % 2 === 0 ? settings.interval_work_ms : settings.interval_rest_ms;
    if (!settings.is_autostart_enabled) {
      return { state: 'paused', leftMs: length };
    }
    endsAt += length;
  }
  return index % 2 === 0
    ? { state: 'busy', endsAt }
    : { state: 'resting', endsAt };
}
