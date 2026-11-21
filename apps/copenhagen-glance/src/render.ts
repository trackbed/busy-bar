import type { BarElements, Snapshot } from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  fitText,
  FOOTER_Y,
  FRONT_DISPLAY,
  PALETTE,
  solidRectangle,
  textElement,
} from '@busy-bar-apps/bar-kit';

import type { RainHour } from './dmi.ts';
import type { Co2Reading, PriceArea, PriceSlot } from './energi.ts';
import type { PriceLevel, PriceOutlook, PriceWindow } from './outlook.ts';
import { priceOutlook, RAIN_THRESHOLD_MM, rainAhead } from './outlook.ts';

export const LEVEL_COLORS: Readonly<Record<PriceLevel, string>> = {
  low: PALETTE.good,
  mid: PALETTE.warn,
  high: PALETTE.bad,
};
export const RAIN_COLOR = PALETTE.info;

const CO2_GOOD = 100;
const CO2_FAIR = 200;
/** A CO2 reading older than this is not shown. */
export const CO2_MAX_AGE_MS = 30 * 60_000;

// Front: the price and the CO2 or rain on the top line, then one bar per
// hour for the next 18 hours, rising from the bottom row.
const BAR_PITCH = 4;
export const BAR_HOURS = FRONT_DISPLAY.width / BAR_PITCH;
const BAR_MAX_HEIGHT = 7;

const ROW_PITCH = 11;
const RAIN_HOURS = 3;
const TIME_ZONE = 'Europe/Copenhagen';

export interface GlanceData {
  readonly area: PriceArea;
  readonly prices: Snapshot<readonly PriceSlot[]> | undefined;
  readonly co2: Snapshot<Co2Reading> | undefined;
  /** Undefined while rain is off or before DMI first answers. */
  readonly rain: Snapshot<readonly RainHour[]> | undefined;
  readonly rainEnabled: boolean;
}

/**
 * The spot price now and over the next 18 hours in front, with the grid's
 * CO2, or rain when it is coming. The details are listed behind.
 */
export function render(now: Date, data: GlanceData): BarElements {
  const glance = glanceAt(data, now);
  return [...front(glance), ...back(glance, data, now)];
}

/** What the glance shows at a moment: the readings still worth drawing. */
export interface Glance {
  /** Undefined until Energi Data Service publishes prices for now. */
  readonly outlook: PriceOutlook | undefined;
  /** Undefined without a reading, or with one too old to show. */
  readonly co2: Co2Reading | undefined;
  /** Millimetres per hour for the next hours; undefined without a forecast. */
  readonly rain: readonly number[] | undefined;
  /** Whether the coming hour brings enough rain to say so in front. */
  readonly raining: boolean;
}

/** Pick out of `data` what the glance shows at `now`. */
export function glanceAt(data: GlanceData, now: Date): Glance {
  const outlook =
    data.prices === undefined
      ? undefined
      : priceOutlook(data.prices.value, now, BAR_HOURS);
  const co2 =
    data.co2 !== undefined &&
    now.getTime() - data.co2.value.at.getTime() <= CO2_MAX_AGE_MS
      ? data.co2.value
      : undefined;
  const rain =
    data.rain === undefined
      ? undefined
      : rainAhead(data.rain.value, now, RAIN_HOURS);
  const raining = rain !== undefined && (rain[0] ?? 0) >= RAIN_THRESHOLD_MM;
  return { outlook, co2, rain, raining };
}

