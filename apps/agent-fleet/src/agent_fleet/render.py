"""What the fleet board draws."""

from datetime import datetime, timedelta
from typing import Literal

from agent_fleet.fleet import NEEDS_YOU, FleetView, Row, Status
from bar_kit import (
    BACK_DISPLAY,
    FRONT_DISPLAY,
    DisplayElement,
    DisplayFontName,
    DisplayName,
    RectangleElement,
    TextElement,
    fit_text,
    rgba,
    text_width,
)

STATUS_COLORS: dict[Status, str] = {
    "asking": rgba(255, 60, 60),
    "failed": rgba(200, 80, 255),
    "done": rgba(255, 170, 0),
    "working": rgba(0, 200, 90),
    "quiet": rgba(160, 160, 0),
    "background": rgba(60, 130, 255),
    "seen": rgba(90, 90, 90),
}
IDLE_COLOR = rgba(90, 90, 90)

# The back display shows 16 levels of grey.
BRIGHT = rgba(255, 255, 255)
LIGHT = rgba(200, 200, 200)
DIM = rgba(130, 130, 130)
FAINT = rgba(80, 80, 80)

FRONT = DisplayName.FRONT
BACK = DisplayName.BACK

# Front: a headline in `small` (rows 0-8), a summary in `tiny` (rows 9-14),
# and one cell per session on the bottom row.
SUMMARY_Y = 9
CELL_WIDTH = 3
CELL_PITCH = 4
MAX_CELLS = FRONT_DISPLAY.width // CELL_PITCH

# Back: a header, then one session per 10 px row in three columns.
ROW_PITCH = 10
FIRST_ROW_Y = 11
VISIBLE_ROWS = (BACK_DISPLAY.height - FIRST_ROW_Y) // ROW_PITCH
NAME_X = 6
DETAIL_X = 66
AGE_WIDTH = 18
COLUMN_GAP = 4
SUMMARY_GAP = 2

_MINUTE = timedelta(minutes=1)
_HOUR = timedelta(hours=1)
_DAY = timedelta(days=1)

type Align = Literal["top_left", "top_right"]

# What the headline says when nothing needs you, in order of preference.
_CALM_HEADLINES: tuple[tuple[Status, str], ...] = (
    ("working", "WORKING"),
    ("quiet", "QUIET"),
    ("background", "WAITING"),
)


def format_age(age: timedelta) -> str:
    """`now`, then whole minutes, hours, or days."""
    if age < _MINUTE:
        return "now"
    if age < _HOUR:
        return f"{age // _MINUTE}m"
    if age < _DAY:
        return f"{age // _HOUR}h"
    return f"{age // _DAY}d"


def render(_now: datetime, view: FleetView, *, listening: str) -> list[DisplayElement]:
    """Draw the most urgent session in front and the whole list behind.

    `listening` is the `host:port` the hook endpoint serves, shown until the
    first session reports in.
    """
    return [*_front(view), *_back(view, listening)]


def _front(view: FleetView) -> list[DisplayElement]:
    headline, color = _headline(view)
    elements: list[DisplayElement] = [
        _text("headline", headline, display=FRONT, font="small", y=0, color=color)
    ]
    if view.rows:
        top = view.rows[0]
        age = format_age(top.age)
        room = FRONT_DISPLAY.width - text_width(age, "tiny") - SUMMARY_GAP
        summary = fit_text(f"{top.workspace} {top.detail}", "tiny", room)
        color = STATUS_COLORS[top.status]
        elements += [
            _text(
                "summary", summary, display=FRONT, font="tiny", y=SUMMARY_Y, color=color
            ),
            _text(
                "age",
                age,
                display=FRONT,
                font="tiny",
                # Right-aligned text anchors on the last pixel column.
                x=FRONT_DISPLAY.width - 1,
                y=SUMMARY_Y,
                color=color,
                align="top_right",
            ),
        ]
    else:
        elements.append(
            _text(
                "summary",
                "waiting for hooks",
                display=FRONT,
                font="tiny",
                y=SUMMARY_Y,
                color=IDLE_COLOR,
            )
        )
    elements += [
        RectangleElement(
            id=f"cell-{index}",
            display=FRONT,
            x=index * CELL_PITCH,
            y=FRONT_DISPLAY.height - 1,
            width=CELL_WIDTH,
            height=1,
            fill="solid",
            fill_colors=[STATUS_COLORS[row.status]],
            border_width=0,
        )
        for index, row in enumerate(view.rows[:MAX_CELLS])
    ]
    return elements


