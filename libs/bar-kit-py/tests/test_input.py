import asyncio
import logging
from collections.abc import AsyncIterator, Callable

import pytest
from busylib.features import EncoderEvent, InputEvent

from bar_kit import listen_for_input


def wheel(delta: int) -> dict[str, object]:
    return {"updates": [{"input": {"encoder_event": {"delta": delta}}}]}


def streams(
    *behaviours: list[object] | BaseException,
) -> Callable[[], AsyncIterator[object]]:
    """Each call opens the next stream: messages, or an error to raise."""
    pending = list(behaviours)

    async def stream() -> AsyncIterator[object]:
        behaviour = pending.pop(0)
        if isinstance(behaviour, BaseException):
            raise behaviour
        for message in behaviour:
            yield message

    return stream


async def test_passes_input_from_the_status_stream_on(
    caplog: pytest.LogCaptureFixture,
) -> None:
    handled: list[InputEvent] = []

    with caplog.at_level(logging.WARNING, logger="bar_kit.input"):
        await listen_for_input(
            streams(
                [wheel(1), {"updates": [{"frame": {}}]}, b"binary", wheel(-2)],
                NotImplementedError(),
            ),
            handled.append,
            reconnect_seconds=0,
        )

    assert handled == [EncoderEvent(delta=1), EncoderEvent(delta=-2)]
    assert "The bar closed its input stream." in caplog.text
    assert "the cloud does not stream them" in caplog.text


async def test_reconnects_after_the_stream_drops(
    caplog: pytest.LogCaptureFixture,
) -> None:
    handled: list[InputEvent] = []

    with caplog.at_level(logging.WARNING, logger="bar_kit.input"):
        await listen_for_input(
            streams(ConnectionError("bar rebooted"), [wheel(3)], NotImplementedError()),
            handled.append,
            reconnect_seconds=0,
        )

    assert handled == [EncoderEvent(delta=3)]
    assert "Lost the bar's input stream." in caplog.text


async def test_logs_a_handler_that_raises_and_goes_on_listening(
    caplog: pytest.LogCaptureFixture,
) -> None:
    handled: list[InputEvent] = []

    def handle(event: InputEvent) -> None:
        handled.append(event)
        if len(handled) == 1:
            raise ValueError("bug")

    with caplog.at_level(logging.WARNING, logger="bar_kit.input"):
        await listen_for_input(
            streams([wheel(1), wheel(2)], NotImplementedError()),
            handle,
            reconnect_seconds=0,
        )

    assert handled == [EncoderEvent(delta=1), EncoderEvent(delta=2)]
    assert "Handling an input event failed." in caplog.text


async def test_keeps_listening_until_cancelled() -> None:
    handled: list[InputEvent] = []

    async def endless() -> AsyncIterator[object]:
        yield wheel(1)
        await asyncio.Event().wait()
        yield wheel(2)  # pragma: no cover - never reached.

    listening = asyncio.create_task(listen_for_input(endless, handled.append))
    await asyncio.sleep(0.01)
    listening.cancel()
    with pytest.raises(asyncio.CancelledError):
        await listening

    assert handled == [EncoderEvent(delta=1)]
