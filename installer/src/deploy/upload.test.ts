import { describe, expect, it } from "vitest"
import { vapidKeys } from "./upload"

describe("vapidKeys", () => {
  it("makes a P-256 pair in web-push's base64url format", async () => {
    const { publicKey, privateKey } = await vapidKeys()
    // 65-byte uncompressed point and a 32-byte scalar.
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
    expect(privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
