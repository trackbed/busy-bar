from datetime import timedelta
from pathlib import Path

import pytest
from busylib import types
from samples import NOW

from bar_kit import BACK_DISPLAY, FRONT_DISPLAY, PollFailure, Snapshot, text_width
from claude_limits.render import (
    BARS_WIDTH,
    BARS_X,
    LEVEL_COLORS,
    TRACK_COLOR,
    format_duration,
    render,
)
from claude_limits.rotation import Account, Rotation, RotationNotSetUpError, Window

ROOT = Path("/Users/me/.local/share/conductor-claude-rotation")


def window(used: float, resets_in: float) -> Window:
    return Window(
        used=used,
        resets_at=NOW + timedelta(minutes=resets_in),
        observed_at=NOW - timedelta(minutes=1),
    )


def rotation(
    *accounts: Account,
    current: str | None = "account-a",
    rotating_to: str | None = None,
) -> Rotation:
    return Rotation(
        accounts=accounts,
        current=current,
        rotating_to=rotating_to,
        threshold=100.0,
        max_usage_age=timedelta(minutes=10),
    )


TWO_ACCOUNTS = rotation(
    Account("account-a", window(82, 72), window(45, 3 * 24 * 60 + 240)),
    Account("account-b", window(10, 200), None),
)


def draw(
    value: Rotation | None,
    *,
    fetched_ago: timedelta = timedelta(0),
    failure: PollFailure | None = None,
) -> dict[str, types.DisplayElement]:
    latest = None if value is None else Snapshot(value=value, at=NOW - fetched_ago)
    return {element.id: element for element in render(NOW, latest, failure, root=ROOT)}


def text(elements: dict[str, types.DisplayElement], element_id: str) -> str:
    element = elements[element_id]
    assert isinstance(element, types.TextElement)
    return element.text


def rectangle(
    elements: dict[str, types.DisplayElement], element_id: str
) -> types.RectangleElement:
    element = elements[element_id]
    assert isinstance(element, types.RectangleElement)
    return element


def test_shows_the_active_accounts_five_hour_usage_and_reset() -> None:
    elements = draw(TWO_ACCOUNTS)

    headline = elements["headline"]
    assert isinstance(headline, types.TextElement)
    assert headline.text == "A 82%"
    assert headline.color == LEVEL_COLORS["high"]
    assert text(elements, "summary") == "reset 1h12m"


def test_draws_a_pair_of_bars_per_account_with_the_active_one_marked() -> None:
    elements = draw(TWO_ACCOUNTS)

    used = rectangle(elements, "five-0-used")
    assert (used.x, used.y, used.width, used.height) == (
        BARS_X,
        0,
        round(0.82 * BARS_WIDTH),
        2,
    )
    free = rectangle(elements, "five-0-free")
    assert free.x + free.width == FRONT_DISPLAY.width
    assert free.fill_colors == [TRACK_COLOR]
    assert rectangle(elements, "week-0-used").y == 2
    assert "marker-0" in elements
    assert "marker-1" not in elements
    # Account b has no weekly reading: its weekly bar is all track.
    assert "week-1-used" not in elements
    assert rectangle(elements, "week-1-free").width == BARS_WIDTH


def test_lists_every_account_behind() -> None:
    elements = draw(TWO_ACCOUNTS, fetched_ago=timedelta(minutes=2))

    assert text(elements, "header") == "Claude accounts: 5h and week"
    assert [
        text(elements, f"row-0-{column}")
        for column in ("marker", "name", "five", "five-reset", "week", "week-reset")
    ] == [">", "account-a", "82%", "1h12m", "45%", "3d04h"]
    assert text(elements, "row-1-week") == "?"
    assert "row-1-week-reset" not in elements
    assert text(elements, "footer") == "updated 2m ago"


def test_says_where_a_rotation_is_heading() -> None:
    elements = draw(
        rotation(Account("account-a", window(99, 30), None), rotating_to="account-b")
    )

    assert text(elements, "summary") == "to account-b"
    assert text(elements, "header") == "Rotating to account-b"


def test_warns_when_every_account_is_at_its_limit() -> None:
    elements = draw(
        rotation(
            Account("account-a", window(100, 42), None),
            Account("account-b", window(100, 90), None),
        )
    )

    headline = elements["headline"]
    assert isinstance(headline, types.TextElement)
    assert headline.text == "ALL LIMITED"
    assert headline.color == LEVEL_COLORS["limit"]
    assert text(elements, "summary") == "free in 42m"
    assert text(elements, "header") == "Every account is at its limit"


def test_copes_without_an_active_account_or_a_reading() -> None:
    assert (
        text(draw(rotation(Account("x", None, None), current=None)), "headline")
        == "NO ACCOUNT"
    )
    assert (
        text(draw(rotation(Account("account-a", None, None))), "summary")
        == "no reading"
    )


def test_says_when_the_files_have_been_unreadable_for_a_while() -> None:
    failure = PollFailure(error=ValueError("broken"), at=NOW)

    recent = draw(TWO_ACCOUNTS, fetched_ago=timedelta(minutes=1), failure=failure)
    old = draw(TWO_ACCOUNTS, fetched_ago=timedelta(minutes=6), failure=failure)

    assert text(recent, "footer") == "updated 1m ago"
    assert text(draw(TWO_ACCOUNTS), "footer") == "updated just now"
    assert text(old, "footer") == "files unreadable, showing old data"


@pytest.mark.parametrize(
    ("failure", "headline", "lines"),
    [
        (None, "LIMITS", ["Reading the rotation files"]),
        (
            PollFailure(error=RotationNotSetUpError("missing"), at=NOW),
            "NO ROTATION",
            [
                "conductor-claude-rotation has no",
                "config.json in",
                "/Users/me/.local/share/",
                "conductor-claude-rotation",
            ],
        ),
        (
            PollFailure(error=ValueError("config.json is not valid JSON."), at=NOW),
            "LIMITS ?",
            ["Cannot read the rotation files:", "config.json is not valid JSON."],
        ),
    ],
)
def test_explains_why_there_is_nothing_to_show(
    failure: PollFailure | None, headline: str, lines: list[str]
) -> None:
    elements = draw(None, failure=failure)

    assert text(elements, "headline") == headline
    assert [text(elements, f"line-{index}") for index in range(len(lines))] == lines


def test_keeps_every_text_inside_its_display() -> None:
    elements = draw(
        rotation(
            Account(
                "account-with-a-very-long-label", window(100, 7000), window(100, 9000)
            ),
            Account("account-b", window(100, 7000), window(100, 9000)),
            current="account-with-a-very-long-label",
        )
    )

    for element in elements.values():
        if isinstance(element, types.TextElement) and element.align != "top_right":
            limit = (
                FRONT_DISPLAY.width
                if element.display == types.DisplayName.FRONT
                else BACK_DISPLAY.width
            )
            assert element.x + text_width(element.text, element.font) <= limit, (
                element.id
            )

    # Right-aligned elements anchor inside the display too.
    assert [
        element.id
        for element in elements.values()
        if element.x
        >= (
            FRONT_DISPLAY.width
            if element.display == types.DisplayName.FRONT
            else BACK_DISPLAY.width
        )
    ] == []


def test_formats_durations() -> None:
    assert [
        format_duration(timedelta(minutes=minutes))
        for minutes in (-5, 0, 42, 65, 24 * 60 + 5, 3 * 24 * 60 + 4 * 60)
    ] == ["0m", "0m", "42m", "1h05m", "1d00h", "3d04h"]
