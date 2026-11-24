"""Run the fleet board: `nx run agent-fleet:start` or `python -m agent_fleet`.

`python -m agent_fleet --print-hooks` prints the hooks block to merge into
`~/.claude/settings.json` instead.
"""

import asyncio
import json
import logging
import os
import sys
from contextlib import AsyncExitStack
from datetime import datetime

from agent_fleet.controls import Chime, Controls
from agent_fleet.fleet import Fleet
from agent_fleet.hooks import hook_settings
from agent_fleet.render import render
from agent_fleet.render_showtime import render_showtime
from agent_fleet.server import start_hook_server
from agent_fleet.settings import FleetSettings, load_settings
from agent_fleet.showtime import Showtime
from bar_kit import (
    DisplayElement,
    Speaker,
    create_busy_bar,
    install_shutdown_handlers,
    listen_for_input,
    load_bar_config,
    run_bar_app,
    track_screen,
)

NAME = "agent-fleet"


async def main(settings: FleetSettings) -> None:
    stop = asyncio.Event()
    install_shutdown_handlers(stop)
    fleet = Fleet(quiet_after=settings.quiet_after)
    config = load_bar_config()
    client = create_busy_bar(config)
    # busylib types `__aenter__` as returning its base client, so keep this
    # reference instead of binding the context manager's result.
    async with client, AsyncExitStack() as stack:
        screen = track_screen(client)
        speaker = Speaker(client, name=NAME, enabled=settings.sound, stop=stop)
        chime = Chime(speaker.play, on_screen=screen.on_screen)
        board = Showtime(settings.showtime) if settings.showtime else None
        controls = Controls(fleet, chime, on_screen=screen.on_screen, showtime=board)
        if board is None:
            server = await start_hook_server(
                controls.hook, host=settings.host, port=settings.port
            )
            await stack.enter_async_context(server)
            print(f"Listening for Claude Code hooks at {settings.url}")

        def frame(now: datetime) -> list[DisplayElement]:
            if board is not None:
                if board.refresh(now):
                    chime.ring("asking")
                return render_showtime(now, board)
            return render(
                now, fleet.view(now), listening=f"{settings.host}:{settings.port}"
            )

        listening = asyncio.create_task(
            listen_for_input(
                name=NAME,
                config=config,
                stream=controls.input_stream(client.stream_status_ws),
                handle=controls.handle,
                stop=stop,
            )
        )
        try:
            await run_bar_app(
                name=NAME, client=screen.client, render=frame, interval=1.0, stop=stop
            )
        finally:
            stop.set()
            await listening


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    fleet_settings = load_settings(os.environ)
    if "--print-hooks" in sys.argv[1:]:
        print(json.dumps(hook_settings(fleet_settings.url), indent=2))
    else:
        asyncio.run(main(fleet_settings))
