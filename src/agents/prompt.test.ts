import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { DEFAULT_PROACTIVE, DEFAULT_RULES } from "@/lib/types"
import type { BotState, BotTask } from "@/lib/types"
import {
  VOICE_INSTRUCTIONS,
  helperBrief,
  scriptPrompt,
  turnContext,
  withSentTimes,
} from "./prompt"

const AT = Date.UTC(2026, 9, 26, 5, 41)

describe("withSentTimes", () => {
  it("stamps each user message with its own send time", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
      { role: "user", content: [{ type: "text", text: "second" }] },
    ]
    const out = withSentTimes(messages, [AT, AT + 60_000], "UTC")
    expect(out[0].content).toBe(
      "first\n\n[Sent Monday, 26 October 2026 at 05:41]"
    )
    expect(out[1]).toBe(messages[1])
    expect(out[2].content).toEqual([
      { type: "text", text: "second" },
      { type: "text", text: "[Sent Monday, 26 October 2026 at 05:42]" },
    ])
  })

  it("matches from the end when older messages were compacted away", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "latest" }]
    const out = withSentTimes(messages, [AT - 86_400_000, AT], "UTC")
    expect(out[0].content).toBe(
      "latest\n\n[Sent Monday, 26 October 2026 at 05:41]"
    )
  })

  it("leaves a message without a timestamp alone", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "hi" }]
    expect(withSentTimes(messages, [undefined], "UTC")[0].content).toBe("hi")
  })
})

describe("scriptPrompt", () => {
  it("reports a finished script's result and output", () => {
    const text = scriptPrompt({
      runId: "js_1",
      purpose: "Close stale issues",
      outcome: {
        exitCode: 0,
        stdout: "closed 3\n",
        stderr: "",
        value: { closed: 3 },
      },
      background: false,
    })
    expect(text).toContain("[Script finished: js_1]")
    expect(text).toContain("It completed.")
    expect(text).toContain('"closed": 3')
    expect(text).toContain("closed 3")
    expect(text).not.toContain("stderr:")
    expect(text).not.toContain("background turn")
  })

  it("keeps only the end of long output", () => {
    const text = scriptPrompt({
      runId: "js_2",
      purpose: "Dump",
      outcome: { exitCode: 1, stdout: `${"a".repeat(5000)}END`, stderr: "" },
      background: false,
    })
    expect(text).toContain("It failed (exit code 1).")
    expect(text).toContain("END")
    expect(text).not.toContain("a".repeat(4500))
  })

  it("warns that a lost script may have partly run", () => {
    const text = scriptPrompt({
      runId: "js_3",
      purpose: "Send invoices",
      outcome: { lost: "it stopped responding" },
      background: true,
    })
    expect(text).toContain("did not finish: it stopped responding")
    expect(text).toContain("check their effects")
    expect(text).toContain("background turn")
  })
})

describe("turnContext tasks", () => {
  const state: BotState = {
    name: "Shopper",
    avatar: "blue-rectangle",
    role: "",
    status: "idle",
    rules: DEFAULT_RULES,
    routines: [],
    proactive: DEFAULT_PROACTIVE,
    skills: [],
    apps: [],
  }
  const context = (extra: {
    task?: BotTask
    backgroundTasks?: { id: string; title: string; task: string; at: number }[]
  }) =>
    turnContext(state, [], [], {
      openItems: [],
      delegations: [],
      backgroundTasks: extra.backgroundTasks ?? [],
      task: extra.task,
      inbound: { email: null, webhookUrl: "" },
      sharedMemory: "",
      builtApps: [],
    })

  it("tells a helper that its reply goes back to the main chat", () => {
    const text = context({
      task: { id: "bg1", replyTo: { kind: "parent", botId: "b1" } },
    })
    expect(text).toContain("background helper")
    expect(text).toContain("handed back to the main chat")
    expect(text).toContain('"Ask first" are blocked')
    expect(text).not.toContain("Another bot gave you this task")
  })

  it("lists running tasks with the id update_task and cancel_task take", () => {
    const text = context({
      backgroundTasks: [
        { id: "bgabc", title: "Protein prices", task: "Compare", at: AT },
      ],
    })
    expect(text).toContain("# Tasks running in the background")
    expect(text).toContain("- [bgabc] Protein prices")
    expect(text).not.toContain("# Tasks you handed out")
  })
})

describe("helperBrief", () => {
  const conversation = [
    { role: "user" as const, text: "プロテインの価格比較して" },
    { role: "assistant" as const, text: "おけー、やっとく！" },
    { role: "user" as const, text: "国産だけで" },
  ]

  it("gives the helper the conversation and the user's memory", () => {
    const text = helperBrief({
      title: "プロテインの価格比較",
      conversation,
      memory: "- Lives in Japan",
    })
    expect(text.split("\n")[0]).toBe("[Background task: プロテインの価格比較]")
    expect(text).toContain(
      "User: プロテインの価格比較して\nYou: おけー、やっとく！\nUser: 国産だけで"
    )
    expect(text).toContain("- Lives in Japan")
  })

  it("leaves out an empty memory", () => {
    expect(
      helperBrief({ title: "P", conversation, memory: "  " })
    ).not.toContain("memory")
  })
})

describe("VOICE_INSTRUCTIONS", () => {
  it("keeps spoken replies short, plain and spoken-number, and sends slow or visual work elsewhere", () => {
    expect(VOICE_INSTRUCTIONS).toContain("one or two short spoken sentences")
    expect(VOICE_INSTRUCTIONS).toMatch(
      /no Markdown.*no tables, no URLs, no code/
    )
    expect(VOICE_INSTRUCTIONS).toMatch(/numbers.*in words/)
    expect(VOICE_INSTRUCTIONS).toMatch(
      /more than a few seconds goes to start_task/
    )
    expect(VOICE_INSTRUCTIONS).toMatch(/put it in the chat/)
  })
})
