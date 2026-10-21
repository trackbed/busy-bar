"""The frame loop every app runs."""

import asyncio
import logging
import signal
from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Protocol

from busylib import types

from bar_kit._clock import utc_now, wait_for_stop

logger = logging.getLogger(__name__)

DEFAULT_PRIORITY = 50
"""The bar's default draw priority."""

_MIN_PRIORITY = 1
_MAX_PRIORITY = 100

type Render = Callable[[datetime], Sequence[types.DisplayElement]]
"""Map the current time to the elements to draw. Keep it pure."""


class DisplayClient(Protocol):
    """The part of busylib's `AsyncBusyBar` that `run_bar_app` uses."""

    async def display_draw(self, display_data: types.DisplayElements, /) -> object:
        """Draw elements on the bar."""
        ...

    async def display_clear(
        self, *, application_name: str, element_ids: Sequence[str] | None = None
    ) -> object:
        """Remove what an application drew: everything, or the `element_ids`."""
        ...


async def run_bar_app(  # noqa: PLR0913 - keyword-only settings, one per concern.
    *,
    name: str,
    client: DisplayClient,
    render: Render,
    interval: float,
    stop: asyncio.Event,
    priority: int = DEFAULT_PRIORITY,
    now: Callable[[], datetime] = utc_now,
) -> None:
    """Draw a frame every `interval` seconds until `stop` is set, then clear.

    `name` is the `application_name` everything the app draws belongs to.
    `priority` is an integer from 1 to 100: the bar accepts a draw from the
    app on screen at or above its priority, and from another app only above
    it. Built-in apps run at 10; while a BUSY timer runs or is paused the bar
    refuses every draw.

    The bar merges each draw into what the app already shows, by element id,
    so elements the last frame drew and this one does not are deleted after
    the draw. Failed draws and deletions are logged and retried on later
    frames, so an app survives the bar dropping off Wi-Fi. An exception raised by
    `render` is a bug: it clears the display and propagates.
    """
    if not _MIN_PRIORITY <= priority <= _MAX_PRIORITY:
        message = f"Draw priority must be an integer from 1 to 100; got {priority}."
        raise ValueError(message)

    # IDs that may still be displayed, including deletions awaiting a retry.
    shown: list[str] = []
    try:
        while not stop.is_set():
            frame = types.DisplayElements(
                application_name=name, priority=priority, elements=list(render(now()))
            )
            operation = "Drawing on"
            try:
                await client.display_draw(frame)
                drawn = [element.id for element in frame.elements]
                stale = [element_id for element_id in shown if element_id not in drawn]
                shown = list(dict.fromkeys([*shown, *drawn]))
                if stale:
                    operation = "Deleting stale elements from"
                    await client.display_clear(application_name=name, element_ids=stale)
                shown = drawn
            except Exception:  # A dropped draw must not end the app.
                logger.warning(
                    "[%s] %s the BUSY Bar failed.", name, operation, exc_info=True
                )
            await wait_for_stop(interval, stop)
    finally:
        try:
            await client.display_clear(application_name=name)
        except Exception:  # Shutdown continues if the bar is gone.
            logger.warning(
                "[%s] Clearing the BUSY Bar display failed.", name, exc_info=True
            )


def install_shutdown_handlers(stop: asyncio.Event) -> None:
    """Set `stop` on SIGINT or SIGTERM.

    Both Ctrl+C and a process manager stopping the app then end `run_bar_app`
    cleanly. Call it from inside the running event loop.
    """
    loop = asyncio.get_running_loop()
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signum, stop.set)
        except NotImplementedError:  # pragma: no cover - Windows event loops.
            signal.signal(signum, lambda *_: loop.call_soon_threadsafe(stop.set))
