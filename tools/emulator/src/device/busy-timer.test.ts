import { describe, expect, it } from 'vitest';

import type { BusySnapshot } from './busy-timer.ts';
import {
  DEFAULT_SETTINGS,
  parseBusySnapshot,
  screenHold,
  startedTimer,
  stoppedTimer,
} from './busy-timer.ts';

const NOW = 1_761_480_000_000;
const MINUTE = 60_000;
const CARD = 'c0ffee00-0000-4000-8000-00000000abcd';
const SETTINGS = {
  theme: 'on_air',
  show_work_phase_only: true,
  trigger_smart_home: false,
};

function simple(fields: Record<string, unknown> = {}) {
  return {
    snapshot: {
      type: 'SIMPLE',
      card_id: CARD,
      is_paused: false,
      time_left_ms: 25 * MINUTE,
      busy_bar_settings: SETTINGS,
      ...fields,
    },
    snapshot_timestamp_ms: NOW,
  };
}

/** A 3-cycle timer of 20 working and 5 resting minutes. */
function interval(fields: Record<string, unknown> = {}, autostart = true) {
  return {
    snapshot: {
      type: 'INTERVAL',
      card_id: CARD,
      is_paused: false,
      current_interval: 0,
      current_interval_time_total_ms: 20 * MINUTE,
      current_interval_time_left_ms: 20 * MINUTE,
      interval_settings: {
        type: 'INTERVAL',
        interval_work_ms: 20 * MINUTE,
        interval_rest_ms: 5 * MINUTE,
        interval_work_cycles_count: 3,
        is_autostart_enabled: autostart,
      },
      busy_bar_settings: SETTINGS,
      ...fields,
    },
    snapshot_timestamp_ms: NOW,
  };
}

function parsed(body: unknown): BusySnapshot {
  const snapshot = parseBusySnapshot(body, NOW);
  if (snapshot === undefined) {
    throw new Error('The snapshot did not parse.');
  }
  return snapshot;
}

