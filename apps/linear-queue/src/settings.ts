import { envWholeNumber, SettingsError } from '@busy-bar-apps/bar-kit';

import type { QueueScope } from './linear.ts';

/** What the queue gauge needs from the environment. */
export interface QueueSettings {
  readonly apiKey: string;
  readonly scope: QueueScope;
  /** Below this many ready issues, the gauge asks for a refill. */
  readonly low: number;
}

/** The environment does not describe a gauge that can run. */
class QueueSettingsError extends SettingsError {
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
  return {
    apiKey,
    scope: {
      team: env['LINEAR_QUEUE_TEAM']?.trim().toUpperCase() || DEFAULT_TEAM,
      label: env['LINEAR_QUEUE_LABEL']?.trim() || undefined,
      mine: assignee === 'me',
    },
    low: envWholeNumber(env, 'LINEAR_QUEUE_LOW', {
      fallback: DEFAULT_LOW,
      min: 0,
    }),
  };
}
