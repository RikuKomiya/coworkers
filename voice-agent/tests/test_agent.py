import asyncio
from types import SimpleNamespace

from livekit.agents import llm

import agent
from agent import CoworkerAgent


class FakeLink:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, frame: dict) -> bool:
        self.sent.append(frame)
        return True


class ScriptedTurn:
    """Plays (delay, frame) pairs; `next` times out like the real Turn."""

    def __init__(self, script: list[tuple[float, dict]]) -> None:
        self._queue: asyncio.Queue[dict] = asyncio.Queue()
        self._feeder = asyncio.create_task(self._feed(script))

    async def _feed(self, script):
        for delay, frame in script:
            await asyncio.sleep(delay)
            self._queue.put_nowait(frame)

    async def next(self, timeout=None):
        return await asyncio.wait_for(self._queue.get(), timeout)


async def collect(coworker: CoworkerAgent, turn) -> list[str]:
    return [text async for text in coworker._reply(turn)]


async def test_filler_once_when_a_tool_runs_without_deltas(monkeypatch):
    monkeypatch.setattr(agent, "FILLER_AFTER_S", 0.05)
    coworker = CoworkerAgent(FakeLink())
    turn = ScriptedTurn(
        [
            (0, {"type": "delta", "turnId": "t", "text": "調べます。"}),
            (0, {"type": "tool", "turnId": "t", "name": "a", "label": "A"}),
            (0.1, {"type": "tool", "turnId": "t", "name": "b", "label": "B"}),
            (0.1, {"type": "delta", "turnId": "t", "text": "わかりました。"}),
            (0, {"type": "turn_end", "turnId": "t", "status": "completed"}),
        ]
    )
    assert await collect(coworker, turn) == ["調べます。", "少々お待ちください。 ", "わかりました。"]


async def test_no_filler_when_deltas_keep_coming(monkeypatch):
    monkeypatch.setattr(agent, "FILLER_AFTER_S", 0.2)
    coworker = CoworkerAgent(FakeLink())
    coworker.language = "en-US"
    turn = ScriptedTurn(
        [
            (0, {"type": "tool", "turnId": "t", "name": "a", "label": "A"}),
            (0.05, {"type": "delta", "turnId": "t", "text": "Done."}),
            (0, {"type": "turn_end", "turnId": "t", "status": "completed"}),
        ]
    )
    assert await collect(coworker, turn) == ["Done."]


async def test_reply_ends_when_the_socket_drops():
    coworker = CoworkerAgent(FakeLink())

    class Dropped:
        async def next(self, timeout=None):
            return None

    assert await asyncio.wait_for(collect(coworker, Dropped()), 1) == []


def test_interrupt_reports_only_what_was_played():
    link = FakeLink()
    coworker = CoworkerAgent(link)
    played = llm.ChatMessage(role="assistant", content=["今日は晴れ"], interrupted=True)
    coworker._speech_done("t1", SimpleNamespace(interrupted=True, chat_items=[played]))
    coworker._speech_done("t2", SimpleNamespace(interrupted=False, chat_items=[]))
    assert link.sent == [
        {"type": "interrupt", "turnId": "t1", "spokenText": "今日は晴れ"},
        {"type": "playback_done", "turnId": "t2"},
    ]
