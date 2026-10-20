"""Display sizes and colours."""

from dataclasses import dataclass

_MAX_CHANNEL = 255


@dataclass(frozen=True, slots=True)
class DisplaySize:
    """Pixel size of a BUSY Bar display."""

    width: int
    height: int


FRONT_DISPLAY = DisplaySize(width=72, height=16)
"""The 72×16 RGB LED matrix on the front. Elements placed outside it are not
visible."""

BACK_DISPLAY = DisplaySize(width=148, height=80)
"""The part of the 160×80 back screen apps can draw on.

The firmware's status bar keeps the rightmost 12 columns, so elements past
x = 147 are cut off. The screen shows 16 levels of grey.
"""


def rgba(red: int, green: int, blue: int, alpha: int = _MAX_CHANNEL) -> str:
    """Format a colour as the `#RRGGBBAA` string the display API expects.

    Channels are integers from 0 to 255; alpha defaults to fully opaque.
    """
    channels = (red, green, blue, alpha)
    for channel in channels:
        if not 0 <= channel <= _MAX_CHANNEL:
            message = f"Colour channels must be integers from 0 to 255; got {channel}."
            raise ValueError(message)
    return "#" + "".join(f"{channel:02X}" for channel in channels)
