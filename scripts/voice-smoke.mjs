#!/usr/bin/env node
/**
 * Plays the LiveKit agent's side of a voice call against `pnpm dev`: signs a
 * link token with VOICE_LINK_SECRET from .dev.vars, opens the bot's /voice
 * socket, says hello, sends one user turn and prints every voice frame back.
 * With --interrupt it talks over the reply after the first delta; with
 * --linger it stays on the call (pinging) to hear `say` frames, such as a
 * background task's result.
 *
 *   node scripts/voice-smoke.mjs [--bot <botId>] [--user demo] [--text "..."] [--interrupt] [--linger 120]
 *     [--base ws://localhost:3000]
 */
import { createHmac, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    bot: { type: "string", default: "voice-smoke" },
    user: { type: "string", default: "demo" },
    text: { type: "string", default: "Say hello in one short sentence." },
    base: { type: "string", default: "ws://localhost:3000" },
    interrupt: { type: "boolean", default: false },
    timeout: { type: "string", default: "90" },
    linger: { type: "string", default: "0" },
  },
})

const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
const secret = /^VOICE_LINK_SECRET\s*=\s*"?([^"\n]+)"?/m.exec(vars)?.[1]
if (!secret) throw new Error("VOICE_LINK_SECRET is not set in .dev.vars")

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const callId = randomUUID()
const payload = b64url(
  JSON.stringify({
    userId: args.user,
    botId: args.bot,
    callId,
    exp: Math.floor(Date.now() / 1000) + 600,
  })
)
const token = `${payload}.${b64url(createHmac("sha256", secret).update(payload).digest())}`

const VOICE_FRAMES = new Set([
  "ready",
  "delta",
  "tool",
  "turn_end",
  "say",
  "error",
  "pong",
])
const url = `${args.base}/voice/${encodeURIComponent(args.user)}/${encodeURIComponent(args.bot)}?token=${token}`
const ws = new WebSocket(url)
const turnId = `t-${Date.now()}`
const started = Date.now()
const seen = []
let interrupted = false

const stamp = () => `+${String(Date.now() - started).padStart(5)}ms`
const send = (frame) => {
  console.log(`${stamp()} → ${JSON.stringify(frame)}`)
  ws.send(JSON.stringify(frame))
}

const linger = Number(args.linger) * 1000
const timer = setTimeout(
  () => finish("timed out"),
  Number(args.timeout) * 1000 + linger
)
const ping = setInterval(() => send({ type: "ping" }), 15_000)

function finish(why) {
  clearTimeout(timer)
  clearInterval(ping)
  console.log(`\n${why}. Voice frames in order: ${seen.join(", ") || "(none)"}`)
  ws.close()
  process.exit(why === "done" ? 0 : 1)
}

ws.addEventListener("open", () => {
  send({
    type: "hello",
    v: 1,
    callId,
    room: `cw-${callId}`,
    participant: "smoke",
  })
})
ws.addEventListener("message", (event) => {
  const frame = JSON.parse(String(event.data))
  if (!VOICE_FRAMES.has(frame.type)) {
    console.log(`${stamp()} ← (ignored ${frame.type})`)
    return
  }
  seen.push(frame.type)
  console.log(`${stamp()} ← ${JSON.stringify(frame)}`)
  if (frame.type === "ready") {
    send({
      type: "user_turn",
      turnId,
      text: args.text,
      startedAt: Date.now() - 1500,
      endedAt: Date.now(),
    })
  }
  if (frame.type === "delta" && args.interrupt && !interrupted) {
    interrupted = true
    send({ type: "interrupt", turnId, spokenText: frame.text.slice(0, 8) })
  }
  if (frame.type === "say") send({ type: "playback_done", sayId: frame.sayId })
  const hangUp = () => {
    send({ type: "call_end", reason: "smoke test done" })
    setTimeout(() => finish("done"), 500)
  }
  if (frame.type === "turn_end") {
    if (linger) setTimeout(hangUp, linger)
    else hangUp()
  }
})
ws.addEventListener("close", (event) => {
  console.log(`${stamp()} closed ${event.code} ${event.reason}`)
})
ws.addEventListener("error", (event) => {
  console.error("socket error", event.message ?? event)
  finish("socket error")
})
