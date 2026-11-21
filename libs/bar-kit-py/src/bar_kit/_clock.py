"""Stop-aware waiting shared by the frame loop, the poller, and the listener."""

import asyncio
import contextlib
from collections.abc import Awaitable
from datetime import UTC, datetime


def utc_now() -> datetime:
    """The current time, time zone aware."""
    return datetime.now(UTC)


async def wait_for_stop(seconds: float, stop: asyncio.Event) -> None:
    """Wait `seconds`, or less if `stop` is set first."""
    with contextlib.suppress(TimeoutError):
        await asyncio.wait_for(stop.wait(), timeout=seconds)


class Stopped(Exception):  # noqa: N818 - names the event, like StopIteration.
    """`stop` was set before the work `until_stopped` awaited finished."""


async def until_stopped[T](work: Awaitable[T], stop: asyncio.Event) -> T:
    """Await `work`, or cancel it and raise `Stopped` once `stop` is set.

    The counterpart of passing an `AbortSignal` to a request in the TypeScript
    kit: stopping does not wait out a request in flight.
    """
    task = asyncio.ensure_future(work)
    stopping = asyncio.ensure_future(stop.wait())
    try:
        await asyncio.wait({task, stopping}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        stopping.cancel()
        if not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    if task.cancelled():
        raise Stopped
    return task.result()
