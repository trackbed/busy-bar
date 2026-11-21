import asyncio
import logging
import os
import signal
from collections.abc import Sequence
from datetime import UTC, datetime

import pytest
from busylib import types
from busylib.exceptions import BusyBarAPIError

from bar_kit import DEFAULT_PRIORITY, install_shutdown_handlers, run_bar_app

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
FRAME = [types.TextElement(id="hello", text="HELLO", font="small")]


class FakeClient:
    """Records draws and sets `stop` after `frames` of them."""

    def __init__(
        self,
        stop: asyncio.Event,
        frames: int,
        *,
        failing_draws: int = 0,
        failing_draw: int | None = None,
        failing_clear: bool = False,
    ) -> None:
        self.stop = stop
        self.frames = frames
        self.failing_draws = failing_draws
        self.failing_draw = failing_draw
        self.failing_clear = failing_clear
        self.failing_deletions = 0
        self.deletion_error: Exception = ConnectionError("bar offline")
        self.gone: set[str] = set()
        """IDs the bar no longer has: deleting one is a 400, as on the bar."""
        self.drawn: list[types.DisplayElements] = []
        self.cleared: list[str] = []
        self.deleted: list[list[str]] = []

    async def display_draw(self, display_data: types.DisplayElements, /) -> object:
        self.drawn.append(display_data)
        if len(self.drawn) >= self.frames:
            self.stop.set()
        if (
            len(self.drawn) <= self.failing_draws
            or len(self.drawn) == self.failing_draw
        ):
            message = "bar offline"
            raise ConnectionError(message)
        return None

    async def display_clear(
        self, *, application_name: str, element_ids: Sequence[str] | None = None
    ) -> object:
        if element_ids is None:
            self.cleared.append(application_name)
        else:
            self.deleted.append(list(element_ids))
            if self.gone.intersection(element_ids):
                message = "one of element_ids is non-existent"
                raise BusyBarAPIError(message, status_code=400)
        if self.failing_clear:
            message = "bar offline"
            raise ConnectionError(message)
        if element_ids is not None and len(self.deleted) <= self.failing_deletions:
            raise self.deletion_error
        return None


def render(_now: datetime) -> Sequence[types.DisplayElement]:
    return FRAME


async def test_draws_a_frame_per_interval_and_clears_when_stopped() -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=2)
    seen: list[datetime] = []

    def recording_render(now: datetime) -> Sequence[types.DisplayElement]:
        seen.append(now)
        return FRAME

    await run_bar_app(
        name="demo",
        client=client,
        render=recording_render,
        interval=0,
        stop=stop,
        now=lambda: NOW,
    )

    assert seen == [NOW, NOW]
    assert [frame.application_name for frame in client.drawn] == ["demo", "demo"]
    assert client.drawn[0].elements == FRAME
    assert client.drawn[0].priority == DEFAULT_PRIORITY
    assert client.cleared == ["demo"]


EXTRA = types.TextElement(id="extra", text="X", font="small")


async def test_deletes_the_elements_a_frame_stops_drawing() -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=3)
    frames = iter([[*FRAME, EXTRA], FRAME, FRAME])

    await run_bar_app(
        name="demo",
        client=client,
        render=lambda _now: next(frames),
        interval=0,
        stop=stop,
    )

    assert client.deleted == [["extra"]]
    assert client.cleared == ["demo"]


async def test_remembers_what_the_last_draw_that_went_through_showed() -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=3, failing_draw=2)
    frames = iter([[*FRAME, EXTRA], FRAME, FRAME])

    await run_bar_app(
        name="demo",
        client=client,
        render=lambda _now: next(frames),
        interval=0,
        stop=stop,
    )

    assert client.deleted == [["extra"]]


