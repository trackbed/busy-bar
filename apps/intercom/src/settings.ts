import {
  envHttpUrl,
  envSwitch,
  envWholeNumber,
  SettingsError,
} from '@busy-bar-apps/bar-kit';

import { FOCUS_MINUTES } from './convex/presence.ts';

/** What the intercom needs from the environment. */
export interface IntercomSettings {
  /** The team's Convex deployment: `https://<name>.convex.cloud`. */
  readonly convexUrl: string;
  /** The key `bars:add` answered for this bar. */
  readonly key: string;
  /** Whether a knock, an answer, and a team focus play a sound. */
  readonly sound: boolean;
  /** How long a team focus this bar starts lasts. */
  readonly focusMinutes: number;
}

export const DEFAULT_FOCUS_MINUTES = 25;

/** The environment does not describe an intercom that can run. */
export class IntercomSettingsError extends SettingsError {
  override readonly name = 'IntercomSettingsError';
}

/**
 * Read `INTERCOM_CONVEX_URL` and `INTERCOM_KEY`, both required, and
 * `INTERCOM_SOUND` and `INTERCOM_FOCUS_MINUTES`. The URL is not
 * `CONVEX_URL`, which `convex dev` points at its own dev deployment.
 */
export function loadSettings(
  env: Readonly<Record<string, string | undefined>>,
): IntercomSettings {
  const convexUrl = envHttpUrl(env, 'INTERCOM_CONVEX_URL');
  if (convexUrl === undefined) {
    throw new IntercomSettingsError(
      'Set INTERCOM_CONVEX_URL to the team deployment, such as https://<name>.convex.cloud.',
    );
  }
  const key = env['INTERCOM_KEY']?.trim() ?? '';
  if (key === '') {
    throw new IntercomSettingsError(
      'Set INTERCOM_KEY to the key the deployment owner got from bars:add for this bar.',
    );
  }
  return {
    convexUrl,
    key,
    sound: envSwitch(env, 'INTERCOM_SOUND'),
    focusMinutes: envWholeNumber(env, 'INTERCOM_FOCUS_MINUTES', {
      fallback: DEFAULT_FOCUS_MINUTES,
      min: FOCUS_MINUTES.min,
      max: FOCUS_MINUTES.max,
    }),
  };
}
