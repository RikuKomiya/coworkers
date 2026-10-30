import { base64url, hmacKey } from "./voice"

/**
 * The two LiveKit server calls a voice call needs: a participant token for
 * the browser and an agent dispatch. Signed with Web Crypto rather than
 * livekit-server-sdk, which would pull protobuf runtimes into the Worker for
 * one JWT and one JSON POST.
 */

export interface LiveKitConfig {
  url: string
  apiKey: string
  apiSecret: string
}

/** The agent voice-agent/ registers; it only joins rooms it is dispatched to. */
export const VOICE_AGENT_NAME = "coworkers-voice"

const TOKEN_TTL_S = 2 * 60 * 60

interface VideoGrant {
  room: string
  roomJoin?: boolean
  roomAdmin?: boolean
  canPublish?: boolean
  canSubscribe?: boolean
  canPublishData?: boolean
}

export async function liveKitToken(
  config: LiveKitConfig,
  claims: { identity?: string; name?: string; video: VideoGrant },
  nowS = Math.floor(Date.now() / 1000)
) {
  const encode = (value: unknown) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)))
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: config.apiKey,
    nbf: nowS,
    exp: nowS + TOKEN_TTL_S,
    ...(claims.identity ? { sub: claims.identity } : {}),
    ...(claims.name ? { name: claims.name } : {}),
    video: claims.video,
  })}`
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(config.apiSecret, "sign"),
    new TextEncoder().encode(unsigned)
  )
  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}

/** LiveKit's server API is served over https from the same host as `wss://`. */
export function liveKitHttpUrl(url: string) {
  return url.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "")
}

/** Asks LiveKit to send the voice agent into the room. */
export async function dispatchVoiceAgent(
  config: LiveKitConfig,
  room: string,
  metadata: Record<string, unknown>
) {
  const token = await liveKitToken(config, {
    video: { room, roomAdmin: true },
  })
  const response = await fetch(
    `${liveKitHttpUrl(config.url)}/twirp/livekit.AgentDispatchService/CreateDispatch`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        room,
        agent_name: VOICE_AGENT_NAME,
        metadata: JSON.stringify(metadata),
      }),
    }
  )
  if (!response.ok) {
    throw new Error(
      `LiveKit refused the agent dispatch (${response.status}): ${(await response.text()).slice(0, 200)}`
    )
  }
}
