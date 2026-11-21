"""The bar's wheel, buttons, and speaker, and Claude Code's hooks, as the fleet
board uses them."""

from collections.abc import AsyncIterator, Callable, Mapping
from datetime import UTC, datetime, timedelta

from agent_fleet.fleet import Alert, Fleet
from agent_fleet.hooks import parse_hook
from bar_kit import (
    ButtonEvent,
    EncoderEvent,
    InputEvent,
    SelectorEvent,
    SelectorPosition,
    StockSound,
)

SOUNDS: Mapping[Alert, StockSound] = {
    "done": "reminder",
    "asking": "event",
    "failed": "event",
}
"""The stock sound each alert plays."""

# Selector positions where the bar asks not to be disturbed: a running BUSY or
# CUSTOM session, or OFF, the bar's do-not-disturb.
_FOCUS_POSITIONS: frozenset[SelectorPosition] = frozenset({"busy", "custom", "off"})

DEFAULT_MIN_GAP = timedelta(seconds=5)


def _utc_now() -> datetime:
    return datetime.now(UTC)


class Chime:
    """Plays a sound when a session starts waiting on you.

    It stays silent while the bar's selector is on a focus position, and plays
    at most one sound per `min_gap`, so a burst of finished agents is one
    chime. The bar reports the selector only when it moves, so until it does
    the chime follows the screen instead: it plays only while the board is on
    screen, which a running BUSY or CUSTOM session's timer does not allow.
    """

    def __init__(
        self,
        play: Callable[[StockSound], None],
        *,
        on_screen: Callable[[], bool],
        min_gap: timedelta = DEFAULT_MIN_GAP,
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        self._play = play
        self._on_screen = on_screen
        self._min_gap = min_gap
        self._now = now
        self._last: datetime | None = None
        self.selector: SelectorPosition | None = None
        """Where the bar's selector is, or None until the bar reports it."""

    @property
    def muted(self) -> bool:
        """Whether the selector, or the screen while it is unknown, says hush."""
        if self.selector is None:
            return not self._on_screen()
        return self.selector in _FOCUS_POSITIONS

    def ring(self, alert: Alert) -> None:
        """Sound `alert`, unless something says not to."""
        now = self._now()
        if self.muted:
            return
        if self._last is not None and now - self._last < self._min_gap:
            return
        self._last = now
        self._play(SOUNDS[alert])


class Controls:
    """Maps the bar's input and Claude Code's hooks to the board.

    While the board is on screen, the wheel moves the highlight, OK marks the
    highlighted session as seen, and BACK marks every session as seen. The bar
    reports input to every listener, so while another app or the BUSY timer
    holds the screen the wheel and buttons belong to it and the board ignores
    them. Moving the selector to a focus position mutes the chime. A hook
    updates its session and chimes when the session starts waiting on you.
    """

    def __init__(
        self,
        fleet: Fleet,
        chime: Chime,
        *,
        on_screen: Callable[[], bool],
        now: Callable[[], datetime] = _utc_now,
    ) -> None:
        """Ask `on_screen`, such as bar_kit's `track_screen`, before any input."""
        self._fleet = fleet
        self._chime = chime
        self._on_screen = on_screen
        self._now = now

    def handle(self, event: InputEvent) -> None:
        """React to one input event."""
        if isinstance(event, SelectorEvent):
            self._chime.selector = event.position
            return
        if not self._on_screen():
            return
        match event:
            case EncoderEvent(delta=delta):
                self._fleet.move_selection(delta, self._now())
            case ButtonEvent(button="ok", action="press"):
                self._fleet.acknowledge_selected(self._now())
            case ButtonEvent(button="back", action="press"):
                self._fleet.acknowledge_all(self._now())
            case _:
                pass

    def input_stream(
        self, open_stream: Callable[[], AsyncIterator[object]]
    ) -> Callable[[], AsyncIterator[object]]:
        """`open_stream`, for `listen_for_input`, forgetting the selector.

        A new stream does not say where the selector is, and it may have moved
        while the last one was down, so each opening makes it unknown again.
        """

        def reopen() -> AsyncIterator[object]:
            self._chime.selector = None
            return open_stream()

        return reopen

    def hook(self, payload: object) -> None:
        """Apply one hook payload; one the board has no use for is ignored."""
        event = parse_hook(payload)
        if event is None:
            return
        alert = self._fleet.apply(event, self._now())
        if alert is not None:
            self._chime.ring(alert)
