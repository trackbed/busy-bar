import { envSwitch, SettingsError } from '@busy-bar-apps/bar-kit';

/** What the ticker needs from the environment. */
export interface TickerSettings {
  readonly token: string;
  /** Extra search qualifiers, such as `org:consensusaps`. */
  readonly scope: string;
  /** IANA time zone that decides when "today" starts; the system's by default. */
  readonly timeZone: string | undefined;
  readonly sound: boolean;
}

/** The environment does not describe a ticker that can run. */
class TickerSettingsError extends SettingsError {
  override readonly name = 'TickerSettingsError';
}

/**
 * Read `GITHUB_TOKEN` (required) and the optional `MERGE_TICKER_SCOPE`,
 * `MERGE_TICKER_TIME_ZONE`, and `MERGE_TICKER_SOUND`.
 */
export function loadSettings(
  env: Readonly<Record<string, string | undefined>>,
): TickerSettings {
  const token = env['GITHUB_TOKEN']?.trim();
  if (!token) {
    throw new TickerSettingsError(
      'Set GITHUB_TOKEN to a token that can read your pull requests, for example GITHUB_TOKEN=$(gh auth token).',
    );
  }
  const timeZone = env['MERGE_TICKER_TIME_ZONE']?.trim() || undefined;
  if (timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone });
    } catch {
      throw new TickerSettingsError(
        `MERGE_TICKER_TIME_ZONE must be an IANA time zone such as Europe/Copenhagen; got ${JSON.stringify(timeZone)}.`,
      );
    }
  }
  return {
    token,
    scope: env['MERGE_TICKER_SCOPE']?.trim() ?? '',
    timeZone,
    sound: envSwitch(env, 'MERGE_TICKER_SOUND'),
  };
}
