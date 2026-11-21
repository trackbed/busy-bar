"""What the countdown draws."""

from datetime import datetime, timedelta

from bar_kit import (
    BACK_DISPLAY,
    FRONT_DISPLAY,
    PALETTE,
    DisplayElement,
    DisplayName,
    rgba,
    text_element,
)
from countdown.settings import CountdownSettings

REMAINING_COLOR = PALETTE.bright
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
        text_element(
            element_id="remaining",
            text=format_remaining(settings.target - now),
            display=DisplayName.FRONT,
            font="large",
            x=FRONT_DISPLAY.width // 2,
            y=FRONT_DISPLAY.height // 2,
            color=DONE_COLOR if done else REMAINING_COLOR,
            align="center",
        ),
        text_element(
            element_id="label",
            text=settings.label,
            display=DisplayName.BACK,
            font="large",
            x=BACK_DISPLAY.width // 2,
            y=BACK_DISPLAY.height // 3,
            color=PALETTE.bright,
            align="center",
        ),
        text_element(
            element_id="target",
            text=settings.target.strftime("%a %d %b %H:%M"),
            display=DisplayName.BACK,
            font="small",
            x=BACK_DISPLAY.width // 2,
            y=BACK_DISPLAY.height * 2 // 3,
            color=PALETTE.bright,
            align="center",
        ),
    ]
