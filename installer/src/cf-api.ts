/**
 * The handful of Cloudflare API calls the installer makes, with the
 * user's OAuth token. Every response is the standard v4 envelope.
 */

const API = "https://api.cloudflare.com/client/v4"

interface Envelope<T> {
  success: boolean
  result: T
  errors?: { code: number; message: string }[]
  result_info?: { page: number; total_pages: number }
}

export class CfApiError extends Error {
  readonly status: number
  readonly codes: number[]
  readonly path: string
  constructor(
    status: number,
    path: string,
    errors: Envelope<unknown>["errors"]
  ) {
    const message =
      errors?.map((e) => e.message).join("; ") ||
      `Cloudflare answered ${status}`
    super(message)
    this.status = status
    this.codes = errors?.map((e) => e.code) ?? []
    this.path = path
  }

  /** The token, or the user's role, may not do this. */
  get forbidden() {
    return (
      this.status === 403 || (this.status === 401 && this.codes.includes(10000))
    )
  }
}

export interface Script {
  id: string
  tags?: string[] | null
  migration_tag?: string
}

export interface AccessApp {
  id: string
  aud: string
  name: string
  domain?: string
}

export interface AccessPolicy {
  id: string
  name: string
}

export class CfApi {
  constructor(private readonly token: () => Promise<string>) {}

  async request<T>(
    method: string,
    path: string,
    options: {
      json?: unknown
      body?: BodyInit
      query?: Record<string, string>
      /** Replaces the OAuth token, e.g. with an assets upload JWT. */
      bearer?: string
    } = {}
  ): Promise<T> {
    const url = new URL(`${API}${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value)
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.bearer ?? (await this.token())}`,
    }
    if (options.json !== undefined) headers["Content-Type"] = "application/json"
    const response = await fetch(url, {
      method,
      headers,
      body:
        options.json !== undefined
          ? JSON.stringify(options.json)
          : options.body,
      signal: AbortSignal.timeout(60_000),
    })
    let data: Envelope<T> | null = null
    try {
      data = await response.json<Envelope<T>>()
    } catch {
      // Not JSON.
    }
    if (!response.ok || !data?.success) {
      throw new CfApiError(response.status, path, data?.errors)
    }
    return data.result
  }

