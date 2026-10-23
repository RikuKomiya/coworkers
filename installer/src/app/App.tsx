import { useEffect, useState } from "react"
import { useAgent } from "agents/react"
import type { Installer } from "../installer"
import type { InstallerState } from "../shared"
import { Done } from "./Done"
import { Landing } from "./Landing"
import { Progress } from "./Progress"
import { Setup } from "./Setup"

export type InstallerAgent = ReturnType<
  typeof useAgent<Installer, InstallerState>
>

interface Session {
  id: string | null
  configured: boolean
}

export function App() {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json<Session>())
      .then(setSession)
      .catch(() => setSession({ id: null, configured: false }))
  }, [])

  return (
    <div className="flex min-h-full flex-col">
      <main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
        {session === null ? null : session.id ? (
          <Signed id={session.id} />
        ) : (
          <Landing configured={session.configured} />
        )}
      </main>
      <footer className="pb-6 text-center text-xs text-kumo-subtle">
        bdots is open source.{" "}
        <a
          href="https://github.com/fayazara/bdots"
          className="underline decoration-kumo-line underline-offset-2 hover:decoration-current"
        >
          Read the code
        </a>{" "}
        before you install it.
      </footer>
    </div>
  )
}

function Signed({ id }: { id: string }) {
  const agent = useAgent<Installer, InstallerState>({
    agent: "installer",
    name: id,
  })
  const state = agent.state
  if (!state) return null
  switch (state.phase) {
    case "setup":
      return <Setup key="setup" agent={agent} state={state} />
    case "installing":
    case "failed":
      return <Progress key="progress" agent={agent} state={state} />
    case "done":
      return <Done key="done" agent={agent} state={state} />
  }
}
