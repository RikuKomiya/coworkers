import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import {
  backgroundTaskId,
  handedOff,
  helperBotId,
  isBackgroundTaskId,
  parentBotIdOf,
  withTaskNotes,
} from "./background-tasks"

describe("helper ids", () => {
  it("round-trips the parent out of a helper's bot id", () => {
    const taskId = backgroundTaskId("toolu_01AbC-xyz")
    expect(parentBotIdOf(helperBotId("b7k2", taskId))).toBe("b7k2")
  })

  it("treats a bot in the directory as no helper", () => {
    expect(parentBotIdOf("b7k2")).toBeNull()
  })

  it("keeps the same id for a replayed tool call and tells it from delegate_task's", () => {
    expect(backgroundTaskId("call:1/2")).toBe(backgroundTaskId("call:1/2"))
    expect(backgroundTaskId("call:1/2")).toBe("bgcall12")
    expect(isBackgroundTaskId(backgroundTaskId("x"))).toBe(true)
    expect(isBackgroundTaskId("tcall12")).toBe(false)
  })
})

describe("withTaskNotes", () => {
  const base: ModelMessage[] = [{ role: "user", content: "compare protein" }]
  const note = { key: "c1", text: "only Japanese brands" }

  it("appends a note the step has not seen", () => {
    const out = withTaskNotes(base, [note])
    expect(out).toHaveLength(2)
    expect(out?.[1]).toEqual({
      role: "user",
      content:
        "[Update from the user while you were working]\nonly Japanese brands",
    })
  })

  it("does not add a note twice when the SDK carries messages forward", () => {
    const once = withTaskNotes(base, [note])!
    expect(withTaskNotes(once, [note])).toBeNull()
    const more = withTaskNotes(once, [
      note,
      { key: "c2", text: "under 5000 yen" },
    ])
    expect(more).toHaveLength(3)
    expect(String(more?.[2].content)).toContain("under 5000 yen")
    expect(String(more?.[2].content)).not.toContain("only Japanese brands")
  })

  it("leaves the step alone without notes", () => {
    expect(withTaskNotes(base, [])).toBeNull()
  })
})

describe("handedOff", () => {
  const step = (text: string, ...calls: [string, unknown?][]) => ({
    text,
    toolCalls: calls.map(([toolName, input = {}]) => ({ toolName, input })),
  })

  it("ends the turn when the hand-off carries the reply", () => {
    expect(
      handedOff({
        steps: [step("", ["start_task", { reply: "おけー、やっとく！" }])],
      })
    ).toBe(true)
  })

  it("ends the turn when the reply was written as text", () => {
    expect(
      handedOff({ steps: [step("おけー、やっとく！", ["start_task"])] })
    ).toBe(true)
  })

  it("keeps going when the hand-off came without a reply", () => {
    expect(
      handedOff({ steps: [step("  ", ["start_task", { reply: " " }])] })
    ).toBe(false)
  })

  it("keeps going after other tools", () => {
    expect(handedOff({ steps: [step("調べるね", ["web_search"])] })).toBe(false)
  })
})