def _headline(view: FleetView) -> tuple[str, str]:
    if view.needs_you:
        return f"{view.needs_you} NEED YOU", STATUS_COLORS[view.rows[0].status]
    for status, word in _CALM_HEADLINES:
        if view.counts[status]:
            return f"{view.counts[status]} {word}", STATUS_COLORS[status]
    return ("ALL SEEN" if view.rows else "NO AGENTS"), IDLE_COLOR


def _back(view: FleetView, listening: str) -> list[DisplayElement]:
    if not view.rows:
        hint = fit_text(f"Hooks post to {listening}", "small", BACK_DISPLAY.width)
        return [
            _text("header", "No sessions yet", display=BACK, font="small", y=0),
            _text("hint", hint, display=BACK, font="small", y=FIRST_ROW_Y, color=DIM),
        ]

    count = len(view.rows)
    header = f"{view.needs_you} need you, {count} session{'' if count == 1 else 's'}"
    elements: list[DisplayElement] = [
        _text("header", header, display=BACK, font="small", y=0, color=BRIGHT)
    ]
    for slot, row in enumerate(_window(view.rows)):
        elements += _row(slot, row)
    return elements


def _window(rows: tuple[Row, ...]) -> tuple[Row, ...]:
    """The rows that fit, scrolled so the highlighted one is among them."""
    selected = next((index for index, row in enumerate(rows) if row.selected), 0)
    start = max(0, min(selected - VISIBLE_ROWS // 2, len(rows) - VISIBLE_ROWS))
    return rows[start : start + VISIBLE_ROWS]


def _row(slot: int, row: Row) -> list[DisplayElement]:
    y = FIRST_ROW_Y + slot * ROW_PITCH
    if row.selected:
        color = BRIGHT
    elif row.status == "seen":
        color = FAINT
    elif row.status in NEEDS_YOU:
        color = LIGHT
    else:
        color = DIM
    name = fit_text(row.workspace, "small", DETAIL_X - NAME_X - COLUMN_GAP)
    detail_room = BACK_DISPLAY.width - DETAIL_X - AGE_WIDTH - COLUMN_GAP
    elements: list[DisplayElement] = []
    if row.selected:
        elements.append(
            _text(
                f"row-{slot}-marker", ">", display=BACK, font="small", y=y, color=color
            )
        )
    elements += [
        _text(
            f"row-{slot}-name",
            name,
            display=BACK,
            font="small",
            x=NAME_X,
            y=y,
            color=color,
        ),
        _text(
            f"row-{slot}-detail",
            fit_text(row.detail, "small", detail_room),
            display=BACK,
            font="small",
            x=DETAIL_X,
            y=y,
            color=color,
        ),
        _text(
            f"row-{slot}-age",
            format_age(row.age),
            display=BACK,
            font="small",
            x=BACK_DISPLAY.width - 1,
            y=y,
            color=color,
            align="top_right",
        ),
    ]
    return elements


def _text(  # noqa: PLR0913 - keyword-only, one per property of a text element.
    element_id: str,
    text: str,
    *,
    display: DisplayName,
    font: DisplayFontName,
    y: int,
    x: int = 0,
    color: str = LIGHT,
    align: Align = "top_left",
) -> TextElement:
    return TextElement(
        id=element_id,
        display=display,
        text=text,
        font=font,
        color=color,
        align=align,
        x=x,
        y=y,
    )
