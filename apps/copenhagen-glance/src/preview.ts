import type { BarElements, Preview } from '@busy-bar-apps/bar-kit';
import { printPreview } from '@busy-bar-apps/bar-kit';

import type { RainHour } from './dmi.ts';
import type { PriceSlot } from './energi.ts';
import { render } from './render.ts';

const QUARTER = 15 * 60_000;
const HOUR = 60 * 60_000;
// Midnight on 21 October 2026 in Copenhagen (CEST).
const MIDNIGHT = Date.parse('2026-10-20T22:00:00Z');

// A typical autumn day in DK2, in kroner per kWh for each local hour: cheap
// and windy at night, a morning ramp, and an evening peak.
const HOURLY = [
  0.62, 0.55, 0.48, 0.45, 0.47, 0.58, 0.92, 1.45, 1.38, 1.05, 0.86, 0.74, 0.69,
  0.66, 0.72, 0.88, 1.24, 1.86, 2.31, 2.05, 1.52, 1.12, 0.89, 0.74,
];

/** Two days of that pattern in 15-minute slots. */
const SLOTS: readonly PriceSlot[] = Array.from(
  { length: 2 * 24 * 4 },
  (_, index) => ({
    start: new Date(MIDNIGHT + index * QUARTER),
    kronerPerKwh: HOURLY[Math.floor(index / 4) % 24] ?? 0,
  }),
);

/** Rain for each hour from `start` on, in millimetres. */
function rain(start: string, ...millimetres: number[]): RainHour[] {
  const first = Date.parse(start);
  return millimetres.map((value, index) => ({
    start: new Date(first + index * HOUR),
    millimetres: value,
  }));
}

function frame(
  now: string,
  gramsPerKwh: number,
  forecast: RainHour[],
): BarElements {
  const at = new Date(now);
  const read = new Date(at.getTime() - 3 * 60_000);
  return render(at, {
    area: 'DK2',
    prices: { value: SLOTS, at: read },
    co2: { value: { at: read, gramsPerKwh }, at: read },
    rain: { value: forecast, at: read },
    rainEnabled: true,
  });
}

/** Sample frames for the app catalogue: `nx run copenhagen-glance:preview`. */
export function preview(): Preview {
  return {
    summary:
      "The Danish spot power price, the grid's CO2, and the coming rain, for picking a cheap hour or a dry one.",
    steps: [
      {
        label: 'Reads',
        text: "Spot prices every 15 minutes and the grid's CO2 every 5 from Energi Data Service for GLANCE_PRICE_AREA (DK2 by default), and DMI's rain forecast every 15, with no keys needed.",
      },
      {
        label: 'Decides',
        text: "Splits the next 24 hours' price range into thirds to colour the price green, amber, or red, and finds the cheapest and dearest hour-long windows.",
      },
      {
        label: 'Draws',
        text: 'The price in kr/kWh beside the CO2 in g/kWh, or RAIN when 0.2 mm or more is due this hour, over 18 bars for the hours ahead.',
      },
    ],
    scenes: [
      {
        title: 'Cheap windy night',
        caption:
          "At 03:05 power is at the day's lowest and wind keeps CO2 down, so both show green; the bars ahead rise for the morning and evening peaks.",
        elements: frame(
          '2026-10-21T01:05:00Z',
          48,
          rain('2026-10-21T01:00:00Z', 0, 0, 0),
        ),
      },
      {
        title: 'Morning ramp',
        caption:
          'At 07:05 the price sits in the middle third and CO2 is high, while the back warns of rain later in the morning.',
        elements: frame(
          '2026-10-21T05:05:00Z',
          212,
          rain('2026-10-21T05:00:00Z', 0, 0.3, 0.6),
        ),
      },
      {
        title: 'Peak with rain',
        caption:
          "At 18:05 the price is the day's dearest and rain is falling, so RAIN replaces the CO2; the short bars ahead are the cheap night hours.",
        elements: frame(
          '2026-10-21T16:05:00Z',
          164,
          rain('2026-10-21T16:00:00Z', 1.4, 0.8, 0.1),
        ),
      },
    ],
  };
}

if (import.meta.main) {
  printPreview(preview());
}
