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

## Read this before using it for real

**The API keeps all data in files, and Vercel has no persistent disk.** Accounts, passkeys, every
workout, the session secret and the push keys live under `DATA_DIR`. On Vercel only `/tmp` is writable,
and it belongs to one instance and is lost when that instance is replaced. So:

- With no `DATA_DIR` set, the API **refuses to start** on Vercel and says why (`api/deploy.js`).
- With `DATA_DIR=/tmp/opengym` it starts with a warning, and **loses everyone's data** whenever an
  instance is recycled. That is fine for a throwaway demo and nothing else.

Ways to make it real (none is done here, because each is a decision):
1. Keep the API on your own machine and point the Vercel rewrite for `/api/(.*)` at it, using Vercel
   only for the frontend. Your data stays in your folder, which is what this project is for.
2. Replace the file storage in `api/server.js` with a database or object store (Vercel Blob, Postgres,
   Redis). A real change to how accounts and state are saved.

## Environment variables (Project Settings → Environment Variables)

| Variable | Value |
|---|---|
| `RP_ID` | your production domain, e.g. `gym.example.com` (no scheme) |
| `ORIGIN` | `https://gym.example.com` |
| `RP_NAME` | display name shown in the passkey prompt |
| `DATA_DIR` | `/tmp/opengym` for a demo only (see above) |
| `INVITE_ONLY` | `1` is sensible on a public URL: otherwise anyone can create a profile |
| `OPENAI_API_KEY` etc. | optional, for the AI coach and trainer check-in (see `.env.example`) |

**Passkeys are bound to one domain.** A passkey made on `gym.example.com` does not work on a preview
deployment's `*.vercel.app` URL, so passkey sign-in only works on the domain `RP_ID`/`ORIGIN` name.

## What does not carry over

- **Push reminders and rest-timer notifications.** The API schedules these with `setTimeout` and
  `setInterval` in memory. A function instance is not kept running between requests, so they are
  unreliable on Vercel. Fine under Docker.
- **Exercise images and GIFs.** In Docker they are served by nginx from a downloaded volume. Here the
  frontend is built to load them from the dataset's GitHub repository instead (`VITE_IMG_BASE` /
  `VITE_GIF_BASE` in the service's `buildCommand`). `raw.githubusercontent.com` is not a CDN: it
  caches for minutes, and the service worker only caches same-origin media, so they are not available
  offline as they are when self-hosted. Hosting the media yourself (e.g. Vercel Blob) is the fix.
- **`jev-app/`** (Coach Desk) is not deployed. Nothing in the app calls it, it is not reachable
  without a rewrite, and it writes logs to disk.

## Not verified

This configuration has not been run: neither `vercel dev` nor a real deployment was available. The
shape follows Vercel's Services documentation and the JSON is valid, but the first deploy is the test.