  /** Every page of a paginated list. */
  async all<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = []
    for (let page = 1; page <= 20; page++) {
      const url = new URL(`${API}${path}`)
      for (const [key, value] of Object.entries({
        ...query,
        page: String(page),
        per_page: "50",
      })) {
        url.searchParams.set(key, value)
      }
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${await this.token()}` },
        signal: AbortSignal.timeout(30_000),
      })
      const data = await response.json<Envelope<T[]>>()
      if (!response.ok || !data.success) {
        throw new CfApiError(response.status, path, data.errors)
      }
      out.push(...data.result)
      const info = data.result_info
      if (!info || info.page >= info.total_pages) break
    }
    return out
  }

  /** Like request, but a 404 is null. */
  async maybe<T>(method: string, path: string): Promise<T | null> {
    try {
      return await this.request<T>(method, path)
    } catch (err) {
      if (err instanceof CfApiError && err.status === 404) return null
      throw err
    }
  }

  // ── Identity ──────────────────────────────────────────────────────

  user() {
    return this.request<{ email: string }>("GET", "/user")
  }

  accounts() {
    return this.all<{ id: string; name: string }>("/accounts")
  }

  zones(accountId: string) {
    return this.all<{ id: string; name: string; status: string }>("/zones", {
      "account.id": accountId,
      status: "active",
    })
  }

  // ── Workers ───────────────────────────────────────────────────────

  async workersSubdomain(accountId: string) {
    const result = await this.maybe<{ subdomain: string }>(
      "GET",
      `/accounts/${accountId}/workers/subdomain`
    )
    return result?.subdomain || null
  }

  setWorkersSubdomain(accountId: string, subdomain: string) {
    return this.request<{ subdomain: string }>(
      "PUT",
      `/accounts/${accountId}/workers/subdomain`,
      { json: { subdomain } }
    )
  }

  async script(accountId: string, name: string) {
    const scripts = await this.request<Script[]>(
      "GET",
      `/accounts/${accountId}/workers/scripts`
    )
    return scripts.find((s) => s.id === name) ?? null
  }

  assetsUploadSession(
    accountId: string,
    name: string,
    manifest: Record<string, { hash: string; size: number }>
  ) {
    return this.request<{ jwt: string; buckets?: string[][] }>(
      "POST",
      `/accounts/${accountId}/workers/scripts/${name}/assets-upload-session`,
      { json: { manifest } }
    )
  }

  uploadAssets(accountId: string, uploadJwt: string, form: FormData) {
    return this.request<{ jwt?: string }>(
      "POST",
      `/accounts/${accountId}/workers/assets/upload`,
      { body: form, bearer: uploadJwt, query: { base64: "true" } }
    )
  }

  putScript(accountId: string, name: string, form: FormData) {
    return this.request<{ id: string }>(
      "PUT",
      `/accounts/${accountId}/workers/scripts/${name}`,
      { body: form }
    )
  }

  enableWorkersDev(accountId: string, name: string) {
    return this.request<unknown>(
      "POST",
      `/accounts/${accountId}/workers/scripts/${name}/subdomain`,
      { json: { enabled: true, previews_enabled: false } }
    )
  }

  attachDomain(
    accountId: string,
    domain: { hostname: string; zoneId: string; service: string }
  ) {
    return this.request<unknown>(
      "PUT",
      `/accounts/${accountId}/workers/domains`,
      {
        json: {
          hostname: domain.hostname,
          zone_id: domain.zoneId,
          service: domain.service,
          environment: "production",
        },
      }
    )
  }

  // ── AI Gateway ────────────────────────────────────────────────────

  gateway(accountId: string, id: string) {
    return this.maybe<{ id: string }>(
      "GET",
      `/accounts/${accountId}/ai-gateway/gateways/${id}`
    )
  }

  /**
   * Authenticated, as Unified Billing requires; the Worker's AI binding is
   * pre-authenticated in its own account, so it needs no gateway token.
   */
  createGateway(accountId: string, id: string) {
    return this.request<{ id: string }>(
      "POST",
      `/accounts/${accountId}/ai-gateway/gateways`,
      {
        json: {
          id,
          authentication: true,
          collect_logs: true,
          cache_invalidate_on_update: true,
          cache_ttl: 0,
          rate_limiting_interval: 0,
          rate_limiting_limit: 0,
        },
      }
    )
  }

  // ── Access ────────────────────────────────────────────────────────

  accessOrganization(accountId: string) {
    return this.maybe<{ auth_domain: string }>(
      "GET",
      `/accounts/${accountId}/access/organizations`
    )
  }

  createAccessOrganization(accountId: string, team: string) {
    return this.request<{ auth_domain: string }>(
      "POST",
      `/accounts/${accountId}/access/organizations`,
      { json: { name: team, auth_domain: `${team}.cloudflareaccess.com` } }
    )
  }

  identityProviders(accountId: string) {
    return this.request<{ id: string; type: string }[]>(
      "GET",
      `/accounts/${accountId}/access/identity_providers`
    )
  }

  createOneTimePin(accountId: string) {
    return this.request<{ id: string }>(
      "POST",
      `/accounts/${accountId}/access/identity_providers`,
      { json: { name: "One-time PIN", type: "onetimepin", config: {} } }
    )
  }

  accessPolicies(accountId: string) {
    return this.all<AccessPolicy>(`/accounts/${accountId}/access/policies`)
  }

  upsertAccessPolicy(
    accountId: string,
    existing: string | null,
    body: Record<string, unknown>
  ) {
    return existing
      ? this.request<AccessPolicy>(
          "PUT",
          `/accounts/${accountId}/access/policies/${existing}`,
          { json: body }
        )
      : this.request<AccessPolicy>(
          "POST",
          `/accounts/${accountId}/access/policies`,
          { json: body }
        )
  }

  accessApps(accountId: string) {
    return this.all<AccessApp>(`/accounts/${accountId}/access/apps`)
  }

  upsertAccessApp(
    accountId: string,
    existing: string | null,
    body: Record<string, unknown>
  ) {
    return existing
      ? this.request<AccessApp>(
          "PUT",
          `/accounts/${accountId}/access/apps/${existing}`,
          { json: body }
        )
      : this.request<AccessApp>("POST", `/accounts/${accountId}/access/apps`, {
          json: body,
        })
  }
}
