/**
 * Signed cookies and token encryption, both keyed off SESSION_SECRET.
 *
 * The session cookie only names the installer instance (a random id) and
 * proves this browser was handed it at sign-in. The OAuth token never
 * leaves the Durable Object, and is encrypted at rest there.
 */

const encoder = new TextEncoder()

async function hmacKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  )
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** `value.signature`, for a cookie. */
export async function sign(secret: string, value: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret),
    encoder.encode(value)
  )
  return `${value}.${hex(signature)}`
}

/** The value of a `sign()`ed string, or null when it was tampered with. */
export async function unsign(secret: string, signed: string) {
  const dot = signed.lastIndexOf(".")
  if (dot <= 0) return null
  const value = signed.slice(0, dot)
  const expected = await sign(secret, value)
  // Constant-time compare of equal-length strings.
  if (expected.length !== signed.length) return null
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signed.charCodeAt(i)
  }
  return diff === 0 ? value : null
}

export function readCookie(request: Request, name: string) {
  const header = request.headers.get("Cookie") ?? ""
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}

export function cookie(
  name: string,
  value: string,
  options: { maxAge: number; path?: string }
) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ")
}

// ── Encryption at rest ────────────────────────────────────────────────

async function aesKey(secret: string) {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"]
  )
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("bdots-installer"),
      info: encoder.encode("oauth-tokens"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encrypt(secret: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(secret),
    encoder.encode(plaintext)
  )
  const out = new Uint8Array(iv.length + sealed.byteLength)
  out.set(iv)
  out.set(new Uint8Array(sealed), iv.length)
  return btoa(String.fromCharCode(...out))
}

export async function decrypt(secret: string, sealed: string) {
  const bytes = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0))
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) },
    await aesKey(secret),
    bytes.slice(12)
  )
  return new TextDecoder().decode(plain)
}
