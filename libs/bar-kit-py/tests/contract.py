"""The cases of `bar-kit-contract.json`, which the TypeScript kit's tests read too.

Both kits testing against one file keeps them from drifting apart on these rules.
"""

import json
from pathlib import Path

_PATH = Path(__file__).resolve().parents[3] / "bar-kit-contract.json"


def _load() -> dict[str, object]:
    contract: object = json.loads(_PATH.read_text(encoding="utf-8"))
    if not isinstance(contract, dict):
        message = f"{_PATH.name} has an unexpected shape."
        raise TypeError(message)
    return {str(key): value for key, value in contract.items()}


def _entries(key: str) -> list[object]:
    entries = _CONTRACT.get(key)
    if not isinstance(entries, list):
        message = f"{_PATH.name} has no {key} list."
        raise TypeError(message)
    return list(entries)


def _malformed(entry: object) -> TypeError:
    return TypeError(f"{_PATH.name} has a malformed entry {entry!r}.")


_CONTRACT = _load()


def text_cases() -> list[tuple[str, str]]:
    """Text and what `to_bar_text` turns it into."""
    cases = []
    for entry in _entries("toBarText"):
        if not isinstance(entry, dict):
            raise _malformed(entry)
        text, expected = entry.get("text"), entry.get("expected")
        if not isinstance(text, str) or not isinstance(expected, str):
            raise _malformed(entry)
        cases.append((text, expected))
    return cases


def unmeasurable() -> list[str]:
    """Text `text_width` refuses: the fonts draw printable ASCII only."""
    texts = []
    for entry in _entries("unmeasurable"):
        if not isinstance(entry, str):
            raise _malformed(entry)
        texts.append(entry)
    return texts


def addresses() -> list[tuple[str, bool | None]]:
    """`BUSYBAR_ADDR` values and whether each is the BUSY cloud.

    None marks an address `load_bar_config` refuses.
    """
    cases = []
    for entry in _entries("addresses"):
        if not isinstance(entry, dict):
            raise _malformed(entry)
        addr, cloud = entry.get("addr"), entry.get("cloud")
        if not isinstance(addr, str) or not (cloud is None or isinstance(cloud, bool)):
            raise _malformed(entry)
        cases.append((addr, cloud))
    return cases
