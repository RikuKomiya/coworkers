/**
 * Types shared by the Installer Durable Object and the browser. Installer
 * state is broadcast to the page, so nothing secret goes in here.
 */

export interface Account {
  id: string
  name: string
}

export interface Zone {
  id: string
  name: string
}

/** What the user chose on the setup screen. */
export interface InstallPlan {
  accountId: string
  /** Worker name, also the workers.dev subdomain label. */
  name: string
  /** Hostname on one of the account's zones; null serves on workers.dev. */
  domain: { zoneId: string; zoneName: string; hostname: string } | null
  /** Who may sign in through Cloudflare Access. */
  emails: string[]
  /** Deployment default chat model (bdots' MODEL). */
  model: string
  /** AI Gateway every model call goes through. */
  gateway: string
}

export type StepId =
  "account" | "gateway" | "access" | "upload" | "publish" | "wake"

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped"

export interface Step {
  id: StepId
  status: StepStatus
  /** Live detail: "Uploading 34 of 50 files", "Already there". */
  detail?: string
}

/** Each step as a part of the robot being built, for the progress screen. */
export const STEP_COPY: Record<StepId, { title: string; whimsy: string }> = {
  account: {
    title: "Checking your account",
    whimsy: "Measuring the workshop",
  },
  gateway: {
    title: "Creating the AI Gateway",
    whimsy: "Wiring up the brain",
  },
  access: {
    title: "Locking the front door",
    whimsy: "Hiring a bouncer",
  },
  upload: {
    title: "Uploading bdots",
    whimsy: "Bolting on the parts",
  },
  publish: {
    title: "Publishing the URL",
    whimsy: "Painting the sign",
  },
  wake: {
    title: "Waking it up",
    whimsy: "Flipping the switch",
  },
}

export const STEP_ORDER: StepId[] = [
  "account",
  "gateway",
  "access",
  "upload",
  "publish",
  "wake",
]

export interface InstallError {
  step: StepId
  message: string
  /** What the user can do about it. */
  remedy?: string
  link?: { label: string; href: string }
}

export interface InstallerState {
  phase: "setup" | "installing" | "done" | "failed"
  user: { email: string } | null
  accounts: Account[]
  plan: InstallPlan | null
  steps: Step[]
  error: InstallError | null
  /** The live URL once published. */
  url: string | null
  /** bdots version this installer carries. */
  release: string | null
  /** Set when the chosen Worker was installed here before: an update, not a fresh install. */
  updating: boolean
}

export const INITIAL_STATE: InstallerState = {
  phase: "setup",
  user: null,
  accounts: [],
  plan: null,
  steps: STEP_ORDER.map((id) => ({ id, status: "pending" })),
  error: null,
  url: null,
  release: null,
  updating: false,
}

/** Lowercase letters, digits and dashes, 1–54 characters, as Workers allow. */
export function isWorkerName(name: string) {
  return /^[a-z0-9](?:[a-z0-9-]{0,52}[a-z0-9])?$/.test(name)
}

/** Answer to "can I use this name?", for the setup screen. */
export type NameCheck =
  { ok: true; url: string; updating: boolean } | { ok: false; reason: string }

/** DEMO=1 fakes sign-in and every Cloudflare API call. */
export function isDemo(env: { DEMO: string }) {
  return (env.DEMO as string) === "1"
}
