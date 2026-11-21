from datetime import UTC, datetime, timedelta

import pytest

from bar_kit import PollFailure, Snapshot, format_age, freshness_line

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
MINUTE = timedelta(minutes=1)
FAILURE = PollFailure(error=OSError("offline"), at=NOW)


@pytest.mark.parametrize(
    ("seconds", "age"),
    [
        (0, "now"),
        (59, "now"),
        (60, "1m"),
        (3599, "59m"),
        (3600, "1h"),
        (7199, "1h"),
        (2 * 86_400, "48h"),
        (-60, "now"),
    ],
)
def test_format_age_rounds_down_to_minutes_then_hours(seconds: int, age: str) -> None:
    assert format_age(NOW, NOW - timedelta(seconds=seconds)) == age


def test_freshness_line_says_how_old_the_data_is() -> None:
    assert (
        freshness_line("Linear", Snapshot(value=1, at=NOW), None, NOW, MINUTE)
        == "updated just now"
    )
    assert (
        freshness_line(
            "Linear", Snapshot(value=1, at=NOW - 120 * MINUTE), None, NOW, MINUTE
        )
        == "updated 2h ago"
    )


def test_freshness_line_keeps_the_usual_line_through_a_short_failure() -> None:
    latest = Snapshot(value=1, at=NOW - 5 * MINUTE)

    assert freshness_line("Linear", latest, FAILURE, NOW, 5 * MINUTE) == (
        "updated 5m ago"
    )


def test_freshness_line_names_the_source_once_its_data_is_stale() -> None:
    latest = Snapshot(value=1, at=NOW - 5 * MINUTE - timedelta(milliseconds=1))

    assert freshness_line("Linear", latest, FAILURE, NOW, 5 * MINUTE) == (
        "Linear unreachable, showing old data"
    )
