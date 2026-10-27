import type { PipelineRun, PipelineRunStep } from "@/lib/types"

const MAX_SUMMARY_CHARS = 160

/**
 * The first sentence of a bot's reply as plain text, for a one-line summary
 * beside the step. Skips rules, tables and headings-only noise.
 */
export function summarize(text: string) {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^(-{3,}|\*{3,}|\||```)/.test(l)) ?? ""
  const plain = line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/, "")
    .replace(/^([-*+>]|\d+\.)\s+/, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
  const end = plain.search(/[.!?](\s|$)/)
  const sentence = end === -1 ? plain : plain.slice(0, end + 1)
  return sentence.length > MAX_SUMMARY_CHARS
    ? `${sentence.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`
    : sentence
}

/** "42s", "1m 22s", "2h 5m". */
export function formatSpan(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** How long a step took, or has taken so far. */
export function stepSpan(step: PipelineRunStep, now: number) {
  if (!step.startedAt) return null
  return (step.finishedAt ?? now) - step.startedAt
}

/** The step a run is on: the one working or waiting for the user. */
export function currentStep(run: PipelineRun) {
  return run.steps.findIndex(
    (s) => s.status === "running" || s.status === "waiting"
  )
}

/**
 * A summary that says the step had nothing to do ("No new content.",
 * "Nothing sent: …"), so the run can play it down.
 */
export function isNoop(summary: string) {
  return /^(no|nothing|none)\b/i.test(summary)
}
