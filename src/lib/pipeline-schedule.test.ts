import { describe, expect, it } from "vitest"
import { fromCron, toCron } from "./pipeline-schedule"
import type { ScheduleChoice } from "./pipeline-schedule"

const base: ScheduleChoice = { kind: "manual", time: "09:00", day: 1, cron: "" }

describe("schedule choices", () => {
  it("round-trips every preset through cron", () => {
    for (const choice of [
      { ...base, kind: "daily" as const, time: "07:30" },
      { ...base, kind: "weekdays" as const, time: "23:45" },
      { ...base, kind: "weekly" as const, time: "00:15", day: 0 },
      { ...base, kind: "hourly" as const },
    ]) {
      const back = fromCron(toCron(choice))
      expect(back.kind).toBe(choice.kind)
      if (choice.kind !== "hourly") expect(back.time).toBe(choice.time)
      if (choice.kind === "weekly") expect(back.day).toBe(choice.day)
    }
  })

  it("keeps manual and unusual schedules as they are", () => {
    expect(toCron(base)).toBeNull()
    expect(fromCron(null).kind).toBe("manual")
    expect(fromCron("*/5 * * * *")).toMatchObject({
      kind: "custom",
      cron: "*/5 * * * *",
    })
  })
})
