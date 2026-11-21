// The BUSY timer's snapshot, as the firmware keeps it
// (services/busy_timer/busy_timer_snapshot.c and busy_timer.c): the state
// the timer recorded at its last change, which GET /api/busy/snapshot
// reports and PUT replaces. The firmware records a snapshot only when the
// timer starts, pauses, resumes, skips, or stops, so a timer that runs out
// keeps reporting the snapshot that started it.

import { isObject } from '@busy-bar-apps/json-values';

export interface BusyBarSettings {
  readonly theme: string;
  readonly show_work_phase_only: boolean;
  readonly trigger_smart_home: boolean;
}

interface IntervalSettings {
  readonly type: 'INTERVAL';
  readonly interval_work_ms: number;
  readonly interval_rest_ms: number;
  readonly interval_work_cycles_count: number;
  readonly is_autostart_enabled: boolean;
}

/** The timer, with its fields in the order the firmware writes them. */
type BusyTimerState = (
  | { readonly type: 'NOT_STARTED' }
  | {
      readonly type: 'INFINITE';
      readonly card_id: string;
      readonly is_paused: boolean;
    }
  | {
      readonly type: 'SIMPLE';
      readonly card_id: string;
      readonly is_paused: boolean;
      readonly time_left_ms: number;
    }
  | {
      readonly type: 'INTERVAL';
      readonly card_id: string;
      readonly is_paused: boolean;
      readonly current_interval: number;
      readonly current_interval_time_total_ms: number;
      readonly current_interval_time_left_ms: number;
      readonly interval_settings: IntervalSettings;
    }
) & { readonly busy_bar_settings: BusyBarSettings };

export interface BusySnapshot {
  readonly snapshot: BusyTimerState;
  readonly snapshot_timestamp_ms: number;
}

/** The app settings a snapshot without valid ones gets (busy_common.h). */
export const DEFAULT_SETTINGS: BusyBarSettings = {
  theme: 'busy',
  show_work_phase_only: false,
  trigger_smart_home: true,
};

/** What a bar that has never run its timer reports. */
export const INITIAL_SNAPSHOT: BusySnapshot = {
  snapshot: { type: 'NOT_STARTED', busy_bar_settings: DEFAULT_SETTINGS },
  snapshot_timestamp_ms: 0,
};

/** The card the page's BUSY switch starts its timer with. */
const SWITCH_CARD = '00000000-0000-0000-0000-000000000000';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const TIME_MAX_MS = 24 * HOUR;
const WORK_MS = { min: 5 * MINUTE, max: 8 * HOUR };
const REST_MS = { min: 5 * MINUTE, max: 8 * HOUR };
const CYCLES = { min: 2, max: 35 };
const THEME_LENGTH = 64;
/** How far ahead of the bar's clock a snapshot may be stamped. */
const TIMESTAMP_TOLERANCE_MS = MINUTE;

/** The snapshot the page's BUSY switch records: an infinite timer. */
export function startedTimer(
  at: number,
  settings: BusyBarSettings,
): BusySnapshot {
  return {
    snapshot: {
      type: 'INFINITE',
      card_id: SWITCH_CARD,
      is_paused: false,
      busy_bar_settings: settings,
    },
    snapshot_timestamp_ms: at,
  };
}

/** The snapshot a stopped timer records. */
export function stoppedTimer(
  at: number,
  settings: BusyBarSettings,
): BusySnapshot {
  return {
    snapshot: { type: 'NOT_STARTED', busy_bar_settings: settings },
    snapshot_timestamp_ms: at,
  };
}

/**
 * Read a PUT body as busy_timer_snapshot_deserialize does, with the same
 * checks as busy_timer_snapshot_is_valid; undefined when the firmware would
 * answer "Failed to parse snapshot". `now` is the bar's clock.
 */
export function parseBusySnapshot(
  body: unknown,
  now: number,
): BusySnapshot | undefined {
  if (!isObject(body) || !isObject(body['snapshot'])) {
    return undefined;
  }
  const timer = parseTimer(body['snapshot']);
  const timestamp = body['snapshot_timestamp_ms'];
  if (
    timer === undefined ||
    typeof timestamp !== 'number' ||
    Math.trunc(timestamp) - now > TIMESTAMP_TOLERANCE_MS
  ) {
    return undefined;
  }
  return { snapshot: timer, snapshot_timestamp_ms: Math.trunc(timestamp) };
}

/**
 * Whether the timer holds the screen: `free` once it is idle, `held` while
 * it has no end of its own, or held `until` the moment it goes idle.
 */
export type ScreenHold =
  | { readonly kind: 'free' }
  | { readonly kind: 'held' }
  | { readonly kind: 'until'; readonly at: number };

const FREE: ScreenHold = { kind: 'free' };
const HELD: ScreenHold = { kind: 'held' };

/**
 * How a timer run from `snapshot` holds the screen at `now`, as
 * busy_timer_apply_snapshot and busy_timer_update step it. The loader holds
 * the screen while the timer works, rests, or is paused; NOT_STARTED is
 * idle at once. A timer stamped ahead of the bar's clock counts from now,
 * as busy_timer_update does for a peer whose clock runs ahead. It never
 * goes idle by itself while paused, without an end, or waiting at a new
 * interval for START.
 */
