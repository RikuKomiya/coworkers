"""The voice link: one WebSocket from this agent to a bot's Durable Object.

Frames are JSON text, `v: 1`, as defined in `src/agents/voice.ts`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import InvalidStatus, WebSocketException

PROTOCOL_VERSION = 1
PING_INTERVAL_S = 15.0
MAX_BACKOFF_S = 30.0

TURN_FRAMES = frozenset({"delta", "tool", "turn_end"})
GLOBAL_FRAMES = frozenset({"ready", "say", "error", "pong"})
# 1000: the call ended normally, 4409: a newer socket replaced this one,
# 4410: the call is over. None of these is worth reconnecting for.
FINAL_CLOSE_CODES = frozenset({1000, 4409, 4410})

Frame = dict[str, Any]

log = logging.getLogger("coworkers-voice.link")


@dataclass(frozen=True)
class LinkConfig:
    url: str
    token: str
    call_id: str

    @staticmethod
    def from_metadata(raw: str) -> LinkConfig:
        meta = json.loads(raw or "{}")
        try:
            return LinkConfig(url=meta["linkUrl"], token=meta["linkToken"], call_id=meta["callId"])
        except KeyError as e:
            raise ValueError(f"job metadata is missing {e}") from None


class Turn:
    """Frames for one turnId. `next()` returns None once the turn can no longer
    finish, because the socket dropped."""

    def __init__(self, link: VoiceLink, turn_id: str) -> None:
        self.id = turn_id
        self._link = link
        self._frames: asyncio.Queue[Frame | None] = asyncio.Queue()

    async def next(self, timeout: float | None = None) -> Frame | None:
        return await asyncio.wait_for(self._frames.get(), timeout)

    def close(self) -> None:
        self._link._turns.pop(self.id, None)


class VoiceLink:
    def __init__(
        self,
        config: LinkConfig,
        *,
        room: str,
        participant: str,
        on_frame: Callable[[Frame], None],
        ping_interval: float = PING_INTERVAL_S,
        initial_backoff: float = 0.5,
    ) -> None:
        self._config = config
        self._hello = {
            "type": "hello",
            "v": PROTOCOL_VERSION,
            "callId": config.call_id,
            "room": room,
            "participant": participant,
        }
        self._on_frame = on_frame
        self._ping_interval = ping_interval
        self._initial_backoff = initial_backoff
        self._turns: dict[str, Turn] = {}
        self._outbox: asyncio.Queue[Frame] | None = None
        self._ws: ClientConnection | None = None
        self._closing = False

    @property
    def connected(self) -> bool:
        return self._outbox is not None

    def open_turn(self, turn_id: str) -> Turn:
        turn = Turn(self, turn_id)
        self._turns[turn_id] = turn
        return turn

    def send(self, frame: Frame) -> bool:
        """Queue a frame in order. False when there is no socket to send it on."""
        if self._outbox is None:
            return False
        self._outbox.put_nowait(frame)
        return True

    async def run(self) -> str:
        """Connect and reconnect until `close()` or the DO ends the call.
        Returns why it stopped: "closed", "ended" or "unauthorized"."""
        backoff = self._initial_backoff
        while not self._closing:
            close_code: int | None = None
            try:
                async with connect(
                    self._config.url,
                    additional_headers={"Authorization": f"Bearer {self._config.token}"},
                ) as ws:
                    backoff = self._initial_backoff
                    try:
                        await self._serve(ws)
                    finally:
                        close_code = ws.close_code
            except InvalidStatus as e:
                if e.response.status_code == 401:
                    log.error("voice link rejected the token")
                    return "unauthorized"
                log.warning("voice link refused: %s", e)
            except (OSError, TimeoutError, WebSocketException) as e:
                log.warning("voice link dropped: %s", e)
            if self._closing:
                break
            if close_code in FINAL_CLOSE_CODES:
                log.info("voice link closed by the bot (%s)", close_code)
                return "ended"
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_S)
        return "closed"

    async def close(self, reason: str) -> None:
        """Send `call_end` if connected, then stop for good. Safe to call twice."""
        if self._closing:
            return
        self._closing = True
        if self._outbox is not None and self._ws is not None:
            self._outbox.put_nowait({"type": "call_end", "reason": reason})
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._outbox.join(), 2)
            await self._ws.close()

    async def _serve(self, ws: ClientConnection) -> None:
        await ws.send(json.dumps(self._hello))
        self._ws = ws
        self._outbox = asyncio.Queue()
        writer = asyncio.create_task(self._write(ws, self._outbox))
        pinger = asyncio.create_task(self._ping())
        try:
            async for raw in ws:
                self._route(raw)
        finally:
            self._ws = None
            self._outbox = None
            pinger.cancel()
            writer.cancel()
            for turn in list(self._turns.values()):
                turn._frames.put_nowait(None)
            self._turns.clear()

    async def _write(self, ws: ClientConnection, outbox: asyncio.Queue[Frame]) -> None:
        while True:
            frame = await outbox.get()
            try:
                await ws.send(json.dumps(frame))
            finally:
                outbox.task_done()

    async def _ping(self) -> None:
        while True:
            await asyncio.sleep(self._ping_interval)
            self.send({"type": "ping"})

    def _route(self, raw: str | bytes) -> None:
        try:
            frame = json.loads(raw)
        except ValueError:
            return
        if not isinstance(frame, dict):
            return
        kind = frame.get("type")
        if kind in TURN_FRAMES:
            turn = self._turns.get(str(frame.get("turnId")))
            if turn is None:
                return
            turn._frames.put_nowait(frame)
            if kind == "turn_end":
                turn.close()
        elif kind == "error" and frame.get("code") == "no_call":
            self.send(self._hello)
        elif kind in GLOBAL_FRAMES:
            self._on_frame(frame)
