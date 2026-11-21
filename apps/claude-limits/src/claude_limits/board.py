"""How full each account is, judged the way the rotation tool judges it."""

import asyncio
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Literal

from bar_kit import StockSound, to_bar_text, utc_now
from claude_limits.rotation import Account, Rotation, Window, read_rotation

type Level = Literal["ok", "high", "limit", "unknown"]
type Alert = Literal["rotated", "exhausted"]

HIGH_SHARE = 0.8
"""From this share of the rotation threshold on, an account shows as high."""

SOUNDS: Mapping[Alert, StockSound] = {
    "rotated": "reminder",
    "exhausted": "event",
}
"""The stock sound each alert plays."""


@dataclass(frozen=True, slots=True)
class Usage:
    """One window at a moment in time."""

    used: float | None
    """Percent used, or None when no trustworthy reading exists."""

    resets_in: timedelta | None
    level: Level
    stale: bool = False
    """Whether the reading is older than the tool trusts."""


@dataclass(frozen=True, slots=True)
class AccountView:
    """One account as the board draws it."""

    label: str
    short: str
    """Up to three letters for the front display."""

    active: bool
    five_hour: Usage
    seven_day: Usage
    eligible: bool
    """Whether the tool could rotate to this account now."""


@dataclass(frozen=True, slots=True)
class Board:
    """Every account and what the rotation is doing."""

    accounts: tuple[AccountView, ...]
    rotating_to: str | None
    exhausted: bool
    """Whether every account is at its limit, so no rotation can help."""

    free_in: timedelta | None
    """When exhausted: how long until the first account frees up."""

    @property
    def active(self) -> AccountView | None:
        """The account in use, if the tool says which."""
        return next((account for account in self.accounts if account.active), None)


def short_label(label: str) -> str:
    """`account-a` is `A`, `work` is `WOR`: what fits beside a bar."""
    return to_bar_text(label.rsplit("-", 1)[-1])[:3].upper() or "?"


def board_at(rotation: Rotation, now: datetime) -> Board:
    """Judge every account at `now`."""
    accounts = tuple(
        _account_view(account, rotation, now) for account in rotation.accounts
    )
    exhausted = bool(accounts) and not any(item.eligible for item in accounts)
    free_in = None
    if exhausted:
        frees = [_frees_at(account, rotation, now) for account in rotation.accounts]
        free_in = min((at - now for at in frees if at is not None), default=None)
    rotating_to = (
        to_bar_text(rotation.rotating_to) if rotation.rotating_to is not None else None
    )
    return Board(
        accounts=accounts,
        rotating_to=rotating_to,
        exhausted=exhausted,
        free_in=free_in,
    )


def alert_for(
    previous: Rotation | None, current: Rotation, now: datetime
) -> Alert | None:
    """What changed between two readings that is worth a sound."""
    if previous is None:
        return None
    if board_at(current, now).exhausted and not board_at(previous, now).exhausted:
        return "exhausted"
    if previous.current and current.current and previous.current != current.current:
        return "rotated"
    return None


class RotationWatch:
    """Reads the rotation every poll and sounds a change worth a sound.

    The first reading only sets the baseline. `play` returns at once, such as
    `Speaker.play`, so the poll never waits on the bar's speaker.
    """

    def __init__(
        self,
        root: Path,
        *,
        play: Callable[[StockSound], None],
        read: Callable[[Path], Rotation] = read_rotation,
        now: Callable[[], datetime] = utc_now,
    ) -> None:
        self._root = root
        self._play = play
        self._read = read
        self._now = now
        self._previous: Rotation | None = None

    async def fetch(self) -> Rotation:
        """Read the rotation, for a `Poller`."""
        rotation = await asyncio.to_thread(self._read, self._root)
        alert = alert_for(self._previous, rotation, self._now())
        self._previous = rotation
        if alert is not None:
            self._play(SOUNDS[alert])
        return rotation


def usage_at(window: Window | None, rotation: Rotation, now: datetime) -> Usage:
    """One window judged at `now`: unknown once it has reset."""
    if window is None or now >= window.resets_at:
        return Usage(used=None, resets_in=None, level="unknown")
    stale = now - window.observed_at > rotation.max_usage_age
    if window.used >= rotation.threshold:
        level: Level = "limit"
    elif window.used >= rotation.threshold * HIGH_SHARE:
        level = "high"
    else:
        level = "ok"
    return Usage(
        used=window.used,
        resets_in=window.resets_at - now,
        level=level,
        stale=stale,
    )


def _account_view(account: Account, rotation: Rotation, now: datetime) -> AccountView:
    five_hour = usage_at(account.five_hour, rotation, now)
    seven_day = usage_at(account.seven_day, rotation, now)
    blocked = account.blocked_until is not None and account.blocked_until > now
    return AccountView(
        label=to_bar_text(account.label),
        short=short_label(account.label),
        active=account.label == rotation.current,
        five_hour=five_hour,
        seven_day=seven_day,
        eligible=not blocked and "limit" not in {five_hour.level, seven_day.level},
    )


def _frees_at(account: Account, rotation: Rotation, now: datetime) -> datetime | None:
    """When an account at its limit becomes usable again."""
    waits = [
        window.resets_at
        for window in (account.five_hour, account.seven_day)
        if window is not None and usage_at(window, rotation, now).level == "limit"
    ]
    if account.blocked_until is not None and account.blocked_until > now:
        waits.append(account.blocked_until)
    return max(waits, default=None)
