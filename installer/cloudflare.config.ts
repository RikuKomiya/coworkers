import { bindings, defineConfig, exports } from "cf/config"

const WORKER_NAME = "bdots-installer"

/**
 * The "Deploy to Cloudflare" installer: Sign in with Cloudflare, then put a
 * prebuilt bdots release into the user's own account through the API. The
 * release travels in this Worker's static assets (see
 * scripts/pack-release.ts), so installer version = bdots version.
 */
export default defineConfig(({ mode }) => ({
  worker: {
    name: WORKER_NAME,
    compatibilityDate: "2026-09-01",
    compatibilityFlags: ["nodejs_compat"],
    entrypoint: "./src/worker.ts",
    observability: { enabled: true },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*", "/agents/*"],
    },
    exports: {
      // One per sign-in: the plan, the progress, and the encrypted token.
      Installer: exports.durableObject({ storage: "sqlite" }),
    },
    env: {
      ASSETS: bindings.assets(),
      Installer: bindings.durableObject({
        worker: WORKER_NAME,
        exportName: "Installer",
      }),
      // A Cloudflare dashboard OAuth client. Its redirect URL is
      // <origin>/api/auth/callback; see README.md for the scopes.
      CF_OAUTH_CLIENT_ID: bindings.text("5f07eb2c6fd57120f862c90f75ba5dd0"),
      CF_OAUTH_CLIENT_SECRET: bindings.secret(),
      // Signs session cookies and encrypts stored OAuth tokens. Any long
      // random string: `openssl rand -base64 32`.
      SESSION_SECRET: bindings.secret(),
      // `pnpm dev:demo` (mode "demo") fakes sign-in and every API call,
      // for working on the UI without an OAuth client or an account.
      DEMO: bindings.text(mode === "demo" ? "1" : ""),
    },
  },
}))
