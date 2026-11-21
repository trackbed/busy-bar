from datetime import timedelta
from pathlib import Path

import pytest
from samples import NOW

from bar_kit import StockSound
from claude_limits.board import (
    SOUNDS,
    Level,
    RotationWatch,
    Usage,
    alert_for,
    board_at,
    short_label,
    usage_at,
)
from claude_limits.rotation import Account, Rotation, Window

WEEK = 7 * 24 * 60


def window(used: float, *, resets_in: float = 60, observed_ago: float = 1) -> Window:
    return Window(
        used=used,
        resets_at=NOW + timedelta(minutes=resets_in),
        observed_at=NOW - timedelta(minutes=observed_ago),
    )


def account(
    label: str,
    five: Window | None,
    week: Window | None = None,
    *,
    blocked_for: float | None = None,
) -> Account:
    return Account(
        label=label,
        five_hour=five,
        seven_day=week if week is not None else window(10, resets_in=WEEK),
        blocked_until=None
        if blocked_for is None
        else NOW + timedelta(minutes=blocked_for),
    )


def rotation(
    *accounts: Account, current: str | None = "a", rotating_to: str | None = None
) -> Rotation:
    return Rotation(
        accounts=accounts,
        current=current,
        rotating_to=rotating_to,
        threshold=100.0,
        max_usage_age=timedelta(minutes=10),
    )


@pytest.mark.parametrize(
    ("used", "level"), [(10, "ok"), (79.9, "ok"), (80, "high"), (100, "limit")]
)
def test_grades_usage_against_the_rotation_threshold(used: float, level: Level) -> None:
    usage = usage_at(window(used, resets_in=42), rotation(), NOW)

    assert usage == Usage(used=used, resets_in=timedelta(minutes=42), level=level)


def test_a_window_without_a_reading_or_past_its_reset_is_unknown() -> None:
    unknown = Usage(used=None, resets_in=None, level="unknown")

    assert usage_at(None, rotation(), NOW) == unknown
    assert usage_at(window(99, resets_in=0), rotation(), NOW) == unknown


def test_flags_a_reading_older_than_the_tool_trusts() -> None:
    usage = usage_at(window(50, observed_ago=11), rotation(), NOW)

    assert usage.stale
    assert usage.used == 50


def test_marks_the_active_account_and_which_accounts_could_take_over() -> None:
    board = board_at(
        rotation(
            account("a", window(85)),
            account("b", window(100)),
            account("c", window(5), week=window(100, resets_in=WEEK)),
            account("d", window(5), blocked_for=30),
            account("e", None),
            current="a",
        ),
        NOW,
    )

    assert [(item.label, item.active, item.eligible) for item in board.accounts] == [
        ("a", True, True),
        ("b", False, False),
        ("c", False, False),
        ("d", False, False),
        ("e", False, True),
    ]
    assert board.active is not None
    assert board.active.five_hour.level == "high"
    assert not board.exhausted
    assert board.free_in is None


def test_knows_when_every_account_is_at_its_limit_and_when_one_frees_up() -> None:
    board = board_at(
        rotation(
            account("a", window(100, resets_in=90)),
            account("b", window(100, resets_in=40), week=window(100, resets_in=300)),
            account("c", window(20), blocked_for=55),
        ),
        NOW,
    )

    assert board.exhausted
    assert board.free_in == timedelta(minutes=55)


def test_has_no_active_account_when_the_tool_names_none() -> None:
    board = board_at(rotation(account("a", window(5)), current=None), NOW)

    assert board.active is None


def test_spells_out_the_account_a_rotation_switches_to() -> None:
    board = board_at(rotation(account("a", window(5)), rotating_to="kø"), NOW)

    assert board.rotating_to == "koe"


@pytest.mark.parametrize(
    ("label", "short"),
    [("account-a", "A"), ("work", "WOR"), ("personal-max", "MAX"), ("æble", "AEB")],
)
def test_shortens_labels_for_the_front_display(label: str, short: str) -> None:
    assert short_label(label) == short


def test_sounds_an_alert_when_every_account_runs_out() -> None:
    before = rotation(account("a", window(100)), account("b", window(50)))
    after = rotation(account("a", window(100)), account("b", window(100)))

    assert alert_for(before, after, NOW) == "exhausted"
    assert alert_for(after, after, NOW) is None


def test_sounds_an_alert_when_the_tool_switches_accounts() -> None:
    before = rotation(account("a", window(99)), account("b", window(5)), current="a")
    after = rotation(account("a", window(99)), account("b", window(5)), current="b")

    assert alert_for(before, after, NOW) == "rotated"
    assert alert_for(None, after, NOW) is None
    assert alert_for(rotation(current=None), after, NOW) is None


ROOT = Path("/rotation")


def watch_over(
    *readings: Rotation, played: list[StockSound]
) -> tuple[RotationWatch, list[Path]]:
    pending = list(readings)
    roots: list[Path] = []

    def read(root: Path) -> Rotation:
        roots.append(root)
        return pending.pop(0)

    return RotationWatch(ROOT, play=played.append, read=read, now=lambda: NOW), roots


async def test_reads_the_rotation_and_sounds_when_the_tool_rotates() -> None:
    played: list[StockSound] = []
    first = rotation(account("a", window(10)), account("b", window(10)))
    rotated = rotation(account("a", window(10)), account("b", window(10)), current="b")
    watch, roots = watch_over(first, first, rotated, played=played)

    assert await watch.fetch() == first
    await watch.fetch()
    assert await watch.fetch() == rotated

    assert roots == [ROOT, ROOT, ROOT]
    assert played == ["reminder"]


async def test_sounds_when_every_account_runs_out() -> None:
    played: list[StockSound] = []
    first = rotation(account("a", window(10)))
    exhausted = rotation(account("a", window(100)))
    watch, _ = watch_over(first, exhausted, played=played)

    await watch.fetch()

    assert await watch.fetch() == exhausted
    assert played == [SOUNDS["exhausted"]]
