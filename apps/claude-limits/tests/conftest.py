import json
from pathlib import Path

import pytest
from samples import WriteJson


@pytest.fixture
def write_json(tmp_path: Path) -> WriteJson:
    """Write a JSON file relative to a rotation root in `tmp_path`."""

    def write(relative: str, content: object) -> Path:
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content), encoding="utf-8")
        return path

    return write