export function screenHold(snapshot: BusySnapshot, now: number): ScreenHold {
  const timer = snapshot.snapshot;
  const start = Math.min(snapshot.snapshot_timestamp_ms, now);
  switch (timer.type) {
    case 'NOT_STARTED':
      return FREE;
    case 'INFINITE':
      return HELD;
    case 'SIMPLE':
      return timer.is_paused
        ? HELD
        : holdUntil(start + timer.time_left_ms, now);
    case 'INTERVAL': {
      if (timer.is_paused) {
        return HELD;
      }
      const settings = timer.interval_settings;
      const last = settings.interval_work_cycles_count * 2 - 2;
      let end = start + timer.current_interval_time_left_ms;
      if (timer.current_interval < last && !settings.is_autostart_enabled) {
        return HELD;
      }
      for (let index = timer.current_interval + 1; index <= last; index += 1) {
        end +=
          index % 2 === 0
            ? settings.interval_work_ms
            : settings.interval_rest_ms;
      }
      return holdUntil(end, now);
    }
  }
}

function holdUntil(end: number, now: number): ScreenHold {
  return end > now ? { kind: 'until', at: end } : FREE;
}

function parseTimer(json: Record<string, unknown>): BusyTimerState | undefined {
  const settings = parseSettings(json['busy_bar_settings']);
  switch (json['type']) {
    case 'NOT_STARTED':
      return { type: 'NOT_STARTED', busy_bar_settings: settings };
    case 'INFINITE': {
      const common = parseCommon(json);
      if (common === undefined) {
        return undefined;
      }
      return { type: 'INFINITE', ...common, busy_bar_settings: settings };
    }
    case 'SIMPLE': {
      const common = parseCommon(json);
      const left = uint32(json['time_left_ms']);
      if (common === undefined || left === undefined || left > TIME_MAX_MS) {
        return undefined;
      }
      return {
        type: 'SIMPLE',
        ...common,
        time_left_ms: left,
        busy_bar_settings: settings,
      };
    }
    case 'INTERVAL':
      return parseInterval(json, settings);
    default:
      return undefined;
  }
}

function parseInterval(
  json: Record<string, unknown>,
  settings: BusyBarSettings,
): BusyTimerState | undefined {
  const common = parseCommon(json);
  const index = uint32(json['current_interval']);
  const total = uint32(json['current_interval_time_total_ms']);
  const left = uint32(json['current_interval_time_left_ms']);
  const config = parseIntervalSettings(json['interval_settings']);
  if (
    common === undefined ||
    index === undefined ||
    total === undefined ||
    left === undefined ||
    config === undefined ||
    index > CYCLES.max * 2 - 2 ||
    left > total ||
    left > (index % 2 === 1 ? REST_MS.max : WORK_MS.max)
  ) {
    return undefined;
  }
  return {
    type: 'INTERVAL',
    ...common,
    current_interval: index,
    current_interval_time_total_ms: total,
    current_interval_time_left_ms: left,
    interval_settings: config,
    busy_bar_settings: settings,
  };
}

function parseIntervalSettings(json: unknown): IntervalSettings | undefined {
  if (!isObject(json)) {
    return undefined;
  }
  const work = uint32(json['interval_work_ms']);
  const rest = uint32(json['interval_rest_ms']);
  const cycles = uint32(json['interval_work_cycles_count']);
  const autostart = json['is_autostart_enabled'];
  if (
    work === undefined ||
    rest === undefined ||
    cycles === undefined ||
    typeof autostart !== 'boolean' ||
    !within(cycles, CYCLES) ||
    !within(work, WORK_MS) ||
    !within(rest, REST_MS)
  ) {
    return undefined;
  }
  return {
    type: 'INTERVAL',
    interval_work_ms: work,
    interval_rest_ms: rest,
    interval_work_cycles_count: cycles,
    is_autostart_enabled: autostart,
  };
}

/** `card_id` and `is_paused`; the card is a UUID, of either case. */
function parseCommon(
  json: Record<string, unknown>,
): { readonly card_id: string; readonly is_paused: boolean } | undefined {
  const card = json['card_id'];
  const paused = json['is_paused'];
  if (
    typeof card !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu.test(card) ||
    typeof paused !== 'boolean'
  ) {
    return undefined;
  }
  return { card_id: card, is_paused: paused };
}

/** Settings that do not parse fall back to the defaults, as on the bar. */
function parseSettings(json: unknown): BusyBarSettings {
  if (
    !isObject(json) ||
    typeof json['theme'] !== 'string' ||
    typeof json['show_work_phase_only'] !== 'boolean' ||
    typeof json['trigger_smart_home'] !== 'boolean'
  ) {
    return DEFAULT_SETTINGS;
  }
  return {
    theme: json['theme'].slice(0, THEME_LENGTH),
    show_work_phase_only: json['show_work_phase_only'],
    trigger_smart_home: json['trigger_smart_home'],
  };
}

/**
 * A JSON number as an unsigned 32-bit field holds it: the fraction dropped.
 * The firmware's cast leaves negative numbers undefined; the emulator
 * refuses them.
 */
function uint32(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(Math.trunc(value), 0xffff_ffff);
}

function within(
  value: number,
  range: { readonly min: number; readonly max: number },
): boolean {
  return value >= range.min && value <= range.max;
}
