import { z } from "zod"
import { describeCall } from "@/lib/message-parts"
import type { VoiceView } from "@/lib/types"
import { backgroundTaskId } from "./background-tasks"

/**
 * Voice calls: a LiveKit agent (voice-agent/) does the listening and the
 * speaking, and talks to the bot's BotAgent over one WebSocket in the
 * frames below. Everything here is pure, so it tests without a Durable
 * Object.
 */

export const VOICE_PROTOCOL_VERSION = 1

/** Set by the Worker on a verified `/voice/*` upgrade, read by the BotAgent. */
export const VOICE_CALL_HEADER = "x-coworkers-voice-call"

/** Connection tag for the LiveKit agent's socket. */
export const VOICE_TAG = "voice"

/** Agent → DO. Parsed at the socket, so the rest of the code trusts it. */
export const agentFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    v: z.literal(VOICE_PROTOCOL_VERSION),
    callId: z.string().min(1),
    room: z.string(),
    participant: z.string(),
  }),
  z.object({ type: z.literal("user_partial"), text: z.string() }),
  z.object({
    type: z.literal("user_turn"),
    turnId: z.string().min(1),
    text: z.string(),
    language: z.string().optional(),
    startedAt: z.number(),
    endedAt: z.number(),
  }),
  z.object({
    type: z.literal("interrupt"),
    turnId: z.string().min(1),
    spokenText: z.string(),
  }),
  z.object({
    type: z.literal("playback_done"),
    turnId: z.string().optional(),
    sayId: z.string().optional(),
  }),
  z.object({ type: z.literal("call_end"), reason: z.string() }),
  z.object({ type: z.literal("ping") }),
])

export type AgentFrame = z.infer<typeof agentFrameSchema>

export type TurnEndStatus =
  "completed" | "handed_off" | "aborted" | "needs_screen" | "error"

/** DO → agent. */
export type DoFrame =
  | {
      type: "ready"
      v: typeof VOICE_PROTOCOL_VERSION
      botName: string
      language: string
      ttsVoice?: string
      greeting?: string
      activeTurnId?: string
    }
  | { type: "delta"; turnId: string; text: string }
  | { type: "tool"; turnId: string; name: string; label: string }
  | {
      type: "turn_end"
      turnId: string
      status: TurnEndStatus
      taskIds?: string[]
    }
  | {
      type: "say"
      sayId: string
      text: string
      reason: "task_result" | "notice"
    }
  | { type: "error"; code: string; message: string }
  | { type: "pong" }

export function parseAgentFrame(raw: string): AgentFrame | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = agentFrameSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

// ── Markdown → speakable text, one delta at a time ────────────────────

export interface SpeechState {
  /** Raw text not emitted yet: it may end inside a marker, link or URL. */
  held: string
  atLineStart: boolean
  inFence: boolean
}

export const INITIAL_SPEECH: SpeechState = {
  held: "",
  atLineStart: true,
  inFence: false,
}

/** Past this, an unclosed `[` or URL is plain text, not something to wait for. */
const MAX_HOLD = 400

/** Where the text can be cut without splitting a construct that is still arriving. */
function safeCut(text: string, atLineStart: boolean): number {
  let cut = text.length
  // A line still made only of list, heading or quote markers.
  const lineStart = text.lastIndexOf("\n") + 1
  if (lineStart > 0 || atLineStart) {
    if (/^\s*(#{1,6}|[-*+>]|\|)?\s*$/.test(text.slice(lineStart))) {
      cut = Math.min(cut, lineStart)
    }
  }
  // `**`, `~~`, a fence: the closing half may be in the next delta.
  const markers = /[*_~`]+$/.exec(text)
  if (markers) cut = Math.min(cut, markers.index)
  // A link or image whose `](url)` has not arrived.
  const open = text.lastIndexOf("[")
  if (open !== -1 && text.length - open < MAX_HOLD) {
    const rest = text.slice(open)
    if (!/^\[[^\]]*\](?!\()/.test(rest) && !/^\[[^\]]*\]\([^)]*\)/.test(rest)) {
      cut = Math.min(cut, open > 0 && text[open - 1] === "!" ? open - 1 : open)
    }
  }
  // A URL, or the start of one, still being written.
  const url = /(?:h|ht|htt|https?|https?:\/?\/?\S*)$/.exec(text)
  if (url && text.length - url.index < MAX_HOLD) {
    cut = Math.min(cut, url.index)
  }
  return cut
}

function cleanLine(line: string, atLineStart: boolean) {
  let out = line
  if (atLineStart) {
    // Table separator rows and horizontal rules carry nothing to say.
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(out)) return ""
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(out)) return ""
    out = out.replace(/^\s{0,3}#{1,6}\s+/, "")
    out = out.replace(/^\s*>\s?/, "")
    out = out.replace(/^\s*[-*+]\s+/, "")
  }
  out = out
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*|__|~~|`+|\*/g, "")
    .replace(/(^|[\s(])_+|_+(?=[\s.,!?;:)]|$)/g, "$1")
  // A table row reads as a list of its cells.
  if (!out.includes("|")) return out
  return out
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(", ")
}

