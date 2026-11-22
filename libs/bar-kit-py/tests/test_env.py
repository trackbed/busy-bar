import pytest

from bar_kit import SettingsError, env_http_url, env_switch, env_whole_number


def test_a_switch_is_on_when_unset_or_blank() -> None:
    assert env_switch({}, "SOUND") is True
    assert env_switch({"SOUND": "  "}, "SOUND") is True


def test_a_switch_reads_on_and_off_in_any_case() -> None:
    assert env_switch({"SOUND": " OFF "}, "SOUND") is False
    assert env_switch({"SOUND": "On"}, "SOUND") is True


def test_a_switch_refuses_anything_else() -> None:
    with pytest.raises(SettingsError) as raised:
        env_switch({"SOUND": "Loud"}, "SOUND")

    assert str(raised.value) == "SOUND must be on or off; got 'loud'."


def test_a_whole_number_falls_back_when_unset_or_blank() -> None:
    assert env_whole_number({}, "MINUTES", fallback=15, minimum=1) == 15
    assert env_whole_number({"MINUTES": " "}, "MINUTES", fallback=15, minimum=1) == 15


def test_a_whole_number_reads_decimal_digits_within_the_bounds() -> None:
    env = {"LOW": " 1 ", "HIGH": "060"}

    assert env_whole_number(env, "LOW", fallback=15, minimum=1, maximum=60) == 1
    assert env_whole_number(env, "HIGH", fallback=15, minimum=1, maximum=60) == 60


@pytest.mark.parametrize(
    "raw", ["0", "61", "-5", "+5", "5.0", "1e1", "0x10", "1_0", "ten", "١٢"]
)
def test_a_whole_number_refuses_anything_else(raw: str) -> None:
    with pytest.raises(SettingsError) as raised:
        env_whole_number(
            {"MINUTES": raw}, "MINUTES", fallback=15, minimum=1, maximum=60
        )

    assert (
        str(raised.value)
        == f"MINUTES must be a whole number from 1 to 60; got {raw!r}."
    )


def test_a_whole_number_names_only_the_lower_bound_without_an_upper_one() -> None:
    with pytest.raises(SettingsError) as raised:
        env_whole_number({"MINUTES": "0"}, "MINUTES", fallback=15, minimum=1)

    assert str(raised.value) == "MINUTES must be a whole number of at least 1; got '0'."


def test_a_whole_number_names_no_bound_when_any_whole_number_goes() -> None:
    assert env_whole_number({"LOW": "0"}, "LOW", fallback=3, minimum=0) == 0
    with pytest.raises(SettingsError) as raised:
        env_whole_number({"LOW": "-1"}, "LOW", fallback=3, minimum=0)

    assert str(raised.value) == "LOW must be a whole number; got '-1'."


def test_a_url_is_none_when_unset_or_blank() -> None:
    assert env_http_url({}, "URL") is None
    assert env_http_url({"URL": " "}, "URL") is None


@pytest.mark.parametrize(
    "url",
    [
        "https://happy-otter-123.convex.cloud",
        "http://127.0.0.1:3210",
        "HTTPS://example.com/a b",
        "http://localhost:8080?x=1",
        "http://[::1]:3210/api",
    ],
)
def test_a_url_reads_as_written(url: str) -> None:
    assert env_http_url({"URL": f" {url} "}, "URL") == url


@pytest.mark.parametrize(
    "raw",
    [
        "happy-otter-123",
        "ftp://example.com",
        "https:example.com",
        "http://",
        "https://a b",
        "https://example.com:99999",
        "http://exa<mple.com",
        "http://a|b.com",
        "http://ex^ample.com",
        "http://exa%20mple.com",
        "http://1.2.3.999",
        "http://127.1",
        "http://-example.com",
        "http://example..com",
        "http://user@example.com",
        "http://example.com:",
        "http://[::g]",
        "http://\u212aelvin.com",
        "\u017fttp://example.com",
    ],
)
def test_a_url_refuses_anything_else(raw: str) -> None:
    with pytest.raises(SettingsError) as raised:
        env_http_url({"URL": raw}, "URL")

    assert str(raised.value) == f"URL must be an http(s) URL; got {raw!r}."
