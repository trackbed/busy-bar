from datetime import UTC, datetime

from bar_kit import utc_now


def test_utc_now_is_the_current_time_in_utc() -> None:
    before = datetime.now(UTC)
    now = utc_now()

    assert now.tzinfo is UTC
    assert before <= now <= datetime.now(UTC)
