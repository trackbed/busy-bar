"""Run the limits board: `nx run claude-limits:start` or `python -m claude_limits`."""

import asyncio
import logging
import os

from bar_kit import (
    Poller,
    Speaker,
    create_busy_bar,
    install_shutdown_handlers,
    load_bar_config,
    run_bar_app,
)
from claude_limits.board import RotationWatch
from claude_limits.render import render
from claude_limits.settings import load_settings

NAME = "claude-limits"
REFRESH_SECONDS = 30.0


async def main() -> None:
    settings = load_settings(os.environ)
    stop = asyncio.Event()
    install_shutdown_handlers(stop)
    client = create_busy_bar(load_bar_config())
    speaker = Speaker(client, name=NAME, enabled=settings.sound, stop=stop)
    watch = RotationWatch(settings.root, play=speaker.play)
    poller = Poller(name=NAME, fetch=watch.fetch, interval=REFRESH_SECONDS)
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
