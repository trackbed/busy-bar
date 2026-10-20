import type { BoothRef } from './photocraft.ts';

/** What the event-day board needs from the environment. */
export interface EventSettings {
  readonly photoCraftUrl: string | undefined;
  readonly booths: readonly BoothRef[];
  readonly quietMinutes: number;
  readonly challenge:
    | { readonly convexUrl: string; readonly token: string }
    | undefined;
  /** Draw priority, 1 to 100; no priority draws over a running BUSY timer. */
  readonly priority: number;
  readonly sound: boolean;
}

/** The environment does not describe a board that can run. */
export class EventSettingsError extends Error {
  override readonly name = 'EventSettingsError';
}

export const DEFAULT_QUIET_MINUTES = 15;
export const DEFAULT_PRIORITY = 50;

// PhotoCraft's own slug rule.
const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/u;
const SWITCHES: Readonly<Record<string, boolean>> = { on: true, off: false };

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Read `EVENT_DAY_PHOTOCRAFT_URL` with `EVENT_DAY_BOOTHS`, and
 * `EVENT_DAY_CHALLENGE_URL` with `EVENT_DAY_CHALLENGE_TOKEN`. At least one
 * pair is required. `EVENT_DAY_QUIET_MINUTES`, `EVENT_DAY_PRIORITY`, and
 * `EVENT_DAY_SOUND` are optional.
 */
export function loadSettings(env: Env): EventSettings {
  const photoCraftUrl = url(env, 'EVENT_DAY_PHOTOCRAFT_URL');
  const booths = (env['EVENT_DAY_BOOTHS'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map(booth);
  if (booths.length > 0 && photoCraftUrl === undefined) {
    throw new EventSettingsError(
      'EVENT_DAY_BOOTHS needs EVENT_DAY_PHOTOCRAFT_URL, the PhotoCraft app URL.',
    );
  }

  const challengeUrl = url(env, 'EVENT_DAY_CHALLENGE_URL');
  const token = env['EVENT_DAY_CHALLENGE_TOKEN']?.trim() || undefined;
  if ((challengeUrl === undefined) !== (token === undefined)) {
    throw new EventSettingsError(
      'Set EVENT_DAY_CHALLENGE_URL and EVENT_DAY_CHALLENGE_TOKEN together.',
    );
  }
  if (booths.length === 0 && token === undefined) {
    throw new EventSettingsError(
      'Set EVENT_DAY_BOOTHS (event-slug/booth-slug, comma separated) or the ChallengeCraft leaderboard settings.',
    );
  }

  return {
    photoCraftUrl,
    booths,
    quietMinutes: whole(
      env,
      'EVENT_DAY_QUIET_MINUTES',
      DEFAULT_QUIET_MINUTES,
      1,
      24 * 60,
    ),
    challenge:
      challengeUrl === undefined || token === undefined
        ? undefined
        : { convexUrl: challengeUrl, token },
    priority: whole(env, 'EVENT_DAY_PRIORITY', DEFAULT_PRIORITY, 1, 100),
    sound: switchOf(env, 'EVENT_DAY_SOUND'),
  };
}

function booth(entry: string): BoothRef {
  const [eventSlug = '', boothSlug = '', ...rest] = entry.split('/');
  if (rest.length > 0 || !SLUG.test(eventSlug) || !SLUG.test(boothSlug)) {
    throw new EventSettingsError(
      `EVENT_DAY_BOOTHS entries look like event-slug/booth-slug; got ${JSON.stringify(entry)}.`,
    );
  }
  return { eventSlug, boothSlug };
}

function url(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  if (!URL.canParse(raw) || !/^https?:$/u.test(new URL(raw).protocol)) {
    throw new EventSettingsError(
      `${name} must be an http(s) URL; got ${JSON.stringify(raw)}.`,
    );
  }
  return raw;
}

function whole(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim() ?? '';
  if (raw === '') {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new EventSettingsError(
      `${name} must be a whole number from ${min} to ${max}; got ${JSON.stringify(raw)}.`,
    );
  }
  return value;
}

function switchOf(env: Env, name: string): boolean {
  const raw = env[name]?.trim().toLowerCase() || 'on';
  const value = SWITCHES[raw];
  if (value === undefined) {
    throw new EventSettingsError(
      `${name} must be on or off; got ${JSON.stringify(raw)}.`,
    );
  }
  return value;
}
