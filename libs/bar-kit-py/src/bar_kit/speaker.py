"""Alert sounds every bar ships, played without holding up the app."""

import asyncio
import logging
from typing import Literal, Protocol

from busylib.features.notification import STOCK_SOUNDS

logger = logging.getLogger(__name__)

type StockSound = Literal["event", "reminder", "volume"]
"""busylib's names for the sounds every bar ships (`STOCK_SOUNDS`)."""


class AudioClient(Protocol):
    """The part of busylib's `AsyncBusyBar` that `Speaker` uses."""

    async def audio_play(
        self, *, stock_path: str | None = None, application_name: str | None = None
    ) -> object:
        """Play a sound the bar holds."""
        ...


class Speaker:
    """Plays the bar's stock sounds for an app's alerts.

    `play` returns at once: the sound plays in the background, so a slow or
    absent bar never holds up a poll or an input handler. A sound that fails
    is logged under the app's `name` and never raises. With `enabled` False,
    `play` does nothing.
    """

    def __init__(self, client: AudioClient, *, name: str, enabled: bool) -> None:
        self._client = client
        self._name = name
        self._enabled = enabled
        self._tasks: set[asyncio.Task[None]] = set()

    def play(self, sound: StockSound) -> None:
        """Start playing `sound`; call it from inside the running event loop."""
        if not self._enabled:
            return
        task = asyncio.create_task(self._play(STOCK_SOUNDS[sound]))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def wait(self) -> None:
        """Wait for sounds already started; tests use it to settle."""
        await asyncio.gather(*self._tasks)

    async def _play(self, path: str) -> None:
        try:
            await self._client.audio_play(stock_path=path, application_name=self._name)
        except Exception:  # A missed sound must not end the app.
            logger.warning("[%s] Playing %s failed.", self._name, path, exc_info=True)
