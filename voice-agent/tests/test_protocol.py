import asyncio
import json

import pytest
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.http11 import Response

from protocol import LinkConfig, VoiceLink

TOKEN = "tok"


class FakeBot:
    """A stand-in for the DO side: records frames and lets a test drive the socket."""

    def __init__(self) -> None:
        self.received: asyncio.Queue[dict] = asyncio.Queue()
        self.sockets: asyncio.Queue[ServerConnection] = asyncio.Queue()
        self.auth_headers: list[str | None] = []
        self.reject_with: int | None = None

    def check_auth(self, connection, request):
        self.auth_headers.append(request.headers.get("Authorization"))
        if self.reject_with is not None:
            return Response(self.reject_with, "Rejected", Headers())
        return None

    async def handle(self, ws: ServerConnection) -> None:
        await self.sockets.put(ws)
        async for raw in ws:
            await self.received.put(json.loads(raw))

    async def next_frame(self, kind: str | None = None) -> dict:
        while True:
            frame = await asyncio.wait_for(self.received.get(), 2)
            if kind is None or frame["type"] == kind:
                return frame


@pytest.fixture
async def bot():
    fake = FakeBot()
    async with serve(fake.handle, "127.0.0.1", 0, process_request=fake.check_auth) as server:
        port = server.sockets[0].getsockname()[1]
        fake.url = f"ws://127.0.0.1:{port}/voice/u/b"
        yield fake


def make_link(bot: FakeBot, on_frame=lambda frame: None, **kwargs) -> VoiceLink:
    return VoiceLink(
        LinkConfig(url=bot.url, token=TOKEN, call_id="call-1"),
        room="cw-call-1",
        participant="user-1",
        on_frame=on_frame,
        initial_backoff=0.05,
        **kwargs,
    )


async def test_sends_hello_with_bearer_token_on_connect(bot):
    link = make_link(bot)
    runner = asyncio.create_task(link.run())
    assert await bot.next_frame() == {
        "type": "hello",
        "v": 1,
        "callId": "call-1",
        "room": "cw-call-1",
        "participant": "user-1",
    }
    assert bot.auth_headers == [f"Bearer {TOKEN}"]
    await link.close("test")
    assert await bot.next_frame() == {"type": "call_end", "reason": "test"}
    assert await asyncio.wait_for(runner, 2) == "closed"


async def test_routes_frames_to_their_turn_until_turn_end(bot):
    global_frames = []
    link = make_link(bot, on_frame=global_frames.append)
    runner = asyncio.create_task(link.run())
    await bot.next_frame("hello")
    ws = await bot.sockets.get()
    a, b = link.open_turn("a"), link.open_turn("b")

    for frame in [
        {"type": "cf_agent_state", "state": {}},
        {"type": "delta", "turnId": "a", "text": "one "},
        {"type": "delta", "turnId": "b", "text": "other"},
        {"type": "delta", "turnId": "zzz", "text": "nobody"},
        {"type": "tool", "turnId": "a", "name": "search", "label": "Searching"},
        {"type": "delta", "turnId": "a", "text": "two"},
        {"type": "turn_end", "turnId": "a", "status": "completed"},
        {"type": "delta", "turnId": "a", "text": "after the end"},
        {"type": "say", "sayId": "s1", "text": "hi", "reason": "notice"},
    ]:
        await ws.send(json.dumps(frame))

    got = [await a.next(2) for _ in range(4)]
    assert [f["type"] for f in got] == ["delta", "tool", "delta", "turn_end"]
    assert [f.get("text") for f in got if f["type"] == "delta"] == ["one ", "two"]
    assert (await b.next(2))["text"] == "other"
    await asyncio.sleep(0.05)
    assert a._frames.empty()
    assert [f["type"] for f in global_frames] == ["say"]

    await link.close("test")
    await runner


async def test_reconnect_resends_hello_and_ends_open_turns(bot):
    link = make_link(bot)
    runner = asyncio.create_task(link.run())
    await bot.next_frame("hello")
    ws = await bot.sockets.get()
    turn = link.open_turn("t1")

    await ws.close(1011, "restart")
    assert await turn.next(2) is None
    assert (await bot.next_frame())["type"] == "hello"
    assert link.send({"type": "ping"})
    assert await bot.next_frame() == {"type": "ping"}

    await link.close("test")
    await runner


async def test_no_call_error_resends_hello(bot):
    link = make_link(bot)
    runner = asyncio.create_task(link.run())
    await bot.next_frame("hello")
    ws = await bot.sockets.get()
    await ws.send(json.dumps({"type": "error", "code": "no_call", "message": "x"}))
    assert (await bot.next_frame())["type"] == "hello"
    await link.close("test")
    await runner


@pytest.mark.parametrize("code", [1000, 4409, 4410])
async def test_stops_when_the_bot_ends_the_call(bot, code):
    link = make_link(bot)
    runner = asyncio.create_task(link.run())
    await bot.next_frame("hello")
    ws = await bot.sockets.get()
    await ws.close(code, "bye")
    assert await asyncio.wait_for(runner, 2) == "ended"
    assert bot.sockets.empty()


async def test_gives_up_on_401(bot):
    bot.reject_with = 401
    link = make_link(bot)
    assert await asyncio.wait_for(link.run(), 2) == "unauthorized"
    assert len(bot.auth_headers) == 1


async def test_pings_on_interval(bot):
    link = make_link(bot, ping_interval=0.05)
    runner = asyncio.create_task(link.run())
    await bot.next_frame("hello")
    assert await bot.next_frame() == {"type": "ping"}
    await link.close("test")
    await runner
