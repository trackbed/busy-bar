"""Claude Code hook events, as the fleet board reads them."""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from bar_kit import to_bar_text

type EventKind = Literal["prompt", "tool", "stop", "notification", "failure", "end"]

_KINDS: dict[str, EventKind] = {
    "UserPromptSubmit": "prompt",
    "PreToolUse": "tool",
    "Stop": "stop",
    "Notification": "notification",
    "StopFailure": "failure",
    "SessionEnd": "end",
}

ASKING_NOTIFICATIONS = frozenset(
    {"permission_prompt", "elicitation_dialog", "agent_needs_input"}
)
"""Notifications that mean a session is blocked until you answer it."""

_HOOK_TIMEOUT_SECONDS = 2
_SESSION_END_TIMEOUT_SECONDS = 1

# Conductor checks every workspace out at ~/conductor/workspaces/<repo>/<name>.
_CONDUCTOR_WORKSPACE = re.compile(r"/conductor/workspaces/[^/]+/(?P<workspace>[^/]+)")
# How a skill's expanded prompt starts when a slash command loads it.
_SKILL_PROMPT = re.compile(
    r"^Base directory for this skill: \S*/skills/(?P<skill>[^/\s]+)"
)


@dataclass(frozen=True, slots=True)
class Workspace:
    """Where a session runs: its Conductor workspace or directory name."""

    name: str


@dataclass(frozen=True, slots=True)
class HookEvent:
    """One hook event, reduced to what the board needs."""

    kind: EventKind
    session_id: str
    cwd: str
    skill: str | None = None
    """The skill a prompt or tool call started, shortened for the bar."""

    waiting_on: int = 0
    """Background tasks and scheduled wakeups still pending at a stop."""

    notification: str | None = None
    error: str | None = None


def parse_hook(payload: object) -> HookEvent | None:
    """Read one hook payload, or None if the board has no use for it."""
    if not isinstance(payload, Mapping):
        return None
    kind = _KINDS.get(_text(payload, "hook_event_name"))
    session_id = _text(payload, "session_id")
    if kind is None or not session_id:
        return None
    notification = _text(payload, "notification_type")
    if kind == "notification" and notification not in ASKING_NOTIFICATIONS:
        return None

    pending = _count(payload, "background_tasks") + _count(payload, "session_crons")
    return HookEvent(
        kind,
        session_id,
        _text(payload, "cwd"),
        skill=_skill(kind, payload),
        waiting_on=pending if kind == "stop" else 0,
        notification=notification if kind == "notification" else None,
        error=(_text(payload, "error") or "unknown") if kind == "failure" else None,
    )


def workspace_of(cwd: str) -> Workspace:
    """Name a session after its Conductor workspace, or its directory."""
    match = _CONDUCTOR_WORKSPACE.search(cwd)
    if match:
        return Workspace(name=to_bar_text(match["workspace"]))
    return Workspace(name=to_bar_text(PurePosixPath(cwd).name) or "?")


def skill_label(name: str) -> str:
    """Shorten a skill or slash command name for the bar.

    The plugin namespace goes, and so does a skill prefix that repeats the
    plugin's first word: `kramme-cc-workflow:kramme-pr-fix-ci` is `pr-fix-ci`,
    `kramme:pr:create` is `pr:create`, and `simplify` stays `simplify`.
    """
    plugin, separator, skill = name.partition(":")
    if not separator:
        return to_bar_text(name)
    prefix = plugin.split("-", 1)[0] + "-"
    return to_bar_text(skill.removeprefix(prefix))


def hook_settings(url: str) -> dict[str, object]:
    """The `hooks` block to merge into `~/.claude/settings.json`.

    The short timeouts keep a stopped or stuck board from slowing agents down.
    A hook that cannot reach the board is a non-blocking error, so agents
    carry on without it.
    """

    def hook(timeout: int) -> dict[str, object]:
        return {"hooks": [{"type": "http", "url": url, "timeout": timeout}]}

    return {
        "hooks": {
            event: [
                hook(
                    _SESSION_END_TIMEOUT_SECONDS
                    if event == "SessionEnd"
                    else _HOOK_TIMEOUT_SECONDS
                )
            ]
            for event in _KINDS
        }
    }


def _skill(kind: EventKind, payload: Mapping[str, object]) -> str | None:
    if kind == "prompt":
        return _prompt_skill(_text(payload, "prompt"))
    if kind == "tool":
        return _tool_skill(payload)
    return None


def _prompt_skill(prompt: str) -> str | None:
    text = prompt.strip()
    if text.startswith("/"):
        command = text[1:].split(maxsplit=1)
        return skill_label(command[0]) if command else None
    match = _SKILL_PROMPT.match(text)
    return skill_label(match["skill"]) if match else None


def _tool_skill(payload: Mapping[str, object]) -> str | None:
    if _text(payload, "tool_name") != "Skill":
        return None
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, Mapping):
        return None
    skill = _text(tool_input, "skill")
    return skill_label(skill) if skill else None


def _text(payload: Mapping[str, object], key: str) -> str:
    value = payload.get(key)
    return value if isinstance(value, str) else ""


def _count(payload: Mapping[str, object], key: str) -> int:
    value = payload.get(key)
    return len(value) if isinstance(value, list) else 0
