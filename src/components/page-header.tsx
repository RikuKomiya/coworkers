import { Link } from "@tanstack/react-router"
import { Tooltip } from "@cloudflare/kumo/components/tooltip"
import { ArrowLeftIcon, SidebarSimpleIcon } from "@/components/icons"
import { useLayout } from "@/lib/layout-context"

/** Header for a full-page view: the sidebar toggle, an optional back link, a centred title. */
export function PageHeader({
  title,
  back,
}: {
  title: string
  /** Path the back arrow opens, e.g. "/pipelines". */
  back?: "/pipelines"
}) {
  const { sidebarOpen, toggleSidebar } = useLayout()
  return (
    <header className="col-header relative">
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
      {back ? (
        <Tooltip
          content="Back"
          render={
            <Link to={back} aria-label="Back" className="icon-btn">
              <ArrowLeftIcon size={20} />
            </Link>
          }
        />
      ) : null}
      <h1 className="absolute left-1/2 max-w-[50%] -translate-x-1/2 truncate text-[15px] font-medium text-kumo-default">
        {title}
      </h1>
    </header>
  )
}
