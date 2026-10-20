import type { QueueScope } from './linear.ts';

/** What the queue gauge needs from the environment. */
export interface QueueSettings {
  readonly apiKey: string;
  readonly scope: QueueScope;
  /** Below this many ready issues, the gauge asks for a refill. */
  readonly low: number;
}

/** The environment does not describe a gauge that can run. */
export class QueueSettingsError extends Error {
  override readonly name = 'QueueSettingsError';
}

const DEFAULT_TEAM = 'DISC';
export const DEFAULT_LOW = 3;

/**
 * Read `LINEAR_API_KEY` (required) and the optional `LINEAR_QUEUE_TEAM`,
 * `LINEAR_QUEUE_LABEL`, `LINEAR_QUEUE_ASSIGNEE` (`me`), and `LINEAR_QUEUE_LOW`.
 */
export function loadSettings(
  env: Readonly<Record<string, string | undefined>>,
): QueueSettings {
  const apiKey = env['LINEAR_API_KEY']?.trim();
  if (!apiKey) {
    throw new QueueSettingsError(
      'Set LINEAR_API_KEY to a personal API key from Linear: Settings > Account > Security & access.',
    );
  }
  const assignee = env['LINEAR_QUEUE_ASSIGNEE']?.trim().toLowerCase() ?? '';
  if (assignee !== '' && assignee !== 'me') {
    throw new QueueSettingsError(
      `LINEAR_QUEUE_ASSIGNEE can only be "me"; got ${JSON.stringify(assignee)}.`,
    );
  }
  const rawLow = env['LINEAR_QUEUE_LOW']?.trim() ?? '';
  const low = rawLow === '' ? DEFAULT_LOW : Number(rawLow);
  if (!Number.isInteger(low) || low < 0) {
    throw new QueueSettingsError(
      `LINEAR_QUEUE_LOW must be a whole number; got ${JSON.stringify(rawLow)}.`,
    );
  }
  return {
    apiKey,
    scope: {
      team: env['LINEAR_QUEUE_TEAM']?.trim().toUpperCase() || DEFAULT_TEAM,
      label: env['LINEAR_QUEUE_LABEL']?.trim() || undefined,
      mine: assignee === 'me',
    },
    low,
  };
}
