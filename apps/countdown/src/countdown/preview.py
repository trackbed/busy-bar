"""Sample frames for the app catalogue: `nx run countdown:preview`."""

from datetime import UTC, datetime, timedelta

from bar_kit import Preview, PreviewScene, PreviewStep, print_preview
from countdown.render import render_countdown
from countdown.settings import CountdownSettings

SETTINGS = CountdownSettings(
    target=datetime(2026, 12, 24, 17, tzinfo=UTC), label="XMAS"
)


def preview() -> Preview:
    """Christmas Eve, counted down from October, the last day, and the moment."""
    target = SETTINGS.target
    return Preview(
        summary="Days and hours left until an event, and what it is.",
        steps=[
            PreviewStep(
                label="Reads",
                text="COUNTDOWN_TARGET and COUNTDOWN_LABEL from the environment.",
            ),
            PreviewStep(
                label="Draws",
                text="The time left on the front, every second: days and hours, then "
                "hours, minutes, and seconds on the last day, then NOW in orange.",
            ),
        ],
        scenes=[
            PreviewScene(
                title="Weeks away",
                caption="64 days and 7 hours to go; the back names the event and when it starts.",
                elements=render_countdown(
                    target - timedelta(days=64, hours=7, minutes=12), SETTINGS
                ),
            ),
            PreviewScene(
                title="Last day",
                caption="Under a day left, the front counts down to the second.",
                elements=render_countdown(
                    target - timedelta(hours=4, minutes=33, seconds=20), SETTINGS
                ),
            ),
            PreviewScene(
                title="Time's up",
                caption="Once the moment passes, the front says NOW in orange.",
                elements=render_countdown(target + timedelta(minutes=5), SETTINGS),
            ),
        ],
    )


if __name__ == "__main__":
    print_preview(preview())
