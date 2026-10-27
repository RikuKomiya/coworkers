import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { SidebarSimpleIcon } from "@/components/icons"
import { useLayout } from "@/lib/layout-context"

/** Header for a full-page view: the sidebar toggle, a centred title, and optional actions on the right. */
export function PageHeader({
  title,
  actions,
}: {
  title: string
  /** Icon buttons at the right end, e.g. a panel toggle. */
  actions?: React.ReactNode
}) {
  const { sidebarOpen, toggleSidebar } = useLayout()
  return (
    <header className="col-header relative justify-between">
      <Tooltip
        content={sidebarOpen ? "Hide bots" : "Show bots"}
        render={
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? "Hide bots" : "Show bots"}
            aria-pressed={!sidebarOpen}
            className="icon-btn"
          >
            <SidebarSimpleIcon size={20} />
          </button>
        }
      />
      <h1 className="absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-[15px] font-medium text-kumo-default">
        {title}
      </h1>
      {actions ? (
        <div className="flex items-center gap-1">{actions}</div>
      ) : null}
    </header>
  )
}
