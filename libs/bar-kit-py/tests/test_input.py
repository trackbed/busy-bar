import asyncio
import logging
from collections.abc import AsyncIterator, Callable

import pytest
from busylib.features import ButtonEvent, EncoderEvent, InputEvent

from bar_kit import BarConfig, listen_for_input

USB = BarConfig(addr="10.0.4.20", token=None, is_cloud=False)
CLOUD = BarConfig(addr="https://api.busy.app", token="secret", is_cloud=True)


def wheel(delta: int) -> dict[str, object]:
    return {"updates": [{"input": {"encoder_event": {"delta": delta}}}]}


def ok_press() -> dict[str, object]:
    return {
        "updates": [{"input": {"button_event": {"button": "OK", "action": "PRESS"}}}]
    }


class Streams:
    """Each call opens the next stream: messages, or an error to raise."""

    def __init__(self, *behaviours: list[object] | Exception) -> None:
        self.pending = list(behaviours)
        self.opened = 0

    def __call__(self) -> AsyncIterator[object]:
        self.opened += 1
        return self._next()

    async def _next(self) -> AsyncIterator[object]:
        if not self.pending:
            error = "no more streams"
            raise ConnectionError(error)
        behaviour = self.pending.pop(0)
        if isinstance(behaviour, Exception):
            raise behaviour
        for message in behaviour:
            # Each message arrives on its own, as from a socket.
            await asyncio.sleep(0)
            yield message


def stopping_after(
    count: int, stop: asyncio.Event, handled: list[InputEvent]
) -> Callable[[InputEvent], None]:
    def handle(event: InputEvent) -> None:
        handled.append(event)
        if len(handled) == count:
            stop.set()

    return handle


async def test_passes_each_event_on_and_reopens_the_stream_after_it_drops(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    handled: list[InputEvent] = []
    streams = Streams(
        [wheel(1), {"updates": [{"frame": {}}]}, b"binary", ok_press()],
        ConnectionError("bar rebooted"),
        [wheel(-1)],
    )

    with caplog.at_level(logging.WARNING, logger="bar_kit.input"):
        await listen_for_input(
            name="test",
            config=USB,
            stream=streams,
            handle=stopping_after(3, stop, handled),
            stop=stop,
            reconnect_seconds=0,
        )

    assert handled == [
        EncoderEvent(delta=1),
        ButtonEvent(button="ok", action="press"),
        EncoderEvent(delta=-1),
    ]
    assert streams.opened == 3
    assert [record.getMessage() for record in caplog.records] == [
        "[test] The bar closed its input stream.",
        "[test] Lost the bar's input stream.",
    ]


async def test_logs_a_handler_that_raises_and_goes_on_listening(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    handled: list[InputEvent] = []

    def handle(event: InputEvent) -> None:
        handled.append(event)
        if len(handled) == 1:
            message = "bug"
            raise ValueError(message)
        stop.set()

    with caplog.at_level(logging.WARNING, logger="bar_kit.input"):
        await listen_for_input(
            name="test",
            config=USB,
            stream=Streams([wheel(2), wheel(4)]),
            handle=handle,
            stop=stop,
        )

    assert handled == [EncoderEvent(delta=2), EncoderEvent(delta=4)]
    assert [record.getMessage() for record in caplog.records] == [
        "[test] Handling an input event failed."
    ]


async def test_stops_quietly_when_stopped_during_a_stream(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stop = asyncio.Event()
    handled: list[InputEvent] = []

    async def endless() -> AsyncIterator[object]:
        yield wheel(1)
        await asyncio.Event().wait()
        yield wheel(2)  # pragma: no cover - never reached.

    with caplog.at_level(logging.WARNING, logger="bar_kit.input"):
        await asyncio.wait_for(
            listen_for_input(
                name="test",
                config=USB,
                stream=endless,
                handle=stopping_after(1, stop, handled),
                stop=stop,
            ),
            timeout=1,
        )

    assert handled == [EncoderEvent(delta=1)]
    assert caplog.records == []


async def test_stops_waiting_to_reopen_as_soon_as_it_is_stopped() -> None:
    stop = asyncio.Event()
    streams = Streams(ConnectionError("bar rebooted"))
    listening = asyncio.create_task(
        listen_for_input(
            name="test",
            config=USB,
            stream=streams,
            handle=lambda _event: None,
            stop=stop,
            reconnect_seconds=60,
        )
    )

    await asyncio.sleep(0.01)
    stop.set()
    await asyncio.wait_for(listening, timeout=1)

    assert streams.opened == 1


async def test_warns_once_and_stops_on_the_cloud_which_does_not_stream_input(
    caplog: pytest.LogCaptureFixture,
) -> None:
    streams = Streams()

    with caplog.at_level(logging.WARNING, logger="bar_kit.input"):
        await listen_for_input(
            name="test",
            config=CLOUD,
            stream=streams,
            handle=lambda _event: None,
            stop=asyncio.Event(),
        )

    assert streams.opened == 0
    assert [record.getMessage() for record in caplog.records] == [
        "[test] The wheel and buttons need a direct connection to the bar; "
        "the cloud does not stream them."
    ]
