import type {
  BarElements,
  BarFont,
  Snapshot,
  TextElement,
} from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  FRONT_DISPLAY,
  fitText,
  rgba,
} from '@busy-bar-apps/bar-kit';

import type { RainHour } from './dmi.ts';
import type { Co2Reading, PriceArea, PriceSlot } from './energi.ts';
import type { PriceLevel, PriceWindow } from './outlook.ts';
import { priceOutlook, RAIN_THRESHOLD_MM, rainAhead } from './outlook.ts';

export const LEVEL_COLORS: Readonly<Record<PriceLevel, string>> = {
  low: rgba(0, 200, 90),
  mid: rgba(255, 170, 0),
  high: rgba(255, 60, 60),
};
export const RAIN_COLOR = rgba(60, 130, 255);
const IDLE_COLOR = rgba(110, 110, 110);
const TEXT_COLOR = rgba(200, 200, 200);
const DIM_COLOR = rgba(120, 120, 120);

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
const FOOTER_Y = BACK_DISPLAY.height - 7;
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

  const elements: BarElements = [
    outlook === undefined
      ? text('price', 'NO PRICE', 'front', 'small', 0, 0, IDLE_COLOR)
      : text(
          'price',
          `${kroner(outlook.current.kronerPerKwh)} kr`,
          'front',
          'small',
          0,
          0,
          LEVEL_COLORS[outlook.level],
        ),
  ];
  if (raining) {
    elements.push(rightText('side', 'RAIN', RAIN_COLOR));
  } else if (co2 !== undefined) {
    elements.push(
      rightText(
        'side',
        `${Math.round(co2.gramsPerKwh)}g`,
        co2Color(co2.gramsPerKwh),
      ),
    );
  }
  if (outlook !== undefined) {
    const prices = outlook.hours.map((hour) => hour.kronerPerKwh);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    outlook.hours.forEach((hour, index) => {
      const share = high > low ? (hour.kronerPerKwh - low) / (high - low) : 0.5;
      const height = 1 + Math.round(share * (BAR_MAX_HEIGHT - 1));
      elements.push({
        id: `bar-${index}`,
        type: 'rectangle',
        display: 'front',
        x: index * BAR_PITCH,
        y: FRONT_DISPLAY.height - height,
        width: BAR_PITCH - 1,
        height,
        fill: 'solid',
        fill_colors: [LEVEL_COLORS[hour.level]],
        border_width: 0,
      });
    });
  }

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
  elements.push(
    ...lines.map((line, index) =>
      text(
        `line-${index}`,
        fitText(line, 'small', BACK_DISPLAY.width),
        'back',
        'small',
        0,
        index * ROW_PITCH,
      ),
    ),
    text(
      'footer',
      'Spot price before tariffs, tax, VAT',
      'back',
      'tiny',
      0,
      FOOTER_Y,
      DIM_COLOR,
    ),
  );
  return elements;
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

function rightText(id: string, content: string, color: string): TextElement {
  return {
    ...text(id, content, 'front', 'small', FRONT_DISPLAY.width - 1, 0, color),
    align: 'top_right',
  };
}

function text(
  id: string,
  content: string,
  display: 'front' | 'back',
  font: BarFont,
  x: number,
  y: number,
  color: string = TEXT_COLOR,
): TextElement {
  return { id, type: 'text', display, text: content, font, color, x, y };
}