@pytest.mark.parametrize(
    "error",
    [ConnectionError("bar offline"), BusyBarAPIError("Server error", status_code=503)],
)
async def test_retries_deletions_and_remembers_ids_drawn_while_cleanup_failed(
    caplog: pytest.LogCaptureFixture, error: Exception
) -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=3)
    client.failing_deletions = 1
    client.deletion_error = error
    fresh = types.TextElement(id="fresh", text="F", font="small")
    frames = iter([[*FRAME, EXTRA], [*FRAME, fresh], FRAME])

    with caplog.at_level(logging.WARNING, logger="bar_kit.run"):
        await run_bar_app(
            name="demo",
            client=client,
            render=lambda _now: next(frames),
            interval=0,
            stop=stop,
        )

    assert client.deleted == [["extra"], ["extra", "fresh"]]
    assert client.cleared == ["demo"]
    assert [record.getMessage() for record in caplog.records] == [
        "[demo] Deleting stale elements from the BUSY Bar failed."
    ]


async def test_forgets_ids_the_bar_no_longer_has_and_deletes_the_rest(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=3)
    client.gone = {"extra"}
    kept = types.TextElement(id="kept", text="K", font="small")
    frames = iter([[*FRAME, EXTRA, kept], FRAME, FRAME])

    with caplog.at_level(logging.WARNING, logger="bar_kit.run"):
        await run_bar_app(
            name="demo",
            client=client,
            render=lambda _now: next(frames),
            interval=0,
            stop=stop,
        )

    assert client.deleted == [["extra", "kept"], ["extra"], ["kept"]]
    assert caplog.records == []


async def test_forgets_a_single_id_the_bar_no_longer_has() -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=3)
    client.gone = {"extra"}
    frames = iter([[*FRAME, EXTRA], FRAME, FRAME])

    await run_bar_app(
        name="demo",
        client=client,
        render=lambda _now: next(frames),
        interval=0,
        stop=stop,
    )

    assert client.deleted == [["extra"]]


async def test_retries_every_id_when_a_single_deletion_fails_otherwise(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=3)
    client.gone = {"extra"}
    client.failing_deletions = 3
    client.deletion_error = BusyBarAPIError("Server error", status_code=503)
    more = types.TextElement(id="more", text="M", font="small")
    frames = iter([[*FRAME, EXTRA, more], FRAME, FRAME])

    with caplog.at_level(logging.WARNING, logger="bar_kit.run"):
        await run_bar_app(
            name="demo",
            client=client,
            render=lambda _now: next(frames),
            interval=0,
            stop=stop,
        )

    assert client.deleted[:3] == [["extra", "more"], ["extra"], ["more"]]
    assert [record.getMessage() for record in caplog.records][:1] == [
        "[demo] Deleting stale elements from the BUSY Bar failed."
    ]


async def test_draws_at_the_requested_priority() -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=1)

    await run_bar_app(
        name="demo", client=client, render=render, interval=0, stop=stop, priority=95
    )

    assert client.drawn[0].priority == 95


@pytest.mark.parametrize("priority", [0, 101])
async def test_rejects_a_priority_outside_the_range_before_drawing(
    priority: int,
) -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=1)

    with pytest.raises(ValueError, match="from 1 to 100"):
        await run_bar_app(
            name="demo",
            client=client,
            render=render,
            interval=0,
            stop=stop,
            priority=priority,
        )

    assert client.drawn == []
    assert client.cleared == []


async def test_logs_a_failed_draw_and_keeps_running(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=2, failing_draws=1)

    with caplog.at_level(logging.WARNING, logger="bar_kit.run"):
        await run_bar_app(
            name="demo", client=client, render=render, interval=0, stop=stop
        )

    assert len(client.drawn) == 2
    assert [record.getMessage() for record in caplog.records] == [
        "[demo] Drawing on the BUSY Bar failed."
    ]


async def test_clears_the_display_and_raises_when_render_fails() -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=1)

    def broken_render(_now: datetime) -> Sequence[types.DisplayElement]:
        message = "render bug"
        raise RuntimeError(message)

    with pytest.raises(RuntimeError, match="render bug"):
        await run_bar_app(
            name="demo", client=client, render=broken_render, interval=0, stop=stop
        )

    assert client.drawn == []
    assert client.cleared == ["demo"]


