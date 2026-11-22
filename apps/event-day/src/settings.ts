import {
  DEFAULT_PRIORITY,
  envHttpUrl,
  envSwitch,
  envWholeNumber,
  MAX_PRIORITY,
  MIN_PRIORITY,
  SettingsError,
} from '@busy-bar-apps/bar-kit';

import type { BoothRef } from './photocraft.ts';

/** What the event-day board needs from the environment. */
export interface EventSettings {
  /** The PhotoCraft app URL and the booths to read there; unset without booths. */
  readonly photoCraft:
    | { readonly url: string; readonly booths: readonly BoothRef[] }
    | undefined;
  readonly quietMinutes: number;
  readonly challenge:
    | { readonly convexUrl: string; readonly token: string }
    | undefined;
  /** Draw priority, 1 to 100; no priority draws over a running BUSY timer. */
  readonly priority: number;
  readonly sound: boolean;
}

/** The environment does not describe a board that can run. */
class EventSettingsError extends SettingsError {
  override readonly name = 'EventSettingsError';
}

export const DEFAULT_QUIET_MINUTES = 15;

// PhotoCraft's own slug rule.
const SLUG = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/u;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Read `EVENT_DAY_PHOTOCRAFT_URL` with `EVENT_DAY_BOOTHS`, and
 * `EVENT_DAY_CHALLENGE_URL` with `EVENT_DAY_CHALLENGE_TOKEN`. At least one
 * pair is required. `EVENT_DAY_QUIET_MINUTES`, `EVENT_DAY_PRIORITY`, and
 * `EVENT_DAY_SOUND` are optional.
 */
export function loadSettings(env: Env): EventSettings {
  const photoCraftUrl = envHttpUrl(env, 'EVENT_DAY_PHOTOCRAFT_URL');
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

  const challengeUrl = envHttpUrl(env, 'EVENT_DAY_CHALLENGE_URL');
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
    photoCraft:
      photoCraftUrl === undefined || booths.length === 0
        ? undefined
        : { url: photoCraftUrl, booths },
    quietMinutes: envWholeNumber(env, 'EVENT_DAY_QUIET_MINUTES', {
      fallback: DEFAULT_QUIET_MINUTES,
      min: 1,
      max: 24 * 60,
    }),
    challenge:
      challengeUrl === undefined || token === undefined
        ? undefined
        : { convexUrl: challengeUrl, token },
    priority: envWholeNumber(env, 'EVENT_DAY_PRIORITY', {
      fallback: DEFAULT_PRIORITY,
      min: MIN_PRIORITY,
      max: MAX_PRIORITY,
    }),
    sound: envSwitch(env, 'EVENT_DAY_SOUND'),
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
