"""busylib client construction."""

from busylib import AsyncBusyBar

from bar_kit.config import BarConfig


def create_busy_bar(config: BarConfig) -> AsyncBusyBar:
    """Create an async busylib client for the configured bar.

    busylib sends the token as a bearer token to the cloud proxy and as the
    HTTP access password over Wi-Fi. Enter the client with `async with client:`
    so its connection pool closes; avoid `async with ... as client`, because
    busylib types that result as its base client, without the display methods.
    """
    return AsyncBusyBar(config.addr, token=config.token, is_cloud=config.is_cloud)
