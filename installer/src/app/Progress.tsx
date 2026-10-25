import { Button } from "@cloudflare/kumo/components/button"
import { RobotHead } from "robot-heads"
import type { RobotHeadState } from "robot-heads"
import { BOT_AVATARS, BOT_AVATAR_LOOKS } from "@coworkers/types"
import { STEP_COPY } from "../shared"
import type { InstallerState, StepStatus } from "../shared"
import type { InstallerAgent } from "./App"
import { ExternalIcon, WarningIcon } from "./icons"

const FACE: Record<StepStatus, RobotHeadState> = {
  pending: "sleeping",
  running: "working",
  done: "happy",
  skipped: "idle",
  failed: "error",
}

/** The install, one robot per step, waking up as its part gets done. */
export function Progress({
  agent,
  state,
}: {
  agent: InstallerAgent
  state: InstallerState
}) {
  const current =
    state.steps.find((s) => s.status === "running" || s.status === "failed") ??
    state.steps.find((s) => s.status === "pending")
  const done = state.steps.filter((s) => s.status === "done").length
  const failed = state.phase === "failed"

  return (
    <div className="screen-in flex w-full max-w-[720px] flex-col items-center text-center">
      <p className="text-xs font-medium tracking-wide text-kumo-subtle uppercase tabular-nums">
        {failed ? "Stuck" : `${done} of ${state.steps.length}`}
        {state.plan ? ` · ${state.plan.name}` : ""}
      </p>
      <h1
        key={current?.id}
        className="swap mt-2 text-[28px] leading-tight font-semibold tracking-tight text-kumo-default"
      >
        {current ? STEP_COPY[current.id].whimsy : "All done"}
        {failed ? "…" : ""}
      </h1>
      <p className="mt-2 h-5 text-sm text-kumo-subtle tabular-nums">
        {current ? (current.detail ?? STEP_COPY[current.id].title) : null}
      </p>

      <ol className="mt-12 grid w-full grid-cols-3 gap-x-2 gap-y-8 sm:grid-cols-6">
        {state.steps.map((step, i) => {
          const look = BOT_AVATAR_LOOKS[BOT_AVATARS[i % BOT_AVATARS.length]]
          return (
            <li
              key={step.id}
              className="part flex flex-col items-center"
              data-status={step.status}
            >
              <span className="part-head">
                <RobotHead
                  size={72}
                  shape={look.shape}
                  color={look.color}
                  state={FACE[step.status]}
                  antenna={false}
                  interactive={false}
                  seed={i / 6}
                  aria-hidden="true"
                />
              </span>
              <span
                className={`mt-3 text-xs text-pretty ${
                  step.status === "pending"
                    ? "text-kumo-subtle"
                    : "text-kumo-default"
                } ${step.status === "failed" ? "text-kumo-danger" : ""}`}
              >
                {STEP_COPY[step.id].title}
              </span>
              <span className="sr-only">{step.status}</span>
            </li>
          )
        })}
      </ol>

      {failed && state.error ? (
        <div className="screen-in mt-12 w-full max-w-[520px] rounded-2xl bg-kumo-base p-4 text-left outline outline-1 -outline-offset-1 outline-black/[0.06]">
          <div className="flex gap-3">
            <span className="mt-0.5 text-kumo-danger">
              <WarningIcon size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-pretty text-kumo-default">
                {state.error.message}
              </p>
              {state.error.remedy ? (
                <p className="mt-1 text-sm text-pretty text-kumo-subtle">
                  {state.error.remedy}
                </p>
              ) : null}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            {state.error.link ? (
              <a
                href={state.error.link.href}
                target={
                  state.error.link.href.startsWith("/") ? undefined : "_blank"
                }
                rel="noreferrer noopener"
                className="pressable inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-kumo-subtle hover:bg-(--fill-hover) hover:text-kumo-default"
              >
                {state.error.link.label}
                <ExternalIcon size={14} />
              </a>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => void agent.stub.startOver()}
            >
              Change setup
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="btn-ink rounded-full"
              onClick={() => void agent.stub.tryAgain()}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-12 max-w-[420px] text-xs text-pretty text-kumo-subtle">
          You can close this tab. The install keeps going, and this page shows
          where it got to when you come back.
        </p>
      )}
    </div>
  )
}
