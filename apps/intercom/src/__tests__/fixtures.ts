// Builders for intercom's test files: the bars and team focus a board holds.

import type { Focus, TeamBar } from '../board.ts';
import type { Presence } from '../convex/presence.ts';

const MINUTE = 60_000;

/** A bar on the team, with its name as its id. */
export function bar(
  name: string,
  presence: Presence = { state: 'free' },
  online = true,
): TeamBar {
  return { id: name, name, online, presence };
}

/** A 25-minute team focus Anna started, whose timers start at `startsAt`. */
export function focusFrom(startsAt: number): Focus {
  return {
    id: 'f',
    startedBy: 'Anna',
    startsAt,
    endsAt: startsAt + 25 * MINUTE,
    cardId: '00000000-0000-4000-8000-000000000000',
    skipped: [],
  };
}
