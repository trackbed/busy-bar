"""What the countdown draws."""

from datetime import datetime, timedelta

from bar_kit import (
    BACK_DISPLAY,
    FRONT_DISPLAY,
    DisplayElement,
    DisplayName,
    TextElement,
    rgba,
)
from countdown.settings import CountdownSettings

REMAINING_COLOR = rgba(255, 255, 255)
DONE_COLOR = rgba(255, 140, 0)

_SECONDS_PER_DAY = 86_400
_SECONDS_PER_HOUR = 3_600


def format_remaining(remaining: timedelta) -> str:
    """Fit the time left on the front display.

    `12d 04h` while whole days remain, `04:33:20` on the last day, and `NOW`
    once the moment has passed.
    """
    total = int(remaining.total_seconds())
    if total <= 0:
        return "NOW"
    days, rest = divmod(total, _SECONDS_PER_DAY)
    hours, rest = divmod(rest, _SECONDS_PER_HOUR)
    minutes, seconds = divmod(rest, 60)
    if days:
        return f"{days}d {hours:02}h"
    return f"{hours:02}:{minutes:02}:{seconds:02}"


def render_countdown(
    now: datetime, settings: CountdownSettings
) -> list[DisplayElement]:
    """Draw the time left on the front display and its label on the back."""
    done = now >= settings.target
    return [
        TextElement(
            id="remaining",
            display=DisplayName.FRONT,
            text=format_remaining(settings.target - now),
            font="large",
            color=DONE_COLOR if done else REMAINING_COLOR,
            align="center",
            x=FRONT_DISPLAY.width // 2,
            y=FRONT_DISPLAY.height // 2,
        ),
        TextElement(
            id="label",
            display=DisplayName.BACK,
            text=settings.label,
            font="large",
            align="center",
            x=BACK_DISPLAY.width // 2,
            y=BACK_DISPLAY.height // 3,
        ),
        TextElement(
            id="target",
            display=DisplayName.BACK,
            text=settings.target.strftime("%a %d %b %H:%M"),
            font="small",
            align="center",
            x=BACK_DISPLAY.width // 2,
            y=BACK_DISPLAY.height * 2 // 3,
        ),
    ]
