import { arrayAt, isObject, objectAt } from '@busy-bar-apps/json-values';

import { getJson } from './http.ts';

/** Rain expected in one hour of DMI's forecast. */
export interface RainHour {
  readonly start: Date;
  readonly millimetres: number;
}

const FORECAST =
  'https://opendataapi.dmi.dk/v1/forecastedr/collections/harmonie_dini_sf/position';
const PARAMETER = 'total-precipitation';

/** DMI's HARMONIE forecast for one point, as CoverageJSON. */
export function rainUrl(latitude: number, longitude: number): string {
  const query = new URLSearchParams({
    coords: `POINT(${longitude} ${latitude})`,
    'parameter-name': PARAMETER,
    crs: 'crs84',
    f: 'CoverageJSON',
  });
  return `${FORECAST}?${query.toString()}`;
}

/** DMI refused the request or sent something unexpected. */
export class DmiError extends Error {
  override readonly name = 'DmiError';
}

export async function fetchRain(
  latitude: number,
  longitude: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<RainHour[]> {
  return parseRain(
    await getJson(rainUrl(latitude, longitude), {
      service: 'DMI',
      error: DmiError,
      signal,
      fetch: fetchImpl,
    }),
  );
}

/**
 * Turn the forecast's running total since the model run started into the
 * rain of each hour: the difference between one step and the next.
 */
export function parseRain(body: unknown): RainHour[] {
  if (!isObject(body)) {
    throw new DmiError('DMI did not answer with a JSON object.');
  }
  const times = arrayAt(
    objectAt(objectAt(objectAt(body, 'domain'), 'axes'), 't'),
    'values',
  );
  const totals = arrayAt(
    objectAt(objectAt(body, 'ranges'), PARAMETER),
    'values',
  );
  const hours: RainHour[] = [];
  for (
    let index = 0;
    index + 1 < Math.min(times.length, totals.length);
    index += 1
  ) {
    const time = times[index];
    const total = totals[index];
    const next = totals[index + 1];
    const start = typeof time === 'string' ? new Date(time) : undefined;
    if (
      start === undefined ||
      Number.isNaN(start.getTime()) ||
      typeof total !== 'number' ||
      typeof next !== 'number'
    ) {
      continue;
    }
    hours.push({ start, millimetres: Math.max(0, next - total) });
  }
  if (hours.length === 0) {
    throw new DmiError('DMI sent no precipitation forecast.');
  }
  return hours;
}
