"""Glyph widths of the bar's fonts, for laying out text.

The fonts are proportional bitmaps, so a layout that has to fit measures its
text. The widths below are the advances of printable ASCII, the only characters
the fonts draw, measured from the font maps busy-lib 0.21.1 ships
(`@busy-app/busy-lib/fonts`). The TypeScript kit's `textWidth` reads the same
maps.
"""

from busylib import types

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
