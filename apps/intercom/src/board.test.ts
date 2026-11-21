import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { SetupError } from '@busy-bar-apps/bar-kit';

import { bar, focusFrom } from './__tests__/fixtures.ts';
import type { Board, BoardListener, Focus, Knock } from './board.ts';
import {
  createBoardFeed,
  FOCUS_ROW,
  incomingKnock,
  minutesLeft,
  nameOf,
  outgoingKnock,
  runningFocus,
  screenOf,
  selectable,
  selectionOf,
  startingFocus,
  statusAt,
  teammates,
} from './board.ts';
import { UNKNOWN_KEY } from './convex/presence.ts';

const NOW = Date.parse('2026-10-26T13:00:00Z');
const MINUTE = 60_000;
const at = (minutes: number): number => NOW + minutes * MINUTE;

function board(
  knocks: readonly Knock[] = [],
  focus: Focus | null = null,
): Board {
  return {
    me: 'Me',
    bars: [
      bar('Anna', { state: 'free' }),
      bar('Me', { state: 'free' }),
      bar('Søren', { state: 'free' }),
    ],
    knocks,
    focus,
  };
}

const ALONE: Board = { me: 'Me', bars: [], knocks: [], focus: null };

describe('statusAt', () => {
  it('counts down to the end of a timer', () => {
    expect(
      statusAt(bar('A', { state: 'busy', endsAt: at(17.2) }), NOW),
    ).toStrictEqual({ status: 'busy', minutes: 18 });
    expect(
      statusAt(bar('A', { state: 'resting', endsAt: at(4) }), NOW),
    ).toStrictEqual({ status: 'resting', minutes: 4 });
    expect(
      statusAt(bar('A', { state: 'paused', leftMs: 12 * MINUTE }), NOW),
    ).toStrictEqual({ status: 'paused', minutes: 12 });
  });

  it('gives no minutes when the timer has no end', () => {
    expect(
      statusAt(bar('A', { state: 'busy', endsAt: null }), NOW),
    ).toStrictEqual({ status: 'busy', minutes: undefined });
    expect(
      statusAt(bar('A', { state: 'paused', leftMs: null }), NOW),
    ).toStrictEqual({ status: 'paused', minutes: undefined });
  });

  it('frees a teammate whose timer ran out before their bar says so', () => {
    expect(
      statusAt(bar('A', { state: 'busy', endsAt: at(0) }), NOW),
    ).toStrictEqual({ status: 'free', minutes: undefined });
    expect(
      statusAt(bar('A', { state: 'resting', endsAt: at(-1) }), NOW),
    ).toStrictEqual({ status: 'resting', minutes: undefined });
  });

  it('puts offline before anything the bar last said', () => {
    expect(
      statusAt(bar('A', { state: 'busy', endsAt: at(5) }, false), NOW),
    ).toStrictEqual({ status: 'offline', minutes: undefined });
  });

  it('rounds the minutes left up, as a timer shows them', () => {
    expect(minutesLeft(1)).toBe(1);
    expect(minutesLeft(MINUTE)).toBe(1);
    expect(minutesLeft(MINUTE + 1)).toBe(2);
  });
});

describe('teammates', () => {
  it('leaves this bar out', () => {
    expect(teammates(board()).map((teammate) => teammate.id)).toStrictEqual([
      'Anna',
      'Søren',
    ]);
  });

  it('steps through the teammates, then the focus row', () => {
    expect(selectable(board())).toStrictEqual(['Anna', 'Søren', FOCUS_ROW]);
    expect(selectable(ALONE)).toStrictEqual([]);
  });

  it('points at the selection, or the first teammate', () => {
    expect(selectionOf(board(), 'Søren')).toMatchObject({
      kind: 'teammate',
      bar: { id: 'Søren' },
    });
    expect(selectionOf(board(), FOCUS_ROW)).toStrictEqual({ kind: 'focus' });
    expect(selectionOf(board(), 'Gone')).toMatchObject({ bar: { id: 'Anna' } });
    expect(selectionOf(board(), undefined)).toMatchObject({
      bar: { id: 'Anna' },
    });
    expect(selectionOf(ALONE, FOCUS_ROW)).toBeUndefined();
  });

  it('names a bar as the fonts draw it, and a bar that left as ?', () => {
    expect(nameOf(board(), 'Søren')).toBe('Soeren');
    expect(nameOf(board(), 'Gone')).toBe('?');
  });
});

