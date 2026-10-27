import { describe, expect, it } from "vitest"
import { pipelineStepPrompt, validatePipeline } from "./pipelines"

const bots = new Set(["a", "b"])

describe("validatePipeline", () => {
  it("trims and keeps a valid pipeline", () => {
    expect(
      validatePipeline(
        {
          name: "  Weekly  ",
          steps: [
            { kind: "bot", botId: "a", instructions: " Find news " },
            { kind: "approval", note: "" },
            { kind: "bot", botId: "b", instructions: "Post it" },
          ],
          cron: " 0 9 * * 1 ",
        },
        bots
      )
    ).toEqual({
      name: "Weekly",
      steps: [
        { kind: "bot", botId: "a", instructions: "Find news" },
        { kind: "approval", note: "" },
        { kind: "bot", botId: "b", instructions: "Post it" },
      ],
      cron: "0 9 * * 1",
    })
  })

  it("rejects an approval as the first step", () => {
    expect(() =>
      validatePipeline(
        { name: "x", steps: [{ kind: "approval", note: "" }], cron: null },
        bots
      )
    ).toThrow(/first step/)
  })

  it("rejects unknown bots, empty instructions and bad cron", () => {
    const step = { kind: "bot" as const, botId: "a", instructions: "Do it" }
    expect(() =>
      validatePipeline(
        { name: "x", steps: [{ ...step, botId: "zz" }], cron: null },
        bots
      )
    ).toThrow(/Pick a bot/)
    expect(() =>
      validatePipeline(
        { name: "x", steps: [{ ...step, instructions: " " }], cron: null },
        bots
      )
    ).toThrow(/what to do/)
    expect(() =>
      validatePipeline({ name: "x", steps: [step], cron: "daily" }, bots)
    ).toThrow(/cron/)
  })
})

describe("pipelineStepPrompt", () => {
  it("names the step, the input and who gets the result", () => {
    const text = pipelineStepPrompt({
      pipeline: "Weekly",
      step: 1,
      steps: 3,
      instructions: "Write it up",
      from: "Researcher (step 1)",
      input: "",
      next: "the user",
    })
    expect(text.split("\n")[0]).toBe('[Pipeline "Weekly", step 2 of 3]')
    expect(text).toContain("## Input from Researcher (step 1)\n(nothing)")
    expect(text).toContain("passed on to the user")
  })
})
