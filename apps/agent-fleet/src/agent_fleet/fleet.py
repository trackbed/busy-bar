"""Every Claude Code session the board knows about, and what each one needs."""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal

from agent_fleet.hooks import HookEvent, Workspace, workspace_of

type State = Literal["asking", "failed", "done", "working", "background", "seen"]
"""What a session last reported. `quiet` is derived from it at drawing time."""

type Status = Literal[
    "asking", "failed", "done", "working", "quiet", "background", "seen"
]

NEEDS_YOU: frozenset[Status] = frozenset({"asking", "failed", "done"})
"""Statuses that wait on you: a question, an error, or a finished turn."""

# Most urgent first; the board lists sessions in this order.
_ORDER: dict[Status, int] = {
    "asking": 0,
    "failed": 1,
    "done": 2,
    "working": 3,
    "quiet": 4,
    "background": 5,
    "seen": 6,
}

_NOTIFICATION_LABELS = {
    "permission_prompt": "permit",
    "elicitation_dialog": "question",
    "agent_needs_input": "input",
}

_ERROR_LABELS = {
    "rate_limit": "limit",
    "overloaded": "overload",
    "authentication_failed": "auth",
    "billing_error": "billing",
    "server_error": "server",
}

DEFAULT_QUIET_AFTER = timedelta(minutes=15)
DEFAULT_FORGET_AFTER = timedelta(hours=8)


@dataclass(slots=True)
class _Session:
    workspace: Workspace
    state: State
    since: datetime
    last_event: datetime
    skill: str | None = None
    detail: str = ""


@dataclass(frozen=True, slots=True)
class Row:
    """One session as the board draws it."""

    session_id: str
    workspace: str
    repo: str
    status: Status
    detail: str
    """A word for the status, or the skill a working session is running."""

    age: timedelta
    """How long the session has had this status."""

    selected: bool


@dataclass(frozen=True, slots=True)
class FleetView:
    """The board's content at one moment, most urgent session first."""

    rows: tuple[Row, ...]
    counts: Counter[Status] = field(default_factory=Counter[Status])

    @property
    def needs_you(self) -> int:
        """How many sessions wait on you."""
        return sum(self.counts[status] for status in NEEDS_YOU)


class Fleet:
    """Tracks sessions from their hook events.

    `quiet_after` is how long a working session may stay silent before it looks
    stuck; `forget_after` drops sessions that stopped reporting altogether,
    such as ones closed without a `SessionEnd`.
    """

    def __init__(
        self,
        *,
        quiet_after: timedelta = DEFAULT_QUIET_AFTER,
        forget_after: timedelta = DEFAULT_FORGET_AFTER,
    ) -> None:
        self._quiet_after = quiet_after
        self._forget_after = forget_after
        self._sessions: dict[str, _Session] = {}
        self._selected: str | None = None

    def apply(self, event: HookEvent, now: datetime) -> Status | None:
        """Record an event.

        Returns the session's status when it has just started waiting on you,
        so the caller can sound an alert, and None otherwise.
        """
        self._forget(now)
        if event.kind == "end":
            self._sessions.pop(event.session_id, None)
            return None

        session = self._sessions.get(event.session_id)
        if session is None:
            session = _Session(
                workspace=workspace_of(event.cwd),
                state="working",
                since=now,
                last_event=now,
            )
            self._sessions[event.session_id] = session
        session.last_event = now

        previous = session.state
        match event.kind:
            case "prompt":
                state: State = "working"
                session.skill = event.skill
                session.detail = ""
            case "tool":
                state = "working"
                session.skill = event.skill or session.skill
            case "stop":
                state = "background" if event.waiting_on else "done"
                session.detail = f"bg {event.waiting_on}" if event.waiting_on else ""
            case "notification":
                state = "asking"
                notification = event.notification or ""
                session.detail = _NOTIFICATION_LABELS.get(notification, "asking")
            case "failure":
                state = "failed"
                session.detail = _ERROR_LABELS.get(event.error or "", "error")

        if state != previous:
            session.state = state
            session.since = now
            if state in NEEDS_YOU:
                return state
        return None

    def view(self, now: datetime) -> FleetView:
        """What the board shows at `now`."""
        candidates = [
            (session_id, session, self._status(session, now))
            for session_id, session in self._sessions.items()
            if now - session.last_event <= self._forget_after
        ]
        candidates.sort(key=lambda item: (_ORDER[item[2]], item[1].since))
        selected = self._resolve_selection([item[0] for item in candidates])
        rows = tuple(
            Row(
                session_id=session_id,
                workspace=session.workspace.name,
                repo=session.workspace.repo,
                status=status,
                detail=_detail(session, status),
                age=max(now - session.since, timedelta(0)),
                selected=session_id == selected,
            )
            for session_id, session, status in candidates
        )
        return FleetView(rows=rows, counts=Counter(row.status for row in rows))

    def move_selection(self, steps: int, now: datetime) -> None:
        """Move the highlight `steps` rows down the list, or up when negative."""
        order = [row.session_id for row in self.view(now).rows]
        if not order:
            return
        current = self._resolve_selection(order)
        index = order.index(current) if current in order else 0
        self._selected = order[max(0, min(len(order) - 1, index + steps))]

    def acknowledge_selected(self, now: datetime) -> None:
        """Mark the highlighted session as seen, if it waits on you."""
        rows = self.view(now).rows
        for row in rows:
            if row.selected:
                self._acknowledge(row.session_id, now)

    def acknowledge_all(self, now: datetime) -> None:
        """Mark every session that waits on you as seen."""
        for session_id in list(self._sessions):
            self._acknowledge(session_id, now)

    def _acknowledge(self, session_id: str, now: datetime) -> None:
        session = self._sessions[session_id]
        if session.state in NEEDS_YOU:
            session.state = "seen"
            session.since = now

    def _status(self, session: _Session, now: datetime) -> Status:
        if session.state == "working" and now - session.last_event > self._quiet_after:
            return "quiet"
        return session.state

    def _resolve_selection(self, order: list[str]) -> str | None:
        if self._selected in order:
            return self._selected
        return order[0] if order else None

    def _forget(self, now: datetime) -> None:
        for session_id, session in list(self._sessions.items()):
            if now - session.last_event > self._forget_after:
                del self._sessions[session_id]


def _detail(session: _Session, status: Status) -> str:
    match status:
        case "working":
            return session.skill or "working"
        case "asking" | "failed" | "background":
            return session.detail or status
        case "done" | "quiet" | "seen":
            return status
