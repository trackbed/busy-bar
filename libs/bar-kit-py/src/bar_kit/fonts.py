"""Glyph widths of the bar's fonts, for laying out text.

The fonts are proportional bitmaps, so a layout that has to fit measures its
text. The widths below are the advances of printable ASCII, the only characters
the fonts draw, copied from the font maps busy-lib ships
(`@busy-app/busy-lib/fonts`), which the TypeScript kit's `textWidth` reads.
Both kits test their widths against `bar-kit-text-widths.json` at the
workspace root; when busy-lib's maps change, update that file and this table
together.
"""

from collections.abc import Iterable

from busylib import types

from bar_kit.display import BACK_DISPLAY, FRONT_DISPLAY

ELLIPSIS = ".."
"""What `fit_text` puts after text it cuts short: the fonts have no `…`."""

# Advance width in pixels -> the printable ASCII characters that have it.
_WIDTH_GROUPS: dict[str, dict[int, str]] = {
    "tiny": {
        2: "!',.:;ijl|",
        3: " ()[]`fgr",
        4: '"$*+-0123456789<=>?@ABCDEFGHIJLPRSTX^_abcdehknopqstuvxyz{}',
        5: "%&/KNOQUZ\\~",
        6: "#MVWYmw",
    },
    "small": {
        2: " !',.:Iil|",
        3: "()-/1;[\\]fjrt",
        4: '"$*+023456789<=>?JLTVXYZ^_`abcdeghknopqsuvxyz{}',
        5: "%&@ABCDEFGHKNOPQRSU~",
        6: "#MWmw",
    },
    "normal": {
        2: "':",
        3: "!(),;[]|",
        4: '"*-.<>Iijlr{}',
        5: " /JL\\_`abcdefghknopqstuyz",
        6: "#$+0123456789=?ABCDEFGHKNOPQRSTUVXYZ^mvwx~",
        7: "&",
        8: "%@MW",
    },
    "condensed": {
        2: "':",
        3: "!(),;[]|",
        4: '"*-.<>Iijlr{}',
        5: " /0123456789JL\\_`abcdefghknopqstuyz",
        6: "#$+=?ABCDEFGHKNOPQRSTUVXYZ^mvwx~",
        7: "&",
        8: "%@MW",
    },
    "bold": {
        2: "':",
        3: ",;",
        4: '!"()*-.[]|',
        5: " <>I_`ijlr{}",
        6: "/EFJL\\abcdefghknopqstuyz~",
        7: "+0123456789=?ABCDGHKOPQRSTUXYZ^vx",
        8: "#&NVmw",
        9: "$%",
        10: "@M",
        11: "W",
    },
    "large": {
        2: "':|",
        3: "!,;[]",
        4: '"()-.Iijl{}',
        5: "1<>frt",
        6: " *+/=?\\^_`abcdeghknopqsuvxyz",
        7: "023456789BCEFJKLPRSZ",
        8: "$ADGHNOQTUVXYm~",
        9: "#&",
        10: "%@MWw",
    },
    "extra_large": {
        3: "!',.:;|",
        4: " -[]",
        5: "()1<>I_`i",
        6: '"/\\{}',
        7: "*+=?EFJLTZefjltz",
        8: "023456789ABCDGHKNOPQRSUXY^abcdghknopqrsuxy~",
        9: "$MVWmvw",
        10: "#&",
        11: "%",
        12: "@",
    },
    "global": {
        2: "!',.:;Iil|",
        3: " ()[]`j",
        4: '"*1<>^ftv{}',
        5: "-/47=?EFJLPRY\\_bcdeghknopqrsuxyz",
        6: "$%&+0235689ABCDGHKNOQSTUVXZaw~",
        7: "#@",
        8: "MWm",
    },
    "superscript": {
        2: "':",
        3: "!(),;[]|",
        4: '"*-.0123456789<>Iijlr{}',
        5: " /JL\\_`abcdefghknopqstuyz",
        6: "#$+=?ABCDEFGHKNOPQRSTUVXYZ^mvwx~",
        7: "&",
        8: "%@MW",
    },
}

_ADVANCES: dict[str, dict[str, int]] = {
    font: {char: width for width, chars in groups.items() for char in chars}
    for font, groups in _WIDTH_GROUPS.items()
}


def text_width(text: str, font: types.DisplayFontName) -> int:
    """How many pixels wide `text` is in `font`.

    Pass text through `to_bar_text` first: a character outside printable ASCII
    is not drawn, so it raises `ValueError`.
    """
    advances = _ADVANCES[font]
    try:
        return sum(advances[char] for char in text)
    except KeyError as error:
        message = f"{error.args[0]!r} is not printable ASCII; use to_bar_text first."
        raise ValueError(message) from error


def fit_text(text: str, font: types.DisplayFontName, width: int) -> str:
    """`text` if it fits in `width` pixels, otherwise cut short with `..`.

    Returns an empty string when not even the `..` fits.
    """
    if text_width(text, font) <= width:
        return text
    room = width - text_width(ELLIPSIS, font)
    if room < 0:
        return ""
    cut = text
    while cut and text_width(cut, font) > room:
        cut = cut[:-1]
    return cut.rstrip() + ELLIPSIS


def overflowing_text(
    elements: Iterable[types.DisplayElement],
) -> list[types.TextElement]:
    """The text elements that run past the left or right edge of their display.

    They are placed the way the bar places them: a label is as wide as its
    `width`, or as its text without one, and `align` says whether `x` is its
    left edge, its middle, or the column just past its right edge. Tests check
    layouts with it; the TypeScript kit's `overflowingText` gives the same
    answer.
    """
    return [
        element
        for element in elements
        if isinstance(element, types.TextElement) and not _fits_display(element)
    ]


def _fits_display(element: types.TextElement) -> bool:
    display = (
        BACK_DISPLAY if element.display == types.DisplayName.BACK else FRONT_DISPLAY
    )
    width = (
        element.width
        if element.width is not None
        else text_width(element.text, element.font)
    )
    align = element.align or "top_left"
    if align.endswith("left"):
        left = element.x
    elif align.endswith("right"):
        left = element.x - width
    else:
        left = element.x - width // 2
    return left >= 0 and left + width <= display.width
