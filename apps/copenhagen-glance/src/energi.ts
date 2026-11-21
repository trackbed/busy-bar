import {
  arrayAt,
  isObject,
  numberAt,
  stringAt,
} from '@busy-bar-apps/json-values';

import { getJson } from './http.ts';

/** The two Danish bidding zones: Jutland and Funen (DK1), Zealand (DK2). */
export type PriceArea = 'DK1' | 'DK2';

/** The day-ahead spot price for one 15-minute slot, before tariffs and tax. */
export interface PriceSlot {
  readonly start: Date;
  readonly kronerPerKwh: number;
}

/** How much CO2 the grid emits per kWh right now. */
export interface Co2Reading {
  readonly at: Date;
  readonly gramsPerKwh: number;
}

const DATASETS = 'https://api.energidataservice.dk/dataset';
const MWH_PER_KWH = 1000;

/** The prices from an hour ago to as far ahead as they are published. */
export function pricesUrl(area: PriceArea): string {
  const query = new URLSearchParams({
    start: 'now-PT1H',
    end: 'now+P2D',
    filter: JSON.stringify({ PriceArea: [area] }),
    sort: 'TimeUTC asc',
    limit: '500',
  });
  return `${DATASETS}/DayAheadPrices?${query.toString()}`;
}

/** The latest five-minute emissions reading. */
export function co2Url(area: PriceArea): string {
  const query = new URLSearchParams({
    filter: JSON.stringify({ PriceArea: [area] }),
    sort: 'Minutes5UTC desc',
    limit: '1',
  });
  return `${DATASETS}/CO2Emis?${query.toString()}`;
}

/** Energi Data Service refused the request or sent something unexpected. */
export class EnergiDataError extends Error {
  override readonly name = 'EnergiDataError';
}

export async function fetchPrices(
  area: PriceArea,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<PriceSlot[]> {
  return parsePrices(
    await getJson(pricesUrl(area), request(signal, fetchImpl)),
  );
}

export async function fetchCo2(
  area: PriceArea,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<Co2Reading> {
  return parseCo2(await getJson(co2Url(area), request(signal, fetchImpl)));
}

/** Read `DayAheadPrices` records: `TimeUTC` and `DayAheadPriceDKK` per MWh. */
export function parsePrices(body: unknown): PriceSlot[] {
  return records(body).flatMap((record) => {
    const start = utcTime(stringAt(record, 'TimeUTC'));
    const perMwh = numberAt(record, 'DayAheadPriceDKK');
    return start === undefined || perMwh === undefined
      ? []
      : [{ start, kronerPerKwh: perMwh / MWH_PER_KWH }];
  });
}

/** Read the newest `CO2Emis` record: `Minutes5UTC` and `CO2Emission`. */
export function parseCo2(body: unknown): Co2Reading {
  for (const record of records(body)) {
    const at = utcTime(stringAt(record, 'Minutes5UTC'));
    const gramsPerKwh = numberAt(record, 'CO2Emission');
    if (at !== undefined && gramsPerKwh !== undefined) {
      return { at, gramsPerKwh };
    }
  }
  throw new EnergiDataError('Energi Data Service sent no CO2 reading.');
}

function request(signal: AbortSignal, fetchImpl: typeof fetch) {
  return {
    service: 'Energi Data Service',
    error: EnergiDataError,
    signal,
    fetch: fetchImpl,
  };
}

function records(body: unknown): Readonly<Record<string, unknown>>[] {
  if (!isObject(body)) {
    throw new EnergiDataError(
      'Energi Data Service did not answer with a JSON object.',
    );
  }
  return arrayAt(body, 'records').filter(isObject);
}

/** The datasets write UTC times without a zone: `2026-10-20T11:00:00`. */
function utcTime(value: string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const time = new Date(`${value}Z`);
  return Number.isNaN(time.getTime()) ? undefined : time;
}
