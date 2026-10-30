# Coworkers voice agent

A LiveKit agent that lets you talk to a Coworkers bot. It does the listening
(voice activity detection, turn detection, speech to text) and the speaking
(text to speech). It has no LLM. Each finished utterance goes to the bot's
Durable Object over a WebSocket, and the bot's reply streams back as text to
be spoken. The wire protocol is defined in `src/agents/voice.ts`.

`protocol.py` owns the socket: framing, reconnects, pings, and routing frames
to the turn they belong to. `agent.py` is the LiveKit side.

## How a call gets here

The app's Worker dispatches the agent named `coworkers-voice` into room
`cw-<callId>`, with job metadata `{linkUrl, linkToken, callId}`. The agent
only runs on explicit dispatch, so it never joins rooms on its own. It joins,
waits for the caller, then opens `linkUrl` with
`Authorization: Bearer <linkToken>` and sends `hello`.

The socket reconnects with exponential backoff (capped at 30s) and resends
`hello` each time. A turn still streaming when the socket drops ends with
whatever was already spoken. The agent stops for good on HTTP 401 (bad or
expired token) or when the bot closes the socket with 1000, 4409 (a newer
socket replaced this one) or 4410 (the call is over), and the job shuts down.

## Setup

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12.

```bash
cd voice-agent
uv sync
uv run agent.py download-files   # silero VAD and turn detector weights
```

## Environment

| Variable                                             | Purpose                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | The LiveKit project. Use the same values as the app's `.dev.vars`.         |
| `VOICE_STT`                                          | `deepgram` (default) or `openai`.                                          |
| `VOICE_STT_MODEL`                                    | Defaults to `nova-3` (Deepgram) or `gpt-4o-transcribe` (OpenAI).           |
| `VOICE_STT_LANGUAGE`                                 | Defaults to `multi` (Deepgram) or `ja` (OpenAI).                           |
| `VOICE_TTS`                                          | `elevenlabs` (default), `openai` or `cartesia`.                            |
| `VOICE_TTS_MODEL`                                    | Defaults to `eleven_flash_v2_5`, `gpt-4o-mini-tts` or `sonic-3`.           |
| `VOICE_TTS_VOICE`                                    | Voice ID for the chosen provider. A bot's `ttsVoice` overrides it per call. |
| `VOICE_TTS_LANGUAGE`                                 | Cartesia only. Defaults to `ja`.                                           |
| `DEEPGRAM_API_KEY`                                   | When `VOICE_STT=deepgram`.                                                 |
| `OPENAI_API_KEY`                                     | When either provider is `openai`.                                          |
| `ELEVEN_API_KEY`                                     | When `VOICE_TTS=elevenlabs`.                                               |
| `CARTESIA_API_KEY`                                   | When `VOICE_TTS=cartesia`.                                                 |

The defaults are Deepgram Nova-3 with `multi` and ElevenLabs Flash v2.5.
Nova-3 streams interim results, which feed the live caption, and its
multilingual mode covers Japanese and English in the same call and reports
the language it heard. Flash v2.5 speaks 32 languages, Japanese included,
with the lowest latency in the ElevenLabs line. OpenAI and Cartesia are one
variable away when a different voice or price matters more.

Copy `.env.example` to `.env` (git-ignored) and fill it in.

## Running against `pnpm dev`

1. In the repo root, fill `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET` and `VOICE_LINK_SECRET` in `.dev.vars`, then run
   `pnpm dev` (the app on http://localhost:3000).
2. In another terminal:

   ```bash
   cd voice-agent
   uv run --env-file .env agent.py dev
   ```

3. Start a call from a bot's page.

The Worker builds `linkUrl` from the URL the browser used, so a call started
from http://localhost:3000 hands the agent `ws://localhost:3000/voice/...`.
That works while the agent runs on the same machine as `pnpm dev`. Whatever
runs the agent must be able to reach that URL: when the agent runs anywhere
else (another machine, or deployed to LiveKit Cloud), expose the app through
a tunnel such as `cloudflared tunnel --url http://localhost:3000` and open
the app through the tunnel's URL so `linkUrl` points there.

## Tests

```bash
uv run pytest
```

`tests/test_protocol.py` runs the link against a local WebSocket server.
`tests/test_agent.py` covers the reply stream (filler lines) and what an
interrupted turn reports.
