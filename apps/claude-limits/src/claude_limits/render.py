"""What the limits board draws."""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from busylib import types

from bar_kit import (
    BACK_DISPLAY,
    FRONT_DISPLAY,
    PollFailure,
    Snapshot,
    fit_text,
    rgba,
    to_bar_text,
)
from claude_limits.board import AccountView, Board, Level, Usage, board_at
from claude_limits.rotation import Rotation, RotationNotSetUpError

LEVEL_COLORS: dict[Level, str] = {
    "ok": rgba(0, 200, 90),
    "high": rgba(255, 170, 0),
    "limit": rgba(255, 60, 60),
    "unknown": rgba(90, 90, 90),
}
TRACK_COLOR = rgba(35, 35, 35)
MARKER_COLOR = rgba(255, 255, 255)
TEXT_COLOR = rgba(200, 200, 200)
DIM_COLOR = rgba(110, 110, 110)

FRONT = types.DisplayName.FRONT
BACK = types.DisplayName.BACK

# Front: the active account in text on the left, one pair of bars per account
# on the right: the five-hour window (2 px) over the weekly one (1 px).
BARS_X = 52
BARS_WIDTH = FRONT_DISPLAY.width - BARS_X
ACCOUNT_PITCH = 4
MAX_FRONT_ACCOUNTS = FRONT_DISPLAY.height // ACCOUNT_PITCH
TEXT_WIDTH = BARS_X - 3
SUMMARY_Y = 9

# Back: a header, then one account per row, then a footer.
FIRST_ROW_Y = 12
ROW_PITCH = 11
FOOTER_Y = BACK_DISPLAY.height - 7
MAX_BACK_ACCOUNTS = (FOOTER_Y - FIRST_ROW_Y) // ROW_PITCH
NAME_X = 6
NAME_WIDTH = 38
FIVE_HOUR_RIGHT = 70
FIVE_HOUR_RESET_X = 74
SEVEN_DAY_RIGHT = 128

STALE_AFTER = timedelta(minutes=5)
"""How long the files may stay unreadable before the board says so."""

type Align = Literal["top_left", "top_right"]


