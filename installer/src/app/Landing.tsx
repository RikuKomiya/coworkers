import { RobotHead } from "robot-heads"
import { CloudflareLogo } from "@cloudflare/kumo/components/cloudflare-logo"
import { BrainIcon, LockIcon, ServerIcon } from "./icons"

const ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled. Nothing was changed.",
  sign_in_expired: "That sign-in took too long. Try again.",
  sign_in_failed: "Cloudflare did not finish the sign-in. Try again.",
}

const WHAT = [
  {
    icon: <ServerIcon size={16} />,
    title: "A Worker with Durable Objects",
    body: "Every bot gets its own memory, schedule, computer and browser.",
  },
  {
    icon: <BrainIcon size={16} />,
    title: "An AI Gateway",
    body: "Any model from Workers AI, Anthropic, OpenAI, Google or xAI, with logs and spend limits.",
  },
  {
    icon: <LockIcon size={16} />,
    title: "Cloudflare Access at the door",
    body: "Only the email addresses you list can get in.",
  },
]

/** Signed out: what this is, and the one button. */
export function Landing({ configured }: { configured: boolean }) {
  const params = new URLSearchParams(location.search)
  const error = params.get("error")
  const detail = params.get("detail")
  return (
    <div className="stagger flex w-full max-w-[520px] flex-col items-center text-center">
      <RobotHead
        size={152}
        state="happy"
        color="#f6821f"
        aria-hidden="true"
        className="mb-8"
      />
      <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-balance text-kumo-default sm:text-[32px]">
        Your own AI teammates, on your own Cloudflare
      </h1>
      <p className="mt-3 max-w-[440px] text-[15px] text-pretty text-kumo-subtle">
        Sign in, pick a name and a model, and bdots builds itself into your
        account in about a minute. You own all of it.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 w-full rounded-2xl bg-kumo-danger-tint px-4 py-3 text-sm text-kumo-danger"
        >
          {ERRORS[error] ?? `Sign-in failed: ${error}`}
          {detail ? (
            <span className="mt-1 block text-xs opacity-80">{detail}</span>
          ) : null}
        </p>
      ) : null}

      <a
        href="/api/auth/login"
        aria-disabled={!configured}
        className="pressable mt-8 inline-flex h-12 items-center gap-2.5 rounded-full bg-kumo-contrast px-6 text-[15px] font-medium text-kumo-inverse outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus aria-disabled:pointer-events-none aria-disabled:opacity-40"
      >
        <CloudflareLogo
          variant="glyph"
          aria-hidden="true"
          className="h-4 w-auto"
        />
        Sign in with Cloudflare
      </a>
      {!configured ? (
        <p className="mt-3 text-xs text-kumo-warning">
          This installer has no OAuth client yet. See installer/README.md.
        </p>
      ) : null}

      <ul className="mt-12 w-full overflow-hidden rounded-2xl bg-kumo-base text-left outline outline-1 -outline-offset-1 outline-black/[0.06]">
        {WHAT.map((item) => (
          <li
            key={item.title}
            className="flex gap-3.5 border-t border-kumo-line px-4 py-3.5 first:border-t-0"
          >
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-(--fill-hover) text-kumo-subtle">
              {item.icon}
            </span>
            <span>
              <span className="block text-sm text-kumo-default">
                {item.title}
              </span>
              <span className="mt-0.5 block text-xs text-pretty text-kumo-subtle">
                {item.body}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 px-1.5 text-xs text-pretty text-kumo-subtle">
        Needs the Workers Paid plan. Models from other labs bill through AI
        Gateway credits or your own keys.
      </p>
    </div>
  )
}
