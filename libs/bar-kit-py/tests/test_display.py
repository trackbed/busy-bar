import pytest

from bar_kit import rgba


def test_formats_channels_as_rrggbbaa() -> None:
    assert rgba(255, 140, 0) == "#FF8C00FF"
    assert rgba(0, 0, 0, 0) == "#00000000"


@pytest.mark.parametrize("channel", [-1, 256])
def test_rejects_channels_outside_a_byte(channel: int) -> None:
    with pytest.raises(ValueError, match="from 0 to 255"):
        rgba(channel, 0, 0)
