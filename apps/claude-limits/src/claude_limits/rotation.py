"""What conductor-claude-rotation knows about your Claude accounts.

The rotation tool keeps its state as JSON under one directory (its
`DATA_ROOT`), writing each file atomically, so reading them never sees half a
write and needs no lock:

- `config.json`: the accounts and the rotation threshold.
- `<state_directory>/state.json`: the active account and any rotation in flight.
- `<state_directory>/usage/<account>.json`: the last usage snapshot per account.

This module only reads. It never calls the usage endpoint or touches the
Keychain: refreshing the tool's tokens from outside breaks its logins.
"""

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

DEFAULT_ROOT = Path("~/.local/share/conductor-claude-rotation")

_DEFAULT_THRESHOLD = 100.0
_DEFAULT_MAX_USAGE_AGE = timedelta(seconds=600)


class RotationNotSetUpError(FileNotFoundError):
    """The rotation tool has no configuration in the directory."""


@dataclass(frozen=True, slots=True)
class Window:
    """One usage window, such as the five-hour session limit."""

    used: float
    """Percent of the window used, from 0 to 100."""

    resets_at: datetime
    observed_at: datetime


@dataclass(frozen=True, slots=True)
class Account:
    """One Claude account the tool rotates through."""

    label: str
    five_hour: Window | None
    seven_day: Window | None
    blocked_until: datetime | None = None


@dataclass(frozen=True, slots=True)
class Rotation:
    """Everything the board draws, read in one go."""

    accounts: tuple[Account, ...]
    current: str | None
    """The account Conductor is using now."""

    rotating_to: str | None
    """The account a rotation in flight is switching to."""

    threshold: float
    """The usage percent at which the tool rotates away from an account."""

    max_usage_age: timedelta
    """How old a snapshot may be before the tool stops trusting it."""

    def account(self, label: str | None) -> Account | None:
        """The account with `label`, if the tool has one."""
        return next((item for item in self.accounts if item.label == label), None)


def read_rotation(root: Path) -> Rotation:
    """Read the tool's files under `root`.

    Raises `RotationNotSetUpError` when `root` has no `config.json`, and
    `ValueError` when a file is not the JSON the tool writes.
    """
    config_path = root / "config.json"
    if not config_path.is_file():
        message = f"No conductor-claude-rotation config at {config_path}."
        raise RotationNotSetUpError(message)
    config = _read_object(config_path)

    state_directory = config_path.parent / _text(config, "state_directory", "state")
    state_path = state_directory / "state.json"
    state = _read_object(state_path) if state_path.is_file() else {}
    blocked = _mapping(state.get("blocked_until"))

    accounts = tuple(
        _account(label, state_directory / "usage" / f"{label}.json", blocked)
        for label in _labels(config)
    )
    pending = _mapping(state.get("pending"))
    return Rotation(
        accounts=accounts,
        current=_text(state, "current_account") or _text(config, "initial_account"),
        rotating_to=_text(pending, "to_account") or None,
        threshold=_number(config.get("threshold")) or _DEFAULT_THRESHOLD,
        max_usage_age=_seconds(config.get("max_usage_age_seconds"))
        or _DEFAULT_MAX_USAGE_AGE,
    )


def _labels(config: Mapping[str, object]) -> list[str]:
    accounts = config.get("accounts")
    if not isinstance(accounts, list):
        return []
    return [label for account in accounts if (label := _text(_mapping(account), "id"))]


def _account(label: str, usage_path: Path, blocked: Mapping[str, object]) -> Account:
    usage = _read_object(usage_path) if usage_path.is_file() else {}
    return Account(
        label=label,
        five_hour=_window(usage.get("five_hour")),
        seven_day=_window(usage.get("seven_day")),
        blocked_until=_time(blocked.get(label)),
    )


def _window(value: object) -> Window | None:
    window = _mapping(value)
    used = _number(window.get("used_percentage"))
    resets_at = _time(window.get("resets_at"))
    observed_at = _time(window.get("observed_at"))
    if used is None or resets_at is None or observed_at is None:
        return None
    return Window(used=used, resets_at=resets_at, observed_at=observed_at)


def _read_object(path: Path) -> dict[str, object]:
    try:
        value: object = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as error:
        message = f"{path} is not valid JSON."
        raise ValueError(message) from error
    if not isinstance(value, dict):
        message = f"{path} does not hold a JSON object."
        raise ValueError(message)
    return value


def _mapping(value: object) -> Mapping[str, object]:
    return value if isinstance(value, Mapping) else {}


def _text(values: Mapping[str, object], key: str, default: str = "") -> str:
    value = values.get(key)
    return value if isinstance(value, str) and value else default


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def _seconds(value: object) -> timedelta | None:
    number = _number(value)
    return timedelta(seconds=number) if number else None


def _time(value: object) -> datetime | None:
    """Epoch seconds or an ISO 8601 string with a UTC offset."""
    number = _number(value)
    if number is not None:
        return datetime.fromtimestamp(number, tz=UTC)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return None
        return parsed if parsed.tzinfo is not None else None
    return None
