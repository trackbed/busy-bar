import pytest
from busylib import types

from bar_kit import ELLIPSIS, fit_text, text_width


# The TypeScript kit's tests expect the same widths.
@pytest.mark.parametrize(
    ("text", "font", "width"),
    [
        ("3 NEED YOU", "small", 42),
        ("quebec done 4m", "tiny", 56),
        ("Hello, World!", "normal", 61),
        ("09:05", "extra_large", 35),
        ("", "small", 0),
    ],
)
def test_measures_text(text: str, font: types.DisplayFontName, width: int) -> None:
    assert text_width(text, font) == width


def test_refuses_characters_the_fonts_cannot_draw() -> None:
    with pytest.raises(ValueError, match="use to_bar_text first"):
        text_width("Nørreport", "small")


def test_keeps_text_that_fits() -> None:
    assert fit_text("quebec", "small", 72) == "quebec"


def test_cuts_text_that_does_not_fit_and_marks_the_cut() -> None:
    fitted = fit_text("kuala-lumpur kramme-busy-bar-apps", "small", 72)

    assert fitted == "kuala-lumpur kram.."
    assert text_width(fitted, "small") <= 72


def test_drops_a_trailing_space_before_the_marker() -> None:
    assert fit_text("ab cd", "small", 14) == f"ab{ELLIPSIS}"


def test_returns_nothing_when_even_the_marker_does_not_fit() -> None:
    assert fit_text("hello", "small", 3) == ""
