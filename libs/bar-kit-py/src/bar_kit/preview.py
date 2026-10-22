"""Sample frames for the app catalogue.

Each app's `preview` target prints a `Preview` with `print_preview`;
`tools/catalogue` draws its scenes with the emulator.
"""

import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import TextIO

from busylib import types


@dataclass(frozen=True)
class PreviewStep:
    """One step of how an app works, such as where its data comes from."""

    label: str
    """A word or two: `Reads`, `Decides`, `Draws`, `Alerts`, `Controls`."""
    text: str


@dataclass(frozen=True)
class PreviewScene:
    """One moment of an app, drawn by its own render function from sample data."""

    title: str
    """A few words naming the moment."""
    caption: str
    """What the bar shows here, and why."""
    elements: Sequence[types.DisplayElement]


@dataclass(frozen=True)
class Preview:
    """What the app catalogue shows for an app."""

    summary: str
    """One sentence: what the app is for."""
    steps: Sequence[PreviewStep]
    """How the app works, in order."""
    scenes: Sequence[PreviewScene]


def print_preview(preview: Preview, output: TextIO | None = None) -> None:
    """Write a preview to standard output as one line of JSON.

    Elements are serialized the way busylib sends them to the bar.
    """
    document = {
        "summary": preview.summary,
        "steps": [{"label": step.label, "text": step.text} for step in preview.steps],
        "scenes": [
            {
                "title": scene.title,
                "caption": scene.caption,
                "elements": [
                    element.model_dump(mode="json", exclude_none=True)
                    for element in scene.elements
                ],
            }
            for scene in preview.scenes
        ],
    }
    (output or sys.stdout).write(json.dumps(document) + "\n")
