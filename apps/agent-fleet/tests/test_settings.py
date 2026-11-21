from datetime import timedelta

import pytest

from agent_fleet.settings import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    FleetSettings,
    load_settings,
)
from bar_kit import SettingsError


def test_defaults_to_loopback_with_sound() -> None:
    settings = load_settings({})

    assert settings == FleetSettings(
        host=DEFAULT_HOST,
        port=DEFAULT_PORT,
        sound=True,
        quiet_after=timedelta(minutes=15),
    )
    assert settings.url == "http://127.0.0.1:8740/hook"


def test_reads_every_setting() -> None:
    settings = load_settings(
        {
            "AGENT_FLEET_HOST": " 0.0.0.0 ",
            "AGENT_FLEET_PORT": "9000",
            "AGENT_FLEET_SOUND": "OFF",
            "AGENT_FLEET_QUIET_MINUTES": "30",
        }
    )

    assert settings == FleetSettings(
        host="0.0.0.0",  # noqa: S104 - parsing the value, not binding to it.
        port=9000,
        sound=False,
        quiet_after=timedelta(minutes=30),
    )


@pytest.mark.parametrize(
    ("env", "error"),
    [
        ({"AGENT_FLEET_PORT": "http"}, "AGENT_FLEET_PORT must be a whole number"),
        ({"AGENT_FLEET_PORT": "0"}, "from 1 to 65535"),
        ({"AGENT_FLEET_PORT": "70000"}, "from 1 to 65535"),
        ({"AGENT_FLEET_QUIET_MINUTES": "-5"}, "of at least 1"),
        ({"AGENT_FLEET_QUIET_MINUTES": "\u0661\u0665"}, "of at least 1"),
        ({"AGENT_FLEET_SOUND": "loud"}, "AGENT_FLEET_SOUND must be on or off"),
    ],
)
def test_rejects_settings_it_cannot_use(env: dict[str, str], error: str) -> None:
    with pytest.raises(SettingsError, match=error):
        load_settings(env)
