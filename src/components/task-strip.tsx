import { useEffect, useState } from "react"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { StopIcon } from "@/components/icons"
import type { BackgroundTask } from "@/lib/types"

function elapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Background tasks still running, above the composer. */
export function TaskStrip({
  tasks,
  onStop,
}: {
  tasks: BackgroundTask[]
  onStop: (taskId: string) => Promise<void>
}) {
  const [now, setNow] = useState(() => Date.now())
  const [stopping, setStopping] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (tasks.length === 0) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [tasks.length])

  if (tasks.length === 0) return null

  async function stop(id: string) {
    setStopping((prev) => new Set(prev).add(id))
    try {
      await onStop(id)
    } finally {
      setStopping((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <ul
      aria-label="Background tasks"
      className="mx-auto flex w-full max-w-[820px] flex-col gap-1 px-6 pb-2"
    >
      {tasks.map((task) => (
        <li
          key={task.id}
          className="msg-enter flex min-w-0 items-center gap-2.5 rounded-2xl bg-kumo-tint py-1.5 pr-1.5 pl-3 text-sm"
        >
          <Loader size="sm" />
          <span className="max-w-[55%] shrink-0 truncate font-medium text-kumo-default">
            {task.title}
          </span>
          <span className="min-w-0 flex-1 truncate text-kumo-subtle">
            {task.step ?? "Starting"}
          </span>
          <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
            {elapsed(now - task.startedAt)}
          </span>
          <Tooltip
            content="Stop"
            render={
              <button
                type="button"
                aria-label={`Stop ${task.title}`}
                disabled={stopping.has(task.id)}
                onClick={() => void stop(task.id)}
                className="icon-btn size-7"
              >
                <StopIcon size={14} />
              </button>
            }
          />
        </li>
      ))}
    </ul>
  )
}
