import type { PriceArea } from './energi.ts';

/** What the glance needs from the environment. */
export interface GlanceSettings {
  readonly area: PriceArea;
  readonly latitude: number;
  readonly longitude: number;
  /** Whether to ask DMI for rain. */
  readonly rain: boolean;
}

/** The environment does not describe a glance that can run. */
export class GlanceSettingsError extends Error {
  override readonly name = 'GlanceSettingsError';
}

/** Copenhagen City Hall Square. */
export const COPENHAGEN = { latitude: 55.6761, longitude: 12.5683 } as const;

/**
 * Read the optional `GLANCE_PRICE_AREA` (`DK1` or `DK2`), `GLANCE_LATITUDE`,
 * `GLANCE_LONGITUDE`, and `GLANCE_RAIN`. The defaults suit Copenhagen.
 */
export function loadSettings(
  env: Readonly<Record<string, string | undefined>>,
): GlanceSettings {
  const area = env['GLANCE_PRICE_AREA']?.trim().toUpperCase() || 'DK2';
  if (area !== 'DK1' && area !== 'DK2') {
    throw new GlanceSettingsError(
      `GLANCE_PRICE_AREA must be DK1 (west of the Great Belt) or DK2 (east); got ${JSON.stringify(area)}.`,
    );
  }
  const rawRain = env['GLANCE_RAIN']?.trim().toLowerCase() || 'on';
  if (rawRain !== 'on' && rawRain !== 'off') {
    throw new GlanceSettingsError(
      `GLANCE_RAIN must be on or off; got ${JSON.stringify(rawRain)}.`,
    );
  }
  return {
    area,
    latitude: coordinate(env, 'GLANCE_LATITUDE', COPENHAGEN.latitude, 90),
    longitude: coordinate(env, 'GLANCE_LONGITUDE', COPENHAGEN.longitude, 180),
    rain: rawRain === 'on',
  };
}

function coordinate(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  limit: number,
): number {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > limit) {
    throw new GlanceSettingsError(
      `${name} must be a number from -${limit} to ${limit}; got ${JSON.stringify(raw)}.`,
    );
  }
  return value;
}
