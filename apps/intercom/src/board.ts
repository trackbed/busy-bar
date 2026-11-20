// Reading the team's board: who the teammates are, what their timers say
// now, which knocks concern this bar, and the team focus.

import { toBarText } from '@busy-bar-apps/bar-kit';

import type { Presence } from './convex/presence.ts';
import { freeAt } from './convex/presence.ts';
import type { KnockStatus } from './convex/schema.ts';

/** One bar on the team, as `team:board` answers it. */
export interface TeamBar {
  readonly id: string;
  readonly name: string;
  readonly online: boolean;
  readonly presence: Presence;
}

/** A knock to or from this bar. */
export interface Knock {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly status: KnockStatus;
}

/** A team focus, from the moment it is started until its timers end. */
export interface Focus {
  readonly id: string;
  readonly startedBy: string;
  readonly startsAt: number;
  readonly endsAt: number;
  /** The BUSY timer card every joining bar runs. */
  readonly cardId: string;
  readonly skipped: readonly string[];
}

/** What `team:board` answers: the bars, this bar's knocks, the focus. */
export interface Board {
  readonly me: string;
  readonly bars: readonly TeamBar[];
  readonly knocks: readonly Knock[];
  readonly focus: Focus | null;
}

export type Status = 'free' | 'busy' | 'resting' | 'paused' | 'offline';

/** A bar's status at one moment, with the minutes its timer has left. */
export interface BarStatus {
  readonly status: Status;
  readonly minutes: number | undefined;
}

/** A bar's status at `now`, from what it last reported. */
export function statusAt(bar: TeamBar, now: number): BarStatus {
  const { presence } = bar;
  if (!bar.online) {
    return { status: 'offline', minutes: undefined };
  }
  switch (presence.state) {
    case 'free':
      return { status: 'free', minutes: undefined };
    case 'busy':
      // A timer that ran out: its bar reports that within seconds.
      if (freeAt(presence, now)) {
        return { status: 'free', minutes: undefined };
      }
      return {
        status: 'busy',
        minutes:
          presence.endsAt === null
            ? undefined
            : minutesLeft(presence.endsAt - now),
      };
    case 'resting':
      return {
        status: 'resting',
        minutes:
          presence.endsAt > now
            ? minutesLeft(presence.endsAt - now)
            : undefined,
      };
    case 'paused':
      return {
        status: 'paused',
        minutes:
          presence.leftMs === null ? undefined : minutesLeft(presence.leftMs),
      };
  }
}

/** Every bar but this one, in the board's order (by name). */
export function teammates(board: Board): readonly TeamBar[] {
  return board.bars.filter((bar) => bar.id !== board.me);
}

/** The row after the teammates that starts or joins a team focus. */
export const FOCUS_ROW = 'focus';

/** What the wheel points at: a teammate or the team-focus row. */
export type Selection =
  | { readonly kind: 'teammate'; readonly bar: TeamBar }
  | { readonly kind: 'focus' };

/** What the wheel steps through, in order: the teammates, then the focus. */
export function selectable(board: Board): readonly string[] {
  const team = teammates(board).map((bar) => bar.id);
  return team.length === 0 ? [] : [...team, FOCUS_ROW];
}

/**
 * What the wheel points at: `selected` while it is still there, the first
 * teammate otherwise, and nothing on a team of one.
 */
export function selectionOf(
  board: Board,
  selected: string | undefined,
): Selection | undefined {
  const team = teammates(board);
  if (team.length > 0 && selected === FOCUS_ROW) {
    return { kind: 'focus' };
  }
  const bar = team.find((candidate) => candidate.id === selected) ?? team[0];
  return bar === undefined ? undefined : { kind: 'teammate', bar };
}

/** The team focus, before its timers start, unless this bar skipped it. */
export function startingFocus(board: Board, now: number): Focus | undefined {
  const { focus } = board;
  return focus !== null &&
    now < focus.startsAt &&
    !focus.skipped.includes(board.me)
    ? focus
    : undefined;
}

/** The team focus while its timers run. */
export function runningFocus(board: Board, now: number): Focus | undefined {
  const { focus } = board;
  return focus !== null && focus.startsAt <= now && now < focus.endsAt
    ? focus
    : undefined;
}

/** The oldest knock waiting on this bar. */
export function incomingKnock(board: Board): Knock | undefined {
  return board.knocks.find(
    (knock) => knock.to === board.me && knock.status === 'waiting',
  );
}

/** The knock this bar sent, while it waits and while its answer shows. */
export function outgoingKnock(board: Board): Knock | undefined {
  return board.knocks.find((knock) => knock.from === board.me);
}

/** A bar's name as the fonts draw it; `?` for one that left the team. */
export function nameOf(board: Board, id: string): string {
  const bar = board.bars.find((candidate) => candidate.id === id);
  return bar === undefined ? '?' : toBarText(bar.name);
}

/** Whole minutes left of `ms`, rounded up, as a timer shows them. */
export function minutesLeft(ms: number): number {
  return Math.ceil(ms / 60_000);
}

/** The team's board as its subscription last delivered it. */
export interface BoardFeed {
  /** The last board; none before the first one or after a failed query. */
  readonly board: () => Board | undefined;
  /** Why the last query failed, until the next board arrives. */
  readonly failure: () => Error | undefined;
  /** Take a new board, clear any failure, and hand it to every listener. */
  readonly update: (next: Board) => void;
  /**
   * Take a failed query, such as for a key the team no longer knows: drop the
   * board, so the screen shows why rather than an old board.
   */
  readonly fail: (error: Error) => void;
}

export function createBoardFeed(
  listeners: readonly ((board: Board) => void)[],
): BoardFeed {
  let board: Board | undefined;
  let failure: Error | undefined;
  return {
    board: () => board,
    failure: () => failure,
    update: (next) => {
      board = next;
      failure = undefined;
      for (const listen of listeners) {
        listen(next);
      }
    },
    fail: (error) => {
      board = undefined;
      failure = error;
    },
  };
}
