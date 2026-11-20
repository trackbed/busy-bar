import { describe, expect, it } from 'vitest';

import type { BarElements } from '@busy-bar-apps/bar-kit';
import {
  BACK_DISPLAY,
  FRONT_DISPLAY,
  overflowingText,
} from '@busy-bar-apps/bar-kit';

import type { RainHour } from './dmi.ts';
import type { Co2Reading, PriceSlot } from './energi.ts';
import type { GlanceData } from './render.ts';
import {
  BAR_HOURS,
  CO2_MAX_AGE_MS,
  kroner,
  LEVEL_COLORS,
  RAIN_COLOR,
  render,
} from './render.ts';

// 12:05 in Copenhagen.
const NOW = new Date('2026-10-20T10:05:00Z');
const START = Date.parse('2026-10-20T10:00:00Z');
const QUARTER = 15 * 60_000;
const HOUR = 60 * 60_000;

/** A day of slots: cheap at night (00:00-06:00 UTC next day), dear at 16:00. */
function day(): PriceSlot[] {
  return Array.from({ length: 24 * 4 }, (_, index) => {
    const hour = Math.floor(index / 4);
    let kronerPerKwh = 1.1;
    if (hour === 6) {
      kronerPerKwh = 2.4;
    } else if (hour >= 14 && hour < 20) {
      kronerPerKwh = 0.4;
    }
    return { start: new Date(START + index * QUARTER), kronerPerKwh };
  });
}

function data(overrides: Partial<GlanceData> = {}): GlanceData {
  const co2: Co2Reading = {
    at: new Date(NOW.getTime() - 5 * 60_000),
    gramsPerKwh: 83,
  };
  return {
    area: 'DK2',
    prices: { value: day(), at: NOW },
    co2: { value: co2, at: NOW },
    rain: undefined,
    rainEnabled: true,
    ...overrides,
  };
}

function rain(...millimetres: number[]): GlanceData['rain'] {
  const hours: RainHour[] = millimetres.map((value, index) => ({
    start: new Date(START + index * HOUR),
    millimetres: value,
  }));
  return { value: hours, at: NOW };
}

function byId(elements: BarElements): Map<string, BarElements[number]> {
  return new Map(elements.map((element) => [element.id, element]));
}

function textOf(
  elements: Map<string, BarElements[number]>,
  id: string,
): string | undefined {
  const element = elements.get(id);
  return element !== undefined && 'text' in element ? element.text : undefined;
}

function colorOf(
  elements: Map<string, BarElements[number]>,
  id: string,
): string | undefined {
  const element = elements.get(id);
  return element !== undefined && 'color' in element
    ? element.color
    : undefined;
}

