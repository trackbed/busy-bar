import type { RainHour } from './dmi.ts';
import type { PriceSlot } from './energi.ts';

export type PriceLevel = 'low' | 'mid' | 'high';

/** The average spot price of one clock hour. */
interface HourPrice {
  readonly start: Date;
  readonly kronerPerKwh: number;
  readonly level: PriceLevel;
}

/** One hour-long window of consecutive slots and its average price. */
export interface PriceWindow {
  readonly start: Date;
  readonly kronerPerKwh: number;
}

/** What the prices say about the hours ahead. */
export interface PriceOutlook {
  readonly current: PriceSlot;
  readonly level: PriceLevel;
  /** Hourly averages from the current hour on. */
  readonly hours: readonly HourPrice[];
  /** The cheapest and dearest hour-long windows starting in the next 24 hours. */
  readonly cheapest: PriceWindow | undefined;
  readonly dearest: PriceWindow | undefined;
}

const SLOT_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_SEARCH_MS = DAY_MS;
/** Price ranges narrower than three of this many kroner count as flat. */
const FLAT_KRONER = 0.01;
const SLOTS_PER_HOUR = HOUR_MS / SLOT_MS;

/** Rain heavier than this in an hour counts as rain. */
export const RAIN_THRESHOLD_MM = 0.2;

/**
 * Judge the prices at `now`. Levels split the range of the next 24 hours'
 * prices into thirds: the cheapest third is low and the dearest is high. Returns
 * undefined when no slot covers `now`.
 */
export function priceOutlook(
  slots: readonly PriceSlot[],
  now: Date,
  hourCount: number,
): PriceOutlook | undefined {
  const time = now.getTime();
  const current = slots.find(
    (slot) =>
      slot.start.getTime() <= time && time < slot.start.getTime() + SLOT_MS,
  );
  if (current === undefined) {
    return undefined;
  }
  const ahead = slots.filter(
    (slot) =>
      slot.start.getTime() >= current.start.getTime() &&
      slot.start.getTime() < current.start.getTime() + DAY_MS,
  );
  const levelOf = thirds(ahead.map((slot) => slot.kronerPerKwh));

  const firstHour = Math.floor(time / HOUR_MS) * HOUR_MS;
  const hours: HourPrice[] = [];
  for (let index = 0; index < hourCount; index += 1) {
    const start = firstHour + index * HOUR_MS;
    const inHour = slots.filter(
      (slot) =>
        slot.start.getTime() >= start && slot.start.getTime() < start + HOUR_MS,
    );
    if (inHour.length === 0) {
      break;
    }
    const average = mean(inHour.map((slot) => slot.kronerPerKwh));
    hours.push({
      start: new Date(start),
      kronerPerKwh: average,
      level: levelOf(average),
    });
  }

  const windows = hourWindows(
    slots.filter(
      (slot) =>
        slot.start.getTime() >= current.start.getTime() &&
        slot.start.getTime() < time + WINDOW_SEARCH_MS,
    ),
  );
  const byPrice = windows.toSorted((a, b) => a.kronerPerKwh - b.kronerPerKwh);
  return {
    current,
    level: levelOf(current.kronerPerKwh),
    hours,
    cheapest: byPrice[0],
    dearest: byPrice.at(-1),
  };
}

/** The rain in each of the next `count` hours, starting with the current one. */
export function rainAhead(
  forecast: readonly RainHour[],
  now: Date,
  count: number,
): number[] | undefined {
  const time = now.getTime();
  const index = forecast.findIndex(
    (hour) =>
      hour.start.getTime() <= time && time < hour.start.getTime() + HOUR_MS,
  );
  if (index === -1) {
    return undefined;
  }
  return forecast.slice(index, index + count).map((hour) => hour.millimetres);
}

/** Hour-long windows of four consecutive slots, by their average price. */
function hourWindows(slots: readonly PriceSlot[]): PriceWindow[] {
  const windows: PriceWindow[] = [];
  for (let index = 0; index + SLOTS_PER_HOUR <= slots.length; index += 1) {
    const run = slots.slice(index, index + SLOTS_PER_HOUR);
    const [first] = run;
    const last = run.at(-1);
    if (
      first === undefined ||
      last === undefined ||
      last.start.getTime() - first.start.getTime() !== HOUR_MS - SLOT_MS
    ) {
      continue;
    }
    windows.push({
      start: first.start,
      kronerPerKwh: mean(run.map((slot) => slot.kronerPerKwh)),
    });
  }
  return windows;
}

/**
 * A function that places a price in the low, middle, or high third of the
 * range between the cheapest and dearest price. A flat day is all middle.
 */
function thirds(prices: readonly number[]): (price: number) => PriceLevel {
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const third = (high - low) / 3;
  return (price) => {
    if (third < FLAT_KRONER) {
      return 'mid';
    }
    if (price <= low + third) {
      return 'low';
    }
    return price >= high - third ? 'high' : 'mid';
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
