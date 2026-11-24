"""Draw the Showtime workspace board and the selected workspace's review."""

from datetime import datetime, timedelta

from agent_fleet.render import format_age
from agent_fleet.showtime import PHASES, STALE, Board, Review, Showtime, Workspace
from bar_kit import (
    BACK_DISPLAY,
    FOOTER_Y,
    FRONT_DISPLAY,
    PALETTE,
    DisplayElement,
    DisplayFontName,
    DisplayName,
    fit_text,
    rgba,
    solid_rectangle,
    text_element,
    text_width,
    to_bar_text,
)

BACK = DisplayName.BACK
FRONT = DisplayName.FRONT
INK = rgba(0, 0, 0)
RULE = rgba(80, 80, 80)
VISIBLE = 5
BADGE_TEXT_WIDTH = 18
MAX_BADGE_COUNT = 999

GROUP_FOCUS = (
    ("needs_me", "NEED ME", PALETTE.warn),
    ("merge_ready", "READY", PALETTE.good),
    ("working", "WORKING", PALETTE.info),
    ("nudge", "TO NUDGE", PALETTE.info),
)
PHASE_COLORS = {
    "review": PALETTE.info,
    "fixing": PALETTE.warn,
    "verify": PALETTE.info,
    "done": PALETTE.good,
    "blocked": PALETTE.bad,
}


def _label(  # noqa: PLR0913 - position, font and colour describe the fitted text.
    key: str,
    value: str,
    x: int,
    y: int,
    *,
    width: int | None = None,
    font: DisplayFontName = "small",
    color: str = PALETTE.text,
    display: DisplayName = BACK,
) -> DisplayElement:
    screen = BACK_DISPLAY if display == BACK else FRONT_DISPLAY
    return text_element(
        element_id=key,
        text=fit_text(
            to_bar_text(value), font, screen.width - x if width is None else width
        ),
        display=display,
        x=x,
        y=y,
        font=font,
        color=color,
    )


def _signal(
    badge: str, caption: str, headline: str, color: str
) -> list[DisplayElement]:
    font: DisplayFontName = (
        "extra_large"
        if text_width(badge, "extra_large") <= BADGE_TEXT_WIDTH
        else "small"
    )
    width = max(18, text_width(badge, font) + 4)
    return [
        solid_rectangle(
            element_id="signal",
            display=FRONT,
            x=0,
            y=0,
            width=width,
            height=16,
            color=color,
        ),
        text_element(
            element_id="badge",
            text=badge,
            display=FRONT,
            x=width // 2,
            y=8,
            align="center",
            font=font,
            color=INK,
        ),
        _label(
            "caption", caption, width + 3, 0, font="tiny", color=color, display=FRONT
        ),
        _label(
            "headline",
            headline,
            width + 3,
            7,
            font="small",
            color=PALETTE.bright,
            display=FRONT,
        ),
    ]


def _badge(count: int) -> str:
    return str(count) if count <= MAX_BADGE_COUNT else f"{MAX_BADGE_COUNT}+"


def _header(mode: str, scope: str) -> list[DisplayElement]:
    return [
        _label("mode", mode, 2, 1, font="small", color=PALETTE.bright),
        _label("header", scope, 49, 3, font="tiny"),
        solid_rectangle(
            element_id="header-rule",
            display=BACK,
            x=0,
            y=11,
            width=BACK_DISPLAY.width,
            height=1,
            color=RULE,
        ),
    ]


def _age(label: str, delta: timedelta, failed: bool) -> str:
    return f"{'Read failed / ' if failed else ''}{label} {format_age(delta)}"


def _footer(value: str) -> DisplayElement:
    return _label("footer", value, 2, FOOTER_Y, font="tiny", color=PALETTE.dim)


def _board_signal(board: Board, age: timedelta) -> list[DisplayElement]:
    if age >= STALE:
        return _signal("!", "SHOWTIME", "STALE", PALETTE.warn)
    for group, label, color in GROUP_FOCUS:
        count = sum(row.group == group for row in board.rows)
        if count:
            headline = "NEEDS ME" if count == 1 and group == "needs_me" else label
            return _signal(_badge(count), "SHOWTIME", headline, color)
    return _signal("-", "SHOWTIME", "CLEAR", PALETTE.idle)


