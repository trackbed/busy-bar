import {
  arrayAt,
  isObject,
  objectAt,
  stringAt,
} from '@busy-bar-apps/json-values';

export const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

/** How many issues sit at each stage of a team's queue. */
export interface QueueCounts {
  /**
   * Work an agent or a person can pick up: issues with the ready label in
   * Backlog or Todo when a label is set, otherwise every unstarted issue.
   */
  readonly ready: number;
  readonly inProgress: number;
  /** Started issues in a state whose name mentions review. */
  readonly inReview: number;
  readonly backlog: number;
  readonly doneThisWeek: number;
  /** Whether a count stopped at the page limit and is a lower bound. */
  readonly capped: boolean;
}

/** Which issues the queue counts. */
export interface QueueScope {
  readonly team: string;
  /** The label that marks an issue as ready, such as `agent-ready`. */
  readonly label: string | undefined;
  /** Count only issues assigned to the API key's owner. */
  readonly mine: boolean;
}

/** Linear refused the request or answered with errors. */
export class LinearError extends Error {
  override readonly name = 'LinearError';
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const PAGE_SIZE = 250;
/** Enough for 5,000 issues per count; beyond that the count is a lower bound. */
export const MAX_PAGES = 20;

const QUERY = `query LinearQueue($filter: IssueFilter!, $after: String) {
  issues(filter: $filter, first: ${PAGE_SIZE}, after: $after) {
    nodes { state { name type } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const REVIEW = /review/i;

type Post = (variables: Readonly<Record<string, unknown>>) => Promise<unknown>;

/**
 * The issue filters: the open queue, the past week's completions, and, when
 * a label marks issues as ready, the labelled issues not started yet.
 */
export function queueFilters(scope: QueueScope): {
  readonly open: Readonly<Record<string, unknown>>;
  readonly done: Readonly<Record<string, unknown>>;
  readonly ready: Readonly<Record<string, unknown>> | undefined;
} {
  const common = {
    team: { key: { eq: scope.team } },
    ...(scope.mine ? { assignee: { isMe: { eq: true } } } : {}),
  };
  return {
    open: {
      ...common,
      state: { type: { in: ['backlog', 'unstarted', 'started'] } },
    },
    done: { ...common, completedAt: { gte: '-P7D' } },
    ready:
      scope.label === undefined
        ? undefined
        : {
            ...common,
            state: { type: { in: ['backlog', 'unstarted'] } },
            labels: { some: { name: { eqIgnoreCase: scope.label } } },
          },
  };
}

export interface FetchQueueOptions {
  readonly apiKey: string;
  readonly scope: QueueScope;
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
}

/** Count the queue, paging through Linear's issue search. */
export async function fetchQueue(
  options: FetchQueueOptions,
): Promise<QueueCounts> {
  const { apiKey, scope, signal, fetch: fetchImpl = fetch } = options;
  const post: Post = async (variables) => {
    const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables }),
      signal,
    });
    if (!response.ok) {
      throw new LinearError(
        `Linear answered ${response.status} ${response.statusText}`.trim(),
        response.status,
      );
    }
    return response.json();
  };

  const filters = queueFilters(scope);
  const open = await collectStates(post, filters.open);
  const done = await collectStates(post, filters.done);
  const labelled =
    filters.ready === undefined
      ? undefined
      : await collectStates(post, filters.ready);
  const counts = { unstarted: 0, inProgress: 0, inReview: 0, backlog: 0 };
  for (const { name, type } of open.states) {
    if (type === 'backlog') {
      counts.backlog += 1;
    } else if (type === 'unstarted') {
      counts.unstarted += 1;
    } else if (REVIEW.test(name)) {
      counts.inReview += 1;
    } else {
      counts.inProgress += 1;
    }
  }
  return {
    ready: labelled?.states.length ?? counts.unstarted,
    inProgress: counts.inProgress,
    inReview: counts.inReview,
    backlog: counts.backlog,
    doneThisWeek: done.states.length,
    capped: open.capped || done.capped || labelled?.capped === true,
  };
}

interface IssueState {
  readonly name: string;
  readonly type: string;
}

async function collectStates(
  post: Post,
  filter: Readonly<Record<string, unknown>>,
): Promise<{ readonly states: IssueState[]; readonly capped: boolean }> {
  const states: IssueState[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const issues = readIssues(await post({ filter, after: after ?? null }));
    states.push(...issues.states);
    if (issues.next === undefined) {
      return { states, capped: false };
    }
    after = issues.next;
  }
  return { states, capped: true };
}

/** Read one page of the issue search: its states and the next cursor. */
export function readIssues(body: unknown): {
  readonly states: IssueState[];
  readonly next: string | undefined;
} {
  if (!isObject(body)) {
    throw new LinearError('Linear did not answer with a JSON object.');
  }
  const [firstError] = arrayAt(body, 'errors');
  if (firstError !== undefined) {
    const message = isObject(firstError)
      ? stringAt(firstError, 'message')
      : undefined;
    throw new LinearError(message ?? 'Linear reported an error.');
  }
  const issues = objectAt(objectAt(body, 'data'), 'issues');
  const states = arrayAt(issues, 'nodes').flatMap((node) => {
    const state = objectAt(node, 'state');
    const type = stringAt(state, 'type');
    return type === undefined
      ? []
      : [{ name: stringAt(state, 'name') ?? '', type }];
  });
  const pageInfo = objectAt(issues, 'pageInfo');
  const next =
    pageInfo['hasNextPage'] === true
      ? stringAt(pageInfo, 'endCursor')
      : undefined;
  return { states, next };
}
