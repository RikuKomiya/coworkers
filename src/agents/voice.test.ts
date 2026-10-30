import { describe, expect, it } from "vitest"
import type { VoiceView } from "@/lib/types"
import { backgroundTaskId } from "./background-tasks"
import {
  INITIAL_SPEECH,
  linkMatches,
  nextVoiceView,
  parseAgentFrame,
  signVoiceLink,
  speakable,
  toVoiceFrames,
  verifyVoiceLink,
  voicePath,
  voiceTurn,
} from "./voice"
import type { DoFrame, TurnEvent, VoiceTurnState } from "./voice"

/** Feeds deltas one at a time, then flushes, and returns everything spoken. */
function speak(deltas: string[]) {
  let state = INITIAL_SPEECH
  let out = ""
  for (const delta of deltas) {
    const next = speakable(state, delta)
    state = next.state
    out += next.text
  }
  return out + speakable(state, "", true).text
}

function run(events: TurnEvent[], state: VoiceTurnState = voiceTurn("t1")) {
  const frames: DoFrame[] = []
  for (const event of events) {
    const next = toVoiceFrames(state, event)
    state = next.state
    frames.push(...next.frames)
  }
  return frames
}

const delta = (text: string): TurnEvent => ({
  type: "chunk",
  chunk: { type: "text-delta", id: "x", delta: text },
})

describe("speakable", () => {
  it("strips bold split across deltas", () => {
    expect(speak(["It is **re", "ally", "*", "* good."])).toBe(
      "It is really good."
    )
    expect(speak(["It is *", "*really** good."])).toBe("It is really good.")
    expect(speak(["was ~", "~old~", "~ new"])).toBe("was old new")
  })

  it("speaks a link's text and drops the URL, even when it arrives in pieces", () => {
    expect(speak(["See [the do", "cs](https://ex", "ample.com/a) now."])).toBe(
      "See the docs now."
    )
    expect(speak(["Go to htt", "ps://example.com/x and back."])).toBe(
      "Go to  and back."
    )
  })

  it("drops headings, bullets, code fences and inline code markers", () => {
    expect(
      speak([
        "# Plan\n",
        "- buy ",
        "milk\n- call `Bob`\n```js\nrun()\n```\ndone",
      ])
    ).toBe("Plan\nbuy milk\ncall Bob\ndone")
  })

  it("keeps Japanese text flowing without waiting for spaces", () => {
    let state = INITIAL_SPEECH
    const first = speakable(state, "明日は")
    state = first.state
    expect(first.text).toBe("明日は")
    expect(speakable(state, "晴れです。").text).toBe("晴れです。")
  })
})

describe("toVoiceFrames", () => {
  it("turns text deltas into clean delta frames and ends completed", () => {
    const frames = run([delta("Hi **th"), delta("ere**!"), { type: "done" }])
    const text = frames
      .filter((f) => f.type === "delta")
      .map((f) => (f.type === "delta" ? f.text : ""))
      .join("")
    expect(text).toBe("Hi there!")
    expect(frames.at(-1)).toEqual({
      type: "turn_end",
      turnId: "t1",
      status: "completed",
    })
  })

  it("voices start_task's reply and ends handed off with the task id", () => {
    const frames = run([
      {
        type: "chunk",
        chunk: {
          type: "tool-input-start",
          toolCallId: "call_1",
          toolName: "start_task",
        },
      },
      {
        type: "chunk",
        chunk: {
          type: "tool-input-available",
          toolCallId: "call_1",
          toolName: "start_task",
          input: {
            title: "Compare",
            task: "...",
            reply: "On it, **one** minute.",
          },
        },
      },
      { type: "done" },
    ])
    expect(frames).toEqual([
      { type: "delta", turnId: "t1", text: "On it, one minute." },
      {
        type: "turn_end",
        turnId: "t1",
        status: "handed_off",
        taskIds: [backgroundTaskId("call_1")],
      },
    ])
  })

  it("announces any other tool once, with a label", () => {
    const start: TurnEvent = {
      type: "chunk",
      chunk: {
        type: "tool-input-available",
        toolCallId: "c2",
        toolName: "browser_markdown",
        input: { url: "example.com" },
      },
    }
    expect(run([start, start])).toEqual([
      {
        type: "tool",
        turnId: "t1",
        name: "browser_markdown",
        label: "Read example.com",
      },
    ])
  })

  it("ends needs_screen when the turn waits on an approval", () => {
    const frames = run([
      {
        type: "chunk",
        chunk: {
          type: "tool-approval-request",
          approvalId: "a",
          toolCallId: "c",
        },
      },
      { type: "done" },
    ])
    expect(frames.at(-1)).toMatchObject({ status: "needs_screen" })
  })

  it("does not voice held text when aborted, and ignores events after the end", () => {
    const frames = run([
      delta("Sure, **"),
      { type: "aborted" },
      delta("late"),
      { type: "done" },
    ])
    expect(frames).toEqual([
      { type: "delta", turnId: "t1", text: "Sure, " },
      { type: "turn_end", turnId: "t1", status: "aborted" },
    ])
  })

  it("reports errors as error", () => {
    expect(run([{ type: "error" }])).toEqual([
      { type: "turn_end", turnId: "t1", status: "error" },
    ])
  })
})

