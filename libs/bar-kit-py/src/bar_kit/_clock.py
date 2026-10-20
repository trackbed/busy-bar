"""Time helpers shared by the frame loop and the poller."""

import asyncio
import contextlib
from datetime import UTC, datetime


def utc_now() -> datetime:
    """The current time, time zone aware."""
    return datetime.now(UTC)


async def wait_for_stop(seconds: float, stop: asyncio.Event) -> None:
    """Wait `seconds`, or less if `stop` is set first."""
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=seconds)
