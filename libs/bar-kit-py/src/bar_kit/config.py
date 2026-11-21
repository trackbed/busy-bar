"""Connection settings for a BUSY Bar, read from the environment."""

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

USB_ADDRESS = "10.0.4.20"
"""The address a BUSY Bar answers on when it is plugged in over USB."""

CLOUD_ADDRESS = "https://api.busy.app"
"""The BUSY cloud proxy, which reaches a bar from anywhere with an API token."""

_CLOUD_HOST = "api.busy.app"

_SCHEME = re.compile(r"[a-z][a-z\d+.-]*://", re.IGNORECASE)

# What a URL's host name cannot hold once percent-decoded (the WHATWG URL
# standard's forbidden domain code points, less those `urlsplit` already splits
# the address on), so a host Node's `URL` refuses, such as `my bar`, is refused
# here too.
_FORBIDDEN_IN_HOST = re.compile(r"[\x00-\x20%<>\\^|\x7f]")

_DIGITS = {8: "01234567", 10: "0123456789", 16: "0123456789abcdef"}
_IPV4_BYTES = 4
_BYTE_VALUES = 256


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
    """Whether an address, with or without a protocol, is the BUSY cloud proxy.

    Raises `BarConfigError` for an address that is not a host name, IP address,
    or URL, as the TypeScript kit does.
    """
    try:
        url = urlsplit(addr if _SCHEME.match(addr) else f"http://{addr}")
        host = url.hostname
        _ = url.port  # Raises on a port that is not a number from 0 to 65535.
    except ValueError:
        host = None
    # A host with a colon is an IPv6 address, which `urlsplit` has checked.
    if host and ":" not in host:
        host = unquote(host).lower()
        if _FORBIDDEN_IN_HOST.search(host) or (
            _ends_in_number(host) and not _is_ipv4(host)
        ):
            host = None
    if not host:
        message = (
            f"BUSYBAR_ADDR must be an IP address, host name, or URL; got {addr!r}."
        )
        raise BarConfigError(message)
    return host == _CLOUD_HOST


# The WHATWG URL standard's IPv4 rules, which Node's `URL` follows: a host whose
# last label is a number must be an IPv4 address, in dotted decimal or in its
# shorthands such as `127.1` and `0x7f.0.0.1`, so `192.168.1.256` is refused.


def _labels(host: str) -> list[str]:
    labels = host.split(".")
    return labels[:-1] if len(labels) > 1 and not labels[-1] else labels


def _ends_in_number(host: str) -> bool:
    last = _labels(host)[-1]
    return (last.isascii() and last.isdigit()) or _ipv4_number(last) is not None


def _is_ipv4(host: str) -> bool:
    labels = _labels(host)
    numbers = [
        number for label in labels if (number := _ipv4_number(label)) is not None
    ]
    if len(numbers) != len(labels) or len(numbers) > _IPV4_BYTES:
        return False
    # Each number is one byte, but the last fills the bytes that remain.
    *leading, last = numbers
    remaining = _IPV4_BYTES - len(leading)
    return all(number < _BYTE_VALUES for number in leading) and (
        last < _BYTE_VALUES**remaining
    )


def _ipv4_number(label: str) -> int | None:
    """`label` as one part of an IPv4 address, in decimal, octal, or hex."""
    if not label:
        return None
    base = 10
    if label.startswith("0x"):
        label, base = label[2:], 16
    elif len(label) > 1 and label.startswith("0"):
        label, base = label[1:], 8
    if not all(digit in _DIGITS[base] for digit in label):
        return None
    return int(label, base) if label else 0