describe("parseAgentFrame", () => {
  it("accepts a user turn and rejects malformed frames", () => {
    expect(
      parseAgentFrame(
        JSON.stringify({
          type: "user_turn",
          turnId: "u1",
          text: "hi",
          startedAt: 1,
          endedAt: 2,
        })
      )
    ).toMatchObject({ type: "user_turn", turnId: "u1" })
    expect(parseAgentFrame("{")).toBeNull()
    expect(
      parseAgentFrame(JSON.stringify({ type: "user_turn", text: "hi" }))
    ).toBeNull()
    expect(
      parseAgentFrame(
        JSON.stringify({
          type: "hello",
          v: 2,
          callId: "c",
          room: "r",
          participant: "p",
        })
      )
    ).toBeNull()
  })
})

describe("nextVoiceView", () => {
  const view: VoiceView = { callId: "c", status: "listening", partial: "" }

  it("walks listening → thinking → speaking → listening", () => {
    let v = nextVoiceView(view, { type: "user_partial", text: "what's" })
    expect(v).toEqual({ callId: "c", status: "listening", partial: "what's" })
    v = nextVoiceView(v, {
      type: "user_turn",
      turnId: "u",
      text: "x",
      startedAt: 0,
      endedAt: 0,
    })
    expect(v).toEqual({ callId: "c", status: "thinking", partial: "" })
    v = nextVoiceView(v, { type: "delta", turnId: "u", text: "Hi" })
    v = nextVoiceView(v, { type: "turn_end", turnId: "u", status: "completed" })
    expect(v.status).toBe("speaking")
    expect(
      nextVoiceView(v, { type: "playback_done", turnId: "u" }).status
    ).toBe("listening")
  })

  it("goes back to listening when a turn ends without saying anything", () => {
    const thinking = { ...view, status: "thinking" as const }
    expect(
      nextVoiceView(thinking, {
        type: "turn_end",
        turnId: "u",
        status: "error",
      }).status
    ).toBe("listening")
  })
})

describe("voice link tokens", () => {
  const SECRET = "test-secret"
  const NOW = 1_800_000_000
  const link = { userId: "u1", botId: "b1", callId: "c1", exp: NOW + 60 }

  it("round-trips a valid token", async () => {
    const token = await signVoiceLink(link, SECRET)
    expect(await verifyVoiceLink(token, SECRET, NOW)).toEqual(link)
  })

  it("rejects an expired token", async () => {
    const token = await signVoiceLink(link, SECRET)
    expect(await verifyVoiceLink(token, SECRET, NOW + 61)).toBeNull()
  })

  it("rejects a tampered payload or a different secret", async () => {
    const token = await signVoiceLink(link, SECRET)
    const [, sig] = token.split(".")
    const forged = btoa(JSON.stringify({ ...link, botId: "b2" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    expect(await verifyVoiceLink(`${forged}.${sig}`, SECRET, NOW)).toBeNull()
    expect(await verifyVoiceLink(token, "other-secret", NOW)).toBeNull()
    expect(await verifyVoiceLink("garbage", SECRET, NOW)).toBeNull()
  })

  it("only opens the bot in the path it was minted for", () => {
    expect(linkMatches(link, { userId: "u1", botId: "b1" })).toBe(true)
    expect(linkMatches(link, { userId: "u1", botId: "b2" })).toBe(false)
    expect(linkMatches(link, { userId: "u2", botId: "b1" })).toBe(false)
  })

  it("parses /voice/<userId>/<botId> and nothing else", () => {
    expect(voicePath("/voice/u%401/b1")).toEqual({ userId: "u@1", botId: "b1" })
    expect(voicePath("/voice/u1")).toBeNull()
    expect(voicePath("/voice/u1/b1/x")).toBeNull()
    expect(voicePath("/agents/u1/b1")).toBeNull()
  })
})
