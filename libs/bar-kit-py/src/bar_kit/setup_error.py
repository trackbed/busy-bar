"""Failures only the person running the app can fix."""

from collections.abc import Sequence


class SetupError(Exception):
    """A failure only the person running the app can fix.

    A rejected key or a missing file, say. The client that learns the cause
    raises it, and the app's screen for a source it cannot read shows
    `summary` (a few words for the front display) and `lines` (what to change,
    one per back row) instead of the message. Raise it `from` the original
    error so the log keeps that. The TypeScript kit's `SetupError` carries the
    same.
    """

    def __init__(self, summary: str, lines: Sequence[str]) -> None:
        """Hint at the fix with `summary` in front and `lines` behind."""
        self.summary = summary
        self.lines = tuple(lines)
        super().__init__(" ".join(self.lines))
