import asyncio
import logging
from collections.abc import Callable, Iterator
from datetime import UTC, datetime

import pytest

from bar_kit import Poller, PollFailure, Snapshot

FIRST = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
SECOND = datetime(2026, 10, 20, 12, 0, 30, tzinfo=UTC)


def clock(*times: datetime) -> Callable[[], datetime]:
    """A clock that returns each of `times` in turn, then keeps the last."""
    ticks: Iterator[datetime] = iter(times)
    last = times[-1]

    def now() -> datetime:
        return next(ticks, last)

    return now


def test_has_nothing_to_show_before_the_first_fetch() -> None:
    async def fetch() -> int:
        return 1

    poller = Poller(name="demo", fetch=fetch, interval=0)

    assert poller.latest is None
    assert poller.failure is None


async def test_keeps_the_latest_value_and_when_it_arrived() -> None:
    stop = asyncio.Event()
    calls = 0

    async def fetch() -> int:
        nonlocal calls
        calls += 1
        if calls == 2:
            stop.set()
        return calls

    poller = Poller(name="demo", fetch=fetch, interval=0, now=clock(FIRST, SECOND))
    await poller.run(stop)

    assert poller.latest == Snapshot(value=2, at=SECOND)
    assert poller.failure is None


async def test_records_a_failure_until_the_next_fetch_succeeds(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    calls = 0
    error = ConnectionError("offline")
    failures: list[PollFailure | None] = []

    async def fetch() -> str:
        nonlocal calls
        calls += 1
        failures.append(poller.failure)
        if calls == 1:
            raise error
        stop.set()
        return "back"

    poller = Poller(name="demo", fetch=fetch, interval=0, now=clock(FIRST, SECOND))
    with caplog.at_level(logging.WARNING, logger="bar_kit.poll"):
        await poller.run(stop)

    assert failures == [None, PollFailure(error=error, at=FIRST)]
    assert [record.getMessage() for record in caplog.records] == [
        "[demo] Fetching failed."
    ]
    assert poller.latest == Snapshot(value="back", at=SECOND)
    assert poller.failure is None


async def test_keeps_the_previous_value_when_a_fetch_fails() -> None:
    stop = asyncio.Event()
    calls = 0

    async def fetch() -> str:
        nonlocal calls
        calls += 1
        if calls == 1:
            return "fresh"
        stop.set()
        message = "offline"
        raise ConnectionError(message)

    poller = Poller(name="demo", fetch=fetch, interval=0, now=clock(FIRST, SECOND))
    await poller.run(stop)

    assert poller.latest == Snapshot(value="fresh", at=FIRST)
    assert poller.failure is not None
    assert poller.failure.at == SECOND


async def test_stopping_cancels_a_fetch_in_flight() -> None:
    stop = asyncio.Event()
    started = asyncio.Event()
    cancelled = False

    async def fetch() -> str:
        nonlocal cancelled
        started.set()
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            cancelled = True
            raise
        return "late"

    poller = Poller(name="demo", fetch=fetch, interval=0)
    running = asyncio.create_task(poller.run(stop))
    await started.wait()
    stop.set()
    await asyncio.wait_for(running, timeout=1)

    assert cancelled
    assert poller.latest is None
    assert poller.failure is None


async def test_waits_the_interval_between_fetches() -> None:
    stop = asyncio.Event()
    calls = 0

    async def fetch() -> int:
        nonlocal calls
        calls += 1
        return calls

    poller = Poller(name="demo", fetch=fetch, interval=60)
    running = asyncio.create_task(poller.run(stop))
    await asyncio.sleep(0.05)
    stop.set()
    await asyncio.wait_for(running, timeout=1)

    assert calls == 1


async def test_tries_again_sooner_after_a_failed_fetch() -> None:
    stop = asyncio.Event()
    calls = 0

    async def fetch() -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            message = "busy"
            raise ConnectionError(message)
        stop.set()
        return calls

    poller = Poller(name="demo", fetch=fetch, interval=60, retry=0)
    await asyncio.wait_for(poller.run(stop), timeout=1)

    assert calls == 2
    assert poller.latest is not None


async def test_does_not_fetch_when_already_stopped() -> None:
    stop = asyncio.Event()
    stop.set()
    calls = 0

    async def fetch() -> int:
        nonlocal calls
        calls += 1
        return calls

    await Poller(name="demo", fetch=fetch, interval=0).run(stop)

    assert calls == 0
