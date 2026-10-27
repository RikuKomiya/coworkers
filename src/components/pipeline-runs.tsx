import { useState } from "react"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Loader } from "@cloudflare/kumo/components/loader"
import { BotAvatar } from "@/components/bot-avatar"
import { CheckIcon, FileIcon, WarningIcon, XIcon } from "@/components/icons"
import { Prose } from "@/components/thread"
import { useHub } from "@/lib/hub-context"
import type { PipelineRun, PipelineRunStep } from "@/lib/types"

/** Outputs longer than this start folded. */
const FOLD_CHARS = 600

function RunBadge({ status }: { status: PipelineRun["status"] }) {
  switch (status) {
    case "running":
      return (
        <Badge variant="neutral" icon={<Loader size="sm" />}>
          Running
        </Badge>
      )
    case "waiting":
      return <Badge variant="orange">Needs your OK</Badge>
    case "done":
      return <Badge variant="green">Done</Badge>
    case "failed":
      return <Badge variant="red">Failed</Badge>
    case "stopped":
      return <Badge variant="neutral">Stopped</Badge>
  }
}

function StepMarker({ status }: { status: PipelineRunStep["status"] }) {
  const base =
    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs"
  switch (status) {
    case "running":
      return (
        <span className={`${base} bg-(--fill-hover)`}>
          <Loader size="sm" />
        </span>
      )
    case "done":
      return (
        <span className={`${base} bg-kumo-success-tint text-kumo-success`}>
          <CheckIcon size={14} />
        </span>
      )
    case "failed":
      return (
        <span className={`${base} bg-kumo-danger-tint text-kumo-danger`}>
          <XIcon size={14} />
        </span>
      )
    case "waiting":
      return (
        <span className={`${base} bg-kumo-warning-tint text-kumo-warning`}>
          <WarningIcon size={14} />
        </span>
      )
    default:
      return (
        <span
          className={`${base} outline outline-1 -outline-offset-1 outline-kumo-line`}
        />
      )
  }
}

function duration(step: PipelineRunStep) {
  if (!step.startedAt || !step.finishedAt) return null
  const s = Math.round((step.finishedAt - step.startedAt) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** A step's result: folded when long, with the full text a click away. */
function StepOutput({
  runId,
  index,
  output,
}: {
  runId: string
  index: number
  output: string
}) {
  const hub = useHub()
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<string | null>(null)
  const long = output.length > FOLD_CHARS
  // State carries a clipped copy; fetch the rest on first open.
  const clipped = output.endsWith("…")

  async function toggle() {
    if (!open && clipped && full === null && hub.pipelines) {
      setFull(await hub.pipelines.output(runId, index))
    }
    setOpen((o) => !o)
  }

  const text = open
    ? (full ?? output)
    : long
      ? `${output.slice(0, FOLD_CHARS)}…`
      : output
  return (
    <div className="space-y-1">
      <div className="rounded-xl bg-kumo-tint px-3.5 py-2.5 text-sm break-words">
        <Prose text={text} />
      </div>
      {long ? (
        <button
          type="button"
          onClick={() => void toggle()}
          className="px-1 text-xs text-kumo-subtle hover:text-kumo-default"
        >
          {open ? "Show less" : "Show all"}
        </button>
      ) : null}
    </div>
  )
}

function RunCard({ run }: { run: PipelineRun }) {
  const hub = useHub()
  const [busy, setBusy] = useState(false)
  const active = run.status === "running" || run.status === "waiting"

  async function act(fn: () => Promise<void>) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-3 rounded-2xl bg-kumo-base p-4 outline outline-1 -outline-offset-1 outline-black/[0.06]">
      <div className="flex items-center gap-2">
        <RunBadge status={run.status} />
        <span className="min-w-0 flex-1 truncate text-sm text-kumo-subtle tabular-nums">
          {new Date(run.startedAt).toLocaleString([], {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
          {" · "}
          {run.trigger === "schedule" ? "Scheduled" : "Run by you"}
        </span>
        {active ? (
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full"
            disabled={busy || !hub.pipelines}
            onClick={() => void act(() => hub.pipelines!.stop(run.id))}
          >
            Stop
          </Button>
        ) : null}
      </div>
      {run.input ? (
        <p className="line-clamp-2 px-0.5 text-sm text-pretty text-kumo-subtle">
          Input: {run.input}
        </p>
      ) : null}
      <ol className="space-y-3">
        {run.steps.map((step, i) => {
          const plan = run.plan[i]
          const bot =
            plan?.kind === "bot"
              ? hub.state.bots.find((b) => b.id === plan.botId)
              : undefined
          const label =
            plan?.kind === "approval"
              ? "Your approval"
              : (step.botName ?? bot?.name ?? "Deleted bot")
          const took = duration(step)
          return (
            <li key={i} className="flex gap-3">
              <StepMarker status={step.status} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="flex min-h-6 items-center gap-2 text-sm">
                  {bot ? <BotAvatar avatar={bot.avatar} size={18} /> : null}
                  <span
                    className={
                      step.status === "pending" || step.status === "skipped"
                        ? "text-kumo-subtle"
                        : "font-medium text-kumo-default"
                    }
                  >
                    {label}
                  </span>
                  {step.status === "skipped" ? (
                    <span className="text-xs text-kumo-subtle">skipped</span>
                  ) : null}
                  {took ? (
                    <span className="text-xs text-kumo-subtle tabular-nums">
                      {took}
                    </span>
                  ) : null}
                </p>
                {step.status === "waiting" && plan?.kind === "approval" ? (
                  <div className="space-y-2">
                    {plan.note ? (
                      <p className="text-sm text-pretty text-kumo-default">
                        {plan.note}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        className="btn-ink rounded-full"
                        disabled={busy || !hub.pipelines}
                        onClick={() =>
                          void act(() => hub.pipelines!.answer(run.id, true))
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-full"
                        disabled={busy || !hub.pipelines}
                        onClick={() =>
                          void act(() => hub.pipelines!.answer(run.id, false))
                        }
                      >
                        Turn down
                      </Button>
                    </div>
                  </div>
                ) : null}
                {step.output ? (
                  <StepOutput runId={run.id} index={i} output={step.output} />
                ) : null}
                {step.files?.length ? (
                  <p className="flex flex-wrap gap-1.5">
                    {step.files.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-1 rounded-full bg-(--fill-hover) px-2 py-0.5 text-xs text-kumo-subtle"
                      >
                        <FileIcon size={12} />
                        {name}
                      </span>
                    ))}
                  </p>
                ) : null}
                {step.error ? (
                  <p
                    className={`text-sm text-pretty ${
                      step.status === "failed"
                        ? "text-kumo-danger"
                        : "text-kumo-subtle"
                    }`}
                  >
                    {step.error}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </li>
  )
}

/** Recent runs of one pipeline, live from the hub. */
export function PipelineRuns({ pipelineId }: { pipelineId: string }) {
  const { state } = useHub()
  const runs = (state.pipelineRuns ?? []).filter(
    (r) => r.pipelineId === pipelineId
  )
  if (runs.length === 0) return null
  return (
    <section className="space-y-2">
      <h3 className="px-1.5 text-sm font-medium text-kumo-default">Runs</h3>
      <ul className="space-y-3">
        {runs.map((run) => (
          <RunCard key={run.id} run={run} />
        ))}
      </ul>
    </section>
  )
}
