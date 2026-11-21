from datetime import timedelta
from pathlib import Path

import pytest
from samples import EPOCH_NOW, NOW, WriteJson, usage_window

from bar_kit import SetupError
from claude_limits.rotation import (
    Account,
    Rotation,
    Window,
    read_rotation,
)

CONFIG = {
    "accounts": [{"id": "account-a"}, {"id": "account-b"}, {"label": "no id"}],
    "initial_account": "account-a",
    "threshold": 95,
    "max_usage_age_seconds": 300,
}


def test_reads_accounts_usage_and_state(tmp_path: Path, write_json: WriteJson) -> None:
    write_json("config.json", CONFIG)
    write_json(
        "state/state.json",
        {
            "current_account": "account-b",
            "pending": {"to_account": "account-a", "phase": "restart_workspaces"},
            "blocked_until": {"account-a": EPOCH_NOW + 600},
        },
    )
    write_json(
        "state/usage/account-a.json",
        {
            "account_id": "account-a",
            "five_hour": usage_window(98.5, resets_in_minutes=42),
            "seven_day": usage_window(40, resets_in_minutes=3 * 24 * 60),
        },
    )
    rotation = read_rotation(tmp_path)

    assert rotation == Rotation(
        accounts=(
            Account(
                label="account-a",
                five_hour=Window(
                    used=98.5,
                    resets_at=NOW + timedelta(minutes=42),
                    observed_at=NOW - timedelta(minutes=1),
                ),
                seven_day=Window(
                    used=40,
                    resets_at=NOW + timedelta(days=3),
                    observed_at=NOW - timedelta(minutes=1),
                ),
                blocked_until=NOW + timedelta(minutes=10),
            ),
            Account(label="account-b", five_hour=None, seven_day=None),
        ),
        current="account-b",
        rotating_to="account-a",
        threshold=95,
        max_usage_age=timedelta(minutes=5),
    )
    assert rotation.account("account-b") == rotation.accounts[1]
    assert rotation.account("missing") is None


def test_falls_back_to_the_initial_account_and_defaults(
    tmp_path: Path, write_json: WriteJson
) -> None:
    write_json("config.json", {"accounts": [{"id": "work"}], "initial_account": "work"})

    rotation = read_rotation(tmp_path)

    assert rotation.current == "work"
    assert rotation.rotating_to is None
    assert rotation.threshold == 100
    assert rotation.max_usage_age == timedelta(minutes=10)


def test_follows_a_custom_state_directory(
    tmp_path: Path, write_json: WriteJson
) -> None:
    write_json("config.json", {**CONFIG, "state_directory": "elsewhere"})
    write_json("elsewhere/state.json", {"current_account": "account-b"})

    assert read_rotation(tmp_path).current == "account-b"


@pytest.mark.parametrize(
    "five_hour",
    [
        {"used_percentage": "high", "resets_at": EPOCH_NOW, "observed_at": EPOCH_NOW},
        {"used_percentage": True, "resets_at": EPOCH_NOW, "observed_at": EPOCH_NOW},
        {"used_percentage": 10, "resets_at": "soon", "observed_at": EPOCH_NOW},
        {
            "used_percentage": 10,
            "resets_at": "2026-10-20T13:00:00",
            "observed_at": EPOCH_NOW,
        },
        {"used_percentage": 10, "resets_at": [], "observed_at": EPOCH_NOW},
        None,
    ],
)
def test_treats_a_malformed_window_as_no_reading(
    tmp_path: Path, write_json: WriteJson, five_hour: object
) -> None:
    write_json("config.json", CONFIG)
    write_json("state/usage/account-a.json", {"five_hour": five_hour})

    assert read_rotation(tmp_path).accounts[0].five_hour is None


def test_reads_an_empty_account_list_when_the_config_has_none(
    tmp_path: Path, write_json: WriteJson
) -> None:
    write_json("config.json", {"accounts": "none"})

    assert read_rotation(tmp_path).accounts == ()


def test_names_the_folder_when_the_tool_is_not_set_up(tmp_path: Path) -> None:
    with pytest.raises(SetupError) as raised:
        read_rotation(tmp_path / "conductor-claude-rotation")

    assert raised.value.summary == "not set up"
    assert raised.value.lines == (
        "conductor-claude-rotation has no",
        "config.json in",
        f"{tmp_path}/",
        "conductor-claude-rotation",
    )


@pytest.mark.parametrize(
    ("content", "error"),
    [("{broken", "is not valid JSON"), ("[]", "does not hold a JSON object")],
)
def test_rejects_files_the_tool_did_not_write(
    tmp_path: Path, content: str, error: str
) -> None:
    (tmp_path / "config.json").write_text(content, encoding="utf-8")

    with pytest.raises(ValueError, match=error):
        read_rotation(tmp_path)
