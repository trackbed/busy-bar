from busylib import types

from agent_fleet.preview import preview
from bar_kit import overflowing_text


def test_heads_with_who_needs_you_then_who_is_working() -> None:
    headlines = [
        element.text
        for scene in preview().scenes
        for element in scene.elements
        if isinstance(element, types.TextElement) and element.id == "headline"
    ]

    assert headlines == ["2 NEED YOU", "3 WORKING", "2 WORKING"]


def test_fits_every_text_on_its_display() -> None:
    elements = [element for scene in preview().scenes for element in scene.elements]

    assert overflowing_text(elements) == []