async def test_logs_a_failed_clear_instead_of_raising(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    stop.set()
    client = FakeClient(stop, frames=1, failing_clear=True)

    with caplog.at_level(logging.WARNING, logger="bar_kit.run"):
        await run_bar_app(
            name="demo", client=client, render=render, interval=0, stop=stop
        )

    assert client.drawn == []
    assert [record.getMessage() for record in caplog.records] == [
        "[demo] Clearing the BUSY Bar display failed."
    ]


async def test_stops_waiting_for_the_next_frame_as_soon_as_it_is_stopped() -> None:
    stop = asyncio.Event()
    client = FakeClient(stop, frames=1_000)
    running = asyncio.create_task(
        run_bar_app(name="demo", client=client, render=render, interval=60, stop=stop)
    )

    await asyncio.sleep(0)
    stop.set()
    await asyncio.wait_for(running, timeout=1)

    assert len(client.drawn) == 1
    assert client.cleared == ["demo"]


class HangingClient:
    """A bar that never answers a draw, or a deletion, as when it refuses one.

    A refused draw holds the request for up to 1.5 seconds before its 409.
    """

    def __init__(self, *, hang_draws: bool) -> None:
        self.hang_draws = hang_draws
        self.drawn = 0
        self.requests: list[Sequence[str] | None] = []
        self.started = asyncio.Event()

    async def display_draw(self, display_data: types.DisplayElements, /) -> object:
        del display_data
        self.drawn += 1
        if self.hang_draws:
            self.started.set()
            await asyncio.Event().wait()
        return None

    async def display_clear(
        self, *, application_name: str, element_ids: Sequence[str] | None = None
    ) -> object:
        del application_name
        self.requests.append(element_ids)
        if element_ids is not None:
            self.started.set()
            await asyncio.Event().wait()
        return None


@pytest.mark.parametrize("hang_draws", [True, False], ids=["draw", "deletion"])
async def test_stopping_cancels_a_request_in_flight_and_clears(
    caplog: pytest.LogCaptureFixture, *, hang_draws: bool
) -> None:
    stop = asyncio.Event()
    client = HangingClient(hang_draws=hang_draws)
    frames = iter([[*FRAME, EXTRA], FRAME])
    with caplog.at_level(logging.WARNING, logger="bar_kit.run"):
        running = asyncio.create_task(
            run_bar_app(
                name="demo",
                client=client,
                render=lambda _now: next(frames, FRAME),
                interval=0,
                stop=stop,
            )
        )
        await asyncio.wait_for(client.started.wait(), timeout=1)
        stop.set()
        await asyncio.wait_for(running, timeout=1)

    assert client.drawn == (1 if hang_draws else 2)
    assert client.requests == ([None] if hang_draws else [["extra"], None])
    assert caplog.records == []


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM])
async def test_shutdown_handlers_set_stop_on(signum: signal.Signals) -> None:
    stop = asyncio.Event()
    install_shutdown_handlers(stop)
    try:
        os.kill(os.getpid(), signum)
        await asyncio.wait_for(stop.wait(), timeout=1)
    finally:
        loop = asyncio.get_running_loop()
        loop.remove_signal_handler(signal.SIGINT)
        loop.remove_signal_handler(signal.SIGTERM)

    assert stop.is_set()


@pytest.mark.parametrize("signum", [signal.SIGINT, signal.SIGTERM])
async def test_leaves_a_second_signal_to_the_process(signum: signal.Signals) -> None:
    stop = asyncio.Event()
    previous = {
        other: signal.getsignal(other) for other in (signal.SIGINT, signal.SIGTERM)
    }
    install_shutdown_handlers(stop)
    try:
        os.kill(os.getpid(), signum)
        await asyncio.wait_for(stop.wait(), timeout=1)

        assert signal.getsignal(signal.SIGINT) is signal.SIG_DFL
        assert signal.getsignal(signal.SIGTERM) is signal.SIG_DFL
    finally:
        for other, handler in previous.items():
            signal.signal(other, handler)
