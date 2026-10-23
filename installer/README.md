# bdots installer

"Deploy to Cloudflare" for bdots: a small Worker where someone signs in with
Cloudflare, picks a name, a URL, who can sign in and a model, and gets bdots
running in their own account about a minute later. No clone, no CLI.

```
Sign in with Cloudflare (OAuth + PKCE)
        │
        ▼
Installer Durable Object (one per sign-in; token encrypted at rest)
        │  state streams to the page over the agent WebSocket
        ▼
1. account   workers.dev subdomain, existing install?
2. gateway   AI Gateway for every model call
3. access    Zero Trust org, allow list, bypass for /apps and /api/hooks
4. upload    static assets, then the Worker (modules, bindings, DO classes)
5. publish   workers.dev route or custom domain
6. wake      wait until the URL answers (with Access in front)
```

Each step can be re-run. A failed install resumes from the step that failed,
and installing again under the same name updates bdots in place. Bots, secrets
and the Durable Object data all stay.

## How the release gets here

`scripts/pack-release.ts` builds bdots (`pnpm build` in the repo root) and
copies the result into `public/release/`. It writes the Worker modules, the
static assets, and a `manifest.json` with asset hashes and the Workers API
bindings. That folder ships as the installer's own static assets, so **each
installer deploy carries exactly one bdots version**: the commit it was packed
from.

If bdots gains a binding type the installer cannot deploy, the pack fails.
Teach `pack-release.ts` and `src/deploy/upload.ts` about the new type.

## Set up

1. **OAuth client.** In the Cloudflare dashboard, create an OAuth client with:
   - Redirect URL: `https://<installer host>/api/auth/callback` (and
     `http://localhost:3100/api/auth/callback` for local testing)
   - Response type: **Code**
   - Grant types: **Authorization Code** and **Refresh Token**
   - Token auth method: **Client Secret Basic** (the installer also uses PKCE)
   - Scopes, all required (dashboard name → id):

     | In the dashboard | Scope id |
     | --- | --- |
     | User Details: Read | `user-details.read` |
     | Account Settings: Read | `account-settings.read` |
     | Workers: Admin | `workers-scripts.admin` |
     | Workers Routes: Edit | `workers-routes.write` |
     | Zone: Read | `zone.read` |
     | Access: Apps and Policies: Write | `access.write` |
     | Access: Organizations, Identity Providers, and Groups: Write | `access-acct.write` |
     | AI Gateway: Write | `aig.write` |

     `cf oauth-scopes list` prints every id with its dashboard name.

   The dashboard refuses the whole sign-in if the client is not granted every
   scope in `src/oauth.ts`.

2. **Config.** Put the client id in `cloudflare.config.ts`
   (`CF_OAUTH_CLIENT_ID`), and the secrets in a file:

   ```
   CF_OAUTH_CLIENT_SECRET=...
   SESSION_SECRET=...   # openssl rand -base64 32
   ```

   Locally they go in `.dev.vars` (see `.dev.vars.example`). For production,
   pass the file with `cf deploy --secrets-file <path>`. Never commit it.

3. **Deploy.** `pnpm run deploy` (packs a fresh release, then `cf deploy`).

## Develop

```bash
pnpm dev:demo    # fake sign-in and API: the whole flow with no account
pnpm dev         # real sign-in; needs the OAuth client and .dev.vars
pnpm test        # session signing, token encryption, VAPID keys
pnpm typecheck
```

## What it does in the user's account

| Resource | Name |
| --- | --- |
| Worker (tagged `bdots`) | the name they pick |
| Durable Object classes | `UserHub`, `BotAgent`, `AppLive` (first install only) |
| AI Gateway | the name they pick (default `bdots`), authenticated |
| Access organization | only if the account has none, with a one-time PIN login |
| Access policy | `bdots <name>: people` (their email list) |
| Access policy | `bdots <name>: share links and webhooks` (bypass) |
| Access applications | `bdots <name>`, and `bdots <name>: links` for `/apps` and `/api/hooks` |
| Secrets | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, generated on first install |

bdots reads `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, and verifies the Access JWT
on every request (`src/lib/auth.ts` in the repo root). Access destinations are
public hostnames, not Worker destinations, because Worker destinations refuse
the WebSocket upgrades bdots runs on.

## Not verified against a real account yet

The demo mode exercises the whole UI and state machine, but these API details
come from the docs and from Cloudflare OS, and have not run against a live
account:

- the AI Gateway create body (`authentication: true`, no Secrets Store)
- the `/apps` and `/api/hooks` bypass application, assuming subpaths inherit
- `workers.dev` subdomain creation on an account that has never had a Worker
- the first install's `new_sqlite_classes` migration through the raw API
