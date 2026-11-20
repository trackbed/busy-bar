from busylib import types

from bar_kit import overflowing_text
from countdown.preview import preview


def test_counts_down_through_every_stage() -> None:
    remaining = [
        element.text
        for scene in preview().scenes
        for element in scene.elements
        if isinstance(element, types.TextElement) and element.id == "remaining"
    ]

    assert remaining == ["64d 07h", "04:33:20", "NOW"]


def test_fits_every_text_on_its_display() -> None:
    elements = [element for scene in preview().scenes for element in scene.elements]

    assert overflowing_text(elements) == []
