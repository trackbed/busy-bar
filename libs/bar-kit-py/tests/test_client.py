import pytest

from bar_kit import BarConfig, create_busy_bar


@pytest.mark.parametrize(
    ("config", "base_url", "headers"),
    [
        pytest.param(
            BarConfig(addr="10.0.4.20", token=None, is_cloud=False),
            "http://10.0.4.20",
            {},
            id="usb",
        ),
        pytest.param(
            BarConfig(addr="192.168.1.20", token="1234", is_cloud=False),
            "http://192.168.1.20",
            {"x-api-token": "1234"},
            id="wifi",
        ),
        pytest.param(
            BarConfig(addr="https://api.busy.app", token="secret", is_cloud=True),
            "https://api.busy.app",
            {"authorization": "Bearer secret"},
            id="cloud",
        ),
    ],
)
async def test_sends_the_token_the_way_the_connection_expects(
    config: BarConfig, base_url: str, headers: dict[str, str]
) -> None:
    client = create_busy_bar(config)
    async with client:
        sent = {
            name: value
            for name, value in client.client.headers.items()
            if name in {"authorization", "x-api-token"}
        }

        assert str(client.client.base_url).startswith(base_url)
        assert sent == headers
