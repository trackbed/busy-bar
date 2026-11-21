from datetime import UTC, datetime, timedelta

import pytest

from bar_kit import DisplayElement, DisplayName, TextElement
from countdown.render import (
    DONE_COLOR,
    REMAINING_COLOR,
    format_remaining,
    render_countdown,
)
from countdown.settings import CountdownSettings

SETTINGS = CountdownSettings(
    target=datetime(2026, 12, 24, 17, tzinfo=UTC), label="XMAS"
)


@pytest.mark.parametrize(
    ("remaining", "text"),
    [
        (timedelta(days=66, hours=5, minutes=59), "66d 05h"),
        (timedelta(hours=4, minutes=33, seconds=20), "04:33:20"),
        (timedelta(seconds=1), "00:00:01"),
        (timedelta(0), "NOW"),
        (timedelta(minutes=-5), "NOW"),
    ],
)
def test_formats_the_time_left(remaining: timedelta, text: str) -> None:
    assert format_remaining(remaining) == text


def texts(elements: list[DisplayElement]) -> dict[str, str]:
    return {
        element.id: element.text
        for element in elements
        if isinstance(element, TextElement)
    }


def test_draws_the_time_left_in_front_and_the_label_behind() -> None:
    elements = render_countdown(datetime(2026, 10, 19, 12, tzinfo=UTC), SETTINGS)

    assert texts(elements) == {
        "remaining": "66d 05h",
        "label": "XMAS",
        "target": "Thu 24 Dec 17:00",
    }
    assert [element.display for element in elements] == [
        DisplayName.FRONT,
        DisplayName.BACK,
        DisplayName.BACK,
    ]
    assert isinstance(elements[0], TextElement)
    assert elements[0].color == REMAINING_COLOR


def test_highlights_the_moment_it_reaches_zero() -> None:
    elements = render_countdown(SETTINGS.target, SETTINGS)

    assert isinstance(elements[0], TextElement)
    assert elements[0].text == "NOW"
    assert elements[0].color == DONE_COLOR
