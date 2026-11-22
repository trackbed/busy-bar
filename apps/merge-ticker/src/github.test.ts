import { describe, expect, it, vi } from 'vitest';

import { SetupError } from '@busy-bar-apps/bar-kit';

import {
  fetchPullRequests,
  GITHUB_GRAPHQL_URL,
  GitHubError,
  parsePullRequests,
  pullKey,
  searchQueries,
  startOfDay,
} from './github.ts';

const ANSWER = {
  data: {
    open: {
      issueCount: 3,
      nodes: [
        {
          number: 12,
          title: 'Add the merge ticker – with “quotes”',
          isDraft: false,
          repository: { nameWithOwner: 'Abildtoft/kramme-busy-bar-apps' },
          autoMergeRequest: { enabledAt: '2026-10-20T08:00:00Z' },
          commits: {
            nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }],
          },
        },
        {
          number: 7,
          title: 'Fix the flaky test',
          isDraft: true,
          repository: { nameWithOwner: 'consensusaps/consensus-event-studio' },
          autoMergeRequest: null,
          commits: {
            nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }],
          },
        },
        {
          number: 3,
          repository: { nameWithOwner: 'Abildtoft/discera' },
          commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
        },
        { title: 'An issue or an inaccessible node, not a pull request' },
        {},
      ],
    },
    merged: {
      issueCount: 5,
      nodes: [
        {
          number: 11,
          title: 'Ship it',
          mergedAt: '2026-10-20T09:30:00Z',
          repository: { nameWithOwner: 'Abildtoft/kramme-busy-bar-apps' },
        },
        {
          number: 10,
          title: 'No merge time',
          repository: { nameWithOwner: 'Abildtoft/kramme-busy-bar-apps' },
        },
        {
          number: 9,
          mergedAt: 'not a date',
          repository: { nameWithOwner: 'Abildtoft/kramme-busy-bar-apps' },
        },
      ],
    },
  },
};

describe('parsePullRequests', () => {
  it('reads open and merged pull requests and skips malformed nodes', () => {
    expect(parsePullRequests(ANSWER)).toStrictEqual({
      open: [
        {
          repo: 'Abildtoft/kramme-busy-bar-apps',
          number: 12,
          title: 'Add the merge ticker - with "quotes"',
          draft: false,
          autoMerge: true,
          checks: 'pending',
        },
        {
          repo: 'consensusaps/consensus-event-studio',
          number: 7,
          title: 'Fix the flaky test',
          draft: true,
          autoMerge: false,
          checks: 'failing',
        },
        {
          repo: 'Abildtoft/discera',
          number: 3,
          title: '',
          draft: false,
          autoMerge: false,
          checks: 'none',
        },
      ],
      openCount: 3,
      mergedToday: 5,
      merged: [
        {
          repo: 'Abildtoft/kramme-busy-bar-apps',
          number: 11,
          title: 'Ship it',
          mergedAt: new Date('2026-10-20T09:30:00Z'),
        },
      ],
    });
  });

  it.each(['constructor', '__proto__', 'UNKNOWN'])(
    'ignores unknown check state %s',
    (state) => {
      const pulls = parsePullRequests({
        data: {
          open: {
            nodes: [
              {
                number: 1,
                repository: { nameWithOwner: 'owner/repo' },
                commits: {
                  nodes: [{ commit: { statusCheckRollup: { state } } }],
                },
              },
            ],
          },
        },
      });

      expect(pulls.open[0]?.checks).toBe('none');
    },
  );

  it('counts the nodes when the totals are missing', () => {
    const pulls = parsePullRequests({
      data: { open: { nodes: [] }, merged: {} },
    });

    expect(pulls.openCount).toBe(0);
    expect(pulls.mergedToday).toBe(0);
  });

  it.each([
    [{ errors: [{ message: 'Bad credentials' }] }, 'Bad credentials'],
    [{ errors: ['odd'] }, 'GitHub reported an error.'],
    ['not an object', 'GitHub did not answer with a JSON object.'],
  ])('turns %j into a GitHubError', (body, message) => {
    expect(() => parsePullRequests(body)).toThrow(new GitHubError(message));
  });
});

describe('searchQueries', () => {
  it('searches your open pull requests and the ones merged today', () => {
    expect(
      searchQueries('org:consensusaps', '2026-10-20T00:00:00+02:00'),
    ).toStrictEqual({
      open: 'is:pr author:@me archived:false org:consensusaps is:open sort:updated-desc',
      merged:
        'is:pr author:@me archived:false org:consensusaps is:merged merged:>=2026-10-20T00:00:00+02:00 sort:updated-desc',
    });
  });

  it('works without extra qualifiers', () => {
    expect(searchQueries('', 'T').open).toBe(
      'is:pr author:@me archived:false is:open sort:updated-desc',
    );
  });
});

describe('startOfDay', () => {
  it('names midnight of the local day with its offset', () => {
    const now = new Date('2026-10-20T22:30:00Z');

    expect(startOfDay(now, 'Europe/Copenhagen')).toBe(
      '2026-10-21T00:00:00+02:00',
    );
    expect(startOfDay(now, 'UTC')).toBe('2026-10-20T00:00:00+00:00');
    expect(startOfDay(now, 'America/New_York')).toBe(
      '2026-10-20T00:00:00-04:00',
    );
  });

  it('uses the system time zone by default', () => {
    expect(startOfDay(new Date('2026-10-20T12:00:00Z'))).toMatch(
      /^2026-10-2\dT00:00:00[+-]\d{2}:\d{2}$/,
    );
  });
});

describe('fetchPullRequests', () => {
  it('posts both searches with the token and parses the answer', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(ANSWER)),
    );
    const signal = new AbortController().signal;

    const pulls = await fetchPullRequests({
      token: 'secret',
      scope: '',
      startOfDay: '2026-10-20T00:00:00+02:00',
      signal,
      fetch,
    });

    expect(pulls.mergedToday).toBe(5);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(GITHUB_GRAPHQL_URL);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      signal,
    });
    const rawBody = init?.body;
    expect(typeof rawBody).toBe('string');
    const body: unknown = JSON.parse(
      typeof rawBody === 'string' ? rawBody : '{}',
    );
    expect(body).toMatchObject({
      variables: searchQueries('', '2026-10-20T00:00:00+02:00'),
    });
  });

  function refusing(status: number, statusText: string) {
    return fetchPullRequests({
      token: 'expired',
      scope: '',
      startOfDay: 'T',
      signal: new AbortController().signal,
      fetch: vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(new Response('nope', { status, statusText })),
      ),
    });
  }

  it('names the token to fix when GitHub rejects it', async () => {
    const failed = refusing(401, 'Unauthorized');

    await expect(failed).rejects.toBeInstanceOf(SetupError);
    await expect(failed).rejects.toMatchObject({
      summary: 'token rejected',
      lines: [
        'GitHub rejected GITHUB_TOKEN.',
        'Try GITHUB_TOKEN=$(gh auth token).',
      ],
      cause: new GitHubError('GitHub answered 401 Unauthorized'),
    });
  });

  it('rejects with the status when GitHub fails', async () => {
    await expect(refusing(502, 'Bad Gateway')).rejects.toStrictEqual(
      new GitHubError('GitHub answered 502 Bad Gateway'),
    );
  });
});

describe('pullKey', () => {
  it('names a pull request by repository and number', () => {
    expect(pullKey({ repo: 'a/b', number: 1 })).toBe('a/b#1');
  });
});
