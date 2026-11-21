from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest

from agent_fleet.controls import SOUNDS, Chime, Controls
from agent_fleet.fleet import Fleet
from agent_fleet.hooks import HookEvent
from bar_kit import (
    ButtonEvent,
    EncoderEvent,
    SelectorEvent,
    SelectorPosition,
    StockSound,
)

NOW = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def on_screen() -> bool:
    return True


def test_chimes_for_a_session_that_starts_waiting_on_you() -> None:
    played: list[StockSound] = []
    chime = Chime(played.append, on_screen=on_screen, now=Clock())

    chime.ring("done")

    assert played == [SOUNDS["done"]]


def test_one_chime_covers_a_burst_of_alerts() -> None:
    played: list[StockSound] = []
    clock = Clock()
    chime = Chime(
        played.append,
        on_screen=on_screen,
        min_gap=timedelta(seconds=5),
        now=clock,
    )

    chime.ring("done")
    clock.now = NOW + timedelta(seconds=4)
    chime.ring("asking")
    clock.now = NOW + timedelta(seconds=5)
    chime.ring("failed")

    assert played == [SOUNDS["done"], SOUNDS["failed"]]


@pytest.mark.parametrize(
    ("selector", "board_on_screen", "chimes"),
    [
        (None, True, True),
        (None, False, False),
        ("apps", True, True),
        ("apps", False, True),
        ("settings", False, True),
        ("busy", True, False),
        ("busy", False, False),
        ("custom", True, False),
        ("off", True, False),
    ],
)
def test_the_selector_or_while_it_is_unknown_the_screen_decides(
    selector: SelectorPosition | None, *, board_on_screen: bool, chimes: bool
) -> None:
    played: list[StockSound] = []
    chime = Chime(played.append, on_screen=lambda: board_on_screen)
    chime.selector = selector

    chime.ring("done")

    assert played == ([SOUNDS["done"]] if chimes else [])


def test_a_board_started_during_a_focus_session_does_not_chime() -> None:
    played: list[StockSound] = []
    # The selector has not moved since the board started, and the BUSY timer
    # refuses the board's frames.
    chime = Chime(played.append, on_screen=lambda: False)

    chime.ring("asking")

    assert chime.selector is None
    assert played == []


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
    controls = Controls(
        fleet,
        Chime(lambda _: None, on_screen=on_screen),
        on_screen=lambda: True,
        now=lambda: NOW,
    )

    controls.handle(EncoderEvent(delta=1))
    controls.handle(ButtonEvent(button="ok", action="release"))
    assert seen(fleet) == []

    controls.handle(ButtonEvent(button="ok", action="press"))
    assert seen(fleet) == ["b"]


def test_back_acknowledges_everything() -> None:
    fleet = fleet_of("a", "b")
    controls = Controls(
        fleet,
        Chime(lambda _: None, on_screen=on_screen),
        on_screen=lambda: True,
        now=lambda: NOW,
    )

    controls.handle(ButtonEvent(button="start", action="press"))
    assert seen(fleet) == []

    controls.handle(ButtonEvent(button="back", action="press"))
    assert seen(fleet) == ["a", "b"]


def working_fleet() -> Fleet:
    """Sessions a and b wait on you, a highlighted; c is working."""
    fleet = fleet_of("a", "b")
    fleet.apply(HookEvent("prompt", "c", "/x/c"), NOW + timedelta(minutes=2))
    return fleet


def highlighted(fleet: Fleet) -> str:
    return next(row.workspace for row in fleet.view(NOW).rows if row.selected)