describe('render', () => {
  it('shows the price now beside the grid’s CO2', () => {
    const elements = byId(render(NOW, data()));

    expect(textOf(elements, 'price')).toBe('1,10 kr');
    expect(colorOf(elements, 'price')).toBe(LEVEL_COLORS.mid);
    expect(textOf(elements, 'side')).toBe('83g');
    expect(colorOf(elements, 'side')).toBe(LEVEL_COLORS.low);
  });

  it('draws a bar per hour, tallest where the price is highest', () => {
    const bars = render(NOW, data()).filter(
      (element) => element.type === 'rectangle',
    );

    expect(bars).toHaveLength(BAR_HOURS);
    const heights = bars.map((bar) => ('height' in bar ? bar.height : 0));
    expect(Math.max(...heights)).toBe(heights[6]);
    expect(heights[6]).toBe(7);
    expect(heights[14]).toBe(1);
    expect(bars[6]).toMatchObject({
      y: FRONT_DISPLAY.height - 7,
      fill_colors: [LEVEL_COLORS.high],
    });
  });

  it('draws even bars when every hour costs the same', () => {
    const flat = Array.from({ length: 8 }, (_, index) => ({
      start: new Date(START + index * QUARTER),
      kronerPerKwh: 1,
    }));

    const bars = render(NOW, data({ prices: { value: flat, at: NOW } })).filter(
      (element) => element.type === 'rectangle',
    );

    expect(bars.map((bar) => ('height' in bar ? bar.height : 0))).toStrictEqual(
      [4, 4],
    );
  });

  it('lists the details behind', () => {
    const elements = byId(render(NOW, data({ rain: rain(0, 0.1, 0) })));

    expect(
      [0, 1, 2, 3, 4].map((index) => textOf(elements, `line-${index}`)),
    ).toStrictEqual([
      'Spot price DK2: 1,10 kr/kWh',
      'Cheapest hour: 02:00, 0,40 kr',
      'Dearest hour: 18:00, 2,40 kr',
      'CO2: 83 g/kWh',
      'No rain in the next 3 h',
    ]);
    expect(textOf(elements, 'footer')).toBe(
      'Spot price before tariffs, tax, VAT',
    );
  });

  it('says now when the cheapest hour has already started', () => {
    const cheapNow = day().map((slot, index) => ({
      ...slot,
      kronerPerKwh: index < 4 ? 0.1 : slot.kronerPerKwh,
    }));

    const elements = byId(
      render(NOW, data({ prices: { value: cheapNow, at: NOW } })),
    );

    expect(textOf(elements, 'line-1')).toBe('Cheapest hour: now, 0,10 kr');
  });

  it('warns of rain in the coming hour instead of showing CO2', () => {
    const elements = byId(render(NOW, data({ rain: rain(0.6, 1.25, 0) })));

    expect(textOf(elements, 'side')).toBe('RAIN');
    expect(colorOf(elements, 'side')).toBe(RAIN_COLOR);
    expect(textOf(elements, 'line-4')).toBe('Rain: 0.6, 1.3, 0.0 mm/h');
  });

  it.each([
    [150, LEVEL_COLORS.mid],
    [250, LEVEL_COLORS.high],
  ])('colours %d g/kWh of CO2', (gramsPerKwh, color) => {
    const co2: Co2Reading = { at: NOW, gramsPerKwh };

    expect(
      colorOf(
        byId(render(NOW, data({ co2: { value: co2, at: NOW } }))),
        'side',
      ),
    ).toBe(color);
  });

  it('copes without prices, CO2, or rain', () => {
    const old: Co2Reading = {
      at: new Date(NOW.getTime() - CO2_MAX_AGE_MS - 1),
      gramsPerKwh: 50,
    };

    const elements = byId(
      render(
        NOW,
        data({
          prices: undefined,
          co2: { value: old, at: NOW },
          rainEnabled: false,
        }),
      ),
    );

    expect(textOf(elements, 'price')).toBe('NO PRICE');
    expect(elements.has('side')).toBe(false);
    expect(
      [0, 1, 2, 3, 4].map((index) => textOf(elements, `line-${index}`)),
    ).toStrictEqual([
      'Spot price DK2: not published yet',
      'Cheapest hour: unknown',
      'Dearest hour: unknown',
      'CO2: no reading',
      'Rain: off',
    ]);
    expect(textOf(byId(render(NOW, data())), 'line-4')).toBe(
      'Rain: no forecast',
    );
  });

  it('keeps every text inside its display', () => {
    const elements = render(NOW, data({ rain: rain(10.25, 12.5, 30.75) }));

    expect(
      overflowingText(elements).map((element) => element.id),
    ).toStrictEqual([]);
    // Other elements start inside their display too.
    const outside = elements.filter(
      (element) =>
        (element.x ?? 0) >=
        (element.display === 'back' ? BACK_DISPLAY.width : FRONT_DISPLAY.width),
    );
    expect(outside.map((element) => element.id)).toStrictEqual([]);
  });
});

describe('kroner', () => {
  it('writes amounts with a Danish decimal comma', () => {
    expect(kroner(1.1109)).toBe('1,11');
    expect(kroner(0)).toBe('0,00');
  });
});