describe('parseBusySnapshot', () => {
  it('reads every kind of timer', () => {
    const infinite = {
      snapshot: {
        type: 'INFINITE',
        card_id: CARD.toUpperCase(),
        is_paused: true,
        busy_bar_settings: SETTINGS,
      },
      snapshot_timestamp_ms: NOW,
    };
    const notStarted = {
      snapshot: { type: 'NOT_STARTED', busy_bar_settings: SETTINGS },
      snapshot_timestamp_ms: NOW,
    };

    for (const body of [notStarted, infinite, simple(), interval()]) {
      expect(parseBusySnapshot(body, NOW)).toStrictEqual(body);
    }
  });

  it('writes the fields in the order the firmware does', () => {
    const body: unknown = JSON.parse(
      '{"snapshot_timestamp_ms":1,"snapshot":{"busy_bar_settings":{"trigger_smart_home":true,"show_work_phase_only":false,"theme":"busy"},"time_left_ms":5,"is_paused":false,"card_id":"' +
        CARD +
        '","type":"SIMPLE"}}',
    );

    expect(JSON.stringify(parsed(body))).toBe(
      `{"snapshot":{"type":"SIMPLE","card_id":"${CARD}","is_paused":false,"time_left_ms":5,"busy_bar_settings":{"theme":"busy","show_work_phase_only":false,"trigger_smart_home":true}},"snapshot_timestamp_ms":1}`,
    );
  });

  it('drops the fractions of times and keeps only the fields it knows', () => {
    expect(
      parsed({
        ...simple({ time_left_ms: 1500.9, extra: true }),
        snapshot_timestamp_ms: NOW + 0.5,
      }),
    ).toStrictEqual({
      ...simple({ time_left_ms: 1500 }),
      snapshot_timestamp_ms: NOW,
    });
  });

  it('falls back to the default settings, as the bar does', () => {
    for (const busy_bar_settings of [
      undefined,
      'busy',
      { theme: 'busy', show_work_phase_only: 'no', trigger_smart_home: true },
    ]) {
      expect(
        parsed(simple({ busy_bar_settings })).snapshot.busy_bar_settings,
      ).toStrictEqual(DEFAULT_SETTINGS);
    }
  });

  it('cuts a theme to the 64 characters the bar keeps', () => {
    const theme = 'x'.repeat(70);

    expect(
      parsed(simple({ busy_bar_settings: { ...SETTINGS, theme } })).snapshot
        .busy_bar_settings.theme,
    ).toBe('x'.repeat(64));
  });

  it('takes a snapshot up to a minute ahead of the bar clock', () => {
    expect(
      parseBusySnapshot(
        { ...simple(), snapshot_timestamp_ms: NOW + MINUTE },
        NOW,
      ),
    ).toBeDefined();
    expect(
      parseBusySnapshot(
        { ...simple(), snapshot_timestamp_ms: NOW + MINUTE + 1 },
        NOW,
      ),
    ).toBeUndefined();
  });

  it.each([
    ['no object', 'snapshot'],
    ['no snapshot', {}],
    ['a snapshot that is no object', { snapshot: 'SIMPLE' }],
    ['no timestamp', { snapshot: simple().snapshot }],
    [
      'a timestamp that is no number',
      { ...simple(), snapshot_timestamp_ms: '1' },
    ],
    ['an unknown type', simple({ type: 'FOREVER' })],
    ['no card', simple({ card_id: undefined })],
    ['a card that is no UUID', simple({ card_id: CARD.replaceAll('-', '_') })],
    ['a short card', simple({ card_id: CARD.slice(1) })],
    ['no pause flag', simple({ is_paused: 'false' })],
    [
      'an infinite timer without a card',
      { ...simple({ type: 'INFINITE', card_id: 1 }) },
    ],
    ['no time left', simple({ time_left_ms: undefined })],
    ['negative time left', simple({ time_left_ms: -1 })],
    ['more than a day left', simple({ time_left_ms: 24 * 60 * MINUTE + 1 })],
    [
      'an endless time left',
      simple({ time_left_ms: Number.POSITIVE_INFINITY }),
    ],
  ])('refuses %s', (_case, body) => {
    expect(parseBusySnapshot(body, NOW)).toBeUndefined();
  });

  it.each([
    ['no interval settings', interval({ interval_settings: undefined })],
    ['no interval index', interval({ current_interval: undefined })],
    [
      'no interval total',
      interval({ current_interval_time_total_ms: undefined }),
    ],
    [
      'no interval time left',
      interval({ current_interval_time_left_ms: undefined }),
    ],
    ['a card that is no UUID', interval({ card_id: 'card' })],
    ['an index past the most cycles', interval({ current_interval: 69 })],
    [
      'more time left than the interval holds',
      interval({ current_interval_time_left_ms: 20 * MINUTE + 1 }),
    ],
    [
      'a rest longer than the longest rest',
      interval({
        current_interval: 1,
        current_interval_time_total_ms: 9 * 60 * MINUTE,
        current_interval_time_left_ms: 8 * 60 * MINUTE + 1,
      }),
    ],
  ])('refuses an interval timer with %s', (_case, body) => {
    expect(parseBusySnapshot(body, NOW)).toBeUndefined();
  });

  it.each([
    ['one cycle', { interval_work_cycles_count: 1 }],
    ['36 cycles', { interval_work_cycles_count: 36 }],
    ['4 minutes of work', { interval_work_ms: 4 * MINUTE }],
    ['8 hours and 1 ms of rest', { interval_rest_ms: 8 * 60 * MINUTE + 1 }],
    ['no autostart flag', { is_autostart_enabled: 1 }],
    ['no work time', { interval_work_ms: null }],
  ])('refuses interval settings with %s', (_case, fields) => {
    const body = interval();
    const settings = { ...body.snapshot.interval_settings, ...fields };

    expect(
      parseBusySnapshot(interval({ interval_settings: settings }), NOW),
    ).toBeUndefined();
    expect(
      parseBusySnapshot(interval({ interval_settings: [settings] }), NOW),
    ).toBeUndefined();
  });
});

