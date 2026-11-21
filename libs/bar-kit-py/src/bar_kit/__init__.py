"""Shared helpers for BUSY Bar apps written in Python.

The Python counterpart of `@busy-bar-apps/bar-kit`: both kits read the same
environment variables and expose the same frame loop.
"""

from busylib.features import ButtonEvent, EncoderEvent, InputEvent, SelectorEvent
from busylib.features.input_events import SelectorPosition
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
from bar_kit.fonts import ELLIPSIS, fit_text, overflowing_text, text_width
from bar_kit.input import listen_for_input
from bar_kit.poll import Poller, PollFailure, Snapshot
from bar_kit.preview import Preview, PreviewScene, PreviewStep, print_preview
from bar_kit.run import (
    DEFAULT_PRIORITY,
    DisplayClient,
    Render,
    install_shutdown_handlers,
    run_bar_app,
)
from bar_kit.screen import TrackedScreen, track_screen
from bar_kit.text import to_bar_text

__all__ = [
    "BACK_DISPLAY",
    "DEFAULT_PRIORITY",
    "ELLIPSIS",
    "FRONT_DISPLAY",
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
    "PollFailure",
    "Poller",
    "Preview",
    "PreviewScene",
    "PreviewStep",
    "RectangleElement",
    "Render",
    "SelectorEvent",
    "SelectorPosition",
    "Snapshot",
    "TextElement",
    "TrackedScreen",
    "create_busy_bar",
    "fit_text",
    "install_shutdown_handlers",
    "listen_for_input",
    "load_bar_config",
    "overflowing_text",
    "print_preview",
    "rgba",
    "run_bar_app",
    "text_width",
    "to_bar_text",
    "track_screen",
]
