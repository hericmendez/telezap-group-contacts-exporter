# TeleZap Group Contacts Exporter

Private web tool for authenticated users to connect their own WhatsApp and Telegram accounts, select groups, inspect members, and export them to CSV.

Browser → Next.js Route Handlers → per-user WhatsAppManager / TelegramManager → `whatsapp-web.js` / `teleproto`

## Features

- WhatsApp group discovery and participant / contact extraction (with LID support)
- Telegram group discovery (groups & supergroups) and participant enumeration (pagination, FloodWait-aware)
- Telegram QR authentication with phone / code / 2FA fallback
- CSV export — semicolon-delimited, UTF-8 with BOM, Brazilian Excel-friendly
- Unicode-safe filenames and download headers (RFC 5987)
- Telegram hidden-phone filtering (`NUMERO` stays empty when hidden; UI notice + optional exclude)
- Independent WhatsApp and Telegram sessions per authenticated app user
- User-scoped export files and download slots
- Authenticated access only — login screen + HttpOnly session cookie
- Dark / light / system theme (toggle in header), responsive, shadcn-style UI with per-platform tabs

## Architecture & Deployment

- **Stack:** Next.js 15 / React 19 / TypeScript / Tailwind v4 — single monolith, no separate backend
- **WhatsApp:** `whatsapp-web.js@1.34.7` (patched via `patch-package`) + Puppeteer/Chromium
- **Telegram:** `teleproto@^1.229.0` (pure JS, no native build)
- **Runtime:** persistent Node.js 22+ host with writable filesystem — **not suitable for Vercel/serverless** (sessions, Chromium profile and in-memory singletons require a long-lived process). See `docs/vercel.md`.
- **Multi-user:** small private group — users are provisioned via server-only `TELEZAP_USERS="username:hash,..."` (see Configuration). Each user gets isolated `.whatsapp_sessions/<hash>/`, `.telegram_sessions/<hash>/`, `output/<hash>/`.

## Quick Start

```bash
pnpm install
cp .env.example .env
# edit .env — see Configuration

pnpm dev        # http://localhost:3000
```

Production:

```bash
pnpm build
pnpm start
```

CLI (admin, WhatsApp only):

```bash
pnpm cli -- --group "My Group"
```

Checks:

```bash
pnpm typecheck
pnpm test
```

## Configuration

`.env` is server-only and never committed. Required variables (placeholders only — no real values):

```env
TELEZAP_USERS="alice:scrypt.16384.8.1.<saltB64url>.<hashB64url>,bob:scrypt.16384.8.1...."
TELEGRAM_API_ID=""
TELEGRAM_API_HASH=""
# CLI only:
GROUP_NAME=""
OUTPUT_FILE="output/contacts.csv"
```

Generate hashes without storing passwords:

```bash
pnpm auth:hash -- alice   # type password + Enter → paste ONLY the printed hash into .env
```

| Variable | Description | Default |
|---|---|---|
| `TELEZAP_USERS` | `username:hash` pairs, comma-separated — app users | *(required for web)* |
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | Telegram app credentials from https://my.telegram.org | *(required for Telegram)* |
| `GROUP_NAME` / `--group` | WhatsApp group for CLI | *(CLI only)* |
| `OUTPUT_FILE` / `--output` | CLI output path | `output/<sanitized>.csv` |

No `NEXT_PUBLIC_*` secrets. `TELEGRAM_API_HASH`, hashes and session files never reach the browser.

## Documentation

- Architecture: [`docs/architecture.md`](docs/architecture.md)
- Usage (web + CLI + API reference): [`docs/usage.md`](docs/usage.md)
- Telegram authentication & architecture: [`docs/telegram-architecture.md`](docs/telegram-architecture.md) · [`docs/telegram-authentication.md`](docs/telegram-authentication.md)
- Vercel compatibility & env vars: [`docs/vercel.md`](docs/vercel.md)
- Roadmap / history: [`docs/roadmap.md`](docs/roadmap.md)
- Agent rules: [`AGENTS.md`](AGENTS.md)

## Security & Privacy

- Web access requires login; all `/api/*` except `/api/auth/login` return `401` without a valid `telezap_session` cookie.
- Platform sessions (`LocalAuth`/`StringSession`) are per-user and never exposed to the browser.
- Telegram users may hide their phone number — exported `NUMERO` is then empty; the UI surfaces this explicitly.
- Exports live on the host filesystem under per-user namespaces.
- Synthetic data only in tests; never commit `.env`, `.wwebjs_auth/`, `.whatsapp_sessions/`, `.telegram_session*`, `output/*.csv`.

## Project Status

Implementation is complete for its intended private, small-user deployment (auth, per-user sessions, discovery, enumeration, export, download, Unicode-safe files, theming, 433 tests, production build). Remaining work is operational: deploy to a persistent host, provision users, and validate with real WhatsApp/Telegram accounts.

## License

Private/internal tool — all rights reserved unless otherwise stated.
