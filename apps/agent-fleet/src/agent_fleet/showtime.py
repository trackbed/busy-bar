"""Trackbed's last Showtime pass and the selected workspace's review progress."""

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

STALE = timedelta(minutes=15)
GROUPS = ("needs_me", "merge_ready", "working", "nudge", "idle", "merged")
PHASES = {
    "review": "REVIEW",
    "fixing": "FIXING",
    "verify": "VERIFY",
    "done": "DONE",
    "blocked": "BLOCKED",
}


def _object(value: object) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ValueError("Expected a Trackbed object")
    return value


def _snapshot(path: Path) -> Mapping[str, object]:
    data = _object(json.loads(path.read_bytes()))
    if type(data.get("version")) is not int or data["version"] != 1:
        raise ValueError("Unsupported Trackbed snapshot")
    return data


def _text(data: Mapping[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str):
        raise ValueError(f"Invalid Trackbed field {key}")
    return value


def _date(data: Mapping[str, object], key: str) -> datetime:
    value = datetime.fromisoformat(_text(data, key))
    if value.tzinfo is None:
        raise ValueError("Missing snapshot time zone")
    return value


def _count(data: Mapping[str, object], key: str) -> int:
    value = data.get(key)
    if type(value) is not int or value < 0:
        raise ValueError(f"Invalid Trackbed count {key}")
    return value


@dataclass(frozen=True, slots=True)
class Workspace:
    id: str
    name: str
    group: str
    reason: str

    @classmethod
    def parse(cls, raw: object) -> Workspace:
        row = _object(raw)
        workspace = cls(
            _text(row, "id"),
            _text(row, "name"),
            _text(row, "group"),
            _text(row, "reason"),
        )
        if (
            not re.fullmatch(r"[A-Za-z0-9_-]+", workspace.id)
            or workspace.group not in GROUPS
        ):
            raise ValueError("Invalid Showtime workspace")
        return workspace


@dataclass(frozen=True, slots=True)
class Board:
    scope: str
    at: datetime
    rows: tuple[Workspace, ...]

    @classmethod
    def read(cls, path: Path) -> Board:
        data = _snapshot(path)
        raw = data.get("workspaces")
        if not isinstance(raw, list):
            raise ValueError("Missing Showtime workspaces")
        rows = sorted(
            (Workspace.parse(row) for row in raw),
            key=lambda row: (GROUPS.index(row.group), row.name, row.id),
        )
        return cls(_text(data, "scope"), _date(data, "observedAt"), tuple(rows))


@dataclass(frozen=True, slots=True)
class Review:
    work_item: str
    started: datetime
    at: datetime
    phase: str
    round: int
    cycles: int
    gate: str

    @classmethod
    def read(cls, directory: Path, workspace: Workspace) -> Review:
        data = _snapshot(directory / f"review-{workspace.id}.json")
        phase = _text(data, "phase")
        if phase not in PHASES or _text(data, "workspace") != workspace.id:
            raise ValueError("Invalid review snapshot")
        return cls(
            _text(data, "workItem"),
            _date(data, "startedAt"),
            _date(data, "observedAt"),
            phase,
            _count(data, "round"),
            _count(data, "cycles"),
            _text(data, "lastGate"),
        )


class Showtime:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.board: Board | None = None
        self.index = 0
        self.seen: set[Workspace] = set()
        self.detail = False
        self.review: Review | None = None
        self.failed = False
        self.review_failed = False

    @property
    def selected(self) -> Workspace | None:
        return self.board.rows[self.index] if self.board and self.board.rows else None

    def refresh(self, now: datetime) -> bool:
        """Return whether a fresh pass newly requires attention."""
        alert = False
        try:
            board = Board.read(self.path)
        except OSError, ValueError:
            self.failed = True
        else:
            self.failed = False
            alert = self._observe(board, now)
        selected = self.selected
        if self.detail and selected:
            try:
                latest = Review.read(self.path.parent, selected)
                if self.review is None or (latest.started, latest.at) >= (
                    self.review.started,
                    self.review.at,
                ):
                    self.review = latest
                self.review_failed = False
            except OSError, ValueError:
                self.review_failed = True
        return alert

    def _observe(self, board: Board, now: datetime) -> bool:
        previous = self.board
        prior = self.selected
        self.board = board
        self.index = next(
            (i for i, row in enumerate(board.rows) if prior and row.id == prior.id), 0
        )
        if not prior or not self.selected or prior.id != self.selected.id:
            self.detail = False
            self.review = None
        waiting = {row for row in board.rows if row.group == "needs_me"}
        self.seen.intersection_update(waiting)
        return (
            previous is not None
            and now - board.at < STALE
            and bool(waiting - set(previous.rows))
        )

    def move(self, delta: int) -> None:
        if not self.detail and self.board and self.board.rows:
            self.index = (self.index + delta) % len(self.board.rows)
            self.review = None

    def acknowledge(self) -> None:
        if self.selected and self.selected.group == "needs_me":
            self.seen.add(self.selected)

    def toggle(self) -> None:
        if self.selected:
            self.detail = not self.detail
