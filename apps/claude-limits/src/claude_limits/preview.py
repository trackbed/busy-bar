"""Sample frames for the app catalogue: `nx run claude-limits:preview`."""

from datetime import UTC, datetime, timedelta

from bar_kit import (
    DisplayElement,
    Preview,
    PreviewScene,
    PreviewStep,
    Snapshot,
    print_preview,
)
from claude_limits.render import render
from claude_limits.rotation import Account, Rotation, Window

NOW = datetime(2026, 10, 21, 12, 0, tzinfo=UTC)


def _window(used: float, *, resets_in: timedelta) -> Window:
    """A window the tool's monitor read a minute ago."""
    return Window(
        used=used, resets_at=NOW + resets_in, observed_at=NOW - timedelta(minutes=1)
    )


def _account(
    label: str, five_hour: float, five_hour_resets_in: timedelta, seven_day: float
) -> Account:
    return Account(
        label,
        _window(five_hour, resets_in=five_hour_resets_in),
        _window(seven_day, resets_in=timedelta(days=3, hours=6)),
    )


def _draw(*accounts: Account) -> list[DisplayElement]:
    rotation = Rotation(
        accounts=accounts,
        current="work",
        rotating_to=None,
        threshold=100.0,
        max_usage_age=timedelta(minutes=10),
    )
    latest = Snapshot(value=rotation, at=NOW - timedelta(seconds=10))
    return render(NOW, latest, None)


def preview() -> Preview:
    """Three accounts with room to spare, one running high, and none left."""
    return Preview(
        summary="How much of each Claude account's five-hour and weekly limits "
        "you have used, for the accounts conductor-claude-rotation switches "
        "between.",
        steps=[
            PreviewStep(
                label="Reads",
                text="The rotation tool's config.json, state.json, and per-account "
                "usage snapshots under CLAUDE_LIMITS_DIR every 30 seconds, without "
                "touching credentials or the usage endpoint.",
            ),
            PreviewStep(
                label="Decides",
                text="Each window is green below 80% of the tool's threshold, amber "
                "from 80%, red at the threshold, and grey without a reading, past "
                "its reset, or older than max_usage_age_seconds.",
            ),
            PreviewStep(
                label="Draws",
                text="The active account's five-hour usage and reset on the front "
                "beside a pair of bars per account, five-hour over weekly, and "
                "every account with both windows and their resets on the back.",
            ),
            PreviewStep(
                label="Alerts",
                text="A sound when the tool switches accounts and when every account "
                "reaches its limit, unless CLAUDE_LIMITS_SOUND is off.",
            ),
        ],
        scenes=[
            PreviewScene(
                title="Room to spare",
                caption="The work account has used 34% of its five-hour window, "
                "which resets in 2h10m; every bar is green.",
                elements=_draw(
                    _account("work", 34, timedelta(hours=2, minutes=10), 41),
                    _account("personal", 12, timedelta(hours=4, minutes=5), 58),
                    _account("backup", 0, timedelta(hours=5), 9),
                ),
            ),
            PreviewScene(
                title="Near the limit",
                caption="At 87% the work account turns amber; the tool will rotate "
                "away from it when it reaches its threshold.",
                elements=_draw(
                    _account("work", 87, timedelta(minutes=38), 72),
                    _account("personal", 23, timedelta(hours=3, minutes=20), 61),
                    _account("backup", 0, timedelta(hours=5), 9),
                ),
            ),
            PreviewScene(
                title="All limited",
                caption="Every account is at its five-hour limit, so no rotation "
                "helps; the front counts down to the first one freeing up.",
                elements=_draw(
                    _account("work", 100, timedelta(hours=1, minutes=12), 88),
                    _account("personal", 100, timedelta(hours=2, minutes=40), 77),
                    _account("backup", 100, timedelta(hours=3, minutes=55), 49),
                ),
            ),
        ],
    )


if __name__ == "__main__":
    print_preview(preview())
