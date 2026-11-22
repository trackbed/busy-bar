"""The countdown's settings, read from the environment."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime

from bar_kit import SettingsError

DEFAULT_LABEL = "COUNTDOWN"


class CountdownSettingsError(SettingsError):
    """The environment does not describe a countdown."""


@dataclass(frozen=True, slots=True)
class CountdownSettings:
    """What to count down to."""

    target: datetime
    """The moment the countdown reaches zero. Always time zone aware."""

    label: str
    """What the countdown is for, in printable ASCII."""


def load_settings(env: Mapping[str, str]) -> CountdownSettings:
    """Read `COUNTDOWN_TARGET` and `COUNTDOWN_LABEL`."""
    raw_target = env.get("COUNTDOWN_TARGET", "").strip()
    example = "for example 2026-12-24T18:00:00+01:00"
    if not raw_target:
        message = f"Set COUNTDOWN_TARGET to an ISO 8601 date and time, {example}."
        raise CountdownSettingsError(message)

    try:
        target = datetime.fromisoformat(raw_target)
    except ValueError as error:
        message = f"COUNTDOWN_TARGET must be an ISO 8601 date and time, {example}."
        raise CountdownSettingsError(message) from error
    if target.tzinfo is None:
        message = f"COUNTDOWN_TARGET needs a UTC offset, {example}."
        raise CountdownSettingsError(message)

    label = env.get("COUNTDOWN_LABEL", "").strip() or DEFAULT_LABEL
    # The bar's fonts are bitmap ASCII.
    if not (label.isascii() and label.isprintable()):
        message = "COUNTDOWN_LABEL may only contain printable ASCII characters."
        raise CountdownSettingsError(message)

    return CountdownSettings(target=target, label=label)
