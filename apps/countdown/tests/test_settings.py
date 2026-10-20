from datetime import UTC, datetime, timedelta, timezone

import pytest

from countdown.settings import (
    DEFAULT_LABEL,
    CountdownSettings,
    CountdownSettingsError,
    load_settings,
)


def test_reads_the_target_and_label() -> None:
    settings = load_settings(
        {"COUNTDOWN_TARGET": "2026-12-24T18:00:00+01:00", "COUNTDOWN_LABEL": " XMAS "}
    )

    assert settings == CountdownSettings(
        target=datetime(2026, 12, 24, 18, tzinfo=timezone(timedelta(hours=1))),
        label="XMAS",
    )


def test_defaults_the_label() -> None:
    settings = load_settings({"COUNTDOWN_TARGET": "2026-12-24T17:00:00Z"})

    assert settings.target == datetime(2026, 12, 24, 17, tzinfo=UTC)
    assert settings.label == DEFAULT_LABEL


@pytest.mark.parametrize(
    ("env", "error"),
    [
        ({}, "Set COUNTDOWN_TARGET"),
        ({"COUNTDOWN_TARGET": "christmas"}, "must be an ISO 8601"),
        ({"COUNTDOWN_TARGET": "2026-12-24T18:00:00"}, "needs a UTC offset"),
        (
            {"COUNTDOWN_TARGET": "2026-12-24T18:00:00Z", "COUNTDOWN_LABEL": "JUL ★"},
            "printable ASCII",
        ),
    ],
)
def test_rejects_settings_it_cannot_draw(env: dict[str, str], error: str) -> None:
    with pytest.raises(CountdownSettingsError, match=error):
        load_settings(env)
