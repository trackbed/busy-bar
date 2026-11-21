"""Element builders, the shared palette, and the standard line positions.

The Python counterpart of the TypeScript kit's `elements.ts`: the same
builders give the same elements, and the palette the same colours.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from busylib.types import (
    CountdownElement,
    DisplayElement,
    DisplayFontName,
    DisplayName,
    RectangleElement,
    TextElement,
)

from bar_kit.display import BACK_DISPLAY, FRONT_DISPLAY, rgba

type TextAlign = Literal[
    "top_left",
    "top_mid",
    "top_right",
    "mid_left",
    "center",
    "mid_right",
    "bottom_left",
    "bottom_mid",
    "bottom_right",
]
"""Which point of a text element `x` and `y` place."""


@dataclass(frozen=True, slots=True)
class Palette:
    """One colour per role, shared by every app.

    The back display shows 16 levels of grey (a channel's top four bits), so
    the greys sit on distinct levels: `bright` 15, `text` 12, `dim` 7, and
    `idle` 6.
    """

    bright: str
    """Highlighted text: the selected row, a title. White, the bar's default."""
    text: str
    """Body text."""
    dim: str
    """Secondary text: headers, footers, hints."""
    idle: str
    """Nothing to report: no data yet, nothing open, a source unavailable."""
    good: str
    """All is well: free, live, passing, plenty."""
    warn: str
    """Needs attention soon: pending, low, paused, a knock."""
    bad: str
    """Needs you now: failing, empty, busy, at the limit."""
    info: str
    """Neutral news: queued, resting, rain, a focus session."""


PALETTE = Palette(
    bright=rgba(255, 255, 255),
    text=rgba(200, 200, 200),
    dim=rgba(120, 120, 120),
    idle=rgba(110, 110, 110),
    good=rgba(0, 200, 90),
    warn=rgba(255, 170, 0),
    bad=rgba(255, 60, 60),
    info=rgba(60, 130, 255),
)

SUMMARY_Y = 9
"""The front display's summary line: `tiny` text (rows 9-14) under a `small`
headline at y 0."""

FOOTER_Y = BACK_DISPLAY.height - 7
"""The back display's footer line: `tiny` text on its last seven rows."""


def text_element(  # noqa: PLR0913 - keyword-only, one per property of a text element.
    *,
    element_id: str,
    text: str,
    display: DisplayName,
    font: DisplayFontName,
    x: int,
    y: int,
    color: str = PALETTE.text,
    align: TextAlign | None = None,
) -> TextElement:
    """A text element, placed by name so `x` and `y` cannot swap.

    Leave `align` out for `top_left`, the bar's default.
    """
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


def solid_rectangle(  # noqa: PLR0913 - keyword-only, one per property of a rectangle.
    *,
    element_id: str,
    display: DisplayName,
    x: int,
    y: int,
    width: int,
    height: int,
    color: str,
) -> RectangleElement:
    """A rectangle filled with one colour, without a border."""
    return RectangleElement(
        id=element_id,
        display=display,
        x=x,
        y=y,
        width=width,
        height=height,
        fill="solid",
        fill_colors=[color],
        border_width=0,
    )


def status_cells(
    colors: Sequence[str], *, pitch: int, width: int
) -> list[RectangleElement]:
    """One cell per colour along the front display's bottom row, from the left.

    Their IDs are `cell-0`, `cell-1`, and so on; `pitch` is the columns from
    one cell's left edge to the next, and `width` the columns each fills. Pass
    only the colours that fit: `FRONT_DISPLAY.width // pitch` of them.
    """
    return [
        solid_rectangle(
            element_id=f"cell-{index}",
            display=DisplayName.FRONT,
            x=index * pitch,
            y=FRONT_DISPLAY.height - 1,
            width=width,
            height=1,
            color=color,
        )
        for index, color in enumerate(colors)
    ]


def elements_by_id(elements: Iterable[DisplayElement]) -> dict[str, DisplayElement]:
    """A frame's elements keyed by ID, for render tests to look them up."""
    return {element.id: element for element in elements}


def text_of(elements: Mapping[str, DisplayElement], element_id: str) -> str | None:
    """What the text element `element_id` says; None without one."""
    element = elements.get(element_id)
    return element.text if isinstance(element, TextElement) else None


def color_of(elements: Mapping[str, DisplayElement], element_id: str) -> str | None:
    """The colour of the text or countdown element `element_id`; None without one."""
    element = elements.get(element_id)
    if isinstance(element, TextElement | CountdownElement) and isinstance(
        element.color, str
    ):
        return element.color
    return None
