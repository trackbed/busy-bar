"""Readers for the settings apps take from the environment.

Each treats an unset or blank variable as its default and raises a
`SettingsError` naming the variable and the value it refused. The TypeScript
kit (`@busy-bar-apps/bar-kit`) applies the same rules with the same messages,
quoting the value its own way.
"""

import ipaddress
import re
from collections.abc import Mapping

_SWITCHES = {"on": True, "off": False}
_DIGITS = re.compile(r"[0-9]+")
_HTTP_URL = re.compile(
    r"https?://(?P<host>[^/?#:\[\]]+|\[[0-9a-f:.]+\])(?::(?P<port>[0-9]+))?(?:[/?#].*)?",
    re.IGNORECASE | re.ASCII | re.DOTALL,
)
# re.ASCII keeps IGNORECASE from matching the Kelvin sign as `k`.
_LABEL = re.compile(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", re.IGNORECASE | re.ASCII)
_OCTET = re.compile(r"0|[1-9][0-9]{0,2}")
_MAX_PORT = 65_535
_MAX_OCTET = 255
_IPV4_LABELS = 4


class SettingsError(ValueError):
    """The environment does not describe an app that can run.

    Each app's own settings error extends it.
    """


def env_switch(env: Mapping[str, str], name: str) -> bool:
    """`on` or `off`, in any case; unset means on."""
    raw = env.get(name, "").strip().lower() or "on"
    if raw not in _SWITCHES:
        message = f"{name} must be on or off; got {raw!r}."
        raise SettingsError(message)
    return _SWITCHES[raw]


def env_whole_number(
    env: Mapping[str, str],
    name: str,
    *,
    fallback: int,
    minimum: int,
    maximum: int | None = None,
) -> int:
    """A whole number in decimal digits only, from `minimum` to `maximum`.

    `fallback` is the value when the variable is unset or blank. Without a
    `maximum` there is no upper bound. Signs, decimal points, exponents,
    underscores, and non-ASCII digits are refused.
    """
    raw = env.get(name, "").strip()
    if not raw:
        return fallback
    if (
        not _DIGITS.fullmatch(raw)
        or int(raw) < minimum
        or (maximum is not None and int(raw) > maximum)
    ):
        if maximum is not None:
            bound = f" from {minimum} to {maximum}"
        elif minimum > 0:
            bound = f" of at least {minimum}"
        else:
            bound = ""
        message = f"{name} must be a whole number{bound}; got {raw!r}."
        raise SettingsError(message)
    return int(raw)


def env_http_url(env: Mapping[str, str], name: str) -> str | None:
    """An absolute `http://` or `https://` URL, as written.

    `None` when the variable is unset or blank. The host is a name of letters,
    digits, and hyphens, a dotted IPv4 address, or a bracketed IPv6 address; a
    port, when given, runs from 0 to 65535. User info is refused.
    """
    raw = env.get(name, "").strip()
    if not raw:
        return None
    parts = _HTTP_URL.fullmatch(raw)
    if (
        parts is None
        or not _is_valid_host(parts["host"])
        or (parts["port"] is not None and int(parts["port"]) > _MAX_PORT)
    ):
        message = f"{name} must be an http(s) URL; got {raw!r}."
        raise SettingsError(message)
    return raw


def _is_valid_host(host: str) -> bool:
    if host.startswith("["):
        try:
            ipaddress.IPv6Address(host[1:-1])
        except ValueError:
            return False
        return True
    labels = host.split(".")
    if not all(_LABEL.fullmatch(label) for label in labels):
        return False
    # A name ending in a number is an IPv4 address and must be a dotted quad.
    return not labels[-1].isdigit() or (
        len(labels) == _IPV4_LABELS
        and all(
            _OCTET.fullmatch(label) and int(label) <= _MAX_OCTET for label in labels
        )
    )
