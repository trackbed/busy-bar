import pytest
from contract import addresses

from bar_kit import BarConfig, BarConfigError, load_bar_config
from bar_kit.config import CLOUD_ADDRESS, USB_ADDRESS, is_cloud_address


def test_defaults_to_a_bar_plugged_in_over_usb() -> None:
    assert load_bar_config({}) == BarConfig(
        addr=USB_ADDRESS, token=None, is_cloud=False
    )


def test_reads_a_wifi_address_and_its_http_access_password() -> None:
    config = load_bar_config(
        {"BUSYBAR_ADDR": " 192.168.1.20 ", "BUSYBAR_TOKEN": "1234"}
    )

    assert config == BarConfig(addr="192.168.1.20", token="1234", is_cloud=False)


def test_treats_blank_variables_as_unset() -> None:
    config = load_bar_config({"BUSYBAR_ADDR": "  ", "BUSYBAR_TOKEN": ""})

    assert config == BarConfig(addr=USB_ADDRESS, token=None, is_cloud=False)


def test_reads_the_process_environment_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("BUSYBAR_ADDR", "busybar.local")
    monkeypatch.delenv("BUSYBAR_TOKEN", raising=False)

    assert load_bar_config().addr == "busybar.local"


def test_accepts_the_cloud_proxy_with_a_token() -> None:
    config = load_bar_config({"BUSYBAR_ADDR": CLOUD_ADDRESS, "BUSYBAR_TOKEN": "secret"})

    assert config == BarConfig(addr=CLOUD_ADDRESS, token="secret", is_cloud=True)


def test_rejects_the_cloud_proxy_without_a_token() -> None:
    with pytest.raises(BarConfigError, match="BUSYBAR_TOKEN is required"):
        load_bar_config({"BUSYBAR_ADDR": CLOUD_ADDRESS})


ADDRESSES = addresses()


def test_has_the_shared_cases_to_check() -> None:
    assert ADDRESSES


@pytest.mark.parametrize(("addr", "cloud"), ADDRESSES)
def test_classifies_addresses(addr: str, *, cloud: bool | None) -> None:
    if cloud is None:
        with pytest.raises(BarConfigError, match="must be an IP address"):
            is_cloud_address(addr)
    else:
        assert is_cloud_address(addr) is cloud
