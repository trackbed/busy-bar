import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BusySnapshot } from '@busy-bar-apps/bar-kit';

import { focusFrom } from './__tests__/fixtures.ts';
import type { Board, Focus } from './board.ts';
import type { FocusOptions } from './focus.ts';
import { createFocusDriver, JOIN_WINDOW_MS } from './focus.ts';

const NOW = Date.parse('2026-10-27T09:00:00Z');
const MINUTE = 60_000;
const SETTINGS = {
  theme: 'on_air',
  show_work_phase_only: false,
  trigger_smart_home: true,
};
const FREE: BusySnapshot = {
  snapshot: { type: 'NOT_STARTED', busy_bar_settings: SETTINGS },
  snapshot_timestamp_ms: NOW - 60 * MINUTE,
};
const FOCUS = focusFrom(NOW + 15_000);

afterEach(() => {
  vi.useRealTimers();
});

function board(focus: Focus | null): Board {
  return { me: 'Me', bars: [], knocks: [], focus };
}

function setup(snapshot: BusySnapshot = FREE) {
  vi.useFakeTimers({ now: NOW });
  const start = vi.fn<FocusOptions['start']>(() => Promise.resolve());
  const read = vi.fn<FocusOptions['snapshot']>(() => Promise.resolve(snapshot));
  const log = { warn: vi.fn<Console['warn']>() };
  const driver = createFocusDriver({
    name: 'test',
    snapshot: read,
    start,
    log,
  });
  return { driver, start, read, log };
}

/** The snapshot every joining bar runs for {@link FOCUS}. */
const TEAM_TIMER: BusySnapshot = {
  snapshot: {
    type: 'SIMPLE',
    card_id: FOCUS.cardId,
    is_paused: false,
    time_left_ms: 25 * MINUTE,
    busy_bar_settings: SETTINGS,
  },
  snapshot_timestamp_ms: FOCUS.startsAt,
};

describe('createFocusDriver', () => {
  it('starts the bar timer when the session starts, stamped with that moment', async () => {
    const { driver, start } = setup();

    driver.observe(board(FOCUS));
    driver.observe(board(FOCUS));
    await vi.advanceTimersByTimeAsync(14_999);

    expect(start).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(start.mock.calls).toStrictEqual([[TEAM_TIMER]]);
  });

  it('drops the plan when the bar skips the session or it is called off', async () => {
    const { driver, start } = setup();

    driver.observe(board(FOCUS));
    driver.observe(board({ ...FOCUS, skipped: ['Me'] }));
    driver.observe(board({ ...FOCUS, id: 'g' }));
    driver.observe(board(null));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(start).not.toHaveBeenCalled();
  });

  it('drops the plan when the board is lost', async () => {
    const { driver, start } = setup();

    driver.observe(board(FOCUS));
    driver.observe(undefined);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(start).not.toHaveBeenCalled();
  });

  it('plans again for a session still on when the board comes back', async () => {
    const { driver, start } = setup();

    driver.observe(board(FOCUS));
    driver.observe(undefined);
    driver.observe(board(FOCUS));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(start.mock.calls).toStrictEqual([[TEAM_TIMER]]);
  });

  it('does not join a session again when the board comes back after the join', async () => {
    const { driver, start } = setup();

    driver.observe(board(FOCUS));
    await vi.advanceTimersByTimeAsync(15_000);
    driver.observe(undefined);
    driver.observe(board(FOCUS));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(start).toHaveBeenCalledOnce();
  });

  it('joins a session that just started, but not one long under way', async () => {
    const { driver, start } = setup();

    driver.observe(board({ ...FOCUS, startsAt: NOW - JOIN_WINDOW_MS }));
    await vi.advanceTimersByTimeAsync(0);
    driver.observe(
      board({ ...FOCUS, id: 'g', startsAt: NOW - JOIN_WINDOW_MS - 1 }),
    );
    await vi.advanceTimersByTimeAsync(60_000);

    expect(start).toHaveBeenCalledOnce();
  });

  it('leaves a bar whose owner runs a timer of their own alone', async () => {
    const { driver, start } = setup({
      snapshot: {
        type: 'INFINITE',
        card_id: '00000000-0000-0000-0000-000000000000',
        is_paused: false,
        busy_bar_settings: SETTINGS,
      },
      snapshot_timestamp_ms: NOW,
    });

    await driver.join(FOCUS);

    expect(start).not.toHaveBeenCalled();
  });

  it('stamps a late join after a timer its owner stopped, ending with the team', async () => {
    const stoppedAt = FOCUS.startsAt + 5 * MINUTE;
    const { driver, start } = setup({
      ...FREE,
      snapshot_timestamp_ms: stoppedAt,
    });

    await driver.join(FOCUS);

    expect(start.mock.calls).toStrictEqual([
      [
        {
          snapshot: {
            ...TEAM_TIMER.snapshot,
            time_left_ms: FOCUS.endsAt - stoppedAt - 1,
          },
          snapshot_timestamp_ms: stoppedAt + 1,
        },
      ],
    ]);
  });

  it('joins on request, and logs a bar it cannot reach', async () => {
    const { driver, start, read, log } = setup();
    read.mockRejectedValueOnce(new Error('bar offline'));

    await driver.join(FOCUS);
    await driver.join(FOCUS);

    expect(start).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledExactlyOnceWith(
      '[test] Joining the team focus failed:',
      new Error('bar offline'),
    );
  });

  it('forgets its plan when it stops', async () => {
    const { driver, start } = setup();

    driver.observe(board(FOCUS));
    driver.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(start).not.toHaveBeenCalled();
  });
});
