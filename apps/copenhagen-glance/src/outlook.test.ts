import { describe, expect, it } from 'vitest';

import type { RainHour } from './dmi.ts';
import type { PriceSlot } from './energi.ts';
import { priceOutlook, rainAhead } from './outlook.ts';

const START = Date.parse('2026-10-20T10:00:00Z');
const QUARTER = 15 * 60_000;

/** Consecutive 15-minute slots from 10:00 UTC with the given prices. */
function slots(...prices: number[]): PriceSlot[] {
  return prices.map((kronerPerKwh, index) => ({
    start: new Date(START + index * QUARTER),
    kronerPerKwh,
  }));
}

describe('priceOutlook', () => {
  it('finds the current slot and grades it against the day ahead', () => {
    const outlook = priceOutlook(
      slots(1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3),
      new Date(START + 20 * 60_000),
      3,
    );

    expect(outlook?.current).toStrictEqual({
      start: new Date(START + QUARTER),
      kronerPerKwh: 1,
    });
    expect(outlook?.level).toBe('low');
    expect(
      outlook?.hours.map((hour) => [hour.kronerPerKwh, hour.level]),
    ).toStrictEqual([
      [1, 'low'],
      [2, 'mid'],
      [3, 'high'],
    ]);
  });

  it('finds the cheapest and dearest hour-long windows', () => {
    const outlook = priceOutlook(
      slots(5, 5, 1, 1, 1, 1, 5, 9, 9, 9, 9, 5),
      new Date(START),
      4,
    );

    expect(outlook?.cheapest).toStrictEqual({
      start: new Date(START + 2 * QUARTER),
      kronerPerKwh: 1,
    });
    expect(outlook?.dearest).toStrictEqual({
      start: new Date(START + 7 * QUARTER),
      kronerPerKwh: 9,
    });
  });

  it('skips windows that span a gap in the data', () => {
    const gappy = [
      ...slots(1, 1),
      ...slots(9, 9, 9, 9).map((slot) => ({
        ...slot,
        start: new Date(slot.start.getTime() + 4 * QUARTER),
      })),
    ];

    const outlook = priceOutlook(gappy, new Date(START), 2);

    expect(outlook?.cheapest?.kronerPerKwh).toBe(9);
  });

  it('stops the hours where the published prices end', () => {
    expect(
      priceOutlook(slots(1, 2, 3, 4, 5), new Date(START), 18)?.hours,
    ).toHaveLength(2);
  });

  it('has no outlook when no slot covers now', () => {
    expect(
      priceOutlook(slots(1, 2), new Date(START + 60 * 60_000), 3),
    ).toBeUndefined();
    expect(priceOutlook([], new Date(START), 3)).toBeUndefined();
  });
});

describe('rainAhead', () => {
  const forecast: RainHour[] = [0, 0.4, 1.2, 0].map((millimetres, index) => ({
    start: new Date(START + index * 60 * 60_000),
    millimetres,
  }));

  it('reads the rain from the current hour on', () => {
    expect(rainAhead(forecast, new Date(START + 90 * 60_000), 3)).toStrictEqual(
      [0.4, 1.2, 0],
    );
  });

  it('has nothing to say outside the forecast', () => {
    expect(rainAhead(forecast, new Date(START - 1), 3)).toBeUndefined();
  });
});
