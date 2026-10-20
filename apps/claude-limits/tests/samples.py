"""Rotation files as conductor-claude-rotation writes them, for the tests."""

from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

NOW = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
EPOCH_NOW = NOW.timestamp()

type WriteJson = Callable[[str, object], Path]
"""Writes JSON to a path relative to a rotation root and returns the path."""


def usage_window(
    used: float, *, resets_in_minutes: float, observed_minutes_ago: float = 1
) -> dict[str, float]:
    """A usage window as the rotation tool writes it: epoch seconds."""
    return {
        "used_percentage": used,
        "resets_at": EPOCH_NOW + resets_in_minutes * 60,
        "observed_at": EPOCH_NOW - observed_minutes_ago * 60,
    }
