/** A Worker binding in the Workers API upload metadata. */
export type ApiBinding =
  | { type: "ai" | "browser" | "worker_loader"; name: string }
  | { type: "durable_object_namespace"; name: string; class_name: string }
  | { type: "plain_text" | "secret_text"; name: string; text: string }

/** Written by scripts/pack-release.ts into public/release/manifest.json. */
export interface ReleaseManifest {
  version: 1
  /** `<package version>+<commit>`, shown to the user and tagged on the Worker. */
  release: string
  builtAt: string
  worker: {
    mainModule: string
    /** Paths under release/modules/, including mainModule. */
    modules: string[]
    compatibilityDate: string
    compatibilityFlags: string[]
    observability: { enabled: boolean }
    /** SQLite Durable Object classes, created by the first upload's migration. */
    durableObjects: string[]
    /** Bindings with their defaults; the installer overrides some vars. */
    bindings: ApiBinding[]
    /** Secret names Coworkers declares. The installer fills the ones it can. */
    secrets: string[]
  }
  /** `/path` → hash and size, for the assets upload session. */
  assets: Record<string, { hash: string; size: number }>
}

/** Fetches a file of the packed release from this Worker's own assets. */
export function releaseFile(assets: Fetcher, path: string) {
  return assets.fetch(new Request(`https://assets.local/release/${path}`))
}

let cached: Promise<ReleaseManifest> | null = null

export function loadRelease(assets: Fetcher): Promise<ReleaseManifest> {
  cached ??= releaseFile(assets, "manifest.json").then(async (response) => {
    if (!response.ok) {
      cached = null
      throw new Error(
        "This installer has no Coworkers release packed. Run `pnpm pack-release` in installer/."
      )
    }
    return response.json<ReleaseManifest>()
  })
  return cached
}
