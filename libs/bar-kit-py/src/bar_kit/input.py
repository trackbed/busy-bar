"""The bar's buttons, wheel, and mode selector, from its status stream.

The Python counterpart of the TypeScript kit's `listenForInput`. busylib's
`AsyncBusyBar.stream_status_ws` decodes the stream, and its `input_events`
turns each message into typed events.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Mapping

from busylib.features import InputEvent, input_events

from bar_kit._clock import Stopped, until_stopped, wait_for_stop
from bar_kit.config import BarConfig

logger = logging.getLogger(__name__)

RECONNECT_SECONDS = 5.0
"""How long `listen_for_input` waits before reopening a dropped stream."""


async def listen_for_input(  # noqa: PLR0913 - keyword-only settings, one per concern.
    *,
    name: str,
    config: BarConfig,
    stream: Callable[[], AsyncIterator[object]],
    handle: Callable[[InputEvent], None],
    stop: asyncio.Event,
    reconnect_seconds: float = RECONNECT_SECONDS,
) -> None:
    """Feed the bar's input events to `handle` until `stop` is set.

    `name` names the app in log messages. `stream` opens the bar's status
    stream, such as busylib's `AsyncBusyBar.stream_status_ws`. A dropped
    stream reopens after `reconnect_seconds`, and an error `handle` raises is
    logged, not fatal. The BUSY cloud does not stream input, so on the cloud
    this warns once and returns. Every listener gets every event, whichever
    app is on screen.
    """
    if config.is_cloud:
        logger.warning(
            "[%s] The wheel and buttons need a direct connection to the bar; "
            "the cloud does not stream them.",
            name,
        )
        return
    while not stop.is_set():
        try:
            await until_stopped(_pass_on(name, stream, handle), stop)
        except Stopped:
            return
        except Exception:  # The bar rebooted or left the network.
            if not stop.is_set():
                logger.warning("[%s] Lost the bar's input stream.", name, exc_info=True)
        else:
            if not stop.is_set():
                logger.warning("[%s] The bar closed its input stream.", name)
        await wait_for_stop(reconnect_seconds, stop)


async def _pass_on(
    name: str,
    stream: Callable[[], AsyncIterator[object]],
    handle: Callable[[InputEvent], None],
) -> None:
    """Hand every input event of one stream to `handle`, until it closes."""
    async for message in stream():
        if isinstance(message, Mapping):
            for event in input_events(message):
                try:
                    handle(event)
                except Exception:  # A handler bug must not end the stream.
                    logger.warning(
                        "[%s] Handling an input event failed.", name, exc_info=True
                    )
