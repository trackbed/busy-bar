import asyncio
import json
import logging
from collections.abc import AsyncIterator

import pytest

from agent_fleet.server import MAX_BODY_BYTES, start_hook_server


@pytest.fixture
async def server() -> AsyncIterator[tuple[int, list[object]]]:
    received: list[object] = []

    def handle(payload: object) -> None:
        if payload == {"boom": True}:
            message = "board bug"
            raise RuntimeError(message)
        received.append(payload)

    hook_server = await start_hook_server(handle, host="127.0.0.1", port=0)
    port = hook_server.sockets[0].getsockname()[1]
    async with hook_server:
        yield port, received


async def send(port: int, request: bytes) -> str:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(request)
    await writer.drain()
    # Hang up our side, so a short body fails at once instead of timing out.
    writer.write_eof()
    response = await reader.read()
    writer.close()
    await writer.wait_closed()
    return response.decode("latin-1")


def post(body: bytes, *, length: str | None = None) -> bytes:
    content_length = str(len(body)) if length is None else length
    return (
        b"POST /hook HTTP/1.1\r\nHost: localhost\r\n"
        b"Content-Type: application/json\r\n"
        + f"Content-Length: {content_length}\r\n\r\n".encode()
        + body
    )


async def test_passes_each_payload_on_and_answers_with_an_empty_200(
    server: tuple[int, list[object]],
) -> None:
    port, received = server
    payload = {"hook_event_name": "Stop", "session_id": "s1"}

    response = await send(port, post(json.dumps(payload).encode()))

    assert response.startswith("HTTP/1.1 200 OK\r\n")
    assert "Content-Length: 0\r\n" in response
    assert received == [payload]


@pytest.mark.parametrize(
    ("request_bytes", "status"),
    [
        (b"GET /hook HTTP/1.1\r\nHost: localhost\r\n\r\n", "405 Method Not Allowed"),
        (post(b"{}", length=""), "411 Length Required"),
        (post(b"{}", length=str(MAX_BODY_BYTES + 1)), "413"),
        (post(b"not json"), "400 Bad Request"),
        (post(b"{}", length="10"), "400 Bad Request"),
    ],
)
async def test_rejects_requests_that_are_not_hook_posts(
    server: tuple[int, list[object]], request_bytes: bytes, status: str
) -> None:
    port, received = server

    response = await send(port, request_bytes)

    assert response.startswith(f"HTTP/1.1 {status}")
    assert received == []


async def test_a_failing_handler_answers_500_and_keeps_serving(
    server: tuple[int, list[object]], caplog: pytest.LogCaptureFixture
) -> None:
    port, received = server

    with caplog.at_level(logging.ERROR, logger="agent_fleet.server"):
        failed = await send(port, post(b'{"boom": true}'))
    served = await send(port, post(b'{"ok": true}'))

    assert failed.startswith("HTTP/1.1 500 Internal Server Error")
    assert [record.getMessage() for record in caplog.records] == [
        "Handling a hook event failed."
    ]
    assert served.startswith("HTTP/1.1 200 OK")
    assert received == [{"ok": True}]
