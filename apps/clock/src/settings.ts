import { SettingsError } from '@busy-bar-apps/bar-kit';

/** What the clock needs from the environment. */
export interface ClockSettings {
  /** IANA time zone the clock shows; the system's by default. */
  readonly timeZone: string | undefined;
}

/** The environment does not describe a clock that can run. */
export class ClockSettingsError extends SettingsError {
  override readonly name = 'ClockSettingsError';
}

/** Read the optional `CLOCK_TIME_ZONE`. */
export function loadSettings(
  env: Readonly<Record<string, string | undefined>>,
): ClockSettings {
  const timeZone = env['CLOCK_TIME_ZONE']?.trim() || undefined;
  if (timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone });
    } catch {
      throw new ClockSettingsError(
        `CLOCK_TIME_ZONE must be an IANA time zone such as Europe/Copenhagen; got ${JSON.stringify(timeZone)}.`,
      );
    }
  }
  return { timeZone };
}
