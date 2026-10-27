# Deploying on Vercel (services)

`vercel.json` deploys this repository as one Vercel project with two services behind one domain:

| Service | Root | Public path | What it is |
|---|---|---|---|
| `api` | `api/` | `/api/*` | The Node server: passkey login, per-user state, optional AI |
| `frontend` | `frontend/` | everything else | The Vite app |

Rewrites are ordered most specific first (`/api/(.*)` before `/(.*)`). Vercel hands a service the
**original** request path, so the API's routes (`GET /api/health` and so on) need no prefix handling.
One origin also means passkeys and cookies work as they do behind the Docker Compose nginx.

**No bindings.** Bindings are for one service calling another. Here nothing does: the browser calls
`/api/...` on the same origin, and the API only calls outside services (OpenAI, Open Food Facts). The
nginx `proxy_pass http://api:3000` in `web/nginx.conf` is what the rewrite replaces; that file stays
for Docker Compose.

## Storage: private Vercel Blob

Vercel has no persistent disk, so on Vercel the API stores everything in a **private Blob store**
(`api/store.js`) instead of files: `db.json` (accounts, passkeys, invites, push subscriptions),
`state-<uid>.json` (each person's workouts), `secret`, `vapid.json`, and the Open Food Facts cache.
Connect a Blob store to the project and the API picks it up (`BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN`);
nothing else to set. Anywhere else (Docker, `node server.js`) it keeps using `DATA_DIR` files exactly
as before.

- **Concurrent writes.** `db.json` is read fresh on every request and written with an ETag
  precondition. If two instances save at the same moment the second gets `409 — try again` instead of
  silently overwriting. Per-user state is last-writer-wins, as it always was.
- **Without a Blob store** the API refuses to start on Vercel unless `DATA_DIR=/tmp/...` is set (a demo
  that loses its data when an instance is recycled).
- `SESSION_SECRET`, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` can be set as env vars instead of being
  generated into the store.
- Blob has usage limits on the free plan; a handful of users is far below them, but check your plan.

## Environment variables (Project Settings → Environment Variables)

| Variable | Value |
|---|---|
| `RP_ID` | your production domain, e.g. `gym.example.com` (no scheme) |
| `ORIGIN` | `https://gym.example.com` |
| `RP_NAME` | display name shown in the passkey prompt |
| `BLOB_STORE_ID` | set automatically when a Blob store is connected to the project |
| `INVITE_ONLY` | `1` is sensible on a public URL: otherwise anyone can create a profile |
| `OPENAI_API_KEY` etc. | optional, for the AI coach and trainer check-in (see `.env.example`) |

**Passkeys are bound to one domain.** A passkey made on `gym.example.com` does not work on a preview
deployment's `*.vercel.app` URL, so passkey sign-in only works on the domain `RP_ID`/`ORIGIN` name.

## What works differently on Vercel

- **Rest-timer and daily-reminder push notifications are off.** They rely on `setTimeout` /
  `setInterval` in a long-running process; a function instance is not kept alive. Subscribing,
  the test notification and everything else push-related still work. Under Docker all of it works.
- **Sign-in challenges are signed tokens, not a memory map** (instances share no memory). Each is
  valid for its 5 minutes rather than strictly once.
- **"Training now" in the admin view and the AI daily cap are per instance**, so they are approximate.
  The cap is a guard against runaway cost, not a hard limit, on Vercel.
- **Exercise images and GIFs** load from the dataset's GitHub repository (`VITE_IMG_BASE` /
  `VITE_GIF_BASE` in the `buildCommand`). `raw.githubusercontent.com` is not a CDN and the service
  worker only caches same-origin media, so they are not available offline as when self-hosted.
- **`jev-app/`** (Coach Desk) is not deployed: nothing in the app calls it and it writes logs to disk.
