import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { getAgentByName } from "agents"
import { env } from "cloudflare:workers"
import { DEMO_USER_ID, identify } from "@/lib/auth"
import { SIDEBAR_COOKIE, parseWidths } from "@/lib/layout-context"
import type { PanelWidths } from "@/lib/layout-context"
import { botInstanceName } from "@/lib/types"
import type { BotState, HubState } from "@/lib/types"
import type { BotAgent } from "@/agents/bot-agent"
import { dispatchVoiceAgent, liveKitToken } from "@/agents/livekit"
import type { LiveKitConfig } from "@/agents/livekit"
import type { UserHub } from "@/agents/user-hub"
import { VOICE_LINK_TTL_S, signVoiceLink } from "@/agents/voice"

export interface Viewer {
  id: string
  label: string
  avatarUrl?: string
}

// TODO: temporary, hardcoded for screenshots. Replace with the signed-in
// user's profile once there is real auth.
const DEMO_VIEWER = {
  label: "Fayaz Ahmed",
  avatarUrl: "https://github.com/fayazara.png",
}

async function viewerFromRequest(request: Request): Promise<Viewer> {
  const { id, email } = await identify(request)
  if (id === DEMO_USER_ID) return { id, ...DEMO_VIEWER }
  return { id, label: email ?? id }
}

/**
 * Sidebar state for the first paint. After hydration the browser takes over
 * with a WebSocket to the same UserHub.
 */
export const getHubSnapshot = createServerFn().handler(
  async (): Promise<{
    viewer: Viewer
    hub: HubState
    sidebarOpen: boolean
    widths: PanelWidths
  }> => {
    const request = getRequest()
    const viewer = await viewerFromRequest(request)
    const cookie = request.headers.get("Cookie") ?? ""
    const sidebarOpen = !cookie.includes(`${SIDEBAR_COOKIE}=closed`)
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      viewer.id
    )
    return {
      viewer,
      hub: await hub.snapshot(),
      sidebarOpen,
      widths: parseWidths(cookie),
    }
  }
)

export interface BotSnapshot {
  state: BotState
  /** `UIMessage[]` as JSON: message parts hold `unknown` tool payloads. */
  messagesJson: string
  /** LiveKit is configured, so the bot can take voice calls. */
  voiceEnabled: boolean
}

/** LiveKit settings and the link secret, or null when voice calls are off. */
function voiceConfig(): (LiveKitConfig & { linkSecret: string }) | null {
  const url = env.LIVEKIT_URL?.trim()
  const apiKey = env.LIVEKIT_API_KEY?.trim()
  const apiSecret = env.LIVEKIT_API_SECRET?.trim()
  const linkSecret = env.VOICE_LINK_SECRET?.trim()
  if (!url || !apiKey || !apiSecret || !linkSecret) return null
  return { url, apiKey, apiSecret, linkSecret }
}

/** The bot's Durable Object, or null for a bot this user does not have. */
async function ownBot(userId: string, botId: string) {
  const hub = await getAgentByName(
    env.UserHub as unknown as DurableObjectNamespace<UserHub>,
    userId
  )
  const { bots } = await hub.snapshot()
  // Looking up an unknown name would create an empty Durable Object.
  if (!bots.some((b) => b.id === botId)) return null
  return getAgentByName(
    env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
    botInstanceName(userId, botId)
  )
}

/** A bot's state and chat history for the first paint. */
export const getBotSnapshot = createServerFn()
  .validator((botId: string) => botId)
  .handler(async ({ data: botId }): Promise<BotSnapshot | null> => {
    const viewer = await viewerFromRequest(getRequest())
    const bot = await ownBot(viewer.id, botId)
    if (!bot) return null
    const { state, messages } = await bot.snapshot()
    return {
      state,
      messagesJson: JSON.stringify(messages),
      voiceEnabled: voiceConfig() !== null,
    }
  })

export interface VoiceCall {
  /** LiveKit project URL the browser joins. */
  serverUrl: string
  participantToken: string
  callId: string
}

/**
 * Start a voice call with a bot: a LiveKit room for the browser, and the
 * voice agent dispatched into it with a link token that opens this bot's
 * `/voice` socket for this call only.
 */
export const startVoiceCall = createServerFn({ method: "POST" })
  .validator((botId: string) => botId)
  .handler(async ({ data: botId }): Promise<VoiceCall> => {
    const config = voiceConfig()
    if (!config) {
      throw new Error(
        "Voice calls are off: set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and VOICE_LINK_SECRET."
      )
    }
    const request = getRequest()
    const viewer = await viewerFromRequest(request)
    const bot = await ownBot(viewer.id, botId)
    if (!bot) throw new Error("No such bot.")
    const callId = crypto.randomUUID()
    const room = `cw-${callId}`
    const linkToken = await signVoiceLink(
      {
        userId: viewer.id,
        botId,
        callId,
        exp: Math.floor(Date.now() / 1000) + VOICE_LINK_TTL_S,
      },
      config.linkSecret
    )
    const origin = new URL(request.url)
    const linkUrl = `${origin.protocol === "https:" ? "wss:" : "ws:"}//${origin.host}/voice/${encodeURIComponent(viewer.id)}/${encodeURIComponent(botId)}`
    await bot.beginVoiceCall(callId)
    await dispatchVoiceAgent(config, room, { linkUrl, linkToken, callId })
    return {
      serverUrl: config.url,
      participantToken: await liveKitToken(config, {
        identity: viewer.id,
        name: viewer.label,
        video: {
          room,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        },
      }),
      callId,
    }
  })
