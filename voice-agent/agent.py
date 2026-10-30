"""LiveKit agent for Coworkers voice calls.

LiveKit does the listening (VAD, turn detection, STT) and the speaking (TTS).
Every reply comes from the bot's Durable Object over the voice link; there is
no LLM here.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from collections.abc import AsyncIterable, Callable, Coroutine

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    ModelSettings,
    cli,
    inference,
    llm,
)
from livekit.agents.voice import SpeechHandle
from livekit.agents.voice.agent_activity import _SpeechHandleContextVar
from livekit.agents.voice.events import CloseEvent, UserInputTranscribedEvent
from livekit.plugins import cartesia, deepgram, elevenlabs, openai, silero

from protocol import Frame, LinkConfig, Turn, VoiceLink

AGENT_NAME = "coworkers-voice"
FILLER_AFTER_S = 1.5
PARTIAL_EVERY_S = 0.2
FILLERS = {"ja": "少々お待ちください。", "en": "One moment."}

log = logging.getLogger("coworkers-voice")


def _env(name: str, default: str) -> str:
    return os.environ.get(name) or default


STT_PROVIDERS: dict[str, Callable[[], object]] = {
    # LiveKit Inference bills the LiveKit project, so it needs no other key.
    "inference": lambda: inference.STT(
        model=_env("VOICE_STT_MODEL", "deepgram/nova-3"),
        language=_env("VOICE_STT_LANGUAGE", "multi"),
    ),
    "deepgram": lambda: deepgram.STT(
        model=_env("VOICE_STT_MODEL", "nova-3"), language=_env("VOICE_STT_LANGUAGE", "multi")
    ),
    "openai": lambda: openai.STT(
        model=_env("VOICE_STT_MODEL", "gpt-4o-transcribe"),
        language=_env("VOICE_STT_LANGUAGE", "ja"),
    ),
}

# provider -> (factory, name of the voice option in its update_options)
TTS_PROVIDERS: dict[str, tuple[Callable[[], object], str]] = {
    "inference": (
        lambda: inference.TTS(
            model=_env("VOICE_TTS_MODEL", "cartesia/sonic-3"),
            language=_env("VOICE_TTS_LANGUAGE", "ja"),
            **({"voice": v} if (v := os.environ.get("VOICE_TTS_VOICE")) else {}),
        ),
        "voice",
    ),
    "elevenlabs": (
        lambda: elevenlabs.TTS(
            model=_env("VOICE_TTS_MODEL", "eleven_flash_v2_5"),
            **({"voice_id": v} if (v := os.environ.get("VOICE_TTS_VOICE")) else {}),
        ),
        "voice_id",
    ),
    "openai": (
        lambda: openai.TTS(
            model=_env("VOICE_TTS_MODEL", "gpt-4o-mini-tts"),
            voice=_env("VOICE_TTS_VOICE", "ash"),
        ),
        "voice",
    ),
    "cartesia": (
        lambda: cartesia.TTS(
            model=_env("VOICE_TTS_MODEL", "sonic-3"),
            language=_env("VOICE_TTS_LANGUAGE", "ja"),
            **({"voice": v} if (v := os.environ.get("VOICE_TTS_VOICE")) else {}),
        ),
        "voice",
    ),
}


class NoLLM(llm.LLM):
    """AgentSession only runs `llm_node` when an LLM is set; ours never calls it."""

    def chat(self, **_: object) -> llm.LLMStream:
        raise RuntimeError("replies come from the bot over the voice link")


class CoworkerAgent(Agent):
    def __init__(self, link: VoiceLink) -> None:
        super().__init__(instructions="")
        self.link = link
        self.language = "ja"
        self._heard_language: str | None = None

    def on_transcribed(self, ev: UserInputTranscribedEvent) -> None:
        if ev.is_final and ev.language:
            self._heard_language = str(ev.language)

    async def llm_node(
        self,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool],
        model_settings: ModelSettings,
    ) -> AsyncIterable[str]:
        # The reply task sets this before running llm_node (agent_activity._create_speech_task);
        # there is no public accessor, and speech_created can race with an early interrupt.
        speech = _SpeechHandleContextVar.get(None)
        message = next(
            (
                item
                for item in reversed(chat_ctx.items)
                if isinstance(item, llm.ChatMessage) and item.role == "user"
            ),
            None,
        )
        if message is None:
            return
        turn = self.link.open_turn(uuid.uuid4().hex)
        now = time.time()
        sent = self.link.send(
            {
                "type": "user_turn",
                "turnId": turn.id,
                "text": message.text_content or "",
                **({"language": self._heard_language} if self._heard_language else {}),
                "startedAt": _ms(message.metrics.get("started_speaking_at", now)),
                "endedAt": _ms(message.metrics.get("stopped_speaking_at", now)),
            }
        )
        if not sent:
            turn.close()
            return
        if speech is not None:
            speech.add_done_callback(lambda handle: self._speech_done(turn.id, handle))
        try:
            async for text in self._reply(turn):
                yield text
        finally:
            turn.close()

    async def _reply(self, turn: Turn) -> AsyncIterable[str]:
        last_delta = time.monotonic()
        tool_waiting = False
        filler_left = True
        while True:
            timeout = (
                max(0.0, last_delta + FILLER_AFTER_S - time.monotonic())
                if tool_waiting and filler_left
                else None
            )
            try:
                frame = await turn.next(timeout)
            except TimeoutError:
                filler_left = False
                yield FILLERS.get(self.language.split("-")[0], FILLERS["en"]) + " "
                continue
            if frame is None or frame["type"] == "turn_end":
                return
            if frame["type"] == "tool":
                tool_waiting = True
            elif frame["type"] == "delta":
                last_delta = time.monotonic()
                tool_waiting = False
                yield frame["text"]

    def _speech_done(self, turn_id: str, handle: SpeechHandle) -> None:
        if not handle.interrupted:
            self.link.send({"type": "playback_done", "turnId": turn_id})
            return
        # The pipeline stores what was actually played (synchronized transcript)
        # as the reply's assistant message, flagged interrupted.
        spoken = "".join(
            item.text_content or ""
            for item in handle.chat_items
            if isinstance(item, llm.ChatMessage) and item.role == "assistant"
        )
        self.link.send({"type": "interrupt", "turnId": turn_id, "spokenText": spoken})


def _ms(seconds: float) -> int:
    return int(seconds * 1000)


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(setup_fnc=prewarm)


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    config = LinkConfig.from_metadata(ctx.job.metadata)
    await ctx.connect()
    participant = await ctx.wait_for_participant()

    tts_factory, voice_option = TTS_PROVIDERS[_env("VOICE_TTS", "inference")]
    tts = tts_factory()
    session = AgentSession(
        stt=STT_PROVIDERS[_env("VOICE_STT", "inference")](),
        tts=tts,
        llm=NoLLM(),
        vad=ctx.proc.userdata["vad"],
        turn_handling={
            # The successor of turn_detector.MultilingualModel, which 1.8 deprecates.
            "turn_detection": inference.TurnDetector(),
            # A preemptive reply would send user_turn before the user is done.
            "preemptive_generation": {"enabled": False},
        },
    )
    background: set[asyncio.Task[None]] = set()

    def spawn(coro: Coroutine[None, None, None]) -> None:
        task = asyncio.create_task(coro)
        background.add(task)
        task.add_done_callback(background.discard)

    async def say(frame: Frame) -> None:
        await session.say(frame["text"], allow_interruptions=True)
        link.send({"type": "playback_done", "sayId": frame["sayId"]})

    def on_frame(frame: Frame) -> None:
        match frame["type"]:
            case "ready":
                agent.language = frame.get("language") or agent.language
                if voice := frame.get("ttsVoice"):
                    tts.update_options(**{voice_option: voice})
                if greeting := frame.get("greeting"):
                    session.say(greeting, allow_interruptions=True)
            case "say":
                spawn(say(frame))
            case "error":
                log.warning("bot error %s: %s", frame.get("code"), frame.get("message"))

    link = VoiceLink(
        config, room=ctx.room.name, participant=participant.identity, on_frame=on_frame
    )
    agent = CoworkerAgent(link)

    last_partial = 0.0

    def on_transcribed(ev: UserInputTranscribedEvent) -> None:
        nonlocal last_partial
        agent.on_transcribed(ev)
        if ev.is_final or time.monotonic() - last_partial < PARTIAL_EVERY_S:
            return
        last_partial = time.monotonic()
        link.send({"type": "user_partial", "text": ev.transcript})

    def on_close(ev: CloseEvent) -> None:
        spawn(link.close(ev.reason.value))
        ctx.shutdown(ev.reason.value)

    session.on("user_input_transcribed", on_transcribed)
    session.on("close", on_close)
    # Started first: `ready` may carry a greeting, and say() needs a running session.
    # The spec keeps call audio out of storage; LiveKit records by default.
    await session.start(agent, room=ctx.room, record=False)

    runner = asyncio.create_task(link.run())

    def on_link_stopped(task: asyncio.Task[str]) -> None:
        if not task.cancelled() and task.result() != "closed":
            ctx.shutdown(f"voice link {task.result()}")

    async def on_shutdown(reason: str) -> None:
        await link.close(reason)
        runner.cancel()

    runner.add_done_callback(on_link_stopped)
    ctx.add_shutdown_callback(on_shutdown)


if __name__ == "__main__":
    cli.run_app(server)
