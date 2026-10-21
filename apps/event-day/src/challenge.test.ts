import { describe, expect, it, vi } from 'vitest';

import {
  ChallengeError,
  fetchChallenge,
  LEADERBOARD_QUERY,
  parseLeaderboard,
} from './challenge.ts';

/** The JSON body a fake fetch received. */
function bodyOf(init: RequestInit | undefined): unknown {
  const body = init?.body;
  return JSON.parse(typeof body === 'string' ? body : 'null');
}

const LEADERBOARD = {
  status: 'success',
  value: {
    challenge: { status: 'live', entryCount: 37 },
    entries: [
      { rowKey: 'b', rank: 2, displayName: 'Bo', score: 870 },
      { rowKey: 'a', rank: 1, displayName: 'Søren', score: 980 },
    ],
    latestRun: null,
  },
};

describe('parseLeaderboard', () => {
  it('reads the state, entry count, and leader', () => {
    expect(parseLeaderboard(LEADERBOARD)).toStrictEqual({
      state: 'live',
      entries: 37,
      leader: { name: 'Soeren', score: 980 },
    });
  });

  it.each(['draft', 'archived'])('reads an empty %s board', (state) => {
    expect(
      parseLeaderboard({
        status: 'success',
        value: {
          challenge: { status: state, entryCount: null },
          entries: [],
        },
      }),
    ).toStrictEqual({ state, entries: undefined, leader: undefined });
  });

  it.each([
    [
      {
        status: 'error',
        errorMessage: 'Leaderboard not found.',
        errorData: { code: 'leaderboard_not_found' },
      },
      'Leaderboard not found; check EVENT_DAY_CHALLENGE_TOKEN.',
    ],
    [{ status: 'error', errorMessage: 'Server Error' }, 'Server Error'],
    [{ status: 'error' }, 'ChallengeCraft reported an error.'],
    [
      { status: 'success', value: { challenge: { status: 'paused' } } },
      'without a status',
    ],
    [
      { status: 'success', value: { challenge: { status: 'constructor' } } },
      'without a status',
    ],
    [
      { status: 'success', value: { challenge: { status: '__proto__' } } },
      'without a status',
    ],
    ['nope', 'did not answer with a JSON object'],
  ])('turns %j into a ChallengeError', (body, message) => {
    expect(() => parseLeaderboard(body)).toThrow(ChallengeError);
    expect(() => parseLeaderboard(body)).toThrow(message);
  });
});

describe('fetchChallenge', () => {
  it('runs the leaderboard query through the Convex HTTP API', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(LEADERBOARD)),
    );
    const signal = new AbortController().signal;

    const status = await fetchChallenge({
      convexUrl: 'https://happy-otter-123.convex.cloud/',
      token: 'tv-token',
      signal,
      fetch,
    });

    expect(status.entries).toBe(37);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe('https://happy-otter-123.convex.cloud/api/query');
    expect(init?.signal).toBe(signal);
    expect(bodyOf(init)).toStrictEqual({
      path: LEADERBOARD_QUERY,
      args: { token: 'tv-token' },
      format: 'json',
    });
  });

  it('rejects an answer that is not JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(new Response('Bad Gateway', { status: 502 })),
    );

    await expect(
      fetchChallenge({
        convexUrl: 'https://x.convex.cloud',
        token: 't',
        signal: new AbortController().signal,
        fetch,
      }),
    ).rejects.toThrow('ChallengeCraft answered 502');
  });
});
