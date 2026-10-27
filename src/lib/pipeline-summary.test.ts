import { describe, expect, it } from "vitest"
import { formatSpan, summarize } from "./pipeline-summary"

describe("summarize", () => {
  it("keeps the first sentence as plain text", () => {
    expect(
      summarize(
        "**New edition, not a retry:** `edition 2026-W45 rev 1`. One message, 3643 characters."
      )
    ).toBe("New edition, not a retry: edition 2026-W45 rev 1.")
  })

  it("skips rules and tables and unwraps links", () => {
    expect(
      summarize(
        "---\n| a | b |\n## Published to [Telegram](https://t.me/x) today"
      )
    ).toBe("Published to Telegram today")
  })

  it("clips a run-on first line", () => {
    const out = summarize("word ".repeat(80))
    expect(out.length).toBeLessThanOrEqual(160)
    expect(out.endsWith("…")).toBe(true)
  })

  it("is empty for an empty reply", () => {
    expect(summarize("")).toBe("")
  })
})

describe("formatSpan", () => {
  it("picks the two largest units", () => {
    expect(formatSpan(42_000)).toBe("42s")
    expect(formatSpan(82_000)).toBe("1m 22s")
    expect(formatSpan(7_500_000)).toBe("2h 5m")
  })
})