def format_duration(duration: timedelta) -> str:
    """`42m`, `1h05m`, or `3d04h`."""
    minutes = max(0, int(duration.total_seconds() // 60))
    days, minutes = divmod(minutes, 24 * 60)
    hours, minutes = divmod(minutes, 60)
    if days:
        return f"{days}d{hours:02}h"
    if hours:
        return f"{hours}h{minutes:02}m"
    return f"{minutes}m"


def format_used(usage: Usage) -> str:
    """`82%`, or `?` without a reading."""
    return "?" if usage.used is None else f"{round(usage.used)}%"


def render(
    now: datetime,
    latest: Snapshot[Rotation] | None,
    failure: PollFailure | None,
    *,
    root: Path,
) -> list[types.DisplayElement]:
    """Draw the latest reading, or why there is none."""
    if latest is None:
        return _unavailable(failure, root)
    board = board_at(latest.value, now)
    stale = failure is not None and now - latest.at > STALE_AFTER
    return [*_front(board), *_back(board, stale=stale, updated=now - latest.at)]


def _front(board: Board) -> list[types.DisplayElement]:
    active = board.active
    if board.exhausted:
        headline, color = "ALL LIMITED", LEVEL_COLORS["limit"]
        free = f"free in {format_duration(board.free_in)}" if board.free_in else ""
        summary = free or "no account free"
    elif active is None:
        headline, color = "NO ACCOUNT", LEVEL_COLORS["unknown"]
        summary = "none active"
    else:
        usage = active.five_hour
        headline = f"{active.short} {format_used(usage)}"
        color = LEVEL_COLORS[usage.level]
        summary = _summary(board, usage)
    elements: list[types.DisplayElement] = [
        _front_text(
            "headline", fit_text(headline, "small", TEXT_WIDTH), "small", 0, color
        ),
        _front_text(
            "summary", fit_text(summary, "tiny", TEXT_WIDTH), "tiny", SUMMARY_Y, color
        ),
    ]
    for slot, account in enumerate(board.accounts[:MAX_FRONT_ACCOUNTS]):
        elements += _bars(slot, account)
    return elements


def _summary(board: Board, usage: Usage) -> str:
    if board.rotating_to:
        return f"to {board.rotating_to}"
    if usage.resets_in is None:
        return "no reading"
    return f"reset {format_duration(usage.resets_in)}"


def _bars(slot: int, account: AccountView) -> list[types.DisplayElement]:
    y = slot * ACCOUNT_PITCH
    elements: list[types.DisplayElement] = []
    if account.active:
        elements.append(
            _rectangle(
                f"marker-{slot}", BARS_X - 2, y, width=1, height=3, color=MARKER_COLOR
            )
        )
    for name, usage, offset, height in (
        ("five", account.five_hour, 0, 2),
        ("week", account.seven_day, 2, 1),
    ):
        filled = _filled_width(usage)
        if filled:
            color = LEVEL_COLORS["unknown" if usage.stale else usage.level]
            elements.append(
                _rectangle(
                    f"{name}-{slot}-used",
                    BARS_X,
                    y + offset,
                    width=filled,
                    height=height,
                    color=color,
                )
            )
        if filled < BARS_WIDTH:
            elements.append(
                _rectangle(
                    f"{name}-{slot}-free",
                    BARS_X + filled,
                    y + offset,
                    width=BARS_WIDTH - filled,
                    height=height,
                    color=TRACK_COLOR,
                )
            )
    return elements


def _filled_width(usage: Usage) -> int:
    if usage.used is None:
        return 0
    share = min(max(usage.used, 0.0), 100.0) / 100
    return round(share * BARS_WIDTH)


def _back(
    board: Board, *, stale: bool, updated: timedelta
) -> list[types.DisplayElement]:
    if board.exhausted:
        header = "Every account is at its limit"
    elif board.rotating_to:
        header = f"Rotating to {board.rotating_to}"
    else:
        header = "Claude accounts: 5h and week"
    if stale:
        footer = "files unreadable, showing old data"
    elif updated < timedelta(minutes=1):
        footer = "updated just now"
    else:
        footer = f"updated {format_duration(updated)} ago"
    elements: list[types.DisplayElement] = [
        _back_text("header", fit_text(header, "small", BACK_DISPLAY.width), "small", 0),
        _back_text("footer", footer, "tiny", FOOTER_Y, DIM_COLOR),
    ]
    for slot, account in enumerate(board.accounts[:MAX_BACK_ACCOUNTS]):
        elements += _row(slot, account)
    return elements


def _row(slot: int, account: AccountView) -> list[types.DisplayElement]:
    y = FIRST_ROW_Y + slot * ROW_PITCH
    if not account.eligible:
        color = DIM_COLOR
    elif account.active:
        color = MARKER_COLOR
    else:
        color = TEXT_COLOR
    five_reset = account.five_hour.resets_in
    week_reset = account.seven_day.resets_in
    elements: list[types.DisplayElement] = [
        _back_text(
            f"row-{slot}-name",
            fit_text(account.label, "small", NAME_WIDTH),
            "small",
            y,
            color,
            x=NAME_X,
        ),
        _back_text(
            f"row-{slot}-five",
            format_used(account.five_hour),
            "small",
            y,
            color,
            x=FIVE_HOUR_RIGHT,
            align="top_right",
        ),
        _back_text(
            f"row-{slot}-week",
            format_used(account.seven_day),
            "small",
            y,
            color,
            x=SEVEN_DAY_RIGHT,
            align="top_right",
        ),
    ]
    if account.active:
        elements.append(_back_text(f"row-{slot}-marker", ">", "small", y, color))
    if five_reset is not None:
        elements.append(
            _back_text(
                f"row-{slot}-five-reset",
                format_duration(five_reset),
                "small",
                y,
                DIM_COLOR,
                x=FIVE_HOUR_RESET_X,
            )
        )
    if week_reset is not None:
        elements.append(
            _back_text(
                f"row-{slot}-week-reset",
                format_duration(week_reset),
                "small",
                y,
                DIM_COLOR,
                x=BACK_DISPLAY.width - 1,
                align="top_right",
            )
        )
    return elements


def _unavailable(failure: PollFailure | None, root: Path) -> list[types.DisplayElement]:
    if failure is None:
        headline, summary = "LIMITS", "reading..."
        lines = ["Reading the rotation files"]
    elif isinstance(failure.error, RotationNotSetUpError):
        headline, summary = "NO ROTATION", "not set up"
        # The folder rarely fits on one line, so its name gets its own.
        lines = [
            "conductor-claude-rotation has no",
            "config.json in",
            f"{root.parent}/",
            root.name,
        ]
    else:
        headline, summary = "LIMITS ?", "unreadable"
        lines = ["Cannot read the rotation files:", str(failure.error)]
    color = LEVEL_COLORS["unknown"]
    return [
        _front_text("headline", headline, "small", 0, color),
        _front_text("summary", summary, "tiny", SUMMARY_Y, color),
        *(
            _back_text(
                f"line-{index}",
                fit_text(to_bar_text(line), "small", BACK_DISPLAY.width),
                "small",
                index * ROW_PITCH,
            )
            for index, line in enumerate(lines)
        ),
    ]


def _front_text(
    element_id: str, text: str, font: types.DisplayFontName, y: int, color: str
) -> types.TextElement:
    return types.TextElement(
        id=element_id, display=FRONT, text=text, font=font, color=color, x=0, y=y
    )


def _back_text(  # noqa: PLR0913 - keyword-only placement after the basics.
    element_id: str,
    text: str,
    font: types.DisplayFontName,
    y: int,
    color: str = TEXT_COLOR,
    *,
    x: int = 0,
    align: Align = "top_left",
) -> types.TextElement:
    return types.TextElement(
        id=element_id,
        display=BACK,
        text=text,
        font=font,
        color=color,
        align=align,
        x=x,
        y=y,
    )


def _rectangle(  # noqa: PLR0913 - keyword-only size and colour.
    element_id: str, x: int, y: int, *, width: int, height: int, color: str
) -> types.RectangleElement:
    return types.RectangleElement(
        id=element_id,
        display=FRONT,
        x=x,
        y=y,
        width=width,
        height=height,
        fill="solid",
        fill_colors=[color],
        border_width=0,
    )
