import { Link, createFileRoute } from "@tanstack/react-router"
import { PipelineIcon, PlusIcon } from "@/components/icons"
import { PageHeader } from "@/components/page-header"
import { useHub } from "@/lib/hub-context"

export const Route = createFileRoute("/_app/pipelines/")({
  component: Pipelines,
})

const NEW_LINK =
  "pressable inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium btn-ink outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus"

/** The list lives in the sidebar; this is what the main pane shows beside it. */
function Pipelines() {
  const { state } = useHub()
  const empty = (state.pipelines ?? []).length === 0

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader title="Pipelines" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 pb-(--header-h) text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-(--fill-hover) text-kumo-subtle">
          <PipelineIcon size={24} />
        </span>
        <div className="max-w-sm space-y-1.5">
          <h2 className="text-lg font-semibold text-balance text-kumo-default">
            {empty ? "Chain your bots together" : "Pick a pipeline"}
          </h2>
          <p className="text-sm text-pretty text-kumo-subtle">
            {empty
              ? "A pipeline passes work from one bot to the next: a researcher finds things, a writer drafts them, and you approve before anything goes out. Run it by hand or on a schedule."
              : "Open one from the sidebar to edit it or see its runs, or start a new one."}
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
    </section>
  )
}
