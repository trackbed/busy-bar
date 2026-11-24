"""The fleet board's settings, read from the environment."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from bar_kit import env_switch, env_whole_number

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8740
DEFAULT_QUIET_MINUTES = 15

_MAX_PORT = 65_535


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

    showtime: Path | None = None

    @property
    def url(self) -> str:
        """The URL Claude Code's hooks post to."""
        return f"http://{self.host}:{self.port}/hook"


def load_settings(env: Mapping[str, str]) -> FleetSettings:
    """Read the `AGENT_FLEET_*` variables, all of which are optional."""
    host = env.get("AGENT_FLEET_HOST", "").strip() or DEFAULT_HOST
    port = env_whole_number(
        env, "AGENT_FLEET_PORT", fallback=DEFAULT_PORT, minimum=1, maximum=_MAX_PORT
    )
    quiet = env_whole_number(
        env, "AGENT_FLEET_QUIET_MINUTES", fallback=DEFAULT_QUIET_MINUTES, minimum=1
    )
    path = env.get("AGENT_FLEET_SHOWTIME", "").strip()
    return FleetSettings(
        host=host,
        showtime=Path(path).expanduser() if path else None,
        port=port,
        sound=env_switch(env, "AGENT_FLEET_SOUND"),
        quiet_after=timedelta(minutes=quiet),
    )
