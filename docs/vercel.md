# Vercel Deployment Audit — TeleZap Group Contacts Exporter

Date: 2026-09-17. No configuration was added for Vercel because the audit
shows the full application cannot run on serverless functions. This document
records the per-subsystem verdict so a deployment decision can be made
without re-auditing.

## Compatibility matrix

| Subsystem | Vercel status | Notes |
|---|---|---|
| Next.js UI (static + client polling) | compatible | Standard App Router page; no Edge usage. |
| Static assets (`public/*`, favicon, SVG) | compatible | Served from CDN. |
| Telegram API routes (auth/groups/participants/export) | compatible with constraints | Pure-JS teleproto bundles fine, but multi-step flows (QR ~30s refresh, phone/code/2FA, long enumerations) assume one long-lived process; serverless has no instance affinity. |
| Telegram authentication | requires persistent runtime | Login spans many requests (QR polling, code, password); in-memory login state does not survive across function invocations. |
| Telegram session persistence (per-user `.telegram_sessions/<id-hash>/session`, legacy `.telegram_session`) | requires external persistent service | Vercel filesystem is ephemeral; session files would be lost on redeploy/scale. Needs a volume/KV/store (not implemented). |
| WhatsApp API routes | incompatible | Requires the WhatsApp client below. |
| `whatsapp-web.js` + Chromium | incompatible | Needs a persistent browser process; not available/supported in Functions. |
| `LocalAuth` filesystem (`.wwebjs_auth`) | requires external persistent service | Same ephemeral-filesystem problem as above, plus browser profile locking. |
| `globalThis` singleton managers | incompatible | Serverless invocations do not share memory; singletons become per-invocation. |
| CSV `output/*.csv` files | requires external persistent service | Ephemeral; also the source of truth for downloads. |
| Download routes | compatible with constraints | Work only if the export ran on the same warm instance (in-memory slot); unreliable without stickiness. |

## Precise wording

* **Vercel-ready frontend** — the UI itself would deploy.
* **Telegram-compatible deployment** — only with an external session store
  and sticky/long-lived execution (not implemented).
* **WhatsApp requires persistent Node/browser runtime** — e.g. a VPS,
  Fly.io/Render-style machine, or any always-on Node 22 host with Chromium.

Do NOT split the project into a second backend to chase this; the monolith
is correct for a persistent host. If Vercel hosting is ever required, the
honest path is: Vercel for the frontend plus a persistent host for the
Next.js server (or a documented Telegram-only serverless variant with an
external session store — future work, not started).

## Environment variables

Build-time/public: none (no `NEXT_PUBLIC_*` variables exist).

Server-only secrets (set in the host environment, never committed):

| Variable | Required for | Notes |
|---|---|---|
| `TELEGRAM_API_ID` | Telegram login | From https://my.telegram.org; numeric. |
| `TELEGRAM_API_HASH` | Telegram login | Secret; never exposed to the browser. |
| `GROUP_NAME` | CLI only | WhatsApp group for `pnpm cli`. |
| `OUTPUT_FILE` | CLI only | CSV override for `pnpm cli`. |

No other variables are read. Next.js may warn about `dotenv` loading `.env`
— harmless; production hosts inject real env vars.

## Persistence audit (Vercel)

* `.telegram_sessions/<id-hash>/session` (per-user since M4; legacy
  `.telegram_session`) — rewritten on auth/rotation; lost on Vercel
  (ephemeral FS). Needs external storage for serverless.
* `.wwebjs_auth/` — legacy Chromium profile + session; meaningless without a
  persistent browser host. Since M3, web users each own an isolated scope
  under `.whatsapp_sessions/<sha256(userId)>/` — same constraint applies
  per directory (persistent volume required, Chromium locking is per
  profile so concurrent users do not contend, but serverless remains out).
* `output/*.csv` — written per export, read back by download routes;
  ephemeral on Vercel. Downloads already serve bytes from disk, so any
  persistent volume mounted at `output/` keeps them working.

No database or storage provider was added: on a persistent host the
current file-based design is correct and sufficient.

## Restart behavior (M6)

Registries and export slots are process-local: after a restart both start
empty and managers are recreated lazily on the next authenticated request,
reusing the persisted per-user sessions without a new login. Export files
survive on disk but lose their slot references — re-export to download
again. Shutdown (`SIGINT`/`SIGTERM`) destroys all active managers once per
process without deleting any session or export files.

## Node version

Engines: `>=18`; validated on Node v22.23.2. Vercel deprecates Node 20 for
new builds/functions on 2026-10-01 — this project is already consistent
with Node 22+, so no change was made. Deploy with Node 22.x.

## Configuration added

None. No `vercel.json` (nothing to configure: Node runtime is already
declared per-route, no Edge usage, no rewrites needed). Adding one would
be configuration for its own sake.
