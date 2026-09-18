# Usage

The web app (`pnpm dev` / `pnpm start`) is the primary entrypoint:
**TeleZap Group Contacts Exporter**, a single page with **WhatsApp** and
**Telegram** tabs (switching tabs preserves each platform's state), light /
dark / system theme (toggle in the header, preference persisted), and a
TeleZap bolt+node mark.

The CLI (`pnpm cli`, `src/cli.ts`) is kept as a thin administrative/dev
consumer of the same manager.

## Web app

```bash
pnpm dev    # development (http://localhost:3000, HMR)
pnpm build  # production build
pnpm start  # production server (http://localhost:3000)
```

Flow in the browser:

1. Open `http://localhost:3000` → status `disconnected` → click **Conectar**
   (`POST /api/whatsapp/connect`; progress via polling `GET
   /api/whatsapp/status` every 2s).
2. First run: scan the QR (`GET /api/whatsapp/qr`, rendered by the page)
   with WhatsApp → Linked Devices. Later runs reuse `.wwebjs_auth/` and
   connect without QR.
3. When `connected`, the page shows the number and loads `GET /api/groups`.
4. Select one group (selection is the group **ID**; the name is display only,
   so duplicate names are exported unambiguously) → **Exportar CSV**
   (`POST /api/export { "groupId" }`) → success shows counts + **Baixar CSV**
   (`GET /api/export/download`, the exact bytes of the generated file).
5. WhatsApp stays connected after export; `Ctrl+C` stops the server.

`GROUP_NAME` is no longer needed for the web flow (the group is picked in
the UI). The server only uses environment for Node runtime concerns;
nothing secret is exposed to the browser.

## CLI (admin/dev)

```bash
pnpm cli -- --group "My Group"   # auth → ready → discovery → extraction → resolution → CSV
pnpm cli:watch -- --group "My Group"  # watch mode via tsx watch
```

## Setup

```bash
pnpm install
cp .env.example .env
# edit GROUP_NAME in .env — required for the CLI (the web UI picks the group instead)
# OUTPUT_FILE optionally overrides CSV location (default: output/<sanitized-group>.csv)
```

## Configuration

All CLI configuration can be provided via `.env` or CLI flags (flags win):

| Source | Example |
|---|---|
| `.env` | `GROUP_NAME=My Group` |
| CLI | `pnpm cli -- --group "My Group"` |
| `.env` | `OUTPUT_FILE=output/contacts.csv` |
| CLI | `pnpm cli -- --output output/my.csv` |

CLI also supports `=` form: `--group="My Group"` `--output=output/my.csv`.

`GROUP_NAME` / `--group` is **required** for the CLI. Missing value exits with `Missing group name. Set GROUP_NAME in .env or pass --group "My Group".` `OUTPUT_FILE`/`--output` optionally overrides default `output/<sanitized-group-name>.csv` (e.g. `output/My Gaming Group.csv`).

## Commands

```bash
pnpm dev                           # Next.js web app (primary)
pnpm build                         # Next.js production build
pnpm start                         # Next.js production server
pnpm cli -- --group "My Group"     # admin/dev CLI export
pnpm typecheck                     # tsc --noEmit
pnpm test                          # vitest run (no real WhatsApp)
pnpm test:watch                    # vitest watch
```

## Examples (CLI)

```bash
# Use .env
echo 'GROUP_NAME=My Group' > .env
pnpm cli
# -> Initializing WhatsApp client... -> QR (if needed) -> WhatsApp client ready.
# -> Connected as: 5516999999999 (when the library exposes the number)
# -> Searching for group: My Group
# -> Group found: My Group
# -> Group ID: 1203@g.us
# -> Participants: 42
# -> Participants extracted: 42
# -> Contacts resolved: 41
# -> Contacts unresolved: 1
# -> CSV exported: output/My Group.csv

# One-off override (GROUP_NAME still required — CLI wins)
pnpm cli -- --group "Família Silva" --output output/familia.csv

# With equals syntax
pnpm cli -- --group="My Group"

# Missing group name (error)
pnpm cli
# -> Missing group name. Set GROUP_NAME in .env or pass --group "My Group".
```

## Group Discovery (Phase 2)

Implemented in `src/whatsapp/group.ts`.

* Source: `await client.getChats()` **only after** `ready` (via `waitForReady`). Never before authentication.
* Filter: `chat.isGroup === true` only — direct chats ignored.
* Matching: **exact** `===` — `"My Group"` does not match `"My Group 2026"` or `"my group"`.
* Internal model: `GroupSummary { id, name, participantCount?, isGroup }` — `id` is opaque (e.g. `120363...@g.us`), `participantCount` from `participants` or `groupMetadata.participants`.
* Output after `ready`:

```text
Searching for group: My Group
Group found: My Group
Group ID: 120363025...@g.us
Participants: 42
```

Errors are actionable:

* No match: `Group "My Group" was not found.` (exit 1, client destroyed)
* Multiple matches:

```text
Multiple WhatsApp groups named "My Group" were found.
Please identify the group using a more specific selector.

1. My Group — 42 participants — 120363025@g.us
2. My Group — 17 participants — 120363026@g.us

Use a more specific group selector.
```

* Missing config: `Missing group name. ...` (exit 1, before init)

Future: `--group-id` for deterministic selection when names collide; not yet implemented.

## Participant Extraction (Phase 3)

Implemented in `src/whatsapp/participants.ts`.

* Source: `group.participants` **only** (via `client.getChatById(groupId)` after discovery). Never `client.getChats()` again, never message scraping, never `getContactById` (Phase 4).
* Model: `GroupParticipantSummary { whatsappId, isAdmin, isSuperAdmin }` — `whatsappId` is opaque `participant.id._serialized` (e.g. `5519@c.us`, `123456789012345@lid`), no `name`/`number`/`pushname` yet.
* Mapping: `participantToSummary(participant)` copies `_serialized` unchanged + `isAdmin`/`isSuperAdmin` (defaults `false`), never mutates source, treats ID as opaque (LID-safe).
* Deduplication: `deduplicateParticipants` by `whatsappId` only (not name/flags), keeps first occurrence, preserves WhatsApp order, deterministic.
* Extraction: `extractParticipants(group)` validates `group.participants` is array (empty array = valid empty group), maps + dedup; throws `Group does not expose participants as expected.` if missing/not-array (clear failure, not silent empty). `fetchParticipantsByGroupId(client, groupId)` wraps `getChatById` → `extractParticipants`.
* CLI: after `Group found`, logs `Extracting participants...` → `Participants extracted: N` (summary only, usable for 1000+ members). No per-participant bulk logging, no CSV.

Errors after discovery:

* `Participant extraction failed: Group does not expose participants as expected.` (exit 1, client destroyed).
* Empty participant list is distinguished from retrieval failure where API allows.

No contact resolution is performed until Phase 4.

## Contact Resolution (Phase 4)

Implemented in `src/whatsapp/contacts.ts`.

* Pipeline: `GroupParticipantSummary[]` → `client.getContactById(whatsappId)` (opaque, one per participant, never `getChats`/message scraping) → `ResolvedContact { whatsappId, name, pushname, number, isAdmin, isSuperAdmin }`.
* Installed API inspected: `whatsapp-web.js@1.34.7` Contact has `id._serialized`, `number` (`userid`), `name?`, `pushname`, `shortName?` — chosen `number`/`name`/`pushname` (shortName redundant), limits documented in module header.
* Identity: `whatsappId` preserved unchanged (e.g. `123@lid` stays `@lid`, not replaced by phone number).
* Normalization: missing `name`/`pushname`/`number` → `""` (safe for Phase 5 CSV), never `"Unknown"`/`"N/A"`.
* Partial failures: single `getContactById` failure → `logger.warn("Contact resolution warning: could not resolve <ID>")` + placeholder `name/pushname/number=""` retaining `isAdmin`/`isSuperAdmin`; does not abort batch. Fatal client failure (missing `getContactById`) propagated.
* Batch: `resolveParticipantsWithStats` sequential (no concurrency framework) for Puppeteer safety, preserves input order, defensive cache avoids duplicate lookups (`dup@c.us` called once).
* CLI: `Resolving contacts...` → `Contacts resolved: N` / `Contacts unresolved: M` (concise, no per-contact flood for 1000+).

Errors:

* `Contact resolution warning: could not resolve 123@lid` (per-contact, warn, continue).
* `Contact resolution failed: WhatsApp client is not available for contact resolution.` (fatal, destroy → exit 1).

## CSV Export (Phase 5)

Implemented in `src/export/csv.ts`.

**Exporter boundary**: `ResolvedContact[]` (already normalized) → `exportCsv(contacts, outputPath)` with no `whatsapp-web.js` dependency. CLI chooses path.

**Location**: Default `output/<sanitized-group-name>.csv` (e.g. `My Gaming Group` → `output/My Gaming Group.csv`; `My/Group` → `output/My_Group.csv`). `OUTPUT_FILE`/`--output` overrides when explicitly set to non-default (`output/contacts.csv`). Invalid chars `/\:*?"<>|\x00-\x1F` → `_`, `..`/empty → `whatsapp-group.csv`, `../escape` → `output/__escape.csv` (stays inside `output/`), Unicode preserved, long names truncated to 100 chars.

**Format**:

- Header exactly: `WHATSAPP_ID;NOME;NOME_WHATSAPP;NUMERO;ADMIN;SUPER_ADMIN` (order fixed, 6 columns).
- Delimiter `;` for Brazilian Excel/LibreOffice.
- UTF-8 with BOM `EF BB BF` at start (Excel preserves João, Márcia, Unicode).
- Correct escaping: `;`, `"`, `\n`, `\r`, combinations quoted with doubled `""` (e.g. `João; "O Rei"` → `"João; ""O Rei"""`).
- Booleans `true`/`false` lowercase. Empty `""` remains empty (e.g. `123@lid;;;;false;false`). Unresolved contacts exported normally (empty name/pushname/number, admin preserved). Order preserved. Empty group → header only.
- Example:

```csv
WHATSAPP_ID;NOME;NOME_WHATSAPP;NUMERO;ADMIN;SUPER_ADMIN
5516999999999@c.us;João Silva;João;5516999999999;false;false
123456789@lid;;;false;false
5511999999999@c.us;"João; ""O Rei""";João;5511999999999;true;false
```

**Filesystem**: `output/` created if missing (`mkdir -p`), file written with BOM, no partial success reporting, path safety via `path.resolve` check.

## Output (legacy docs)

CSV is written to the path above (default `output/<sanitized>.csv` or `OUTPUT_FILE` override).

- Semicolon `;` delimiter
- UTF-8 with BOM for Excel
- Handles quotes, delimiters, newlines, carriage returns
- Preserves accented characters (e.g. João, José)

Headers: `WHATSAPP_ID;NOME;NOME_WHATSAPP;NUMERO;ADMIN;SUPER_ADMIN`

Output directory `output/` is created and gitignored via `.gitkeep` and `output/*.csv`.

## Authentication (WhatsApp)

Implemented via `LocalAuth` (`.wwebjs_auth/`). The web UI flow (Connect →
QR → connected, polled status) is described in "Web app" above; what
follows is the CLI shape, unchanged since Phase 1:

Implemented via `LocalAuth` (`.wwebjs_auth/`):

1. On first run, the app prints:

```text
Initializing WhatsApp client...
QR code received. Scan it with WhatsApp.
Scan the QR code with WhatsApp:
[QR CODE]
Waiting for authentication...
```

2. Scan with WhatsApp > Linked Devices.
3. On success:

```text
Authenticated.
WhatsApp client ready.
Searching for group: ...
```

4. On failure: `WhatsApp authentication failed: <reason>` (process exits 1).
5. On disconnect: `WhatsApp disconnected: <reason>`.
6. Session persists in `.wwebjs_auth/` — next run reuses session, no QR needed.

To re-authenticate: `rm -rf .wwebjs_auth .wwebjs_cache` and re-run.

Graceful shutdown: `Ctrl+C` (SIGINT) or `SIGTERM` triggers `Shutdown requested (SIGINT)...` → `WhatsApp client destroyed.` → exit 0, via `WhatsAppManager.attachProcessShutdownHandlers()` + `disconnect()`. The CLI also disconnects before exiting after a finished or failed export, so no Chromium is leaked. Duplicate handlers are avoided.

Web-server shutdown (M6): SIGINT/SIGTERM runs `shutdownAllManagers()` once per process (see `src/instrumentation.ts`), destroying every active WhatsApp/Telegram client without deleting any session files. Restart starts with empty registries — managers and export slots are recreated lazily per user, while `.whatsapp_sessions/`, `.telegram_sessions/`, and `output/` persist on disk. App logout never destroys platform managers; only explicit disconnect or process shutdown does.

## WhatsApp sessions per app user (M3)

Web users no longer share `.wwebjs_auth/`. Each authenticated user gets an
isolated `LocalAuth` scope under `.whatsapp_sessions/<sha256(userId)>`
(distinct `clientId` too), so two users can hold live WhatsApp connections
simultaneously. The mapping is deterministic and filesystem-safe; session
ownership always derives from `requireAppUser(request).id`, never from
request data. New session directories are gitignored; expected posture is
owner-only access on a private host (the migrator sets `0700` on roots it
creates; Chromium-created contents follow the process umask).

The CLI still uses the legacy `.wwebjs_auth/` scope. To adopt the legacy
session for one specific user (explicit, opt-in, never automatic):

```bash
pnpm whatsapp:migrate-session -- --user alice
```

This copies (never moves/deletes) `.wwebjs_auth/` into that user's scope,
verifies the copy, refuses if the destination already holds different
files, and is safe to rerun. There is deliberately no "first visitor wins"
behavior. Telegram sessions are isolated per user since M4
(`.telegram_sessions/<id-hash>/session`); export slots and files are
isolated per user since M5 (see below).

## Telegram authentication

Requires `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` in `.env` (server-only; get
them at https://my.telegram.org → API development tools). The Telegram tab
is independent from WhatsApp (switching tabs preserves both states).

Requires `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` in `.env` (server-only; get
them at https://my.telegram.org → API development tools). The Telegram
section of the page is independent from WhatsApp.

1. Click **Conectar Telegram** (`POST /api/telegram/connect`; progress via
   polling `GET /api/telegram/status`).
2. Click **Escanear QR Code** (`POST /api/telegram/qr/start`) and scan with
   Telegram (Settings → Devices → Link Desktop Device). Tokens expire
   (~30s) and refresh automatically server-side; **Cancelar** aborts.
   Or enter the phone number → **Continuar** (`POST
   /api/telegram/auth/phone`).
3. If asked, enter the verification code → **Verificar** (`POST
   /api/telegram/auth/code`). A wrong step returns `401`, unknown IDs are
   never involved here — only `409` (transport down) and `429` (FloodWait).
4. If the account has 2FA, enter the password → **Verificar** (`POST
   /api/telegram/auth/password`). The password is transient (never stored,
   logged, or returned); the server-provided hint is shown when available.
5. On success the page shows name, `@username`, and numeric ID; the session
   persists in the user's isolated scope — gitignored
   `.telegram_sessions/<id-hash>/session` (`0600`) — and is reused on
   restart without a new login. Each app user has their own scope; the
   legacy global `.telegram_session` file is only used when no user scope
   applies, and can be adopted explicitly via `pnpm telegram:migrate-session
   -- --user <app-user-id>` (copy + verify, source preserved).

To re-authenticate: delete your `.telegram_sessions/<id-hash>/session` file
(or the legacy `.telegram_session`) and log in again. To revoke: remove the
session in Telegram (Settings → Devices) and delete the file. Revoking one
user never touches another user's session. There is no logout button by
design.

After authorization the tab shows groups (radio by ID) → **Carregar
participantes** (skeleton while loading) → an informational notice that
contacts may hide their phone number → optional checkbox **Não listar
contatos com número oculto ou desconhecido** (list, counts, and CSV then
cover only phone-visible contacts; the total stays shown) →
**Exportar CSV** (spinner, guarded against double clicks) → success +
**Baixar CSV**.

## API reference
Every route below except the three `/api/auth/*` rows requires the
`telezap_session` cookie (`401` without a valid session). WhatsApp handlers
share one manager per authenticated user via `getWhatsAppManager(userId)`,
Telegram handlers via `getTelegramManager(userId)` — fully independent. All return plain
serializable values (never clients, chats, MTProto objects, sessions,
codes, or passwords):

| Method + path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/auth/login` | `{ "username", "password" }` | `{ authenticated, user }` + session cookie | `400` bad body, `401` bad credentials |
| `GET /api/auth/me` | — | `{ authenticated, user }` | `401` |
| `POST /api/auth/logout` | — | `{ authenticated: false }`, session destroyed | — |
|---|---|---|---|
| `GET /api/whatsapp/status` | — | `{ status, number, qr, error }` | — |
| `POST /api/whatsapp/connect` | — | `{ started, status }` | — |
| `GET /api/whatsapp/qr` | — | `{ qr: string \| null }` | — |
| `GET /api/groups` | — | `{ groups: [{ id, name, participantCount? }] }` | `409` not connected |
| `POST /api/export` | `{ "groupId": "120363...@g.us" }` | `ExportResult + downloadUrl` | `400` bad body, `404` unknown/non-group ID, `409` not connected |
| `GET /api/export/download` | — | CSV bytes (`text/csv`, attachment) | `404` no export yet / file gone |
| `GET /api/telegram/status` | — | `{ transport, authorized, loginStep, qr, user, passwordHint, error }` | — |
| `POST /api/telegram/connect` | — | `{ started, status }` | — |
| `GET /api/telegram/qr` | — | `{ qr: string \| null }` (`tg://login?token=…` or null) | — |
| `POST /api/telegram/qr/start` | — | `{ started, status }` | `409` login already pending / transport down |
| `POST /api/telegram/qr/cancel` | — | `{ cancelled, status }` | — |
| `POST /api/telegram/auth/phone` | `{ "phone": "+5516…" }` | `{ sent, status }` | `400` bad body, `409` transport down, `429` FloodWait |
| `POST /api/telegram/auth/code` | `{ "code": "12345" }` | `{ verified, status }` | `400` bad body, `401` wrong step, `429` FloodWait |
| `POST /api/telegram/auth/password` | `{ "password": "…" }` | `{ verified, status }` | `400` bad body, `401` wrong step |
| `GET /api/telegram/groups` | — | `{ groups: [{ id, title, kind }] }` (`group` \| `supergroup`, sorted) | `401` not authorized |
| `GET /api/telegram/groups/:id/participants` | — | `{ groupId, participants: [{ telegramId, firstName, lastName, username, phone, isAdmin, isOwner }] }` | `401` not authorized, `404` unknown ID, `403` enumeration unavailable, `429` FloodWait + seconds |
| `POST /api/telegram/export` | `{ "groupId": "123456789", "excludeHiddenPhone?": boolean }` | `{ groupId, groupTitle, participantCount, filename, downloadUrl }` (no `filePath`; count reflects the filter) | `400` bad body, `401` not authorized, `404` unknown ID, `403` enumeration unavailable, `429` FloodWait |
| `GET /api/telegram/export/download` | — | CSV bytes (`text/csv`, attachment, RFC 5987 filename) | `404` no export yet / file gone |

Telegram IDs are opaque decimal strings (64-bit); `accessHash` never leaves
the server. Phone is `""` when hidden by privacy. Refused enumeration is a
`403` — never an empty list pretending success.

## Telegram CSV export (Phase 16)

Schema (frozen, in order): `TELEGRAM_ID;NOME;SOBRENOME;USERNAME;NUMERO;ADMIN;OWNER`
(`;` delimiter, UTF-8 + BOM, lowercase booleans, empty preserved, exact IDs,
Unicode preserved, no `@`/`+` added). Files land in
`output/<user-hash>/telegram/telegram-<sanitized-title>.csv` (user namespace
plus `telegram-` prefix, so neither same-titled cross-platform groups nor
other users' exports ever share a file). The browser flow is: authorized →
groups → select by ID → **Carregar participantes** → **Exportar CSV** →
**Baixar CSV** (`/api/telegram/export/download`, served from that user's
Telegram last-export slot — WhatsApp's slot is independent, and so is every
other user's). Downloads use
`filename="…ascii…"; filename*=UTF-8''…` so accented/emoji/CJK titles never
trigger ByteString header errors (same hardening applied to the WhatsApp
download route).

Connection status is explicit: `disconnected | connecting | qr |
connected | auth_failed`. The manager keeps a single client per process —
concurrent `connect()` calls share one initialization, and `exportGroup()`
never destroys the client.

## Troubleshooting

- `Missing group name.` → set `GROUP_NAME` in `.env` or pass `--group`.
- `Group "X" was not found.` → check exact name (case-sensitive, no fuzzy), ensure account is member.
- `Multiple WhatsApp groups named "X" were found.` → multiple groups share name; inspect listed IDs/participant counts; future `--group-id` will help.
- `Participant extraction failed: Group does not expose participants as expected.` → group has unexpected API shape; ensure group is still valid and client is `ready`.
- `Contact resolution warning: could not resolve <ID>` → per-contact, not fatal; check report `Contacts resolved/unresolved`.
- `Contact resolution failed: WhatsApp client is not available...` → fatal infrastructure failure; restart.
- `Export failed: ...` → the export pipeline failed outside group selection (extraction, resolution, or CSV filesystem error); ensure `output/` is writable and the path is not traversal.
- `CSV export failed: ...` → (legacy phase message) filesystem error (permission, disk); ensure `output/` writable and path not traversal.
- `WhatsApp authentication failed: ...` → delete `.wwebjs_auth/` and retry; check phone connectivity.
- `WhatsApp disconnected: ...` → restart; session reuse if still valid.
- Chromium launch failure → ensure Chrome/Chromium installed; project uses puppeteer with `--no-sandbox --disable-setuid-sandbox`.
- Hanging Chromium after Ctrl+C → fixed via graceful shutdown handlers (also on success/failure); verify with `ps aux | grep chromium`.

## Notes

- Phase 10 adds the Next.js web layer on top of the Phase 5 pipeline → CSV file. All previous phases remain intact; the domain (`src/whatsapp/*`, `src/export/*`) is unchanged.
- Tests use synthetic data only — no real WhatsApp IDs, LIDs, or phone numbers; API/UI tests mock the manager and `fetch` (no real WhatsApp, no network).
- Generated CSVs are gitignored (`output/*.csv`); only `output/.gitkeep` is tracked. No `output/*.csv` should be committed.
- See `roadmap.md` for phase status. Manual `getChats`/`group.participants`/`getContactById`/CSV integration requires a real authenticated WhatsApp account.
