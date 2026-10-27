import { Link, createFileRoute } from "@tanstack/react-router"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Loader } from "@cloudflare/kumo/components/loader"
import { BotAvatar } from "@/components/bot-avatar"
import { CaretRightIcon, PipelineIcon, PlusIcon } from "@/components/icons"
import { PageHeader } from "@/components/page-header"
import { useHub } from "@/lib/hub-context"
import type { Pipeline, PipelineRun } from "@/lib/types"

export const Route = createFileRoute("/_app/pipelines/")({
  component: Pipelines,
})

const NEW_LINK =
  "pressable inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium btn-ink outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"

function LastRun({ run }: { run?: PipelineRun }) {
  if (!run) return null
  switch (run.status) {
    case "running":
      return (
        <Badge variant="neutral" icon={<Loader size="sm" />}>
          Running
        </Badge>
      )
    case "waiting":
      return <Badge variant="orange">Needs your OK</Badge>
    case "failed":
      return <Badge variant="red">Failed</Badge>
    default:
      return null
  }
}

function PipelineRow({
  pipeline,
  run,
}: {
  pipeline: Pipeline
  run?: PipelineRun
}) {
  const { state } = useHub()
  const bots = pipeline.steps.flatMap((s) =>
    s.kind === "bot" ? (state.bots.find((b) => b.id === s.botId) ?? []) : []
  )
  const chain = pipeline.steps
    .map((s) =>
      s.kind === "approval"
        ? "You"
        : (state.bots.find((b) => b.id === s.botId)?.name ?? "Deleted bot")
    )
    .join(" → ")
  return (
    <li className="border-t border-kumo-line first:border-t-0">
      <Link
        to="/pipelines/$pipelineId"
        params={{ pipelineId: pipeline.id }}
        className="flex min-h-16 items-center gap-4 py-3 pr-3 pl-4 outline-none hover:bg-(--fill-hover) focus-visible:bg-(--fill-hover)"
      >
        <span className="flex shrink-0 -space-x-2">
          {bots.slice(0, 3).map((b, i) => (
            <span
              key={`${b.id}-${i}`}
              className="rounded-full ring-2 ring-kumo-base"
            >
              <BotAvatar avatar={b.avatar} size={28} />
            </span>
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-kumo-default">
            {pipeline.name}
          </span>
          <span className="mt-0.5 block truncate text-xs text-kumo-subtle">
            {chain}
            {pipeline.cron ? " · scheduled" : ""}
          </span>
        </span>
        <LastRun run={run} />
        <CaretRightIcon size={16} className="shrink-0 text-kumo-subtle" />
      </Link>
    </li>
  )
}

function Pipelines() {
  const { state } = useHub()
  const pipelines = state.pipelines ?? []
  const runs = state.pipelineRuns ?? []

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader title="Pipelines" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] space-y-6 px-6 pt-4 pb-16">
          {pipelines.length === 0 ? (
            <div className="flex flex-col items-center gap-4 pt-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-(--fill-hover) text-kumo-subtle">
                <PipelineIcon size={24} />
              </span>
              <div className="max-w-sm space-y-1.5">
                <h2 className="text-lg font-semibold text-balance text-kumo-default">
                  Chain your bots together
                </h2>
                <p className="text-sm text-pretty text-kumo-subtle">
                  A pipeline passes work from one bot to the next: a researcher
                  finds things, a writer drafts them, and you approve before
                  anything goes out. Run it by hand or on a schedule.
                </p>
              </div>
              <Link
                to="/pipelines/$pipelineId"
                params={{ pipelineId: "new" }}
                className={NEW_LINK}
              >
                <PlusIcon size={16} />
                New pipeline
              </Link>
            </div>
          ) : (
            <>
              <div className="flex justify-end">
                <Link
                  to="/pipelines/$pipelineId"
                  params={{ pipelineId: "new" }}
                  className={NEW_LINK}
                >
                  <PlusIcon size={16} />
                  New pipeline
                </Link>
              </div>
              <ul className="overflow-hidden rounded-2xl bg-kumo-base outline outline-1 -outline-offset-1 outline-black/[0.06]">
                {pipelines.map((p) => (
                  <PipelineRow
                    key={p.id}
                    pipeline={p}
                    run={runs.find((r) => r.pipelineId === p.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
