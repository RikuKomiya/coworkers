import { useMemo } from "react"
import { RobotHead } from "robot-heads"
import { BOT_AVATAR_LOOKS } from "@coworkers/types"
import { modelName, providerOf } from "@coworkers/models"
import type { InstallerState } from "../shared"
import type { InstallerAgent } from "./App"
import { ArrowRightIcon } from "./icons"

const COLORS = Object.values(BOT_AVATAR_LOOKS).map((l) => l.color)

/** A burst of robot-coloured confetti, once. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const angle = (i / 28) * Math.PI * 2
        const distance = 140 + Math.random() * 120
        return {
          color: COLORS[i % COLORS.length],
          x: `${Math.cos(angle) * distance}px`,
          y: `${Math.sin(angle) * distance - 60}px`,
          r: `${Math.random() * 540 - 270}deg`,
          delay: `${Math.random() * 120}ms`,
        }
      }),
    []
  )
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti"
          style={
            {
              background: p.color,
              "--x": p.x,
              "--y": p.y,
              "--r": p.r,
              animationDelay: p.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

/** It is live: where it is and what happens when you open it. */
export function Done({
  agent,
  state,
}: {
  agent: InstallerAgent
  state: InstallerState
}) {
  const plan = state.plan
  const thirdParty = plan && providerOf(plan.model) !== "workers-ai"
  const next = [
    `Open it and sign in as ${plan?.emails[0] ?? "you"}. Access emails you a one-time code.`,
    `Bots think with ${plan ? modelName(plan.model) : "your model"}. Change it any time on the Models page.`,
    thirdParty
      ? "Add Unified Billing credits or a provider key in AI Gateway. Until then bots fall back to Workers AI."
      : "Want Claude, GPT or Gemini? Pick one on the Models page and add AI Gateway credits.",
  ]

  return (
    <div className="relative flex w-full max-w-[560px] flex-col items-center text-center">
      <Confetti />
      <div className="stagger flex w-full flex-col items-center">
        <RobotHead
          size={136}
          state="happy"
          color="#2f8f5b"
          aria-hidden="true"
          className="mb-6"
        />
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-kumo-default">
          {state.updating ? "Your bots are updated" : "Your bots are alive"}
        </h1>
        <p className="mt-2 font-mono text-sm break-all text-kumo-subtle">
          {state.url?.replace("https://", "")}
        </p>
        {state.url ? (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer noopener"
            className="pressable mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-kumo-contrast px-6 text-[15px] font-medium text-kumo-inverse outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"
          >
            Meet your bots
            <ArrowRightIcon size={16} />
          </a>
        ) : null}
        <ul className="mt-10 w-full overflow-hidden rounded-2xl bg-kumo-base text-left outline outline-1 -outline-offset-1 outline-black/[0.06]">
          {next.map((line, i) => (
            <li
              key={line}
              className="flex gap-3 border-t border-kumo-line px-4 py-3.5 text-sm text-pretty text-kumo-default first:border-t-0"
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-[11px] font-medium text-kumo-subtle tabular-nums">
                {i + 1}
              </span>
              {line}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void agent.stub.startOver()}
          className="mt-6 text-xs text-kumo-subtle underline decoration-kumo-line underline-offset-2 hover:text-kumo-default"
        >
          Install another
        </button>
      </div>
    </div>
  )
}
