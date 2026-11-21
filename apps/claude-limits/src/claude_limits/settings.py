"""The limits board's settings, read from the environment."""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from bar_kit import env_switch
from claude_limits.rotation import DEFAULT_ROOT


@dataclass(frozen=True, slots=True)
class LimitsSettings:
    """Where the rotation tool keeps its files, and whether to play sounds."""

    root: Path
    sound: bool
    """Whether a rotation, or every account reaching its limit, plays a sound."""


def load_settings(
    env: Mapping[str, str], *, home: Path | None = None
) -> LimitsSettings:
    """Read `CLAUDE_LIMITS_DIR` and `CLAUDE_LIMITS_SOUND`, both optional."""
    raw_root = env.get("CLAUDE_LIMITS_DIR", "").strip()
    root = Path(raw_root) if raw_root else DEFAULT_ROOT
    if root.parts and root.parts[0] == "~":
        root = (home or Path.home()).joinpath(*root.parts[1:])
    return LimitsSettings(root=root, sound=env_switch(env, "CLAUDE_LIMITS_SOUND"))
