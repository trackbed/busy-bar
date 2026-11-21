import asyncio
import logging
from typing import get_args

import pytest

from bar_kit import STOCK_SOUNDS, Speaker, StockSound


class FakeBar:
    """Records each sound and holds it until `answer` is set."""

    def __init__(self, *, broken: bool = False) -> None:
        self.broken = broken
        self.answer = asyncio.Event()
        self.answer.set()
        self.played: list[tuple[str | None, str | None]] = []
        self.finished = 0

    async def audio_play(
        self, *, stock_path: str | None = None, application_name: str | None = None
    ) -> object:
        self.played.append((stock_path, application_name))
        await self.answer.wait()
        if self.broken:
            message = "bar offline"
            raise ConnectionError(message)
        self.finished += 1
        return None


def test_names_the_sounds_busylib_ships() -> None:
    assert set(get_args(StockSound.__value__)) == set(STOCK_SOUNDS)


async def test_plays_the_stock_path_under_the_app_name() -> None:
    bar = FakeBar()
    speaker = Speaker(bar, name="test", enabled=True)

    speaker.play("event")
    speaker.play("reminder")
    await speaker.wait()

    assert bar.played == [
        (STOCK_SOUNDS["event"], "test"),
        (STOCK_SOUNDS["reminder"], "test"),
    ]


async def test_stays_silent_when_disabled() -> None:
    bar = FakeBar()
    speaker = Speaker(bar, name="test", enabled=False)

    speaker.play("event")
    await speaker.wait()

    assert bar.played == []


async def test_returns_before_the_bar_answers() -> None:
    bar = FakeBar()
    bar.answer.clear()
    speaker = Speaker(bar, name="test", enabled=True)

    speaker.play("event")
    await asyncio.sleep(0)

    assert bar.played == [(STOCK_SOUNDS["event"], "test")]
    assert bar.finished == 0
    bar.answer.set()
    await speaker.wait()
    assert bar.finished == 1


async def test_logs_a_sound_that_fails_without_raising(
    caplog: pytest.LogCaptureFixture,
) -> None:
    speaker = Speaker(FakeBar(broken=True), name="test", enabled=True)

    with caplog.at_level(logging.WARNING, logger="bar_kit.speaker"):
        speaker.play("reminder")
        await speaker.wait()

    assert [record.getMessage() for record in caplog.records] == [
        f"[test] Playing {STOCK_SOUNDS['reminder']} failed."
    ]
