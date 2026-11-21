"""Whether an app's frames reach the screen.

Every input listener gets every event, whichever app is on screen, so an app
that acts on the buttons asks this first.
"""

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from busylib import types

from bar_kit.run import DisplayClient

ON_SCREEN_SECONDS = 2.5
"""How long after its last drawn frame the app still counts as on screen."""


@dataclass(frozen=True, slots=True)
class TrackedScreen:
    """A display client that remembers whether the app's frames reach the bar."""

    client: DisplayClient
    """The client to pass to `run_bar_app`."""

    on_screen: Callable[[], bool]
    """Whether a frame drew recently: the bar refused none for its BUSY timer
    or an app of higher priority since."""


def track_screen(
    client: DisplayClient, now: Callable[[], float] = time.monotonic
) -> TrackedScreen:
    """Wrap `client`, for `run_bar_app`, to follow what reaches the screen.

    A frame that draws puts the app on screen for `ON_SCREEN_SECONDS`, and a
    refused one, while the BUSY timer or an app of higher priority holds the
    screen, takes it off at once. The TypeScript kit's `trackScreen` behaves
    the same way.
    """
    tracked = _Tracked(client, now)
    return TrackedScreen(client=tracked, on_screen=tracked.on_screen)


class _Tracked:
    def __init__(self, client: DisplayClient, now: Callable[[], float]) -> None:
        self._client = client
        self._now = now
        self._drawn_at: float | None = None

    async def display_draw(self, display_data: types.DisplayElements, /) -> object:
        try:
            result = await self._client.display_draw(display_data)
        except BaseException:  # Refused, failed, or cancelled: not on screen.
            self._drawn_at = None
            raise
        self._drawn_at = self._now()
        return result

    async def display_clear(
        self, *, application_name: str, element_ids: Sequence[str] | None = None
    ) -> object:
        return await self._client.display_clear(
            application_name=application_name, element_ids=element_ids
        )

    def on_screen(self) -> bool:
        return (
            self._drawn_at is not None
            and self._now() - self._drawn_at <= ON_SCREEN_SECONDS
        )
