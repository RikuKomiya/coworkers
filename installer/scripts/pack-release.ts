/**
 * Builds bdots and packs it into the installer's static assets:
 *
 *   public/release/manifest.json   what to upload and how (ReleaseManifest)
 *   public/release/modules/...     the Worker's ES modules
 *   public/release/assets/...      the Worker's static assets
 *
 * The installer reads these through its ASSETS binding, so each installer
 * deploy carries exactly one bdots release. Run from installer/:
 * `node scripts/pack-release.ts` (or `--skip-build` to reuse the last build).
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { extname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { ApiBinding, ReleaseManifest } from "../src/release.ts"

const root = fileURLToPath(new URL("../..", import.meta.url))
const out = fileURLToPath(new URL("../public/release", import.meta.url))
const built = join(root, ".cloudflare/output/v0/workers/default")

if (!process.argv.includes("--skip-build")) {
  // BDOTS_PACKING: build with the defaults, not the packer's own
  // bdots.deploy.json (its Access AUD and team domain would ship publicly).
  execFileSync("pnpm", ["build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, BDOTS_PACKING: "1" },
  })
}
if (!existsSync(join(built, "worker.config.json"))) {
  throw new Error(
    `No bdots build at ${built}. Run \`pnpm build\` in the repo root.`
  )
}

interface BuiltBinding {
  type: string
  value?: string
  exportName?: string
}

interface BuiltConfig {
  name: string
  compatibilityDate: string
  compatibilityFlags: string[]
  observability?: { enabled: boolean }
  exports: Record<string, { type: string; storage?: string }>
  manifest: { mainModule: string }
  env: Record<string, BuiltBinding>
}

const config: BuiltConfig = JSON.parse(
  readFileSync(join(built, "worker.config.json"), "utf8")
)

/** cf's binding shapes → the Workers API metadata. Unknown types fail the pack. */
function apiBinding(name: string, b: BuiltBinding): ApiBinding | null {
  switch (b.type) {
    case "ai":
      return { type: "ai", name }
    case "browser":
      return { type: "browser", name }
    case "worker-loader":
      return { type: "worker_loader", name }
    case "durable-object":
      return {
        type: "durable_object_namespace",
        name,
        class_name: b.exportName ?? name,
      }
    case "text":
      return { type: "plain_text", name, text: b.value ?? "" }
    case "secret":
      // Filled by the installer when it has a value (VAPID keys); left out
      // otherwise, which bdots treats as "feature off".
      return null
    default:
      throw new Error(
        `bdots binding ${name} has type "${b.type}", which the installer cannot deploy yet. Teach pack-release.ts and src/deploy/upload.ts about it.`
      )
  }
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// Worker modules: the entry and its code-split chunks. Source maps and the
// Vite manifest stay behind.
const bundle = join(built, "bundle")
const modules = files(bundle)
  .filter((path) => extname(path) === ".js" && !path.includes("/.vite/"))
  .map((path) => relative(bundle, path))
for (const name of modules) {
  const target = join(out, "modules", name)
  mkdirSync(join(target, ".."), { recursive: true })
  cpSync(join(bundle, name), target)
}

// Static assets, hashed the way the assets upload session expects: 32 hex
// characters of SHA-256 over the base64 content plus the extension.
const assetsDir = join(built, "assets")
const assets: ReleaseManifest["assets"] = {}
for (const path of files(assetsDir)) {
  const rel = relative(assetsDir, path)
  const bytes = readFileSync(path)
  const hash = createHash("sha256")
    .update(bytes.toString("base64") + extname(rel).slice(1))
    .digest("hex")
    .slice(0, 32)
  assets[`/${rel}`] = { hash, size: bytes.length }
}
cpSync(assetsDir, join(out, "assets"), { recursive: true })

const bindings: ApiBinding[] = []
const secrets: string[] = []
for (const [name, binding] of Object.entries(config.env)) {
  const api = apiBinding(name, binding)
  if (api) bindings.push(api)
  else secrets.push(name)
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
let commit = "unknown"
try {
  commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root })
    .toString()
    .trim()
} catch {
  // Not a git checkout.
}

const manifest: ReleaseManifest = {
  version: 1,
  release: `${pkg.version ?? "0.0.0"}+${commit}`,
  builtAt: new Date().toISOString(),
  worker: {
    mainModule: config.manifest.mainModule,
    modules,
    compatibilityDate: config.compatibilityDate,
    compatibilityFlags: config.compatibilityFlags,
    observability: config.observability ?? { enabled: true },
    durableObjects: Object.entries(config.exports)
      .filter(([, e]) => e.type === "durable-object")
      .map(([name]) => name),
    bindings,
    secrets,
  },
  assets,
}
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2))

const size = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
const moduleBytes = modules.reduce(
  (sum, name) => sum + statSync(join(bundle, name)).size,
  0
)
console.log(
  `Packed bdots ${manifest.release}: ${modules.length} modules (${size(moduleBytes)}), ${Object.keys(assets).length} assets, ${bindings.length} bindings.`
)
