// What a bar tells its team, shared by the backend and the bar's process.

import type { Infer } from 'convex/values';
import { v } from 'convex/values';

/** A bar's process reports at least this often while it can read its bar. */
export const HEARTBEAT_MS = 60_000;

/** A bar that has not reported for this long counts as offline. */
export const OFFLINE_AFTER_MS = 150_000;

/**
 * What a bar's BUSY timer says about its owner. Times are epoch
 * milliseconds; every bar counts down to `endsAt` on its own clock, so a
 * running timer is reported once, not every second.
 */
export const presenceValidator = v.union(
  v.object({ state: v.literal('free') }),
  // `endsAt` is null for a timer without an end.
  v.object({ state: v.literal('busy'), endsAt: v.union(v.number(), v.null()) }),
  // The break between two work intervals of an interval timer.
  v.object({ state: v.literal('resting'), endsAt: v.number() }),
  // `leftMs` is null for a paused timer without an end.
  v.object({
    state: v.literal('paused'),
    leftMs: v.union(v.number(), v.null()),
  }),
);

export type Presence = Infer<typeof presenceValidator>;

export function samePresence(a: Presence, b: Presence): boolean {
  switch (a.state) {
    case 'free':
      return b.state === 'free';
    case 'busy':
      return b.state === 'busy' && b.endsAt === a.endsAt;
    case 'resting':
      return b.state === 'resting' && b.endsAt === a.endsAt;
    case 'paused':
      return b.state === 'paused' && b.leftMs === a.leftMs;
  }
}

/**
 * Whether a bar that reported `presence` is free at `now`: it runs no
 * timer, or its timer has run out since it last reported.
 */
export function freeAt(presence: Presence, now: number): boolean {
  return (
    presence.state === 'free' ||
    (presence.state === 'busy' &&
      presence.endsAt !== null &&
      presence.endsAt <= now)
  );
}
