import { ClientOnly, createFileRoute } from "@tanstack/react-router"
import { Loader } from "@cloudflare/kumo/components/loader"
import { PageHeader } from "@/components/page-header"
import { PipelineEditor } from "@/components/pipeline-editor"
import { PipelineRuns } from "@/components/pipeline-runs"
import { useHub } from "@/lib/hub-context"

export const Route = createFileRoute("/_app/pipelines/$pipelineId")({
  component: PipelinePage,
})

function PipelinePage() {
  const { pipelineId } = Route.useParams()
  const { state } = useHub()
  const isNew = pipelineId === "new"
  const pipeline = isNew
    ? null
    : (state.pipelines ?? []).find((p) => p.id === pipelineId)

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        title={isNew ? "New pipeline" : (pipeline?.name ?? "Pipeline")}
        back="/pipelines"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[640px] px-6 pt-4 pb-16">
          {pipeline === undefined ? (
            <p className="pt-16 text-center text-sm text-kumo-subtle">
              This pipeline does not exist any more.
            </p>
          ) : (
            // The schedule picker works in the viewer's time zone, and the
            // editor needs the live hub to save.
            <ClientOnly
              fallback={
                <div className="flex justify-center pt-16">
                  <Loader />
                </div>
              }
            >
              <PipelineEditor key={pipeline?.id ?? "new"} pipeline={pipeline}>
                {pipeline ? <PipelineRuns pipelineId={pipeline.id} /> : null}
              </PipelineEditor>
            </ClientOnly>
          )}
        </div>
      </div>
    </section>
  )
}