describe('screenHold', () => {
  const until = (at: number) => ({ kind: 'until', at });
  const free = { kind: 'free' };
  const held = { kind: 'held' };
  const stamped = (body: { readonly snapshot: object }, at: number) =>
    parsed({ ...body, snapshot_timestamp_ms: at });
  const notStarted = {
    snapshot: { type: 'NOT_STARTED', busy_bar_settings: SETTINGS },
  };
  const infinite = (paused: boolean) => ({
    snapshot: {
      type: 'INFINITE',
      card_id: CARD,
      is_paused: paused,
      busy_bar_settings: SETTINGS,
    },
  });

  // Stamped two minutes ago, now, and 30 s ahead of the bar's clock. A
  // timer stamped ahead counts from now, as busy_timer_update does.
  const PAST = NOW - 2 * MINUTE;
  const AHEAD = NOW + 30_000;
  it.each([
    ['NOT_STARTED', notStarted, [free, free, free]],
    ['INFINITE', infinite(false), [held, held, held]],
    ['paused INFINITE', infinite(true), [held, held, held]],
    [
      'SIMPLE',
      simple(),
      [
        until(PAST + 25 * MINUTE),
        until(NOW + 25 * MINUTE),
        until(NOW + 25 * MINUTE),
      ],
    ],
    ['paused SIMPLE', simple({ is_paused: true }), [held, held, held]],
    [
      'INTERVAL with autostart',
      interval(),
      [
        until(PAST + 70 * MINUTE),
        until(NOW + 70 * MINUTE),
        until(NOW + 70 * MINUTE),
      ],
    ],
    [
      'paused INTERVAL with autostart',
      interval({ is_paused: true }),
      [held, held, held],
    ],
    ['INTERVAL without autostart', interval({}, false), [held, held, held]],
    [
      'paused INTERVAL without autostart',
      interval({ is_paused: true }, false),
      [held, held, held],
    ],
  ])('holds the screen for a %s timer', (_name, body, expected) => {
    expect(
      [PAST, NOW, AHEAD].map((at) => screenHold(stamped(body, at), NOW)),
    ).toStrictEqual(expected);
  });

  it('never holds the screen for a stopped timer stamped ahead', () => {
    expect(
      screenHold(stoppedTimer(NOW + 30_000, DEFAULT_SETTINGS), NOW),
    ).toStrictEqual(free);
  });

  it('holds the screen for the infinite timer the switch starts', () => {
    expect(screenHold(startedTimer(NOW, DEFAULT_SETTINGS), NOW)).toStrictEqual(
      held,
    );
  });

  it('frees the screen once a timer has run out', () => {
    expect(screenHold(parsed(simple()), NOW + 25 * MINUTE)).toStrictEqual(free);
    expect(screenHold(parsed(interval()), NOW + 70 * MINUTE)).toStrictEqual(
      free,
    );
  });

  it('holds an interval timer until its last work interval ends', () => {
    // 5 + 20 minutes after the third interval's last 2.
    expect(
      screenHold(
        parsed(
          interval({
            current_interval: 3,
            current_interval_time_total_ms: 5 * MINUTE,
            current_interval_time_left_ms: 2 * MINUTE,
          }),
        ),
        NOW,
      ),
    ).toStrictEqual(until(NOW + 22 * MINUTE));
  });

  it('holds the last interval without autostart until it ends', () => {
    expect(
      screenHold(
        parsed(
          interval(
            { current_interval: 4, current_interval_time_left_ms: MINUTE },
            false,
          ),
        ),
        NOW,
      ),
    ).toStrictEqual(until(NOW + MINUTE));
  });

  it('keeps holding an interval that waits for START after running out', () => {
    expect(
      screenHold(parsed(interval({}, false)), NOW + 3 * 60 * MINUTE),
    ).toStrictEqual(held);
  });
});
