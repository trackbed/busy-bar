from datetime import UTC, datetime, timedelta
from typing import get_args

from agent_fleet.fleet import NEEDS_YOU, Alert, Fleet, FleetView, Row
from agent_fleet.hooks import EventKind, HookEvent

START = datetime(2026, 10, 20, 9, 0, tzinfo=UTC)
WORKSPACES = "/Users/me/conductor/workspaces/discera"


def at(minutes: float) -> datetime:
    return START + timedelta(minutes=minutes)


def event(  # noqa: PLR0913 - mirrors the event's optional fields.
    kind: EventKind,
    session: str = "s1",
    *,
    skill: str | None = None,
    waiting_on: int = 0,
    notification: str | None = None,
    error: str | None = None,
) -> HookEvent:
    return HookEvent(
        kind,
        session,
        f"{WORKSPACES}/{session}",
        skill=skill,
        waiting_on=waiting_on,
        notification=notification,
        error=error,
    )


def statuses(view: FleetView) -> list[tuple[str, str, str]]:
    return [(row.workspace, row.status, row.detail) for row in view.rows]


def test_the_statuses_that_need_you_are_the_alerts() -> None:
    assert set(get_args(Alert.__value__)) == NEEDS_YOU


def test_a_prompt_starts_a_working_session_named_after_its_workspace() -> None:
    fleet = Fleet()

    assert fleet.apply(event("prompt", skill="pr-fix-ci"), at(0)) is None

    (row,) = fleet.view(at(1)).rows
    assert row == Row(
        session_id="s1",
        workspace="s1",
        status="working",
        detail="pr-fix-ci",
        age=timedelta(minutes=1),
        selected=True,
    )


def test_a_finished_turn_waits_on_you_and_raises_one_alert() -> None:
    fleet = Fleet()
    fleet.apply(event("prompt"), at(0))

    assert fleet.apply(event("stop"), at(5)) == "done"
    assert fleet.apply(event("stop"), at(6)) is None

    view = fleet.view(at(7))
    assert statuses(view) == [("s1", "done", "done")]
    assert view.needs_you == 1
    assert view.rows[0].age == timedelta(minutes=2)


def test_a_stop_with_background_work_does_not_wait_on_you() -> None:
    fleet = Fleet()

    assert fleet.apply(event("stop", waiting_on=2), at(0)) is None

    view = fleet.view(at(1))
    assert statuses(view) == [("s1", "background", "bg 2")]
    assert view.needs_you == 0


def test_questions_and_errors_wait_on_you() -> None:
    fleet = Fleet()

    assert (
        fleet.apply(event("notification", notification="permission_prompt"), at(0))
        == "asking"
    )
    assert fleet.apply(event("failure", "s2", error="rate_limit"), at(1)) == "failed"
    assert fleet.apply(event("failure", "s3", error="mystery"), at(2)) == "failed"

    assert statuses(fleet.view(at(3))) == [
        ("s1", "asking", "permit"),
        ("s2", "failed", "limit"),
        ("s3", "failed", "error"),
    ]


def test_activity_after_a_question_means_it_was_answered() -> None:
    fleet = Fleet()
    fleet.apply(event("notification", notification="elicitation_dialog"), at(0))

    fleet.apply(event("tool"), at(1))

    assert statuses(fleet.view(at(2))) == [("s1", "working", "working")]


def test_a_tool_keeps_the_skill_a_prompt_started() -> None:
    fleet = Fleet()
    fleet.apply(event("prompt", skill="pr-create"), at(0))
    fleet.apply(event("tool"), at(1))
    fleet.apply(event("tool", skill="git-commit-message"), at(2))

    assert statuses(fleet.view(at(3))) == [("s1", "working", "git-commit-message")]

    fleet.apply(event("prompt"), at(4))
    assert statuses(fleet.view(at(5))) == [("s1", "working", "working")]


def test_a_silent_working_session_looks_quiet() -> None:
    fleet = Fleet(quiet_after=timedelta(minutes=15))
    fleet.apply(event("tool"), at(0))

    assert statuses(fleet.view(at(15))) == [("s1", "working", "working")]
    assert statuses(fleet.view(at(16))) == [("s1", "quiet", "quiet")]


