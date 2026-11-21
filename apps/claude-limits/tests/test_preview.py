from bar_kit import TextElement, overflowing_text
from claude_limits.preview import preview
from claude_limits.render import LEVEL_COLORS


def test_goes_from_room_to_spare_to_every_account_limited() -> None:
    headlines = [
        (element.text, element.color)
        for scene in preview().scenes
        for element in scene.elements
        if isinstance(element, TextElement) and element.id == "headline"
    ]

    assert headlines == [
        ("WOR 34%", LEVEL_COLORS["ok"]),
        ("WOR 87%", LEVEL_COLORS["high"]),
        ("ALL LIMITED", LEVEL_COLORS["limit"]),
    ]


def test_fits_every_text_on_its_display() -> None:
    elements = [element for scene in preview().scenes for element in scene.elements]

    assert overflowing_text(elements) == []