function front({ outlook, co2, raining }: Glance): BarElements {
  const elements: BarElements = [
    outlook === undefined
      ? textElement({
          id: 'price',
          text: 'NO PRICE',
          display: 'front',
          font: 'small',
          x: 0,
          y: 0,
          color: PALETTE.idle,
        })
      : textElement({
          id: 'price',
          text: `${kroner(outlook.current.kronerPerKwh)} kr`,
          display: 'front',
          font: 'small',
          x: 0,
          y: 0,
          color: LEVEL_COLORS[outlook.level],
        }),
  ];
  if (raining) {
    elements.push(
      textElement({
        id: 'side',
        text: 'RAIN',
        display: 'front',
        font: 'small',
        x: FRONT_DISPLAY.width - 1,
        y: 0,
        color: RAIN_COLOR,
        align: 'top_right',
      }),
    );
  } else if (co2 !== undefined) {
    elements.push(
      textElement({
        id: 'side',
        text: `${Math.round(co2.gramsPerKwh)}g`,
        display: 'front',
        font: 'small',
        x: FRONT_DISPLAY.width - 1,
        y: 0,
        color: co2Color(co2.gramsPerKwh),
        align: 'top_right',
      }),
    );
  }
  if (outlook !== undefined) {
    elements.push(...priceBars(outlook));
  }
  return elements;
}

/** One bar per hour, as tall as its price within the outlook's range. */
function priceBars(outlook: PriceOutlook): BarElements {
  const prices = outlook.hours.map((hour) => hour.kronerPerKwh);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return outlook.hours.map((hour, index) => {
    const share = high > low ? (hour.kronerPerKwh - low) / (high - low) : 0.5;
    const height = 1 + Math.round(share * (BAR_MAX_HEIGHT - 1));
    return solidRectangle({
      id: `bar-${index}`,
      display: 'front',
      x: index * BAR_PITCH,
      y: FRONT_DISPLAY.height - height,
      width: BAR_PITCH - 1,
      height,
      color: LEVEL_COLORS[hour.level],
    });
  });
}

function back(
  { outlook, co2, rain }: Glance,
  data: GlanceData,
  now: Date,
): BarElements {
  const lines = [
    outlook === undefined
      ? `Spot price ${data.area}: not published yet`
      : `Spot price ${data.area}: ${kroner(outlook.current.kronerPerKwh)} kr/kWh`,
    windowLine('Cheapest hour', outlook?.cheapest, now),
    windowLine('Dearest hour', outlook?.dearest, now),
    co2 === undefined
      ? 'CO2: no reading'
      : `CO2: ${Math.round(co2.gramsPerKwh)} g/kWh`,
    rainLine(data.rainEnabled, rain),
  ];
  return [
    ...lines.map((line, index) =>
      textElement({
        id: `line-${index}`,
        text: fitText(line, 'small', BACK_DISPLAY.width),
        display: 'back',
        font: 'small',
        x: 0,
        y: index * ROW_PITCH,
      }),
    ),
    textElement({
      id: 'footer',
      text: 'Spot price before tariffs, tax, VAT',
      display: 'back',
      font: 'tiny',
      x: 0,
      y: FOOTER_Y,
      color: PALETTE.dim,
    }),
  ];
}

/** Kroner with a Danish decimal comma: `1,11`. */
export function kroner(amount: number): string {
  return amount.toFixed(2).replace('.', ',');
}

function windowLine(
  label: string,
  window: PriceWindow | undefined,
  now: Date,
): string {
  if (window === undefined) {
    return `${label}: unknown`;
  }
  const when =
    window.start.getTime() <= now.getTime() ? 'now' : clock(window.start);
  return `${label}: ${when}, ${kroner(window.kronerPerKwh)} kr`;
}

function rainLine(
  enabled: boolean,
  rain: readonly number[] | undefined,
): string {
  if (!enabled) {
    return 'Rain: off';
  }
  if (rain === undefined) {
    return 'Rain: no forecast';
  }
  if (rain.every((millimetres) => millimetres < RAIN_THRESHOLD_MM)) {
    return `No rain in the next ${rain.length} h`;
  }
  return `Rain: ${rain.map((millimetres) => millimetres.toFixed(1)).join(', ')} mm/h`;
}

function co2Color(gramsPerKwh: number): string {
  if (gramsPerKwh < CO2_GOOD) {
    return LEVEL_COLORS.low;
  }
  return gramsPerKwh < CO2_FAIR ? LEVEL_COLORS.mid : LEVEL_COLORS.high;
}

function clock(time: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: TIME_ZONE,
  }).format(time);
}
