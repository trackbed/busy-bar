import { describe, expect, it, vi } from 'vitest';

import { objectAt } from '@busy-bar-apps/json-values';

import type { QueueScope } from './linear.ts';
import {
  fetchQueue,
  LINEAR_GRAPHQL_URL,
  LinearError,
  MAX_PAGES,
  queueFilters,
  readIssues,
} from './linear.ts';

const SCOPE: QueueScope = { team: 'DISC', label: undefined, mine: false };

function page(states: [string, string][], next?: string): unknown {
  return {
    data: {
      issues: {
        nodes: states.map(([type, name]) => ({ state: { type, name } })),
        pageInfo: { hasNextPage: next !== undefined, endCursor: next ?? null },
      },
    },
  };
}

/** A fake fetch that answers each request with the next body. */
function answering(...bodies: unknown[]) {
  const queue = [...bodies];
  return vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(queue.shift())),
  );
}

function variablesOf(
  fetch: ReturnType<typeof answering>,
  call: number,
): unknown {
  const body = fetch.mock.calls[call]?.[1]?.body;
  return objectAt(
    JSON.parse(typeof body === 'string' ? body : '{}'),
    'variables',
  );
}

describe('queueFilters', () => {
  it('counts the team’s open issues and its past week of completions', () => {
    expect(queueFilters(SCOPE)).toStrictEqual({
      open: {
        team: { key: { eq: 'DISC' } },
        state: { type: { in: ['backlog', 'unstarted', 'started'] } },
      },
      done: { team: { key: { eq: 'DISC' } }, completedAt: { gte: '-P7D' } },
      ready: undefined,
    });
  });

  it('counts labelled issues not started yet as ready, and narrows to yours', () => {
    const filters = queueFilters({
      team: 'DISC',
      label: 'agent-ready',
      mine: true,
    });

    expect(filters.ready).toStrictEqual({
      team: { key: { eq: 'DISC' } },
      assignee: { isMe: { eq: true } },
      state: { type: { in: ['backlog', 'unstarted'] } },
      labels: { some: { name: { eqIgnoreCase: 'agent-ready' } } },
    });
    expect(filters.open).toMatchObject({ assignee: { isMe: { eq: true } } });
    expect(filters.open).not.toHaveProperty('labels');
  });
});

describe('readIssues', () => {
  it('reads the states on a page and the cursor of the next one', () => {
    expect(
      readIssues(
        page(
          [
            ['started', 'In Review'],
            ['backlog', 'Backlog'],
          ],
          'cursor-2',
        ),
      ),
    ).toStrictEqual({
      states: [
        { type: 'started', name: 'In Review' },
        { type: 'backlog', name: 'Backlog' },
      ],
      next: 'cursor-2',
    });
  });

  it('skips nodes without a state and stops on the last page', () => {
    expect(
      readIssues({
        data: { issues: { nodes: [{}, { state: { type: 'unstarted' } }] } },
      }),
    ).toStrictEqual({
      states: [{ type: 'unstarted', name: '' }],
      next: undefined,
    });
  });

  it.each([
    [
      { errors: [{ message: 'Authentication required' }] },
      'Authentication required',
    ],
    [{ errors: [42] }, 'Linear reported an error.'],
    [null, 'Linear did not answer with a JSON object.'],
  ])('turns %j into a LinearError', (body, message) => {
    expect(() => readIssues(body)).toThrow(new LinearError(message));
  });
});

describe('fetchQueue', () => {
  it('pages through the queue and sorts issues into stages', async () => {
    const fetch = answering(
      page(
        [
          ['unstarted', 'Todo'],
          ['started', 'In Progress'],
          ['started', 'In Review'],
        ],
        'page-2',
      ),
      page([
        ['backlog', 'Backlog'],
        ['backlog', 'Backlog'],
        ['unstarted', 'Todo'],
      ]),
      page([
        ['completed', 'Done'],
        ['completed', 'Done'],
      ]),
    );
    const signal = new AbortController().signal;

    const counts = await fetchQueue({
      apiKey: 'lin_api_key',
      scope: SCOPE,
      signal,
      fetch,
    });

    expect(counts).toStrictEqual({
      ready: 2,
      inProgress: 1,
      inReview: 1,
      backlog: 2,
      doneThisWeek: 2,
      capped: false,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[0]).toBe(LINEAR_GRAPHQL_URL);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: { authorization: 'lin_api_key' },
      signal,
    });
    expect(variablesOf(fetch, 0)).toStrictEqual({
      filter: queueFilters(SCOPE).open,
      after: null,
    });
    expect(variablesOf(fetch, 1)).toStrictEqual({
      filter: queueFilters(SCOPE).open,
      after: 'page-2',
    });
    expect(variablesOf(fetch, 2)).toStrictEqual({
      filter: queueFilters(SCOPE).done,
      after: null,
    });
  });

  it('takes the ready count from the labelled issues when a label is set', async () => {
    const fetch = answering(
      page([
        ['unstarted', 'Todo'],
        ['backlog', 'Backlog'],
      ]),
      page([]),
      page([
        ['backlog', 'Backlog'],
        ['backlog', 'Backlog'],
        ['unstarted', 'Todo'],
      ]),
    );
    const scope: QueueScope = {
      team: 'DISC',
      label: 'agent-ready',
      mine: false,
    };

    const counts = await fetchQueue({
      apiKey: 'k',
      scope,
      signal: new AbortController().signal,
      fetch,
    });

    expect(counts.ready).toBe(3);
    expect(counts.backlog).toBe(1);
    expect(variablesOf(fetch, 2)).toStrictEqual({
      filter: queueFilters(scope).ready,
      after: null,
    });
  });

  it('stops at the page limit and marks the counts as lower bounds', async () => {
    const endless = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(Response.json(page([['backlog', 'Backlog']], 'more'))),
    );

    const counts = await fetchQueue({
      apiKey: 'k',
      scope: SCOPE,
      signal: new AbortController().signal,
      fetch: endless,
    });

    expect(counts.capped).toBe(true);
    expect(counts.backlog).toBe(MAX_PAGES);
    expect(endless).toHaveBeenCalledTimes(MAX_PAGES * 2);
  });

  it('rejects with the status when Linear refuses the request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.resolve(
        new Response('', { status: 400, statusText: 'Bad Request' }),
      ),
    );

    const failed = fetchQueue({
      apiKey: 'wrong',
      scope: SCOPE,
      signal: new AbortController().signal,
      fetch,
    });

    await expect(failed).rejects.toThrow('Linear answered 400 Bad Request');
    await expect(failed).rejects.toMatchObject({ status: 400 });
  });
});
