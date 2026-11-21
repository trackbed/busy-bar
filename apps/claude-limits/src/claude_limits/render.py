"""What the limits board draws."""

from datetime import datetime, timedelta
from pathlib import Path

from bar_kit import (
    BACK_DISPLAY,
    FOOTER_Y,
    FRONT_DISPLAY,
    PALETTE,
    SUMMARY_Y,
    DisplayElement,
    DisplayName,
    PollFailure,
    Snapshot,
    fit_text,
    rgba,
    solid_rectangle,
    text_element,
    to_bar_text,
)
from claude_limits.board import AccountView, Board, Level, Usage, board_at
from claude_limits.rotation import Rotation, RotationNotSetUpError

LEVEL_COLORS: dict[Level, str] = {
    "ok": PALETTE.good,
    "high": PALETTE.warn,
    "limit": PALETTE.bad,
    "unknown": PALETTE.idle,
}
TRACK_COLOR = rgba(35, 35, 35)

FRONT = DisplayName.FRONT
BACK = DisplayName.BACK

# Front: the active account in text on the left, one pair of bars per account
# on the right: the five-hour window (2 px) over the weekly one (1 px).
BARS_X = 52
BARS_WIDTH = FRONT_DISPLAY.width - BARS_X
ACCOUNT_PITCH = 4
MAX_FRONT_ACCOUNTS = FRONT_DISPLAY.height // ACCOUNT_PITCH
TEXT_WIDTH = BARS_X - 3

# Back: a header, then one account per row, then a footer.
FIRST_ROW_Y = 12
ROW_PITCH = 11
MAX_BACK_ACCOUNTS = (FOOTER_Y - FIRST_ROW_Y) // ROW_PITCH
NAME_X = 6
NAME_WIDTH = 38
FIVE_HOUR_RIGHT = 70
FIVE_HOUR_RESET_X = 74
SEVEN_DAY_RIGHT = 128

STALE_AFTER = timedelta(minutes=5)
"""How long the files may stay unreadable before the board says so."""


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
) -> list[DisplayElement]:
    """Draw the latest reading, or why there is none."""
    if latest is None:
        return _unavailable(failure, root)
    board = board_at(latest.value, now)
    stale = failure is not None and now - latest.at > STALE_AFTER
    return [*_front(board), *_back(board, stale=stale, updated=now - latest.at)]


def _front(board: Board) -> list[DisplayElement]:
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
    elements: list[DisplayElement] = [
        text_element(
            element_id="headline",
            text=fit_text(headline, "small", TEXT_WIDTH),
            display=FRONT,
            font="small",
            x=0,
            y=0,
            color=color,
        ),
        text_element(
            element_id="summary",
            text=fit_text(summary, "tiny", TEXT_WIDTH),
            display=FRONT,
            font="tiny",
            x=0,
            y=SUMMARY_Y,
            color=color,
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


def _bars(slot: int, account: AccountView) -> list[DisplayElement]:
    y = slot * ACCOUNT_PITCH
    elements: list[DisplayElement] = []
    if account.active:
        elements.append(
            solid_rectangle(
                element_id=f"marker-{slot}",
                display=FRONT,
                x=BARS_X - 2,
                y=y,
                width=1,
                height=3,
                color=PALETTE.bright,
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
                solid_rectangle(
                    element_id=f"{name}-{slot}-used",
                    display=FRONT,
                    x=BARS_X,
                    y=y + offset,
                    width=filled,
                    height=height,
                    color=color,
                )
            )
        if filled < BARS_WIDTH:
            elements.append(
                solid_rectangle(
                    element_id=f"{name}-{slot}-free",
                    display=FRONT,
                    x=BARS_X + filled,
                    y=y + offset,
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


def _back(board: Board, *, stale: bool, updated: timedelta) -> list[DisplayElement]:
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
    elements: list[DisplayElement] = [
        text_element(
            element_id="header",
            text=fit_text(header, "small", BACK_DISPLAY.width),
            display=BACK,
            font="small",
            x=0,
            y=0,
        ),
        text_element(
            element_id="footer",
            text=footer,
            display=BACK,
            font="tiny",
            x=0,
            y=FOOTER_Y,
            color=PALETTE.dim,
        ),
    ]
    for slot, account in enumerate(board.accounts[:MAX_BACK_ACCOUNTS]):
        elements += _row(slot, account)
    return elements


def _row(slot: int, account: AccountView) -> list[DisplayElement]:
    y = FIRST_ROW_Y + slot * ROW_PITCH
    if not account.eligible:
        color = PALETTE.dim
    elif account.active:
        color = PALETTE.bright
    else:
        color = PALETTE.text
    five_reset = account.five_hour.resets_in
    week_reset = account.seven_day.resets_in
    elements: list[DisplayElement] = [
        text_element(
            element_id=f"row-{slot}-name",
            text=fit_text(account.label, "small", NAME_WIDTH),
            display=BACK,
            font="small",
            x=NAME_X,
            y=y,
            color=color,
        ),
        text_element(
            element_id=f"row-{slot}-five",
            text=format_used(account.five_hour),
            display=BACK,
            font="small",
            x=FIVE_HOUR_RIGHT,
            y=y,
            color=color,
            align="top_right",
        ),
        text_element(
            element_id=f"row-{slot}-week",
            text=format_used(account.seven_day),
            display=BACK,
            font="small",
            x=SEVEN_DAY_RIGHT,
            y=y,
            color=color,
            align="top_right",
        ),
    ]
    if account.active:
        elements.append(
            text_element(
                element_id=f"row-{slot}-marker",
                text=">",
                display=BACK,
                font="small",
                x=0,
                y=y,
                color=color,
            )
        )
    if five_reset is not None:
        elements.append(
            text_element(
                element_id=f"row-{slot}-five-reset",
                text=format_duration(five_reset),
                display=BACK,
                font="small",
                x=FIVE_HOUR_RESET_X,
                y=y,
                color=PALETTE.dim,
            )
        )
    if week_reset is not None:
        elements.append(
            text_element(
                element_id=f"row-{slot}-week-reset",
                text=format_duration(week_reset),
                display=BACK,
                font="small",
                x=BACK_DISPLAY.width - 1,
                y=y,
                color=PALETTE.dim,
                align="top_right",
            )
        )
    return elements


def _unavailable(failure: PollFailure | None, root: Path) -> list[DisplayElement]:
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
        text_element(
            element_id="headline",
            text=headline,
            display=FRONT,
            font="small",
            x=0,
            y=0,
            color=color,
        ),
        text_element(
            element_id="summary",
            text=summary,
            display=FRONT,
            font="tiny",
            x=0,
            y=SUMMARY_Y,
            color=color,
        ),
        *(
            text_element(
                element_id=f"line-{index}",
                text=fit_text(to_bar_text(line), "small", BACK_DISPLAY.width),
                display=BACK,
                font="small",
                x=0,
                y=index * ROW_PITCH,
            )
            for index, line in enumerate(lines)
        ),
    ]
