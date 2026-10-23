import { describe, expect, it } from "vitest"
import { decrypt, encrypt, sign, unsign } from "./session"

const SECRET = "test-secret-test-secret-test-secret"

describe("signed values", () => {
  it("round-trips", async () => {
    expect(await unsign(SECRET, await sign(SECRET, "abc"))).toBe("abc")
  })

  it("rejects a changed value or another key", async () => {
    const signed = await sign(SECRET, "abc")
    expect(await unsign(SECRET, signed.replace("abc", "abd"))).toBeNull()
    expect(await unsign("another-secret", signed)).toBeNull()
    expect(await unsign(SECRET, "no-signature")).toBeNull()
  })
})

describe("encryption at rest", () => {
  it("round-trips and never repeats a ciphertext", async () => {
    const a = await encrypt(SECRET, "token")
    const b = await encrypt(SECRET, "token")
    expect(a).not.toBe(b)
    expect(await decrypt(SECRET, a)).toBe("token")
  })

  it("fails with the wrong key", async () => {
    await expect(
      decrypt("wrong", await encrypt(SECRET, "token"))
    ).rejects.toThrow()
  })
})
