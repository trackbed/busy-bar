import type { PollFailure, Snapshot } from './poller.ts';

/**
 * How long before `now` `then` was, rounded down: `now` under a minute, then
 * whole minutes (`42m`), then whole hours (`3h`). The Python kit's
 * `format_age` gives the same text.
 */
export function formatAge(now: Date, then: Date): string {
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - then.getTime()) / 60_000),
  );
  if (minutes === 0) {
    return 'now';
  }
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

/**
 * A footer for data a poller fetched: `updated 5m ago`, or, once fetching from
 * `source` has failed and `latest` is more than `staleMs` old,
 * `<source> unreachable, showing old data`. A source that fails only briefly
 * keeps the usual line. The Python kit's `freshness_line` gives the same text.
 */
export function freshnessLine(
  source: string,
  latest: Snapshot<unknown>,
  failure: PollFailure | undefined,
  now: Date,
  staleMs: number,
): string {
  if (failure !== undefined && now.getTime() - latest.at.getTime() > staleMs) {
    return `${source} unreachable, showing old data`;
  }
  const age = formatAge(now, latest.at);
  return age === 'now' ? 'updated just now' : `updated ${age} ago`;
}
