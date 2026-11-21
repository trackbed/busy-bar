import pytest

from bar_kit import SetupError


def _open_missing_config() -> None:
    try:
        raise FileNotFoundError("config.json")
    except FileNotFoundError as error:
        raise SetupError(
            "not set up", ["No config.json in", "/srv/rotation"]
        ) from error


def test_carries_the_hint_for_each_display_and_keeps_its_cause() -> None:
    with pytest.raises(SetupError) as raised:
        _open_missing_config()

    assert raised.value.summary == "not set up"
    assert raised.value.lines == ("No config.json in", "/srv/rotation")
    assert str(raised.value) == "No config.json in /srv/rotation"
    assert isinstance(raised.value.__cause__, FileNotFoundError)