describe('knocks', () => {
  const knocks: Knock[] = [
    { id: 'answered', from: 'Anna', to: 'Me', status: 'later' },
    { id: 'mine', from: 'Me', to: 'Anna', status: 'waiting' },
    { id: 'oldest', from: 'Anna', to: 'Me', status: 'waiting' },
    { id: 'newest', from: 'Søren', to: 'Me', status: 'waiting' },
  ];

  it('finds the oldest knock waiting on this bar', () => {
    expect(incomingKnock(board(knocks))?.id).toBe('oldest');
    expect(incomingKnock(board())).toBeUndefined();
  });

  it('finds the knock this bar sent', () => {
    expect(outgoingKnock(board(knocks))?.id).toBe('mine');
    expect(outgoingKnock(board(knocks.slice(2)))).toBeUndefined();
  });
});

describe('team focus', () => {
  const focus = focusFrom(at(1));

  it('counts down until the timers start, unless this bar skipped it', () => {
    expect(startingFocus(board([], focus), NOW)).toBe(focus);
    expect(startingFocus(board([], focus), at(1))).toBeUndefined();
    expect(
      startingFocus(board([], { ...focus, skipped: ['Me'] }), NOW),
    ).toBeUndefined();
    expect(startingFocus(board(), NOW)).toBeUndefined();
  });

  it('runs from its start until its end', () => {
    expect(runningFocus(board([], focus), NOW)).toBeUndefined();
    expect(runningFocus(board([], focus), at(1))).toBe(focus);
    expect(runningFocus(board([], focus), at(26))).toBeUndefined();
    expect(runningFocus(board(), at(1))).toBeUndefined();
  });
});

describe('screenOf', () => {
  const focus = focusFrom(at(1));
  const waiting: Knock = { id: 'k', from: 'Anna', to: 'Me', status: 'waiting' };

  it('shows a team focus counting down before a knock waiting on this bar', () => {
    expect(screenOf(board([waiting], focus), NOW)).toStrictEqual({
      kind: 'countdown',
      focus,
    });
    expect(screenOf(board([waiting], focus), at(1))).toStrictEqual({
      kind: 'knock',
      knock: waiting,
    });
  });

  it('shows the team once nothing takes over', () => {
    expect(screenOf(board([], focus), at(1))).toStrictEqual({ kind: 'team' });
    expect(
      screenOf(board([], { ...focus, skipped: ['Me'] }), NOW),
    ).toStrictEqual({ kind: 'team' });
  });
});

describe('createBoardFeed', () => {
  it('keeps the latest board and hands it to every listener', () => {
    const focus = vi.fn<BoardListener>();
    const chime = vi.fn<BoardListener>();
    const feed = createBoardFeed([focus, chime]);
    const next = board();

    feed.update(ALONE);
    feed.update(next);

    expect(feed.board()).toBe(next);
    expect(feed.failure()).toBeUndefined();
    expect(focus.mock.calls).toStrictEqual([[ALONE], [next]]);
    expect(chime.mock.calls).toStrictEqual([[ALONE], [next]]);
  });

  it('tells every listener when the query fails', () => {
    const focus = vi.fn<BoardListener>();
    const chime = vi.fn<BoardListener>();
    const feed = createBoardFeed([focus, chime]);

    feed.update(ALONE);
    feed.fail(new Error('Unknown key'));

    expect(focus.mock.calls).toStrictEqual([[ALONE], [undefined]]);
    expect(chime.mock.calls).toStrictEqual([[ALONE], [undefined]]);
  });

  it('shows why the query failed instead of the last board', () => {
    const feed = createBoardFeed([]);
    const failure = new Error('Unknown key');
    feed.update(ALONE);

    feed.fail(failure);

    expect(feed.board()).toBeUndefined();
    expect(feed.failure()).toBe(failure);
  });

  it('asks for a key the team knows when it rejects this one', () => {
    const feed = createBoardFeed([]);
    const rejected = new ConvexError(UNKNOWN_KEY);

    feed.fail(rejected);

    expect(feed.failure()).toBeInstanceOf(SetupError);
    expect(feed.failure()).toMatchObject({
      summary: 'unknown key',
      lines: [
        'The team does not know this',
        "bar's INTERCOM_KEY. Ask the",
        'deployment owner for one.',
      ],
      cause: rejected,
    });
  });

  it('clears the failure once a board arrives again', () => {
    const feed = createBoardFeed([]);
    feed.fail(new Error('Unknown key'));

    feed.update(ALONE);

    expect(feed.board()).toBe(ALONE);
    expect(feed.failure()).toBeUndefined();
  });
});
