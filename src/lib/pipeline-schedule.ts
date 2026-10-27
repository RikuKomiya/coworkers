/**
 * The pipeline editor's schedule picker. Pipelines run on UTC cron; the
 * picker works in the viewer's own time and converts both ways. Browser
 * only: the conversion depends on the viewer's zone.
 */

export type ScheduleKind =
  "manual" | "hourly" | "daily" | "weekdays" | "weekly" | "custom"

export interface ScheduleChoice {
  kind: ScheduleKind
  /** "HH:mm", local. For daily, weekdays and weekly. */
  time: string
  /** 0 = Sunday, local. For weekly. */
  day: number
  /** UTC cron, for custom. */
  cron: string
}

export const SCHEDULE_LABELS: Record<ScheduleKind, string> = {
  manual: "Only when I run it",
  hourly: "Every hour",
  daily: "Every day",
  weekdays: "Weekdays",
  weekly: "Every week",
  custom: "Custom (cron, UTC)",
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]

const DEFAULT_CHOICE: ScheduleChoice = {
  kind: "manual",
  time: "09:00",
  day: 1,
  cron: "",
}

/** Days the UTC moment sits ahead of the local one: -1, 0 or 1. */
function dayShift(local: Date) {
  const utc = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate()
  )
  const own = Date.UTC(local.getFullYear(), local.getMonth(), local.getDate())
  return Math.round((utc - own) / 86_400_000)
}

function shiftDays(days: number[], by: number) {
  return days.map((d) => (((d + by) % 7) + 7) % 7).sort((a, b) => a - b)
}

export function toCron(choice: ScheduleChoice): string | null {
  switch (choice.kind) {
    case "manual":
      return null
    case "hourly":
      return "0 * * * *"
    case "custom":
      return choice.cron.trim() || null
  }
  const [h, m] = choice.time.split(":").map(Number)
  const local = new Date()
  local.setHours(h || 0, m || 0, 0, 0)
  const shift = dayShift(local)
  const time = `${local.getUTCMinutes()} ${local.getUTCHours()}`
  if (choice.kind === "daily") return `${time} * * *`
  const days = choice.kind === "weekdays" ? [1, 2, 3, 4, 5] : [choice.day]
  return `${time} * * ${shiftDays(days, shift).join(",")}`
}

/** The picker's view of a stored cron. Anything it cannot show is custom. */
export function fromCron(cron: string | null): ScheduleChoice {
  if (!cron) return DEFAULT_CHOICE
  if (cron.trim() === "0 * * * *") return { ...DEFAULT_CHOICE, kind: "hourly" }
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6](?:,[0-6])*)$/.exec(
    cron.trim()
  )
  if (!match) return { ...DEFAULT_CHOICE, kind: "custom", cron }
  const local = new Date()
  local.setUTCHours(Number(match[2]), Number(match[1]), 0, 0)
  const time = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`
  if (match[3] === "*") return { ...DEFAULT_CHOICE, kind: "daily", time }
  const days = shiftDays(match[3].split(",").map(Number), -dayShift(local))
  if (days.join() === "1,2,3,4,5") {
    return { ...DEFAULT_CHOICE, kind: "weekdays", time }
  }
  if (days.length === 1) {
    return { ...DEFAULT_CHOICE, kind: "weekly", time, day: days[0] }
  }
  return { ...DEFAULT_CHOICE, kind: "custom", cron }
}
