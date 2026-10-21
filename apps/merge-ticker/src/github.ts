import { toBarText } from '@busy-bar-apps/bar-kit';
import type { JsonObject } from '@busy-bar-apps/json-values';
import {
  arrayAt,
  isObject,
  numberAt,
  objectAt,
  stringAt,
} from '@busy-bar-apps/json-values';

export type Checks = 'passing' | 'failing' | 'pending' | 'none';

export interface OpenPullRequest {
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly draft: boolean;
  /** Whether GitHub merges it on its own once its checks pass. */
  readonly autoMerge: boolean;
  readonly checks: Checks;
}

export interface MergedPullRequest {
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly mergedAt: Date;
}

/** Your pull requests across every repository the token can see. */
export interface PullRequests {
  /** Up to 50 open pull requests, most recently updated first. */
  readonly open: readonly OpenPullRequest[];
  readonly openCount: number;
  readonly mergedToday: number;
  /** Today's merges, most recently updated first. */
  readonly merged: readonly MergedPullRequest[];
}

/** GitHub refused the request or answered with errors. */
export class GitHubError extends Error {
  override readonly name = 'GitHubError';
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

const QUERY = `query MergeTicker($open: String!, $merged: String!) {
  open: search(query: $open, type: ISSUE, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        title
        isDraft
        repository { nameWithOwner }
        autoMergeRequest { enabledAt }
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
      }
    }
  }
  merged: search(query: $merged, type: ISSUE, first: 20) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        title
        mergedAt
        repository { nameWithOwner }
      }
    }
  }
}`;

const CHECKS: Readonly<Record<string, Checks>> = {
  SUCCESS: 'passing',
  FAILURE: 'failing',
  ERROR: 'failing',
  PENDING: 'pending',
  EXPECTED: 'pending',
};

/**
 * The two searches: your open pull requests, and the ones merged since
 * `startOfDay`. `scope` adds qualifiers such as `org:consensusaps`.
 */
export function searchQueries(
  scope: string,
  startOfDay: string,
): { readonly open: string; readonly merged: string } {
  const base = `is:pr author:@me archived:false ${scope}`.trim();
  return {
    open: `${base} is:open sort:updated-desc`,
    merged: `${base} is:merged merged:>=${startOfDay} sort:updated-desc`,
  };
}

/**
 * Midnight of `now`'s day in `timeZone` (the system zone by default), as the
 * ISO 8601 time GitHub's search accepts, such as `2026-10-20T00:00:00+02:00`.
 */
export function startOfDay(now: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'longOffset',
    ...(timeZone === undefined ? {} : { timeZone }),
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  const offset = part('timeZoneName').replace('GMT', '') || '+00:00';
  return `${part('year')}-${part('month')}-${part('day')}T00:00:00${offset}`;
}

export interface FetchPullRequestsOptions {
  readonly token: string;
  readonly scope: string;
  readonly startOfDay: string;
  readonly signal: AbortSignal;
  readonly fetch?: typeof fetch;
}

/** Ask GitHub's GraphQL API for both searches in one request. */
export async function fetchPullRequests(
  options: FetchPullRequestsOptions,
): Promise<PullRequests> {
  const { token, scope, signal, fetch: fetchImpl = fetch } = options;
  const response = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'busy-bar-apps-merge-ticker',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: searchQueries(scope, options.startOfDay),
    }),
    signal,
  });
  if (!response.ok) {
    throw new GitHubError(
      `GitHub answered ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }
  return parsePullRequests(await response.json());
}

/** Read GitHub's answer, keeping only well-formed pull requests. */
export function parsePullRequests(body: unknown): PullRequests {
  if (!isObject(body)) {
    throw new GitHubError('GitHub did not answer with a JSON object.');
  }
  const [firstError] = arrayAt(body, 'errors');
  if (firstError !== undefined) {
    const message = isObject(firstError)
      ? stringAt(firstError, 'message')
      : undefined;
    throw new GitHubError(message ?? 'GitHub reported an error.');
  }
  const data = objectAt(body, 'data');
  const open = objectAt(data, 'open');
  const merged = objectAt(data, 'merged');
  const openPulls = arrayAt(open, 'nodes').flatMap(readOpen);
  const mergedPulls = arrayAt(merged, 'nodes').flatMap(readMerged);
  return {
    open: openPulls,
    openCount: numberAt(open, 'issueCount') ?? openPulls.length,
    mergedToday: numberAt(merged, 'issueCount') ?? mergedPulls.length,
    merged: mergedPulls,
  };
}

/** `owner/name#123`, the key a pull request is tracked by. */
export function pullKey(pull: {
  readonly repo: string;
  readonly number: number;
}): string {
  return `${pull.repo}#${pull.number}`;
}

function readOpen(node: unknown): OpenPullRequest[] {
  const basics = readBasics(node);
  if (basics === undefined || !isObject(node)) {
    return [];
  }
  const [lastCommit] = arrayAt(objectAt(node, 'commits'), 'nodes');
  const rollup = objectAt(objectAt(lastCommit, 'commit'), 'statusCheckRollup');
  const state = stringAt(rollup, 'state');
  return [
    {
      ...basics,
      draft: node['isDraft'] === true,
      autoMerge: isObject(node['autoMergeRequest']),
      checks: (state === undefined ? undefined : CHECKS[state]) ?? 'none',
    },
  ];
}

function readMerged(node: unknown): MergedPullRequest[] {
  const basics = readBasics(node);
  const mergedAt = isObject(node) ? stringAt(node, 'mergedAt') : undefined;
  const date = mergedAt === undefined ? undefined : new Date(mergedAt);
  if (
    basics === undefined ||
    date === undefined ||
    Number.isNaN(date.getTime())
  ) {
    return [];
  }
  return [{ ...basics, mergedAt: date }];
}

function readBasics(
  node: unknown,
): { repo: string; number: number; title: string } | undefined {
  if (!isObject(node)) {
    return undefined;
  }
  const repository: JsonObject = objectAt(node, 'repository');
  const repo = stringAt(repository, 'nameWithOwner');
  const number = numberAt(node, 'number');
  if (repo === undefined || number === undefined) {
    return undefined;
  }
  return { repo, number, title: toBarText(stringAt(node, 'title') ?? '') };
}
