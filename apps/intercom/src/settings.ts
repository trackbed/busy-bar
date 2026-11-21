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
export class IntercomSettingsError extends Error {
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
  const convexUrl = env['INTERCOM_CONVEX_URL']?.trim() ?? '';
  if (!/^https?:\/\/[^/\s]+/u.test(convexUrl)) {
    throw new IntercomSettingsError(
      convexUrl === ''
        ? 'Set INTERCOM_CONVEX_URL to the team deployment, such as https://<name>.convex.cloud.'
        : `INTERCOM_CONVEX_URL must be an http or https URL; got ${JSON.stringify(convexUrl)}.`,
    );
  }
  const key = env['INTERCOM_KEY']?.trim() ?? '';
  if (key === '') {
    throw new IntercomSettingsError(
      'Set INTERCOM_KEY to the key the deployment owner got from bars:add for this bar.',
    );
  }
  const sound = env['INTERCOM_SOUND']?.trim().toLowerCase() || 'on';
  if (sound !== 'on' && sound !== 'off') {
    throw new IntercomSettingsError(
      `INTERCOM_SOUND must be on or off; got ${JSON.stringify(sound)}.`,
    );
  }
  const rawMinutes = env['INTERCOM_FOCUS_MINUTES']?.trim() ?? '';
  const focusMinutes =
    rawMinutes === '' ? DEFAULT_FOCUS_MINUTES : Number(rawMinutes);
  if (
    !Number.isInteger(focusMinutes) ||
    focusMinutes < FOCUS_MINUTES.min ||
    focusMinutes > FOCUS_MINUTES.max
  ) {
    throw new IntercomSettingsError(
      `INTERCOM_FOCUS_MINUTES must be a whole number from ${FOCUS_MINUTES.min} to ${FOCUS_MINUTES.max}; got ${JSON.stringify(rawMinutes)}.`,
    );
  }
  return { convexUrl, key, sound: sound === 'on', focusMinutes };
}