def _board_rows(board: Board, index: int, seen: set[Workspace]) -> list[DisplayElement]:
    if not board.rows:
        return [_label("empty", "No workspaces", 3, 32, font="large")]
    start = max(0, min(index - VISIBLE // 2, len(board.rows) - VISIBLE))
    elements: list[DisplayElement] = []
    y = 14
    for slot, row in enumerate(board.rows[start : start + VISIBLE]):
        selected = slot + start == index
        if selected:
            elements.append(
                solid_rectangle(
                    element_id="selection",
                    display=BACK,
                    x=0,
                    y=y,
                    width=BACK_DISPLAY.width,
                    height=20,
                    color=PALETTE.text,
                )
            )
        color = INK if selected else PALETTE.text
        name = row.name if row not in seen else f"* {row.name}"
        elements.extend(
            [
                _label(
                    f"row-{slot}",
                    name,
                    3,
                    y,
                    width=145 if selected else 59,
                    font="bold" if selected else "small",
                    color=color,
                ),
                _label(
                    f"reason-{slot}",
                    row.reason,
                    3 if selected else 65,
                    y + 12 if selected else y,
                    font="tiny" if selected else "small",
                    color=color,
                ),
            ]
        )
        y += 21 if selected else 9
    return elements


def _review_frame(
    now: datetime, workspace: Workspace, review: Review, *, failed: bool
) -> list[DisplayElement]:
    age = now - review.at
    phase = PHASES[review.phase]
    historical = (
        age >= STALE or workspace.group != "working"
    ) and review.phase not in ("done", "blocked")
    headline = "LAST REVIEW" if historical else phase
    color = PALETTE.idle if historical else PHASE_COLORS[review.phase]
    return [
        *_signal(_badge(review.round), "ROUND", headline, color),
        *_header("REVIEW", workspace.name),
        _label(
            "work-item", review.work_item, 2, 14, font="large", color=PALETTE.bright
        ),
        *_phase_strip(review.phase),
        _label("round", f"Round {review.round}", 2, 46, width=65),
        _label("cycles", f"Fix cycles: {review.cycles}", 71, 46),
        _label("gate", f"Last gate: {review.gate or '-'}", 2, 58),
        _footer(_age("Updated", age, failed)),
    ]


def _phase_strip(phase: str) -> list[DisplayElement]:
    if phase in ("done", "blocked"):
        return [
            solid_rectangle(
                element_id="outcome-band",
                display=BACK,
                x=0,
                y=30,
                width=BACK_DISPLAY.width,
                height=12,
                color=PALETTE.text,
            ),
            _label("outcome", PHASES[phase], 3, 30, font="bold", color=INK),
        ]
    elements: list[DisplayElement] = [
        solid_rectangle(
            element_id="phase-link",
            display=BACK,
            x=3,
            y=35,
            width=140,
            height=1,
            color=RULE,
        )
    ]
    for i, (key, label) in enumerate(
        (("review", "REVIEW"), ("fixing", "FIX"), ("verify", "VERIFY"))
    ):
        x = i * 50
        active = key == phase
        elements.extend(
            [
                solid_rectangle(
                    element_id=f"phase-rail-{key}",
                    display=BACK,
                    x=x,
                    y=30,
                    width=47,
                    height=12,
                    color=PALETTE.bright if active else rgba(40, 40, 40),
                ),
                _label(
                    f"phase-{key}",
                    label,
                    x + (47 - text_width(label, "small")) // 2,
                    31,
                    color=INK if active else PALETTE.text,
                ),
            ]
        )
    return elements


def render_showtime(now: datetime, view: Showtime) -> list[DisplayElement]:
    if view.detail and (selected := view.selected):
        if view.review:
            return _review_frame(now, selected, view.review, failed=view.review_failed)
        return [
            *_signal("?", "REVIEW", "NO REVIEW", PALETTE.idle),
            *_header("REVIEW", selected.name),
            _label("empty", "No review snapshot", 3, 32, font="normal"),
            _footer("START to return"),
        ]
    board = view.board
    if board is None:
        return [
            *_signal("?", "SHOWTIME", "NO DATA", PALETTE.idle),
            *_header("SHOWTIME", ""),
            _label("empty", "Run Showtime to refresh", 3, 32),
            _footer("Snapshot unavailable" if view.failed else "Waiting for snapshot"),
        ]
    age = now - board.at
    return [
        *_board_signal(board, age),
        *_header("SHOWTIME", board.scope),
        *_board_rows(board, view.index, view.seen),
        _footer(_age("Checked", age, view.failed)),
    ]