@pytest.mark.parametrize(
    ("event", "board_on_screen", "highlight", "seen_after"),
    [
        (EncoderEvent(delta=1), True, "b", []),
        (EncoderEvent(delta=1), False, "a", []),
        (ButtonEvent(button="ok", action="press"), True, None, ["a"]),
        (ButtonEvent(button="ok", action="press"), False, "a", []),
        (ButtonEvent(button="back", action="press"), True, None, ["a", "b"]),
        (ButtonEvent(button="back", action="press"), False, "a", []),
    ],
    ids=["wheel-on", "wheel-off", "ok-on", "ok-off", "back-on", "back-off"],
)
def test_acts_on_the_wheel_and_buttons_only_while_on_screen(
    event: ButtonEvent | EncoderEvent,
    *,
    board_on_screen: bool,
    highlight: str | None,
    seen_after: list[str],
) -> None:
    fleet = working_fleet()
    assert highlighted(fleet) == "a"
    controls = Controls(
        fleet,
        Chime(lambda _: None, on_screen=on_screen),
        on_screen=lambda: board_on_screen,
        now=lambda: NOW,
    )

    controls.handle(event)

    # None: an acknowledgement reorders the rows, which test_fleet covers.
    if highlight is not None:
        assert highlighted(fleet) == highlight
    assert seen(fleet) == seen_after


def test_back_while_another_app_is_on_screen_leaves_waiting_sessions_alone() -> None:
    fleet = fleet_of("a", "b")
    controls = Controls(
        fleet,
        Chime(lambda _: None, on_screen=on_screen),
        on_screen=lambda: False,
    )

    controls.handle(ButtonEvent(button="back", action="press"))

    assert fleet.view(NOW).needs_you == 2


def test_ok_during_the_busy_timer_leaves_the_highlighted_session_waiting() -> None:
    fleet = fleet_of("a")
    controls = Controls(
        fleet,
        Chime(lambda _: None, on_screen=on_screen),
        on_screen=lambda: False,
    )

    controls.handle(ButtonEvent(button="ok", action="press"))

    assert fleet.view(NOW).needs_you == 1


@pytest.mark.parametrize("position", ["busy", "custom", "off", "apps", "settings"])
def test_the_selector_reaches_the_chime_on_or_off_screen(
    position: SelectorPosition,
) -> None:
    chime = Chime(lambda _: None, on_screen=on_screen)
    controls = Controls(Fleet(), chime, on_screen=lambda: False)

    controls.handle(SelectorEvent(position=position))

    assert chime.selector == position


async def test_reopening_the_stream_forgets_the_last_position() -> None:
    chime = Chime(lambda _: None, on_screen=on_screen)
    controls = Controls(Fleet(), chime, on_screen=on_screen)
    opened: list[str] = []

    async def stream() -> AsyncIterator[object]:
        opened.append("stream")
        yield {}

    reopen = controls.input_stream(stream)
    controls.handle(SelectorEvent(position="busy"))

    messages = [message async for message in reopen()]

    assert chime.selector is None
    assert messages == [{}]
    assert opened == ["stream"]


def hook(event: str, **fields: object) -> dict[str, object]:
    return {"hook_event_name": event, "session_id": "s1", "cwd": "/repos/app", **fields}


def test_a_hook_updates_its_session_and_chimes_when_it_waits_on_you() -> None:
    played: list[StockSound] = []
    clock = Clock()
    fleet = Fleet()
    chime = Chime(played.append, on_screen=on_screen, now=clock)
    controls = Controls(fleet, chime, on_screen=lambda: True, now=clock)

    controls.hook(hook("UserPromptSubmit", prompt="fix the build"))
    controls.hook(hook("Stop"))

    assert played == [SOUNDS["done"]]
    assert fleet.view(NOW).needs_you == 1


def test_ignores_a_payload_the_board_has_no_use_for() -> None:
    fleet = Fleet()
    controls = Controls(
        fleet,
        Chime(lambda _: None, on_screen=on_screen),
        on_screen=lambda: True,
    )

    controls.hook({"hook_event_name": "Unknown", "session_id": "s1"})
    controls.hook(["not", "a", "hook"])

    assert fleet.view(NOW).rows == ()
