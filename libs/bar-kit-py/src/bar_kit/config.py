"""Connection settings for a BUSY Bar, read from the environment."""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

USB_ADDRESS = "10.0.4.20"
"""The address a BUSY Bar answers on when it is plugged in over USB."""

CLOUD_ADDRESS = "https://api.busy.app"
"""The BUSY cloud proxy, which reaches a bar from anywhere with an API token."""

_CLOUD_HOST = "api.busy.app"


class BarConfigError(ValueError):
    """The environment describes a connection that cannot work."""


@dataclass(frozen=True, slots=True)
class BarConfig:
    """How an app reaches its BUSY Bar.

    `load_bar_config` reads it from the same variables as the TypeScript kit
    (`@busy-bar-apps/bar-kit`).
    """

    addr: str
    """IP address, host name, or URL of the bar, or `CLOUD_ADDRESS`."""

    token: str | None
    """The bar's Wi-Fi HTTP access password, or a cloud API token when
    `is_cloud` is true. USB connections need neither."""

    is_cloud: bool
    """Whether `addr` points at the BUSY cloud proxy."""


def load_bar_config(env: Mapping[str, str] | None = None) -> BarConfig:
    """Read the connection settings from `BUSYBAR_ADDR` and `BUSYBAR_TOKEN`.

    Without `BUSYBAR_ADDR`, apps talk to a bar plugged in over USB.
    """
    values = os.environ if env is None else env
    addr = values.get("BUSYBAR_ADDR", "").strip() or USB_ADDRESS
    token = values.get("BUSYBAR_TOKEN", "").strip() or None
    cloud = is_cloud_address(addr)

    if cloud and token is None:
        message = (
            "BUSYBAR_TOKEN is required when BUSYBAR_ADDR is the BUSY cloud "
            f"({CLOUD_ADDRESS}). Create a token at https://cloud.busy.app/api-tokens."
        )
        raise BarConfigError(message)

    return BarConfig(addr=addr, token=token, is_cloud=cloud)


def is_cloud_address(addr: str) -> bool:
    """Whether an address, with or without a protocol, is the BUSY cloud proxy."""
    host = urlsplit(addr if "://" in addr else f"http://{addr}").hostname
    if not host:
        message = (
            f"BUSYBAR_ADDR must be an IP address, host name, or URL; got {addr!r}."
        )
        raise BarConfigError(message)
    return host.lower() == _CLOUD_HOST