/**
 * Feed one streamed delta (or `final` to flush) and get back the speakable
 * part. Markers split across deltas come out clean because a tail that could
 * still become one is held until the next delta.
 */
export function speakable(
  state: SpeechState,
  delta: string,
  final = false
): { state: SpeechState; text: string } {
  const text = state.held + delta
  const cut = final ? text.length : safeCut(text, state.atLineStart)
  let { atLineStart, inFence } = state
  let out = ""
  const lines = text.slice(0, cut).split("\n")
  lines.forEach((line, i) => {
    const last = i === lines.length - 1
    if (atLineStart && /^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
    } else if (!inFence) {
      out += cleanLine(line, atLineStart)
    }
    if (!last) {
      if (!inFence && !out.endsWith("\n")) out += "\n"
      atLineStart = true
    } else if (line.length > 0) {
      atLineStart = false
    }
  })
  return { state: { held: text.slice(cut), atLineStart, inFence }, text: out }
}

// ── Turn stream → frames ──────────────────────────────────────────────

export interface VoiceTurnState {
  turnId: string
  speech: SpeechState
  /** Tool calls already announced, so a re-sent input is not voiced twice. */
  announced: string[]
  taskIds: string[]
  needsScreen: boolean
  /** Text already went out, so start_task's reply would say it twice. */
  spoke: boolean
  ended: boolean
}

export function voiceTurn(turnId: string): VoiceTurnState {
  return {
    turnId,
    speech: INITIAL_SPEECH,
    announced: [],
    taskIds: [],
    needsScreen: false,
    spoke: false,
    ended: false,
  }
}

/**
 * What a voice turn's stream callback sees: each `onEvent` chunk (a UI
 * message chunk from the AI SDK, as JSON) and how the turn ended.
 */
export type TurnEvent =
  | { type: "chunk"; chunk: unknown }
  | { type: "done" }
  | { type: "aborted" }
  | { type: "error" }

/** Tool calls that are bookkeeping, not something worth a filler line. */
const SILENT_TOOLS = new Set(["mark_reported", "was_reported"])

function endFrames(state: VoiceTurnState, status: TurnEndStatus): DoFrame[] {
  const flushed = speakable(state.speech, "", true).text
  const frames: DoFrame[] = []
  if (status !== "aborted" && status !== "error" && flushed.trim()) {
    frames.push({ type: "delta", turnId: state.turnId, text: flushed })
  }
  frames.push({
    type: "turn_end",
    turnId: state.turnId,
    status,
    ...(status === "handed_off" ? { taskIds: state.taskIds } : {}),
  })
  return frames
}

function chunkFrames(
  state: VoiceTurnState,
  chunk: Record<string, unknown>
): { state: VoiceTurnState; frames: DoFrame[] } {
  const { turnId } = state
  switch (chunk.type) {
    case "text-delta": {
      if (typeof chunk.delta !== "string") break
      const next = speakable(state.speech, chunk.delta)
      return {
        state: {
          ...state,
          speech: next.state,
          spoke: state.spoke || !!next.text.trim(),
        },
        frames: next.text ? [{ type: "delta", turnId, text: next.text }] : [],
      }
    }
    case "tool-input-available": {
      const id = String(chunk.toolCallId ?? "")
      const name = String(chunk.toolName ?? "")
      if (!id || state.announced.includes(id)) break
      const announced = [...state.announced, id]
      const input =
        chunk.input && typeof chunk.input === "object"
          ? (chunk.input as Record<string, unknown>)
          : {}
      if (name === "start_task") {
        // The instant acknowledgment rides in the tool input, not in text.
        // Models sometimes also acknowledge in text; say it once.
        const reply = typeof input.reply === "string" ? input.reply.trim() : ""
        const spoken =
          reply && !state.spoke
            ? speakable(INITIAL_SPEECH, reply, true).text
            : ""
        return {
          state: {
            ...state,
            announced,
            taskIds: [...state.taskIds, backgroundTaskId(id)],
            spoke: state.spoke || !!spoken.trim(),
          },
          frames: spoken ? [{ type: "delta", turnId, text: spoken }] : [],
        }
      }
      if (SILENT_TOOLS.has(name))
        return { state: { ...state, announced }, frames: [] }
      const label = describeCall({
        id,
        name,
        state: "running",
        input,
        output: undefined,
      })
      return {
        state: { ...state, announced },
        frames: [{ type: "tool", turnId, name, label }],
      }
    }
    case "tool-approval-request":
      return { state: { ...state, needsScreen: true }, frames: [] }
  }
  return { state, frames: [] }
}

/**
 * The voice channel's translation: one stream event in, the frames to send
 * the LiveKit agent out. After the turn ends every event is ignored.
 */
