import json
from pathlib import Path
from typing import Literal, get_args

import pytest
from busylib import types

from bar_kit import ELLIPSIS, fit_text, overflowing_text, text_width

FONTS: tuple[types.DisplayFontName, ...] = get_args(types.DisplayFontName)
PRINTABLE = "".join(chr(code) for code in range(32, 127))


def _load_contract() -> tuple[dict[str, object], list[object]]:
    """The widths both kits must give; the TypeScript kit's tests read it too."""
    path = Path(__file__).resolve().parents[3] / "bar-kit-text-widths.json"
    contract: object = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(contract, dict):
        raise TypeError(f"{path.name} has an unexpected shape.")
    advances, samples = contract.get("advances"), contract.get("samples")
    if not isinstance(advances, dict) or not isinstance(samples, list):
        raise TypeError(f"{path.name} has an unexpected shape.")
    return advances, samples


ADVANCES, SAMPLES = _load_contract()


def _font(name: object) -> types.DisplayFontName:
    for font in FONTS:
        if font == name:
            return font
    message = f"Unknown font {name!r}."
    raise TypeError(message)


def _expected_advances(font: types.DisplayFontName) -> dict[str, int]:
    groups: object = ADVANCES.get(font)
    assert isinstance(groups, dict)
    return {
        character: int(width)
        for width, characters in groups.items()
        if isinstance(characters, str)
        for character in characters
    }


def _samples() -> list[tuple[str, types.DisplayFontName, int]]:
    samples = []
    for sample in SAMPLES:
        assert isinstance(sample, dict)
        text, width = sample["text"], sample["width"]
        assert isinstance(text, str)
        assert isinstance(width, int)
        samples.append((text, _font(sample["font"]), width))
    return samples


def test_measures_the_fonts_the_shared_table_lists() -> None:
    assert list(ADVANCES) == list(FONTS)


@pytest.mark.parametrize("font", FONTS)
def test_gives_every_printable_character_the_shared_advance(
    font: types.DisplayFontName,
) -> None:
    measured = {character: text_width(character, font) for character in PRINTABLE}

    assert measured == _expected_advances(font)


@pytest.mark.parametrize(("text", "font", "width"), _samples())
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


WIDTH = text_width("HELLO", "small")


type Align = Literal["top_right", "mid_right", "bottom_right", "center", "top_mid"]


def label(
    element_id: str,
    x: int,
    *,
    align: Align | None = None,
    display: types.DisplayName = types.DisplayName.FRONT,
    text: str = "HELLO",
) -> types.TextElement:
    return types.TextElement(
        id=element_id, text=text, font="small", x=x, align=align, display=display
    )


def test_keeps_left_aligned_text_that_ends_at_the_edge() -> None:
    assert overflowing_text([label("fits", 72 - WIDTH)]) == []


def test_finds_left_aligned_text_one_pixel_too_wide() -> None:
    wide = label("wide", 72 - WIDTH + 1)

    assert overflowing_text([wide]) == [wide]


def test_anchors_right_aligned_text_on_the_column_past_its_right_edge() -> None:
    fits = label("fits", 72, align="top_right")
    too_long = label("long", WIDTH - 1, align="mid_right")
    outside = label("outside", 73, align="bottom_right")

    assert overflowing_text([fits, too_long, outside]) == [too_long, outside]


def test_centres_text_on_x() -> None:
    fits = label("fits", WIDTH // 2, align="center")
    cut = label("cut", WIDTH // 2 - 1, align="top_mid")

    assert overflowing_text([fits, cut]) == [cut]


def test_measures_the_back_display_without_the_status_bar() -> None:
    fits = label("fits", 148 - WIDTH, display=types.DisplayName.BACK)
    covered = label("covered", 148 - WIDTH + 1, display=types.DisplayName.BACK)

    assert overflowing_text([fits, covered]) == [covered]


def test_uses_the_label_width_of_scrolling_text() -> None:
    scrolling = label(
        "scrolling", 0, text="a label far longer than the front display"
    ).model_copy(update={"width": 72})

    assert overflowing_text([scrolling]) == []


def test_ignores_elements_without_text() -> None:
    bar = types.RectangleElement(id="bar", x=100, width=50, height=1)

    assert overflowing_text([bar]) == []