def test_lists_the_most_urgent_sessions_first_and_the_oldest_first_within() -> None:
    fleet = Fleet()
    fleet.apply(event("tool", "working"), at(0))
    fleet.apply(event("stop", "late"), at(2))
    fleet.apply(event("stop", "early"), at(1))
    fleet.apply(
        event("notification", "asking", notification="agent_needs_input"), at(3)
    )
    fleet.apply(event("stop", "waiting", waiting_on=1), at(4))

    assert [row.workspace for row in fleet.view(at(5)).rows] == [
        "asking",
        "early",
        "late",
        "working",
        "waiting",
    ]


def test_an_ended_session_disappears() -> None:
    fleet = Fleet()
    fleet.apply(event("prompt"), at(0))

    assert fleet.apply(event("end"), at(1)) is None

    assert fleet.view(at(2)).rows == ()


def test_forgets_sessions_that_stopped_reporting() -> None:
    fleet = Fleet(forget_after=timedelta(hours=8))
    fleet.apply(event("stop", "old"), at(0))
    fleet.apply(event("prompt", "new"), at(60))

    assert [row.workspace for row in fleet.view(at(8 * 60)).rows] == ["old", "new"]
    assert [row.workspace for row in fleet.view(at(8 * 60 + 1)).rows] == ["new"]

    fleet.apply(event("tool", "new"), at(8 * 60 + 1))
    fleet.apply(event("prompt", "old"), at(8 * 60 + 2))
    # The old session was dropped, so it comes back as a new one.
    assert fleet.view(at(8 * 60 + 2)).rows[1].age == timedelta(0)


def test_the_wheel_moves_the_highlight_within_the_list() -> None:
    fleet = Fleet()
    for minute, session in enumerate(["a", "b", "c"]):
        fleet.apply(event("stop", session), at(minute))

    def highlighted() -> str:
        return next(row.workspace for row in fleet.view(at(5)).rows if row.selected)

    assert highlighted() == "a"
    fleet.move_selection(2, at(5))
    assert highlighted() == "c"
    fleet.move_selection(5, at(5))
    assert highlighted() == "c"
    fleet.move_selection(-9, at(5))
    assert highlighted() == "a"


def test_moving_the_highlight_on_an_empty_board_does_nothing() -> None:
    fleet = Fleet()

    fleet.move_selection(1, at(0))

    assert fleet.view(at(0)).rows == ()


def test_the_highlight_follows_its_session_when_the_order_changes() -> None:
    fleet = Fleet()
    fleet.apply(event("stop", "a"), at(0))
    fleet.apply(event("stop", "b"), at(1))
    fleet.move_selection(1, at(2))

    fleet.apply(event("prompt", "a"), at(3))

    rows = fleet.view(at(4)).rows
    assert [(row.workspace, row.selected) for row in rows] == [
        ("b", True),
        ("a", False),
    ]


def test_acknowledging_marks_the_highlighted_session_as_seen() -> None:
    fleet = Fleet()
    fleet.apply(event("stop", "a"), at(0))
    fleet.apply(event("stop", "b"), at(1))

    fleet.acknowledge_selected(at(2))

    assert statuses(fleet.view(at(3))) == [("b", "done", "done"), ("a", "seen", "seen")]


def test_acknowledging_leaves_a_working_session_alone() -> None:
    fleet = Fleet()
    fleet.apply(event("prompt"), at(0))

    fleet.acknowledge_selected(at(1))

    assert statuses(fleet.view(at(2))) == [("s1", "working", "working")]


def test_acknowledging_everything_marks_every_waiting_session_as_seen() -> None:
    fleet = Fleet()
    fleet.apply(event("stop", "a"), at(0))
    fleet.apply(event("failure", "b", error="overloaded"), at(1))
    fleet.apply(event("tool", "c"), at(2))

    fleet.acknowledge_all(at(3))

    view = fleet.view(at(4))
    assert view.needs_you == 0
    assert statuses(view) == [
        ("c", "working", "working"),
        ("a", "seen", "seen"),
        ("b", "seen", "seen"),
    ]


def test_a_seen_session_alerts_again_when_its_next_turn_ends() -> None:
    fleet = Fleet()
    fleet.apply(event("stop"), at(0))
    fleet.acknowledge_all(at(1))

    assert fleet.apply(event("stop"), at(2)) == "done"
