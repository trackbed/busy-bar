"""Text the bar's bitmap fonts can draw."""

import re
import unicodedata

# Letters and punctuation that Unicode normalization cannot reduce to ASCII,
# and the backtick, which most of the bar's fonts lack. Danish letters follow
# the Danish convention, so `Århus` becomes `Aarhus`.
_REPLACEMENTS = {
    "`": "'",
    "æ": "ae",
    "Æ": "AE",
    "ø": "oe",
    "Ø": "OE",
    "å": "aa",
    "Å": "AA",
    "ß": "ss",
    "œ": "oe",
    "Œ": "OE",
    "đ": "d",
    "Đ": "D",
    "ł": "l",
    "Ł": "L",
    "\N{LEFT SINGLE QUOTATION MARK}": "'",
    "\N{RIGHT SINGLE QUOTATION MARK}": "'",
    "\N{LEFT DOUBLE QUOTATION MARK}": '"',
    "\N{RIGHT DOUBLE QUOTATION MARK}": '"',
    "\N{DOUBLE LOW-9 QUOTATION MARK}": '"',
    "\N{LEFT-POINTING DOUBLE ANGLE QUOTATION MARK}": '"',
    "\N{RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK}": '"',
    "\N{HYPHEN}": "-",
    "\N{EN DASH}": "-",
    "\N{EM DASH}": "-",
    "\N{MINUS SIGN}": "-",
    "\N{HORIZONTAL ELLIPSIS}": "...",
    "\N{BULLET}": "*",
}

# Unicode's White_Space property, spelled out so both kits match the same
# characters: each language's `\s` differs from it, and from the other's.
_WHITESPACE = re.compile(
    r"[\t-\r \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+"
)
_SPACES = re.compile(r" {2,}")


def to_bar_text(text: str) -> str:
    """Turn any text into what the bar's bitmap fonts can draw.

    The result is printable ASCII without the backtick. Known letters and
    punctuation are spelled out, accents are dropped, runs of whitespace become
    one space, and anything else (emoji, CJK, control and format characters)
    disappears. Both kits test their results against `bar-kit-contract.json`,
    so the TypeScript kit's `toBarText` gives the same.
    """
    chars = list(unicodedata.normalize("NFC", text))
    spelled = "".join(
        _spell(char, chars[index + 1] if index + 1 < len(chars) else None)
        for index, char in enumerate(chars)
    )
    decomposed = unicodedata.normalize("NFKD", spelled)
    unmarked = "".join(
        char for char in decomposed if not unicodedata.category(char).startswith("M")
    )
    spaced = _WHITESPACE.sub(" ", unmarked)
    printable = "".join(char for char in spaced if " " <= char <= "~")
    return _SPACES.sub(" ", printable).strip()


def _spell(char: str, following: str | None) -> str:
    """Spell out one character.

    A capital spelled with two letters keeps the case of the word around it:
    `Århus` becomes `Aarhus`, and `ÅRHUS` becomes `AARHUS`.
    """
    replacement = _REPLACEMENTS.get(char)
    if replacement is None:
        return char
    in_lowercase_word = (
        following is not None and following != following.upper() and char.isupper()
    )
    if in_lowercase_word:
        return replacement[0] + replacement[1:].lower()
    return replacement
