"""Background refresh for the data an app draws."""

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

from bar_kit._clock import utc_now, wait_for_stop

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class Snapshot[T]:
    """A value a `Poller` fetched, and when the fetch finished."""

    value: T
    at: datetime


@dataclass(frozen=True, slots=True)
class PollFailure:
    """Why the most recent fetch of a `Poller` failed, and when."""

    error: Exception
    at: datetime


class Poller[T]:
    """The latest value of a data source an app draws, refreshed in the background.

    A render function reads `latest` and stays pure. The TypeScript kit's
    `createPoller` behaves the same way.
    """

    def __init__(
        self,
        *,
        name: str,
        fetch: Callable[[], Awaitable[T]],
        interval: float,
        retry: float | None = None,
        now: Callable[[], datetime] = utc_now,
    ) -> None:
        """Poll `fetch` every `interval` seconds, logging as `name`.

        After a failed fetch the next one comes after `retry` seconds instead,
        so a source that refused once is asked again soon. `retry` defaults to
        `interval`.
        """
        self._name = name
        self._fetch = fetch
        self._interval = interval
        self._retry = interval if retry is None else retry
        self._now = now
        self._latest: Snapshot[T] | None = None
        self._failure: PollFailure | None = None

    @property
    def latest(self) -> Snapshot[T] | None:
        """The most recent successful fetch, or None before the first."""
        return self._latest

    @property
    def failure(self) -> PollFailure | None:
        """How the most recent fetch failed, or None if it succeeded."""
        return self._failure

    async def run(self, stop: asyncio.Event) -> None:
        """Fetch at once and then every `interval` seconds until `stop` is set.

        A failed fetch is logged and kept as `failure`, and the previous value
        stays available, so a flaky source shows stale data instead of none.
        The next try comes after `retry` seconds. Setting `stop` cancels a
        fetch in flight.
        """
        while not stop.is_set():
            await self._refresh(stop)
            pause = self._interval if self._failure is None else self._retry
            await wait_for_stop(pause, stop)

    async def _refresh(self, stop: asyncio.Event) -> None:
        fetching = asyncio.ensure_future(self._fetch())
        stopping = asyncio.ensure_future(stop.wait())
        try:
            await asyncio.wait(
                {fetching, stopping}, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            stopping.cancel()
        if not fetching.done():
            fetching.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await fetching
            return
        try:
            value = fetching.result()
        except Exception as error:  # A failed fetch must not end the app.
            self._failure = PollFailure(error=error, at=self._now())
            logger.warning("[%s] Fetching failed.", self._name, exc_info=True)
        else:
            self._latest = Snapshot(value=value, at=self._now())
            self._failure = None
