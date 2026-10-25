/**
 * "Sign in with Cloudflare": OAuth 2.0 authorization code + PKCE against
 * the Cloudflare dashboard, with a self-serve OAuth client.
 */

const AUTHORIZE_URL = "https://dash.cloudflare.com/oauth2/auth"
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token"

/**
 * What the installer does in the user's account. Dashboard OAuth clients
 * use these dotted ids (not Wrangler's `workers_scripts:write` spelling),
 * and the client must be granted every one, or the dashboard refuses the
 * whole sign-in. `cf oauth-scopes list` maps ids to the names the dashboard
 * shows.
 *
 * There is no `offline_access` scope on dashboard clients. A refresh token
 * comes back when the client has the Refresh Token grant enabled; without
 * one, an install still finishes well within the access token's lifetime.
 */
export const SCOPES = [
  // Who signed in (their email becomes the first allowed user).
  "user-details.read",
  // Which accounts they can install into.
  "account-settings.read",
  // Create and upload the Worker, its assets and the workers.dev route.
  // Admin, because Editor cannot create a Worker that does not exist yet.
  "workers-scripts.admin",
  // Attach a custom domain on one of their zones.
  "workers-routes.write",
  // Pick a zone for a custom domain.
  "zone.read",
  // Access applications and policies in front of Coworkers.
  "access.write",
  // The Zero Trust organization and the one-time PIN login.
  "access-acct.write",
  // The AI Gateway every model call goes through.
  "aig.write",
]

export interface Tokens {
  accessToken: string
  refreshToken: string | null
  /** Unix ms. */
  expiresAt: number
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export function randomToken(bytes = 32) {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  )
  return base64Url(new Uint8Array(digest))
}

export function authorizeUrl(options: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}) {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", options.clientId)
  url.searchParams.set("redirect_uri", options.redirectUri)
  url.searchParams.set("scope", SCOPES.join(" "))
  url.searchParams.set("state", options.state)
  url.searchParams.set("code_challenge", options.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function tokenRequest(
  client: { id: string; secret: string },
  body: Record<string, string>
): Promise<Tokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${client.id}:${client.secret}`)}`,
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  })
  let data: TokenResponse = {}
  try {
    data = await response.json<TokenResponse>()
  } catch {
    // Not JSON: an outage page or a proxy in the way.
  }
  if (!response.ok || !data.access_token) {
    throw new OAuthError(
      data.error_description ??
        data.error ??
        `Cloudflare answered ${response.status}`,
      data.error === "invalid_grant"
    )
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
}

export class OAuthError extends Error {
  /** The grant itself is gone: sign in again. */
  readonly signInAgain: boolean
  constructor(message: string, signInAgain: boolean) {
    super(message)
    this.signInAgain = signInAgain
  }
}

export function exchangeCode(
  client: { id: string; secret: string },
  options: { code: string; verifier: string; redirectUri: string }
) {
  return tokenRequest(client, {
    grant_type: "authorization_code",
    code: options.code,
    code_verifier: options.verifier,
    redirect_uri: options.redirectUri,
  })
}

export function refresh(
  client: { id: string; secret: string },
  refreshToken: string
) {
  return tokenRequest(client, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
}
