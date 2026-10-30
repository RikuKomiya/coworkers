import { describe, expect, it } from "vitest"
import { liveKitHttpUrl, liveKitToken } from "./livekit"
import { hmacKey } from "./voice"

const config = {
  url: "wss://x.livekit.cloud",
  apiKey: "APIkey",
  apiSecret: "s3cret",
}

function decode(part: string) {
  return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")))
}

describe("liveKitToken", () => {
  it("signs an HS256 JWT LiveKit can check with the API secret", async () => {
    const token = await liveKitToken(
      config,
      { identity: "user", video: { room: "cw-1", roomJoin: true } },
      1000
    )
    const [header, payload, signature] = token.split(".")
    expect(decode(header)).toEqual({ alg: "HS256", typ: "JWT" })
    expect(decode(payload)).toEqual({
      iss: "APIkey",
      sub: "user",
      nbf: 1000,
      exp: 1000 + 7200,
      video: { room: "cw-1", roomJoin: true },
    })
    const sig = Uint8Array.from(
      atob(signature.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0)
    )
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey("s3cret", "verify"),
      sig,
      new TextEncoder().encode(`${header}.${payload}`)
    )
    expect(ok).toBe(true)
  })

  it("calls the server API over https on the project host", () => {
    expect(liveKitHttpUrl("wss://x.livekit.cloud/")).toBe(
      "https://x.livekit.cloud"
    )
    expect(liveKitHttpUrl("ws://localhost:7880")).toBe("http://localhost:7880")
  })
})
