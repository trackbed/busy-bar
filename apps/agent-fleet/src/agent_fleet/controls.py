"""The bar's wheel, buttons, and speaker, as the fleet board uses them."""

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from datetime import UTC, datetime, timedelta

from busylib.features import (
    ButtonEvent,
    EncoderEvent,
    InputEvent,
    SelectorEvent,
    input_events,
)

from agent_fleet.fleet import Fleet, Status

logger = logging.getLogger(__name__)

# Built-in sounds every bar ships (busylib's `features.notification`).
SOUNDS: Mapping[Status, str] = {
    "done": "shared/sounds/calendar_reminder_ends.snd",
    "asking": "shared/sounds/calendar_event_starts.snd",
    "failed": "shared/sounds/calendar_event_starts.snd",
}

# Selector positions where the bar asks not to be disturbed: a running BUSY or
# CUSTOM session, or OFF, the bar's do-not-disturb.
_FOCUS_POSITIONS = frozenset({"busy", "custom", "off"})

DEFAULT_MIN_GAP = timedelta(seconds=5)
RECONNECT_SECONDS = 5.0


def _utc_now() -> datetime:
    return datetime.now(UTC)


class Chime:
    """Plays a sound when a session starts waiting on you.

    It stays silent while the bar's selector is on a focus position, and plays
    at most one sound per `min_gap`, so a burst of finished agents is one
    chime.
    """

    def __init__(
        self,
        play: Callable[[str], Awaitable[object]],
        *,
        enabled: bool,
        min_gap: timedelta = DEFAULT_MIN_GAP,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._play = play
        self._enabled = enabled
        self._min_gap = min_gap
        self._now = now
        self._last: datetime | None = None
        self._tasks: set[asyncio.Task[None]] = set()
        self.focused = False
        """Whether the selector is on BUSY, CUSTOM, or OFF."""

    def ring(self, status: Status) -> None:
        """Sound the alert for `status`, unless something says not to."""
        sound = SOUNDS.get(status)
        now = self._now()
        if not self._enabled or self.focused or sound is None:
            return
        if self._last is not None and now - self._last < self._min_gap:
            return
        self._last = now
        task = asyncio.create_task(self._play_quietly(sound))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def wait(self) -> None:
        """Wait for sounds already started; tests use it to settle."""
        await asyncio.gather(*self._tasks)

    async def _play_quietly(self, sound: str) -> None:
        try:
            await self._play(sound)
        except Exception:  # A missed chime must not end the app.
            logger.warning("Playing %s on the bar failed.", sound, exc_info=True)


class Controls:
    """Maps the bar's input to the board.

    The wheel moves the highlight, OK marks the highlighted session as seen,
    and BACK marks every session as seen. Moving the selector to a focus
    position mutes the chime.
    """

    def __init__(
        self, fleet: Fleet, chime: Chime, *, now: Callable[[], datetime] = _utc_now
    ) -> None:
        self._fleet = fleet
        self._chime = chime
        self._now = now

    def handle(self, event: InputEvent) -> None:
        """React to one input event."""
        match event:
            case EncoderEvent(delta=delta):
                self._fleet.move_selection(delta, self._now())
            case ButtonEvent(button="ok", action="press"):
                self._fleet.acknowledge_selected(self._now())
            case ButtonEvent(button="back", action="press"):
                self._fleet.acknowledge_all(self._now())
            case SelectorEvent(position=position):
                self._chime.focused = position in _FOCUS_POSITIONS
            case _:
                pass


async def listen_for_input(
    stream: Callable[[], AsyncIterator[object]],
    handle: Callable[[InputEvent], None],
    *,
    reconnect_seconds: float = RECONNECT_SECONDS,
) -> None:
    """Feed the bar's input events to `handle` until cancelled.

    `stream` opens the bar's status stream, such as busylib's
    `AsyncBusyBar.stream_status_ws`. A dropped stream reconnects after
    `reconnect_seconds`; the cloud has no stream, so input then stays off.
    """
    while True:
        try:
            async for message in stream():
                if isinstance(message, Mapping):
                    for event in input_events(message):
                        handle(event)
        except NotImplementedError:
            logger.warning(
                "The wheel and buttons need a direct connection to the bar; "
                "the cloud does not stream them."
            )
            return
        except Exception:  # The bar rebooted or left the network.
            logger.warning("Lost the bar's input stream.", exc_info=True)
        await asyncio.sleep(reconnect_seconds)
