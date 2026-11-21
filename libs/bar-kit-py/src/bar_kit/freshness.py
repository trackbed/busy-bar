"""How fresh the data a `Poller` fetched is, in words for a footer."""

from datetime import datetime, timedelta

from bar_kit.poll import PollFailure, Snapshot

_MINUTES_PER_HOUR = 60


def format_age(now: datetime, then: datetime) -> str:
    """How long before `now` `then` was, rounded down.

    `now` under a minute, then whole minutes (`42m`), then whole hours
    (`3h`). The TypeScript kit's `formatAge` gives the same text.
    """
    minutes = max(0, int((now - then).total_seconds() // 60))
    if minutes == 0:
        return "now"
    if minutes < _MINUTES_PER_HOUR:
        return f"{minutes}m"
    return f"{minutes // _MINUTES_PER_HOUR}h"


def freshness_line[T](
    source: str,
    latest: Snapshot[T],
    failure: PollFailure | None,
    now: datetime,
    stale_after: timedelta,
) -> str:
    """A footer for data a poller fetched.

    `updated 5m ago`, or, once fetching from `source` has failed and `latest`
    is more than `stale_after` old, `<source> unreachable, showing old data`.
    A source that fails only briefly keeps the usual line. The TypeScript
    kit's `freshnessLine` gives the same text.
    """
    if failure is not None and now - latest.at > stale_after:
        return f"{source} unreachable, showing old data"
    age = format_age(now, latest.at)
    return "updated just now" if age == "now" else f"updated {age} ago"
