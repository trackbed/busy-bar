from collections.abc import Sequence

import pytest
from busylib import types

from bar_kit import track_screen
from bar_kit.screen import ON_SCREEN_SECONDS

FRAME = types.DisplayElements(
    application_name="demo",
    elements=[types.TextElement(id="hello", text="HELLO", font="small")],
)


class FakeClient:
    def __init__(self) -> None:
        self.refusing = False
        self.drawn: list[types.DisplayElements] = []
        self.cleared: list[tuple[str, Sequence[str] | None]] = []

    async def display_draw(self, display_data: types.DisplayElements, /) -> object:
        self.drawn.append(display_data)
        if self.refusing:
            message = "409"
            raise ConnectionError(message)
        return "OK"

    async def display_clear(
        self, *, application_name: str, element_ids: Sequence[str] | None = None
    ) -> object:
        self.cleared.append((application_name, element_ids))
        return "OK"


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


async def test_is_on_screen_for_a_while_after_a_frame_draws() -> None:
    clock = Clock()
    screen = track_screen(FakeClient(), clock)

    assert not screen.on_screen()

    await screen.client.display_draw(FRAME)

    assert screen.on_screen()

    clock.now += ON_SCREEN_SECONDS + 0.001

    assert not screen.on_screen()


async def test_is_off_screen_once_the_bar_refuses_a_frame() -> None:
    client = FakeClient()
    screen = track_screen(client, Clock())
    await screen.client.display_draw(FRAME)
    client.refusing = True

    with pytest.raises(ConnectionError, match="409"):
        await screen.client.display_draw(FRAME)

    assert not screen.on_screen()


async def test_passes_draws_and_clears_through() -> None:
    client = FakeClient()
    screen = track_screen(client, Clock())

    assert await screen.client.display_draw(FRAME) == "OK"
    await screen.client.display_clear(application_name="demo")
    await screen.client.display_clear(application_name="demo", element_ids=["a"])

    assert client.drawn == [FRAME]
    assert client.cleared == [("demo", None), ("demo", ["a"])]
