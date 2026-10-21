import { describe, expect, it } from 'vitest';

import { COPENHAGEN, GlanceSettingsError, loadSettings } from './settings.ts';

describe('loadSettings', () => {
  it('defaults to Copenhagen with rain', () => {
    expect(loadSettings({})).toStrictEqual({
      area: 'DK2',
      ...COPENHAGEN,
      rain: true,
    });
  });

  it('reads the optional settings', () => {
    expect(
      loadSettings({
        GLANCE_PRICE_AREA: ' dk1 ',
        GLANCE_LATITUDE: '56.1567',
        GLANCE_LONGITUDE: '10.2108',
        GLANCE_RAIN: 'Off',
      }),
    ).toStrictEqual({
      area: 'DK1',
      latitude: 56.1567,
      longitude: 10.2108,
      rain: false,
    });
  });

  it.each([
    [{ GLANCE_PRICE_AREA: 'SE4' }, 'DK1 (west of the Great Belt) or DK2'],
    [{ GLANCE_RAIN: 'maybe' }, 'GLANCE_RAIN must be on or off'],
    [{ GLANCE_RAIN: 'constructor' }, 'GLANCE_RAIN must be on or off'],
    [{ GLANCE_RAIN: '__proto__' }, 'GLANCE_RAIN must be on or off'],
    [
      { GLANCE_LATITUDE: 'north' },
      'GLANCE_LATITUDE must be a number from -90 to 90',
    ],
    [
      { GLANCE_LONGITUDE: '200' },
      'GLANCE_LONGITUDE must be a number from -180 to 180',
    ],
  ])('rejects %j', (env, message) => {
    expect(() => loadSettings(env)).toThrow(GlanceSettingsError);
    expect(() => loadSettings(env)).toThrow(message);
  });
});
