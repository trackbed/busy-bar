"""Shared helpers for BUSY Bar apps written in Python.

The Python counterpart of `@busy-bar-apps/bar-kit`: both kits read the same
environment variables and expose the same frame loop.
"""

from busylib.features import ButtonEvent, EncoderEvent, InputEvent, SelectorEvent
from busylib.features.input_events import SelectorPosition
from busylib.features.notification import STOCK_SOUNDS
from busylib.types import (
    DisplayElement,
    DisplayFontName,
    DisplayName,
    RectangleElement,
    TextElement,
)

from bar_kit.client import create_busy_bar
from bar_kit.config import BarConfig, BarConfigError, load_bar_config
from bar_kit.display import BACK_DISPLAY, FRONT_DISPLAY, DisplaySize, rgba
from bar_kit.elements import (
    FOOTER_Y,
    PALETTE,
    SUMMARY_Y,
    Palette,
    TextAlign,
    color_of,
    elements_by_id,
    solid_rectangle,
    status_cells,
    text_element,
    text_of,
)
from bar_kit.env import SettingsError, env_http_url, env_switch, env_whole_number
from bar_kit.fonts import ELLIPSIS, fit_text, overflowing_text, text_width
from bar_kit.input import listen_for_input
from bar_kit.poll import Poller, PollFailure, Snapshot
from bar_kit.preview import Preview, PreviewScene, PreviewStep, print_preview
from bar_kit.run import (
    DEFAULT_PRIORITY,
    MAX_PRIORITY,
    MIN_PRIORITY,
    DisplayClient,
    Render,
    install_shutdown_handlers,
    run_bar_app,
)
from bar_kit.screen import TrackedScreen, track_screen
from bar_kit.speaker import AudioClient, Speaker, StockSound
from bar_kit.text import to_bar_text

__all__ = [
    "BACK_DISPLAY",
    "DEFAULT_PRIORITY",
    "ELLIPSIS",
    "FOOTER_Y",
    "FRONT_DISPLAY",
    "MAX_PRIORITY",
    "MIN_PRIORITY",
    "PALETTE",
    "STOCK_SOUNDS",
    "SUMMARY_Y",
    "AudioClient",
    "BarConfig",
    "BarConfigError",
    "ButtonEvent",
    "DisplayClient",
    "DisplayElement",
    "DisplayFontName",
    "DisplayName",
    "DisplaySize",
    "EncoderEvent",
    "InputEvent",
    "Palette",
    "PollFailure",
    "Poller",
    "Preview",
    "PreviewScene",
    "PreviewStep",
    "RectangleElement",
    "Render",
    "SelectorEvent",
    "SelectorPosition",
    "SettingsError",
    "Snapshot",
    "Speaker",
    "StockSound",
    "TextAlign",
    "TextElement",
    "TrackedScreen",
    "color_of",
    "create_busy_bar",
    "elements_by_id",
    "env_http_url",
    "env_switch",
    "env_whole_number",
    "fit_text",
    "install_shutdown_handlers",
    "listen_for_input",
    "load_bar_config",
    "overflowing_text",
    "print_preview",
    "rgba",
    "run_bar_app",
    "solid_rectangle",
    "status_cells",
    "text_element",
    "text_of",
    "text_width",
    "to_bar_text",
    "track_screen",
]
