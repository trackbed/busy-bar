import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from datetime import UTC, datetime, timedelta

import pytest
from busylib.features import ButtonEvent, EncoderEvent, InputEvent, SelectorEvent
from busylib.features.input_events import SelectorPosition

from agent_fleet.controls import SOUNDS, Chime, Controls, listen_for_input
from agent_fleet.fleet import Fleet
from agent_fleet.hooks import HookEvent

NOW = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


class Speaker:
    def __init__(self, *, broken: bool = False) -> None:
        self.played: list[str] = []
        self.broken = broken

    async def play(self, sound: str) -> object:
        self.played.append(sound)
        if self.broken:
            message = "bar offline"
            raise ConnectionError(message)
        return None


async def test_chimes_for_a_session_that_starts_waiting_on_you() -> None:
    speaker = Speaker()
    chime = Chime(speaker.play, enabled=True, now=Clock())

    chime.ring("done")
    await chime.wait()

    assert speaker.played == [SOUNDS["done"]]


async def test_one_chime_covers_a_burst_of_alerts() -> None:
    speaker = Speaker()
    clock = Clock()
    chime = Chime(speaker.play, enabled=True, min_gap=timedelta(seconds=5), now=clock)

    chime.ring("done")
    clock.now = NOW + timedelta(seconds=4)
    chime.ring("asking")
    clock.now = NOW + timedelta(seconds=5)
    chime.ring("failed")
    await chime.wait()

    assert speaker.played == [SOUNDS["done"], SOUNDS["failed"]]


@pytest.mark.parametrize(("enabled", "focused"), [(False, False), (True, True)])
async def test_stays_silent_when_turned_off_or_during_focus(
    *, enabled: bool, focused: bool
) -> None:
    speaker = Speaker()
    chime = Chime(speaker.play, enabled=enabled, now=Clock())
    chime.focused = focused

    chime.ring("done")
    await chime.wait()

    assert speaker.played == []


async def test_a_failed_chime_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    speaker = Speaker(broken=True)
    chime = Chime(speaker.play, enabled=True, now=Clock())

    with caplog.at_level(logging.WARNING, logger="agent_fleet.controls"):
        chime.ring("asking")
        await chime.wait()

    assert [record.getMessage() for record in caplog.records] == [
        f"Playing {SOUNDS['asking']} on the bar failed."
    ]


def fleet_of(*sessions: str) -> Fleet:
    fleet = Fleet()
    for minute, session in enumerate(sessions):
        fleet.apply(
            HookEvent("stop", session, f"/x/{session}"),
            NOW + timedelta(minutes=minute),
        )
    return fleet


def seen(fleet: Fleet) -> list[str]:
    return [row.workspace for row in fleet.view(NOW).rows if row.status == "seen"]


def test_the_wheel_moves_and_ok_acknowledges_the_highlight() -> None:
    fleet = fleet_of("a", "b", "c")
    controls = Controls(fleet, Chime(Speaker().play, enabled=True), now=lambda: NOW)

    controls.handle(EncoderEvent(delta=1))
    controls.handle(ButtonEvent(button="ok", action="release"))
    assert seen(fleet) == []

    controls.handle(ButtonEvent(button="ok", action="press"))
    assert seen(fleet) == ["b"]


def test_back_acknowledges_everything() -> None:
    fleet = fleet_of("a", "b")
    controls = Controls(fleet, Chime(Speaker().play, enabled=True), now=lambda: NOW)

    controls.handle(ButtonEvent(button="start", action="press"))
    assert seen(fleet) == []

    controls.handle(ButtonEvent(button="back", action="press"))
    assert seen(fleet) == ["a", "b"]


@pytest.mark.parametrize(
    ("position", "focused"),
    [("busy", True), ("custom", True), ("off", True), ("apps", False)],
)
def test_the_selector_mutes_the_chime_during_focus(
    position: SelectorPosition, *, focused: bool
) -> None:
    chime = Chime(Speaker().play, enabled=True)
    controls = Controls(Fleet(), chime)

    controls.handle(SelectorEvent(position=position))

    assert chime.focused is focused


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

    with caplog.at_level(logging.WARNING, logger="agent_fleet.controls"):
        await listen_for_input(
            streams(
                [wheel(1), {"updates": [{"frame": {}}]}, b"binary", wheel(-2)],
                NotImplementedError(),
            ),
            handled.append,
            reconnect_seconds=0,
        )

    assert handled == [EncoderEvent(delta=1), EncoderEvent(delta=-2)]
    assert "the cloud does not stream them" in caplog.text


async def test_reconnects_after_the_stream_drops(
    caplog: pytest.LogCaptureFixture,
) -> None:
    handled: list[InputEvent] = []

    with caplog.at_level(logging.WARNING, logger="agent_fleet.controls"):
        await listen_for_input(
            streams(ConnectionError("bar rebooted"), [wheel(3)], NotImplementedError()),
            handled.append,
            reconnect_seconds=0,
        )

    assert handled == [EncoderEvent(delta=3)]
    assert "Lost the bar's input stream." in caplog.text


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
