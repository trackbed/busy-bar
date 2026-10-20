import pytest

from agent_fleet.hooks import (
    HookEvent,
    Workspace,
    hook_settings,
    parse_hook,
    skill_label,
    workspace_of,
)

CWD = "/Users/me/conductor/workspaces/kramme-busy-bar-apps/quebec"


def payload(event: str, **fields: object) -> dict[str, object]:
    return {"hook_event_name": event, "session_id": "s1", "cwd": CWD, **fields}


def test_reads_a_prompt_and_the_skill_its_slash_command_runs() -> None:
    event = parse_hook(
        payload("UserPromptSubmit", prompt="/kramme-cc-workflow:kramme-pr-fix-ci")
    )

    assert event == HookEvent("prompt", "s1", CWD, skill="pr-fix-ci")


def test_reads_the_skill_from_an_expanded_skill_prompt() -> None:
    prompt = (
        "Base directory for this skill: /Users/me/.claude/plugins/cache/x/0.87.0"
        "/skills/kramme:pr:create\n\n# Create Pull Request"
    )

    event = parse_hook(payload("UserPromptSubmit", prompt=prompt))

    assert event is not None
    assert event.skill == "pr:create"


@pytest.mark.parametrize("prompt", ["Fix the flaky test", "/", "   "])
def test_a_plain_prompt_runs_no_skill(prompt: str) -> None:
    event = parse_hook(payload("UserPromptSubmit", prompt=prompt))

    assert event is not None
    assert event.skill is None


def test_reads_the_skill_a_tool_call_loads() -> None:
    event = parse_hook(
        payload(
            "PreToolUse",
            tool_name="Skill",
            tool_input={"skill": "mattpocock-skills:tdd"},
        )
    )

    assert event == HookEvent("tool", "s1", CWD, skill="tdd")


@pytest.mark.parametrize(
    "fields",
    [
        {"tool_name": "Bash", "tool_input": {"command": "ls"}},
        {"tool_name": "Skill", "tool_input": "not a mapping"},
        {"tool_name": "Skill", "tool_input": {}},
    ],
)
def test_other_tool_calls_are_activity_without_a_skill(
    fields: dict[str, object],
) -> None:
    assert parse_hook(payload("PreToolUse", **fields)) == HookEvent("tool", "s1", CWD)


def test_counts_what_a_stopped_session_still_waits_for() -> None:
    event = parse_hook(
        payload(
            "Stop",
            background_tasks=[{"id": "t1"}, {"id": "t2"}],
            session_crons=[{"id": "c1"}],
        )
    )

    assert event == HookEvent("stop", "s1", CWD, waiting_on=3)


def test_a_stop_without_the_task_lists_waits_for_nothing() -> None:
    assert parse_hook(payload("Stop")) == HookEvent("stop", "s1", CWD)


def test_reads_a_notification_that_asks_for_you() -> None:
    event = parse_hook(payload("Notification", notification_type="permission_prompt"))

    assert event == HookEvent(
        "notification", "s1", CWD, notification="permission_prompt"
    )


@pytest.mark.parametrize("notification", ["idle_prompt", "auth_success", None])
def test_ignores_notifications_that_need_nothing(notification: str | None) -> None:
    assert parse_hook(payload("Notification", notification_type=notification)) is None


def test_reads_the_error_a_turn_ended_with() -> None:
    assert parse_hook(payload("StopFailure", error="rate_limit")) == HookEvent(
        "failure", "s1", CWD, error="rate_limit"
    )
    assert parse_hook(payload("StopFailure")) == HookEvent(
        "failure", "s1", CWD, error="unknown"
    )


def test_reads_the_end_of_a_session() -> None:
    assert parse_hook(payload("SessionEnd", reason="other")) == HookEvent(
        "end", "s1", CWD
    )


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        "Stop",
        {"hook_event_name": "PostToolUse", "session_id": "s1"},
        {"hook_event_name": "Stop"},
        {"hook_event_name": "Stop", "session_id": ""},
    ],
)
def test_ignores_payloads_it_has_no_use_for(body: object) -> None:
    assert parse_hook(body) is None


@pytest.mark.parametrize(
    ("cwd", "workspace"),
    [
        (CWD, Workspace(name="quebec", repo="kramme-busy-bar-apps")),
        (f"{CWD}/apps/clock", Workspace(name="quebec", repo="kramme-busy-bar-apps")),
        ("/Users/me/projects/consensus-connect", Workspace("consensus-connect", "")),
        ("/Users/me/projekter/kø", Workspace(name="koe", repo="")),
        ("", Workspace(name="?", repo="")),
    ],
)
def test_names_a_session_after_its_workspace(cwd: str, workspace: Workspace) -> None:
    assert workspace_of(cwd) == workspace


@pytest.mark.parametrize(
    ("name", "label"),
    [
        ("kramme-cc-workflow:kramme-pr-fix-ci", "pr-fix-ci"),
        ("kramme:pr:create", "pr:create"),
        ("anthropic-skills:pdf", "pdf"),
        ("simplify", "simplify"),
    ],
)
def test_shortens_skill_names(name: str, label: str) -> None:
    assert skill_label(name) == label


def test_builds_the_settings_block_for_every_event_it_reads() -> None:
    settings = hook_settings("http://127.0.0.1:8740/hook")

    hooks = settings["hooks"]
    assert isinstance(hooks, dict)
    assert list(hooks) == [
        "UserPromptSubmit",
        "PreToolUse",
        "Stop",
        "Notification",
        "StopFailure",
        "SessionEnd",
    ]
    assert hooks["Stop"] == [
        {"hooks": [{"type": "http", "url": "http://127.0.0.1:8740/hook", "timeout": 2}]}
    ]
    assert hooks["SessionEnd"] == [
        {"hooks": [{"type": "http", "url": "http://127.0.0.1:8740/hook", "timeout": 1}]}
    ]
