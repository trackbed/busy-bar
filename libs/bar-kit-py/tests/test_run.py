import asyncio
import logging
import os
import signal
from collections.abc import Sequence
from datetime import UTC, datetime

import pytest
from busylib import types

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
        failing_clear: bool = False,
    ) -> None:
        self.stop = stop
        self.frames = frames
        self.failing_draws = failing_draws
        self.failing_clear = failing_clear
        self.drawn: list[types.DisplayElements] = []
        self.cleared: list[str] = []

    async def display_draw(self, display_data: types.DisplayElements, /) -> object:
        self.drawn.append(display_data)
        if len(self.drawn) >= self.frames:
            self.stop.set()
        if len(self.drawn) <= self.failing_draws:
            message = "bar offline"
            raise ConnectionError(message)
        return None

    async def display_clear(self, *, application_name: str) -> object:
        self.cleared.append(application_name)
        if self.failing_clear:
            message = "bar offline"
            raise ConnectionError(message)
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