export function toVoiceFrames(
  state: VoiceTurnState,
  event: TurnEvent
): { state: VoiceTurnState; frames: DoFrame[] } {
  if (state.ended) return { state, frames: [] }
  if (event.type === "chunk") {
    if (!event.chunk || typeof event.chunk !== "object")
      return { state, frames: [] }
    return chunkFrames(state, event.chunk as Record<string, unknown>)
  }
  const status: TurnEndStatus =
    event.type === "aborted"
      ? "aborted"
      : event.type === "error"
        ? "error"
        : state.needsScreen
          ? "needs_screen"
          : state.taskIds.length
            ? "handed_off"
            : "completed"
  return { state: { ...state, ended: true }, frames: endFrames(state, status) }
}

/** Lines that start a block meant for the screen: a table, list, heading or code. */
const SCREEN_BLOCK = /^\s*(\||[-*+]\s|\d+[.)]\s|#|```|~~~)/

/**
 * What to say out loud of a finished reply that was not streamed to the
 * call: its opening prose, up to two sentences. The rest stays in the chat.
 */
export function spokenLead(markdown: string, maxSentences = 2) {
  const lead: string[] = []
  for (const line of markdown.trim().split("\n")) {
    if (SCREEN_BLOCK.test(line)) break
    lead.push(line)
  }
  const text = speakable(INITIAL_SPEECH, lead.join("\n"), true)
    .text.replace(/\s+/g, " ")
    .trim()
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*/g) ?? []
  return sentences.slice(0, maxSentences).join("").trim()
}

// ── What the call bar shows ───────────────────────────────────────────

/** Moves the call bar's status on each frame in or out of the call. */
export function nextVoiceView(
  view: VoiceView,
  frame: AgentFrame | DoFrame
): VoiceView {
  switch (frame.type) {
    case "user_partial":
      return { ...view, status: "listening", partial: frame.text }
    case "user_turn":
      return { ...view, status: "thinking", partial: "" }
    case "interrupt":
    case "playback_done":
      return { ...view, status: "listening" }
    case "delta":
    case "say":
      return { ...view, status: "speaking" }
    case "turn_end":
      // Speech already sent keeps playing until the agent says it is done.
      return view.status === "speaking"
        ? view
        : { ...view, status: "listening" }
  }
  return view
}

// ── Link tokens: what lets the LiveKit agent reach one bot ────────────

export interface VoiceLink {
  userId: string
  botId: string
  callId: string
  /** Unix seconds. */
  exp: number
}

export const VOICE_LINK_TTL_S = 2 * 60 * 60

const linkSchema = z.object({
  userId: z.string().min(1),
  botId: z.string().min(1),
  callId: z.string().min(1),
  exp: z.number(),
})

const encoder = new TextEncoder()

export function base64url(bytes: Uint8Array) {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
    return Uint8Array.from(binary, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  )
}

/** `<payload>.<signature>`, both base64url; the signature is HMAC-SHA256. */
export async function signVoiceLink(link: VoiceLink, secret: string) {
  const payload = base64url(encoder.encode(JSON.stringify(link)))
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    encoder.encode(payload)
  )
  return `${payload}.${base64url(new Uint8Array(signature))}`
}

/** The link a token carries, or null when it is malformed, tampered with or expired. */
export async function verifyVoiceLink(
  token: string,
  secret: string,
  nowS = Math.floor(Date.now() / 1000)
): Promise<VoiceLink | null> {
  const [payload, signature, extra] = token.split(".")
  if (!payload || !signature || extra !== undefined) return null
  const sig = fromBase64url(signature)
  const body = fromBase64url(payload)
  if (!sig || !body) return null
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    sig,
    encoder.encode(payload)
  )
  if (!ok) return null
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
  const link = linkSchema.safeParse(json)
  if (!link.success || link.data.exp <= nowS) return null
  return link.data
}

/** `/voice/<userId>/<botId>` → its parts, URL-decoded. */
export function voicePath(pathname: string) {
  const [, prefix, userId, botId, extra] = pathname.split("/")
  if (prefix !== "voice" || !userId || !botId || extra !== undefined)
    return null
  try {
    return {
      userId: decodeURIComponent(userId),
      botId: decodeURIComponent(botId),
    }
  } catch {
    return null
  }
}

/** A token only opens the bot it was minted for. */
export function linkMatches(
  link: VoiceLink,
  path: { userId: string; botId: string }
) {
  return link.userId === path.userId && link.botId === path.botId
}

// ── Call setup ────────────────────────────────────────────────────────

/** Time zones whose speakers are unlikely to want English by default. */
const ZONE_LANGUAGES: Record<string, string> = {
  "Asia/Tokyo": "ja",
  "Asia/Seoul": "ko",
  "Asia/Shanghai": "zh",
  "Asia/Taipei": "zh",
  "Europe/Berlin": "de",
  "Europe/Paris": "fr",
  "Europe/Madrid": "es",
}

/** The call's language: what the user last spoke, else a guess from their time zone. */
export function callLanguage(spoken: string | undefined, timezone: string) {
  return spoken || ZONE_LANGUAGES[timezone] || "en"
}

/** What the bot says when it picks up, before the user has said anything. */
export function greetingFor(language: string, botName: string) {
  return language === "ja"
    ? `${botName}です。どうしましたか？`
    : `Hi, it's ${botName}. What's up?`
}
