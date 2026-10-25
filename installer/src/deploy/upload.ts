import type { CfApi } from "../cf-api"
import { releaseFile } from "../release"
import type { ApiBinding, ReleaseManifest } from "../release"

/** Tag on every Worker the installer uploads, to recognise its own later. */
export const SCRIPT_TAG = "coworkers"

const MIME: Record<string, string> = {
  js: "application/javascript",
  css: "text/css",
  html: "text/html",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  txt: "text/plain",
  webmanifest: "application/manifest+json",
  woff2: "font/woff2",
  wasm: "application/wasm",
}

function mimeOf(path: string) {
  return MIME[path.split(".").pop() ?? ""] ?? "application/octet-stream"
}

async function base64Of(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * Uploads the static assets the account does not already have, and
 * returns the completion token the script upload carries.
 */
export async function uploadAssets(
  api: CfApi,
  assets: Fetcher,
  release: ReleaseManifest,
  target: { accountId: string; name: string },
  progress: (done: number, total: number) => void
) {
  const session = await api.assetsUploadSession(
    target.accountId,
    target.name,
    release.assets
  )
  const buckets = session.buckets ?? []
  if (buckets.length === 0) return session.jwt

  const pathOf = new Map(
    Object.entries(release.assets).map(([path, { hash }]) => [hash, path])
  )
  const total = buckets.reduce((n, bucket) => n + bucket.length, 0)
  let done = 0
  let completion: string | undefined
  for (const bucket of buckets) {
    const form = new FormData()
    for (const hash of bucket) {
      const path = pathOf.get(hash)
      if (!path)
        throw new Error(`The upload asked for an unknown file (${hash}).`)
      const response = await releaseFile(assets, `assets${path}`)
      if (!response.ok) throw new Error(`Release file ${path} is missing.`)
      form.append(
        hash,
        new File([await base64Of(response)], hash, { type: mimeOf(path) })
      )
    }
    const result = await api.uploadAssets(target.accountId, session.jwt, form)
    if (result.jwt) completion = result.jwt
    done += bucket.length
    progress(done, total)
  }
  if (!completion) throw new Error("The assets upload never completed.")
  return completion
}

/**
 * The script upload: every module, the bindings with the installer's
 * values filled in, and the Durable Object classes on a first install.
 */
export async function putScript(
  api: CfApi,
  assets: Fetcher,
  release: ReleaseManifest,
  target: {
    accountId: string
    name: string
    /** Plain-text values to set, by binding name. */
    vars: Record<string, string>
    /** Secret values to set. Others already on the Worker are kept. */
    secrets: Record<string, string>
    assetsJwt: string
    fresh: boolean
  }
) {
  const { worker } = release
  // A release without one of these would deploy without, say, its Access
  // check. Refuse instead.
  const missing = Object.keys(target.vars).filter(
    (name) =>
      !worker.bindings.some((b) => b.type === "plain_text" && b.name === name)
  )
  if (missing.length > 0) {
    throw new Error(
      `This Coworkers release does not declare ${missing.join(", ")}. Repack the installer from a newer Coworkers.`
    )
  }
  const bindings: ApiBinding[] = worker.bindings.map((binding) =>
    binding.type === "plain_text" && binding.name in target.vars
      ? { ...binding, text: target.vars[binding.name] }
      : binding
  )
  for (const [name, text] of Object.entries(target.secrets)) {
    bindings.push({ type: "secret_text", name, text })
  }

  const metadata = {
    main_module: worker.mainModule,
    compatibility_date: worker.compatibilityDate,
    compatibility_flags: worker.compatibilityFlags,
    observability: worker.observability,
    bindings,
    tags: [SCRIPT_TAG],
    // Secrets set before (VAPID keys, a Browser Run token the user added)
    // survive an update.
    ...(target.fresh ? {} : { keep_bindings: ["secret_text"] }),
    // The classes are created once. Updates carry no migrations, so the
    // live tag stays put.
    ...(target.fresh
      ? {
          migrations: {
            new_tag: "v1",
            steps: [{ new_sqlite_classes: worker.durableObjects }],
          },
        }
      : {}),
    assets: { jwt: target.assetsJwt },
    annotations: { "workers/message": `coworkers ${release.release}` },
  }

  const form = new FormData()
  form.set(
    "metadata",
    new File([JSON.stringify(metadata)], "metadata.json", {
      type: "application/json",
    })
  )
  for (const name of worker.modules) {
    const response = await releaseFile(assets, `modules/${name}`)
    if (!response.ok) throw new Error(`Release module ${name} is missing.`)
    form.set(
      name,
      new File([await response.arrayBuffer()], name, {
        type: "application/javascript+module",
      })
    )
  }
  return api.putScript(target.accountId, target.name, form)
}

/** A Web Push key pair in the format `web-push` reads (base64url). */
export async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer
  )
  const jwk = (await crypto.subtle.exportKey(
    "jwk",
    pair.privateKey
  )) as JsonWebKey
  const base64Url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  return { publicKey: base64Url(raw), privateKey: jwk.d ?? "" }
}
