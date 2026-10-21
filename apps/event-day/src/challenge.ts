import { toBarText } from '@busy-bar-apps/bar-kit';
import {
  arrayAt,
  isObject,
  numberAt,
  objectAt,
  stringAt,
} from '@busy-bar-apps/json-values';

type ChallengeState = 'live' | 'draft' | 'archived';

/** A ChallengeCraft challenge, as its public TV leaderboard sees it. */
export interface ChallengeStatus {
  readonly state: ChallengeState;
  readonly entries: number | undefined;
  readonly leader:
    | { readonly name: string; readonly score: number }
    | undefined;
}

/** The leaderboard could not be read. */
export class ChallengeError extends Error {
  override readonly name = 'ChallengeError';
}

export const LEADERBOARD_QUERY = 'leaderboard:getLeaderboard';

const STATES: Readonly<Record<string, ChallengeState>> = {
  live: 'live',
  draft: 'draft',
  archived: 'archived',
};

export interface FetchChallengeOptions {
  /** The ChallengeCraft Convex deployment URL (`https://<name>.convex.cloud`). */
  readonly convexUrl: string;
  /** The `?token=` of the challenge's TV leaderboard URL. */
  readonly token: string;
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
}

/** Run the public leaderboard query through Convex's HTTP API. */
export async function fetchChallenge(
  options: FetchChallengeOptions,
): Promise<ChallengeStatus> {
  const { convexUrl, token, signal, fetch: fetchImpl = fetch } = options;
  const response = await fetchImpl(
    `${convexUrl.replace(/\/+$/u, '')}/api/query`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: LEADERBOARD_QUERY,
        args: { token },
        format: 'json',
      }),
      signal,
    },
  );
  const body: unknown = await response.json().catch(() => undefined);
  if (!isObject(body)) {
    throw new ChallengeError(`ChallengeCraft answered ${response.status}`);
  }
  return parseLeaderboard(body);
}

/** Read Convex's `{ status, value }` answer for the leaderboard query. */
export function parseLeaderboard(body: unknown): ChallengeStatus {
  if (!isObject(body)) {
    throw new ChallengeError(
      'ChallengeCraft did not answer with a JSON object.',
    );
  }
  if (stringAt(body, 'status') !== 'success') {
    const code = stringAt(objectAt(body, 'errorData'), 'code');
    throw new ChallengeError(
      code === 'leaderboard_not_found'
        ? 'Leaderboard not found; check EVENT_DAY_CHALLENGE_TOKEN.'
        : (stringAt(body, 'errorMessage') ??
            'ChallengeCraft reported an error.'),
    );
  }
  const value = objectAt(body, 'value');
  const challenge = objectAt(value, 'challenge');
  const state = STATES[stringAt(challenge, 'status') ?? ''];
  if (state === undefined) {
    throw new ChallengeError(
      'ChallengeCraft sent a leaderboard without a status.',
    );
  }
  const entries = arrayAt(value, 'entries').filter(isObject);
  const first =
    entries.find((entry) => numberAt(entry, 'rank') === 1) ?? entries[0];
  const score = first === undefined ? undefined : numberAt(first, 'score');
  return {
    state,
    entries: numberAt(challenge, 'entryCount'),
    leader:
      first === undefined || score === undefined
        ? undefined
        : { name: toBarText(stringAt(first, 'displayName') ?? '?'), score },
  };
}
