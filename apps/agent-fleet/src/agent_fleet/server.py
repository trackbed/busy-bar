"""A minimal HTTP endpoint for Claude Code's `http` hooks.

Claude Code posts each event as a JSON body and treats an empty 2xx response
as "carry on". The board only listens, so every accepted request gets an empty
200, and nothing it does can block an agent.
"""

import asyncio
import json
import logging
from collections.abc import Callable
from http import HTTPStatus

logger = logging.getLogger(__name__)

MAX_BODY_BYTES = 16 * 1024 * 1024
"""Large enough for a tool call that writes a big file."""

_MAX_HEAD_BYTES = 64 * 1024
_READ_TIMEOUT_SECONDS = 10

type HookHandler = Callable[[object], None]
"""Receives each decoded JSON payload."""


class _RequestError(Exception):
    def __init__(self, status: HTTPStatus) -> None:
        super().__init__(status.phrase)
        self.status = status


async def start_hook_server(
    handle: HookHandler, *, host: str, port: int
) -> asyncio.Server:
    """Listen for hook posts on `host:port` and pass each payload to `handle`."""

    async def on_connection(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            status = await asyncio.wait_for(
                _serve(reader, handle), timeout=_READ_TIMEOUT_SECONDS
            )
        except _RequestError as error:
            status = error.status
        except (
            TimeoutError,
            asyncio.IncompleteReadError,
            asyncio.LimitOverrunError,
            ConnectionError,
        ):
            status = HTTPStatus.BAD_REQUEST
        await _respond(writer, status)

    return await asyncio.start_server(on_connection, host, port, limit=_MAX_HEAD_BYTES)


async def _serve(reader: asyncio.StreamReader, handle: HookHandler) -> HTTPStatus:
    head = (await reader.readuntil(b"\r\n\r\n")).decode("latin-1")
    request_line, *header_lines = head.split("\r\n")
    method = request_line.split(" ", 1)[0]
    if method != "POST":
        raise _RequestError(HTTPStatus.METHOD_NOT_ALLOWED)

    headers = {
        name.strip().lower(): value.strip()
        for name, separator, value in (line.partition(":") for line in header_lines)
        if separator
    }
    length = headers.get("content-length", "")
    if not length.isdecimal():
        raise _RequestError(HTTPStatus.LENGTH_REQUIRED)
    if int(length) > MAX_BODY_BYTES:
        raise _RequestError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)

    body = await reader.readexactly(int(length))
    try:
        payload: object = json.loads(body)
    except ValueError as error:
        raise _RequestError(HTTPStatus.BAD_REQUEST) from error

    try:
        handle(payload)
    except Exception:  # A board bug must not take the endpoint down.
        logger.exception("Handling a hook event failed.")
        return HTTPStatus.INTERNAL_SERVER_ERROR
    return HTTPStatus.OK


async def _respond(writer: asyncio.StreamWriter, status: HTTPStatus) -> None:
    writer.write(
        f"HTTP/1.1 {status.value} {status.phrase}\r\n"
        "Content-Length: 0\r\nConnection: close\r\n\r\n".encode("latin-1")
    )
    try:
        await writer.drain()
    except ConnectionError:  # The client hung up; there is nobody to tell.
        pass
    finally:
        writer.close()
