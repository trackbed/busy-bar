"""Run the limits board: `nx run claude-limits:start` or `python -m claude_limits`."""

import asyncio
import logging
import os
from datetime import UTC, datetime

from bar_kit import (
    Poller,
    create_busy_bar,
    install_shutdown_handlers,
    load_bar_config,
    run_bar_app,
)
from claude_limits.board import alert_for
from claude_limits.render import render
from claude_limits.rotation import Rotation, read_rotation
from claude_limits.settings import load_settings

NAME = "claude-limits"
REFRESH_SECONDS = 30.0

# Built-in sounds every bar ships (busylib's `features.notification`).
SOUNDS = {
    "rotated": "shared/sounds/calendar_reminder_ends.snd",
    "exhausted": "shared/sounds/calendar_event_starts.snd",
}


async def main() -> None:
    settings = load_settings(os.environ)
    stop = asyncio.Event()
    install_shutdown_handlers(stop)
    client = create_busy_bar(load_bar_config())
    previous: Rotation | None = None

    async def fetch() -> Rotation:
        nonlocal previous
        rotation = await asyncio.to_thread(read_rotation, settings.root)
        alert = alert_for(previous, rotation, datetime.now(UTC))
        previous = rotation
        if alert is not None and settings.sound:
            try:
                await client.audio_play(stock_path=SOUNDS[alert], application_name=NAME)
            except Exception:  # A missed sound must not end the app.
                logging.getLogger(NAME).warning(
                    "Playing a sound failed.", exc_info=True
                )
        return rotation

    poller = Poller(name=NAME, fetch=fetch, interval=REFRESH_SECONDS)
    # busylib types `__aenter__` as returning its base client, so keep this
    # reference instead of binding the context manager's result.
    async with client:
        await asyncio.gather(
            poller.run(stop),
            run_bar_app(
                name=NAME,
                client=client,
                render=lambda now: render(
                    now, poller.latest, poller.failure, root=settings.root
                ),
                interval=1.0,
                stop=stop,
            ),
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
