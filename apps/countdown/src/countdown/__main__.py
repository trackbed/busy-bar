"""Run the countdown: `nx run countdown:start` or `python -m countdown`."""

import asyncio
import logging
import os

from bar_kit import (
    create_busy_bar,
    install_shutdown_handlers,
    load_bar_config,
    run_bar_app,
)
from countdown.render import render_countdown
from countdown.settings import load_settings


async def main() -> None:
    settings = load_settings(os.environ)
    stop = asyncio.Event()
    install_shutdown_handlers(stop)
    client = create_busy_bar(load_bar_config())
    # busylib types `__aenter__` as returning its base client, so keep this
    # reference instead of binding the context manager's result.
    async with client:
        await run_bar_app(
            name="countdown",
            client=client,
            render=lambda now: render_countdown(now, settings),
            interval=1.0,
            stop=stop,
        )


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    asyncio.run(main())
