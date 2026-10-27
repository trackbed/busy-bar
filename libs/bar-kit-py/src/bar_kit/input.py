"""The bar's buttons, wheel, and mode selector, from its status stream.

The Python counterpart of the TypeScript kit's `listenForInput`. busylib's
`AsyncBusyBar.stream_status_ws` decodes the stream, and its `input_events`
turns each message into typed events.
"""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable, Mapping

from busylib.features import InputEvent, input_events

logger = logging.getLogger(__name__)

RECONNECT_SECONDS = 5.0
"""How long `listen_for_input` waits before reopening a dropped stream."""


async def listen_for_input(
    stream: Callable[[], AsyncIterator[object]],
    handle: Callable[[InputEvent], None],
    *,
    reconnect_seconds: float = RECONNECT_SECONDS,
) -> None:
    """Feed the bar's input events to `handle` until cancelled.

    `stream` opens the bar's status stream, such as busylib's
    `AsyncBusyBar.stream_status_ws`. A dropped stream reconnects after
    `reconnect_seconds`, and an error `handle` raises is logged, not fatal.
    The cloud does not stream input, so there this warns once and returns.
    Every listener gets every event, whichever app is on screen.
    """
    while True:
        try:
            async for message in stream():
                if isinstance(message, Mapping):
                    for event in input_events(message):
                        _handle_quietly(handle, event)
        except NotImplementedError:
            logger.warning(
                "The wheel and buttons need a direct connection to the bar; "
                "the cloud does not stream them."
            )
            return
        except Exception:  # The bar rebooted or left the network.
            logger.warning("Lost the bar's input stream.", exc_info=True)
        else:
            logger.warning("The bar closed its input stream.")
        await asyncio.sleep(reconnect_seconds)


def _handle_quietly(handle: Callable[[InputEvent], None], event: InputEvent) -> None:
    try:
        handle(event)
    except Exception:  # A handler bug must not end the stream.
        logger.warning("Handling an input event failed.", exc_info=True)
