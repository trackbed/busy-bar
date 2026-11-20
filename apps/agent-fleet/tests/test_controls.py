import logging
from datetime import UTC, datetime, timedelta

import pytest
from busylib.features import ButtonEvent, EncoderEvent, SelectorEvent
from busylib.features.input_events import SelectorPosition

from agent_fleet.controls import SOUNDS, Chime, Controls
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


def hook(event: str, **fields: object) -> dict[str, object]:
    return {"hook_event_name": event, "session_id": "s1", "cwd": "/repos/app", **fields}


async def test_a_hook_updates_its_session_and_chimes_when_it_waits_on_you() -> None:
    speaker = Speaker()
    clock = Clock()
    fleet = Fleet()
    chime = Chime(speaker.play, enabled=True, now=clock)
    controls = Controls(fleet, chime, now=clock)

    controls.hook(hook("UserPromptSubmit", prompt="fix the build"))
    controls.hook(hook("Stop"))
    await chime.wait()

    assert speaker.played == [SOUNDS["done"]]
    assert fleet.view(NOW).needs_you == 1


def test_ignores_a_payload_the_board_has_no_use_for() -> None:
    fleet = Fleet()
    controls = Controls(fleet, Chime(Speaker().play, enabled=True))

    controls.hook({"hook_event_name": "Unknown", "session_id": "s1"})
    controls.hook(["not", "a", "hook"])

    assert fleet.view(NOW).rows == ()
