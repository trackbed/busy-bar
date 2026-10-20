import { describe, expect, it, vi } from 'vitest';

import { DmiError, fetchRain, parseRain, rainUrl } from './dmi.ts';

const FORECAST = {
  type: 'Coverage',
  domain: {
    axes: {
      t: {
        values: [
          '2026-10-20T06:00:00.000Z',
          '2026-10-20T07:00:00.000Z',
          '2026-10-20T08:00:00.000Z',
          '2026-10-20T09:00:00.000Z',
        ],
      },
    },
  },
  ranges: { 'total-precipitation': { values: [0, 0.03, 0.6, 0.55] } },
};

describe('rainUrl', () => {
  it('asks for the precipitation forecast at a point, longitude first', () => {
    const url = new URL(rainUrl(55.6761, 12.5683));

    expect(url.origin).toBe('https://opendataapi.dmi.dk');
    expect(url.searchParams.get('coords')).toBe('POINT(12.5683 55.6761)');
    expect(url.searchParams.get('parameter-name')).toBe('total-precipitation');
  });
});

describe('parseRain', () => {
  it('turns the running total into rain per hour, never below zero', () => {
    const hours = parseRain(FORECAST);

    expect(hours.map((hour) => hour.start.toISOString())).toStrictEqual([
      '2026-10-20T06:00:00.000Z',
      '2026-10-20T07:00:00.000Z',
      '2026-10-20T08:00:00.000Z',
    ]);
    expect(hours.map((hour) => hour.millimetres)).toStrictEqual(
      [0.03, 0.57, 0].map((value, index) => (index === 1 ? 0.6 - 0.03 : value)),
    );
  });

  it('skips steps it cannot read', () => {
    const hours = parseRain({
      domain: {
        axes: {
          t: {
            values: ['bad', '2026-10-20T07:00:00Z', 7, '2026-10-20T09:00:00Z'],
          },
        },
      },
      ranges: { 'total-precipitation': { values: [0, 1, 2, 'x'] } },
    });

    expect(hours).toStrictEqual([
      { start: new Date('2026-10-20T07:00:00Z'), millimetres: 1 },
    ]);
  });

  it.each([
    ['not an object', 'did not answer with a JSON object'],
    [{ domain: {}, ranges: {} }, 'sent no precipitation forecast'],
  ])('rejects %j', (body, message) => {
    expect(() => parseRain(body)).toThrow(DmiError);
    expect(() => parseRain(body)).toThrow(message);
  });
});

describe('fetchRain', () => {
  it('fetches and parses the forecast', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(FORECAST)),
    );

    await expect(
      fetchRain(55.6761, 12.5683, new AbortController().signal, fetch),
    ).resolves.toHaveLength(3);
  });

  it('rejects when DMI is busy', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response('', { status: 429, statusText: 'Too Many Requests' }),
      ),
    );

    await expect(
      fetchRain(1, 2, new AbortController().signal, fetch),
    ).rejects.toThrow('DMI answered 429 Too Many Requests');
  });
});
