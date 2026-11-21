from pathlib import Path

import pytest

from bar_kit import SettingsError
from claude_limits.settings import LimitsSettings, load_settings

HOME = Path("/Users/me")


def test_defaults_to_the_rotation_tools_data_root_with_sound() -> None:
    assert load_settings({}, home=HOME) == LimitsSettings(
        root=HOME / ".local/share/conductor-claude-rotation", sound=True
    )


def test_reads_a_custom_directory_and_turns_sound_off() -> None:
    settings = load_settings(
        {"CLAUDE_LIMITS_DIR": " ~/rotation ", "CLAUDE_LIMITS_SOUND": "Off"}, home=HOME
    )

    assert settings == LimitsSettings(root=HOME / "rotation", sound=False)


def test_keeps_an_absolute_directory() -> None:
    settings = load_settings({"CLAUDE_LIMITS_DIR": "/srv/rotation"}, home=HOME)

    assert settings.root == Path("/srv/rotation")


def test_rejects_an_unknown_sound_switch() -> None:
    with pytest.raises(SettingsError, match="CLAUDE_LIMITS_SOUND must be on or off"):
        load_settings({"CLAUDE_LIMITS_SOUND": "maybe"})
