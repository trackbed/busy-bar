"""Sample frames for the app catalogue: `nx run agent-fleet:preview`."""

from datetime import UTC, datetime, timedelta

from agent_fleet.fleet import Fleet
from agent_fleet.hooks import EventKind, HookEvent, Notification
from agent_fleet.render import render
from agent_fleet.settings import DEFAULT_HOST, DEFAULT_PORT
from bar_kit import DisplayElement, Preview, PreviewScene, PreviewStep, print_preview

START = datetime(2026, 10, 21, 9, 0, tzinfo=UTC)
NOW = START + timedelta(minutes=30)
WORKSPACES = "/Users/me/conductor/workspaces/busy-bar-apps"


def _event(
    kind: EventKind,
    workspace: str,
    *,
    skill: str | None = None,
    waiting_on: int = 0,
    notification: Notification | None = None,
) -> HookEvent:
    return HookEvent(
        kind,
        f"session-{workspace}",
        f"{WORKSPACES}/{workspace}",
        skill=skill,
        waiting_on=waiting_on,
        notification=notification,
    )


def _fleet(events: list[tuple[float, HookEvent]]) -> Fleet:
    """A fleet that received `events`, each at its minute after `START`."""
    fleet = Fleet()
    for minutes, event in events:
        fleet.apply(event, START + timedelta(minutes=minutes))
    return fleet


def _draw(fleet: Fleet) -> list[DisplayElement]:
    return render(NOW, fleet.view(NOW), listening=f"{DEFAULT_HOST}:{DEFAULT_PORT}")


def _busy_fleet() -> Fleet:
    """Five sessions: one on a permission prompt, one finished, three busy."""
    return _fleet(
        [
            (2, _event("prompt", "oslo", skill="pr-fix-ci")),
            (5, _event("prompt", "lisbon")),
            (10, _event("prompt", "cebu", skill="simplify")),
            (14, _event("prompt", "denver")),
            (19, _event("stop", "denver", waiting_on=2)),
            (24, _event("stop", "lisbon")),
            (27, _event("prompt", "kyoto", skill="code-review")),
            (28, _event("notification", "cebu", notification="permission_prompt")),
            (29, _event("tool", "oslo")),
            (29.5, _event("tool", "kyoto")),
        ]
    )


def _calm_fleet() -> Fleet:
    """Three sessions at work and one waiting on a background task."""
    return _fleet(
        [
            (8, _event("prompt", "oslo", skill="pr-create")),
            (12, _event("prompt", "lisbon", skill="tdd")),
            (16, _event("prompt", "cebu")),
            (21, _event("stop", "denver", waiting_on=1)),
            (29, _event("tool", "oslo")),
            (29, _event("tool", "lisbon")),
            (29.5, _event("tool", "cebu")),
        ]
    )


def preview() -> Preview:
    """A fleet with a session to answer, a calm one, and the first after BACK."""
    seen = _busy_fleet()
    seen.acknowledge_all(NOW)
    return Preview(
        summary="Every Claude Code session you run, and which ones wait on you.",
        steps=[
            PreviewStep(
                label="Reads",
                text="Claude Code's HTTP hooks, posted to a loopback endpoint on "
                "AGENT_FLEET_PORT (8740 by default) that answers every hook with "
                "an empty 200 and never steers an agent.",
            ),
            PreviewStep(
                label="Decides",
                text="Each session's status, most urgent first: asking (red), failed "
                "(purple), done (amber), working (green), quiet after "
                "AGENT_FLEET_QUIET_MINUTES of silence (olive), background (blue), "
                "seen (grey).",
            ),
            PreviewStep(
                label="Draws",
                text="How many sessions need you and the most urgent one on the "
                "front with a cell per session, and every session's workspace, "
                "status or skill, and age on the back.",
            ),
            PreviewStep(
                label="Alerts",
                text="A chime when a session starts asking, fails, or finishes, at "
                "most one every five seconds and none while the selector is on "
                "BUSY, CUSTOM, or OFF.",
            ),
            PreviewStep(
                label="Controls",
                text="The wheel moves the highlight on the back, OK marks the "
                "highlighted session as seen, and BACK marks every waiting "
                "session as seen.",
            ),
        ],
        scenes=[
            PreviewScene(
                title="Permission needed",
                caption="cebu is blocked on a permission prompt and lisbon has "
                "finished its turn, so the front reads 2 NEED YOU in red and names "
                "cebu first.",
                elements=_draw(_busy_fleet()),
            ),
            PreviewScene(
                title="Calm fleet",
                caption="Nothing waits on you: three sessions are working, two "
                "of them in a skill, and denver waits on a background task.",
                elements=_draw(_calm_fleet()),
            ),
            PreviewScene(
                title="Marked as seen",
                caption="After BACK, cebu and lisbon turn grey and the headline "
                "falls back to the sessions still working.",
                elements=_draw(seen),
            ),
        ],
    )


if __name__ == "__main__":
    print_preview(preview())
