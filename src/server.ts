import handler from "@tanstack/react-start/server-entry"
import { getAgentByName, routeAgentEmail, routeAgentRequest } from "agents"
import { Unauthorized, identify } from "@/lib/auth"
import { botInstanceName } from "@/lib/types"
import { handleAppRequest } from "./agents/apps-runtime"
import type { BotAgent } from "./agents/bot-agent"
import type { UserHub } from "./agents/user-hub"
import {
  VOICE_CALL_HEADER,
  linkMatches,
  verifyVoiceLink,
  voicePath,
} from "./agents/voice"

// Durable Objects and the classes their runtimes load by name.
export { BotAgent, WorkspaceServiceProxy } from "./agents/bot-agent"
export { UserHub } from "./agents/user-hub"
// Apps bots build: live fan-out, and `env.BOT` inside an app's server.js.
export { AppBinding, AppLive } from "./agents/apps-runtime"
// Backs `browser_execute`: a durable Code Mode runtime in a DO facet.
export { CodemodeRuntime } from "agents/browser"

/** `/agents/<agent>/<instance>/...` → the instance name, URL-decoded. */
function agentInstance(pathname: string) {
  const [, prefix, agent, instance] = pathname.split("/")
  if (prefix !== "agents" || !agent || !instance) return null
  return { agent, instance: decodeURIComponent(instance) }
}

/**
 * `/voice/<userId>/<botId>`: the LiveKit agent's socket to one bot. It has
 * no cookie; the link token minted by `startVoiceCall` is its credential,
 * and the call it names is passed on in a header only this code sets.
 */
async function handleVoiceRequest(request: Request, env: Env) {
  const path = voicePath(new URL(request.url).pathname)
  if (!path) return null
  const secret = env.VOICE_LINK_SECRET?.trim()
  const token =
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ??
    new URL(request.url).searchParams.get("token")
  const link = secret && token ? await verifyVoiceLink(token, secret) : null
  if (!link || !linkMatches(link, path)) {
    return new Response("Unauthorized", { status: 401 })
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket", { status: 426 })
  }
  const bot = await getAgentByName(
    env.BotAgent as unknown as DurableObjectNamespace<BotAgent>,
    botInstanceName(link.userId, link.botId)
  )
  const headers = new Headers(request.headers)
  headers.set(VOICE_CALL_HEADER, link.callId)
  return bot.fetch(new Request(request, { headers }))
}

/** A user may only reach their own hub and their own bots. */
function ownsInstance(userId: string, agent: string, instance: string) {
  if (agent === "user-hub") return instance === userId
  if (agent === "bot-agent") return instance.startsWith(`${userId}:`)
  return false
}

export default {
  async fetch(request, env) {
    // Apps authenticate by the link token in their URL, not the user.
    const app = await handleAppRequest(request, env)
    if (app) return app
    const voice = await handleVoiceRequest(request, env)
    if (voice) return voice

    const target = agentInstance(new URL(request.url).pathname)
    if (target) {
      let userId: string
      try {
        userId = (await identify(request)).id
      } catch (err) {
        if (err instanceof Unauthorized) {
          return new Response("Unauthorized", { status: 401 })
        }
        throw err
      }
      if (!ownsInstance(userId, target.agent, target.instance)) {
        return new Response("Forbidden", { status: 403 })
      }
      // Only a verified /voice/* upgrade may mark a socket as a call.
      const headers = new Headers(request.headers)
      headers.delete(VOICE_CALL_HEADER)
      // Agent WebSockets and agent HTTP (MCP OAuth callbacks).
      const response = await routeAgentRequest(
        new Request(request, { headers }),
        env
      )
      if (response) return response
    }
    return handler.fetch(request)
  },

  /**
   * Email Routing delivers mail for EMAIL_DOMAIN here. A bot's address is
   * `<userId>.<botId>@EMAIL_DOMAIN`; anything else is rejected, and so is
   * mail for a bot that does not exist (looking it up would create it).
   */
  async email(message, env) {
    const domain = env.EMAIL_DOMAIN?.trim().toLowerCase()
    const [local, host] = message.to.toLowerCase().split("@")
    const dot = local?.lastIndexOf(".") ?? -1
    if (!domain || host !== domain || dot <= 0) {
      message.setReject("Unknown address")
      return
    }
    const userId = local.slice(0, dot)
    const botId = local.slice(dot + 1)
    const hub = await getAgentByName(
      env.UserHub as unknown as DurableObjectNamespace<UserHub>,
      userId
    )
    if (!(await hub.hasBot(botId))) {
      message.setReject("Unknown address")
      return
    }
    await routeAgentEmail(message, env, {
      resolver: async () => ({
        agentName: "BotAgent",
        agentId: botInstanceName(userId, botId),
      }),
    })
  },
} satisfies ExportedHandler<Env>
