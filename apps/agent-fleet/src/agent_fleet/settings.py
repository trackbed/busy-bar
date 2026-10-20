"""The fleet board's settings, read from the environment."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8740
DEFAULT_QUIET_MINUTES = 15

_MAX_PORT = 65_535
_SWITCHES = {"on": True, "off": False}


class FleetSettingsError(ValueError):
    """The environment does not describe a board that can run."""


@dataclass(frozen=True, slots=True)
class FleetSettings:
    """Where the board listens for hooks and how it behaves."""

    host: str
    """The interface the hook endpoint binds to. Keep it on loopback."""

    port: int

    sound: bool
    """Whether a session that starts needing you plays a sound on the bar."""

    quiet_after: timedelta
    """How long a working session may go without an event before it looks
    stuck."""

    @property
    def url(self) -> str:
        """The URL Claude Code's hooks post to."""
        return f"http://{self.host}:{self.port}/hook"


def load_settings(env: Mapping[str, str]) -> FleetSettings:
    """Read the `AGENT_FLEET_*` variables, all of which are optional."""
    host = env.get("AGENT_FLEET_HOST", "").strip() or DEFAULT_HOST
    port = _integer(env, "AGENT_FLEET_PORT", DEFAULT_PORT, maximum=_MAX_PORT)
    quiet = _integer(env, "AGENT_FLEET_QUIET_MINUTES", DEFAULT_QUIET_MINUTES)

    raw_sound = env.get("AGENT_FLEET_SOUND", "").strip().lower() or "on"
    if raw_sound not in _SWITCHES:
        message = f"AGENT_FLEET_SOUND must be on or off; got {raw_sound!r}."
        raise FleetSettingsError(message)

    return FleetSettings(
        host=host,
        port=port,
        sound=_SWITCHES[raw_sound],
        quiet_after=timedelta(minutes=quiet),
    )


def _integer(
    env: Mapping[str, str], name: str, default: int, *, maximum: int | None = None
) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    if not raw.isdecimal() or int(raw) < 1 or (maximum and int(raw) > maximum):
        bound = f"from 1 to {maximum}" if maximum else "of at least 1"
        message = f"{name} must be a whole number {bound}; got {raw!r}."
        raise FleetSettingsError(message)
    return int(raw)
