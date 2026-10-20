import { describe, expect, it, vi } from 'vitest';

import {
  co2Url,
  EnergiDataError,
  fetchCo2,
  fetchPrices,
  parseCo2,
  parsePrices,
  pricesUrl,
} from './energi.ts';

describe('pricesUrl', () => {
  it('asks for the area’s prices from an hour ago onwards', () => {
    const url = new URL(pricesUrl('DK2'));

    expect(url.pathname).toBe('/dataset/DayAheadPrices');
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      start: 'now-PT1H',
      end: 'now+P2D',
      filter: '{"PriceArea":["DK2"]}',
      sort: 'TimeUTC asc',
      limit: '500',
    });
  });
});

describe('co2Url', () => {
  it('asks for the newest reading', () => {
    const url = new URL(co2Url('DK1'));

    expect(url.pathname).toBe('/dataset/CO2Emis');
    expect(url.searchParams.get('filter')).toBe('{"PriceArea":["DK1"]}');
    expect(url.searchParams.get('limit')).toBe('1');
  });
});

describe('parsePrices', () => {
  it('reads each slot in kroner per kWh and skips broken records', () => {
    expect(
      parsePrices({
        records: [
          { TimeUTC: '2026-10-20T11:00:00', DayAheadPriceDKK: 1110.964698 },
          { TimeUTC: '2026-10-20T11:15:00' },
          { TimeUTC: 'soon', DayAheadPriceDKK: 1 },
          'junk',
        ],
      }),
    ).toStrictEqual([
      { start: new Date('2026-10-20T11:00:00Z'), kronerPerKwh: 1.110964698 },
    ]);
  });

  it('rejects an answer that is not an object', () => {
    expect(() => parsePrices([])).toThrow(EnergiDataError);
  });
});

describe('parseCo2', () => {
  it('reads the newest valid reading', () => {
    expect(
      parseCo2({
        records: [
          { Minutes5UTC: '2026-10-20T11:10:00' },
          { Minutes5UTC: '2026-10-20T11:05:00', CO2Emission: 84 },
        ],
      }),
    ).toStrictEqual({ at: new Date('2026-10-20T11:05:00Z'), gramsPerKwh: 84 });
  });

  it('rejects an answer without a reading', () => {
    expect(() => parseCo2({ records: [] })).toThrow('sent no CO2 reading');
  });
});

describe('fetching', () => {
  it('fetches and parses prices and CO2', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>((input) =>
      Promise.resolve(
        Response.json({
          records: (typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          ).includes('CO2Emis')
            ? [{ Minutes5UTC: '2026-10-20T11:05:00', CO2Emission: 84 }]
            : [{ TimeUTC: '2026-10-20T11:00:00', DayAheadPriceDKK: 500 }],
        }),
      ),
    );
    const signal = new AbortController().signal;

    await expect(fetchPrices('DK2', signal, fetch)).resolves.toHaveLength(1);
    await expect(fetchCo2('DK2', signal, fetch)).resolves.toMatchObject({
      gramsPerKwh: 84,
    });
    expect(fetch).toHaveBeenCalledWith(pricesUrl('DK2'), { signal });
  });

  it('rejects when the service refuses the request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response('', { status: 503, statusText: 'Service Unavailable' }),
      ),
    );

    await expect(
      fetchPrices('DK2', new AbortController().signal, fetch),
    ).rejects.toThrow('Energi Data Service answered 503 Service Unavailable');
  });
});
