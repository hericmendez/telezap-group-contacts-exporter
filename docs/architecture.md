# Architecture

## Overview

The application is a Next.js monolith (App Router, single project — no
separate Express/Fastify backend, no `frontend/`/`backend/` split):

```text
Browser (single page: status, QR, groups, export)
   │
   ▼
Next.js Route Handlers (Node runtime, serializable JSON only)
   │
   ▼
getWhatsAppManager() — one WhatsAppManager per Node process
   │
   ▼
WhatsAppManager (single live client, explicit connection status)
   │
   ▼
Configuration / Group Discovery / Participant Extraction /
Contact Resolution / Normalization / CSV Export
   │
   ▼
whatsapp-web.js → WhatsApp Web
```

There is no database. The CLI (`pnpm cli`, `src/cli.ts`) is kept as a thin
administrative/dev consumer of the same manager.

Phase 10 implements the web layer on top of the Phase 9 domain
(CLI → Manager → WhatsApp Client → Group Discovery → Participant
Extraction → Contact Resolution → CSV Export); all boxes are functional.

Telegram is fully implemented (Phases 14–16): independent `TelegramManager`
(teleproto MTProto user session) in `src/telegram/`, with its own routes
(`/api/telegram/*`), UI section, groups/participants domain, and CSV
export — see "Telegram Foundation", "Telegram groups & participants", and
"Telegram CSV export" below, plus `docs/telegram-architecture.md` and
`docs/telegram-authentication.md` (Phase 13 design history).

---

## Application authentication (M1)

Every `/api/*` route except login first passes `requireAppUser(request)`
(`src/auth/guard.ts`): cookie `telezap_session` → server-side session
store → `{ id, username }`, or `401` (`403` on Origin mismatch for
mutations). Users are admin-provisioned scrypt hashes in server-only
`TELEZAP_USERS`; sessions are opaque 64-hex tokens (7-day sliding TTL,
`HttpOnly`, `SameSite=Lax`, `Secure` in production). Login/logout/me live
under `/api/auth/*`; the UI gates on `/api/auth/me` and returns to login
on any 401.

M1 establishes identity only: both platform managers, sessions, export
slots, and output files remain process-global singletons shared by all
logged-in users. Per-user scoping is explicitly M2+ work — do not mistake
"logged in" for "isolated".

## Multi-user staging (M1 → M5)

Staged migration toward per-user isolation for a handful of trusted users
(single persistent host; no SaaS machinery):

* **M1 — request identity (done):** every route resolves `{ id, username }`
  via `requireAppUser()`; anonymous requests get 401.
* **M2 — per-user manager registries (done):** `getWhatsAppManager(userId)`
  / `getTelegramManager(userId)` (`src/lib/whatsapp.ts`,
  `src/lib/telegram.ts`, HMR-safe `Map` on `globalThis`); every platform
  route resolves the manager from the authenticated id. Managers and their
  lifecycles are unchanged.
* **M3 — WhatsApp physical session isolation (done):** each
  `WhatsAppManager` owns a `LocalAuth` scope derived from the authenticated
  user id — `.whatsapp_sessions/<sha256(userId)>` + distinct `clientId`
  (`src/whatsapp/client.ts`, verified against the installed library:
  unique `dataPath` isolates storage, `clientId` adds distinct client
  identity). The legacy `.wwebjs_auth` scope is preserved for the CLI and
  available via explicit opt-in migration (`pnpm whatsapp:migrate-session
  -- --user <id>`: copy + verify, source never deleted, idempotent).
  Concurrent live WhatsApp connections are now safe; the M2 WhatsApp slot
  guard was removed (Telegram keeps its own until M4).
* **M4 — Telegram physical session isolation (done):** each
  `TelegramManager` owns a session file derived from the authenticated user
  id — `.telegram_sessions/<sha256(userId)>/session` (`src/telegram/
  session.ts`, verified design: `StringSession` payload, 0600, server-side
  only). The legacy `.telegram_session` file is preserved for explicit
  opt-in migration (`pnpm telegram:migrate-session -- --user <id>`: copy +
  verify, source never deleted, idempotent). Concurrent live Telegram
  connections are now safe; the M2 Telegram slot guard was removed.
* **M5 — export/download isolation (done):** per-user in-memory slots
  (`Map<userId, …>` on `globalThis`, HMR-safe) plus per-user output
  directories (`output/<sha256(userId)>/<platform>/`, derived server-side
  from the authenticated id — never from request data). Managers resolve
  their own output dir from the stored `userId` (legacy no-user callers
  such as the CLI keep plain `output/`); routes only pass `auth.id` into
  the slot get/set. Download serves exactly the caller's slot entry.

**Remaining limitations (by design):** slots are process-local memory — a
restart invalidates download references (M6 owns persistence/cleanup).
Session storage is per-user on both platforms; only exports awaited M5,
which is now complete for isolation (not for restart recovery).

## Lifecycle & recovery (M6)

**Runtime model:** managers are created lazily per authenticated user on
first request (`getXManager(userId)`); nothing auto-connects on boot. A
restart starts with empty registries — sessions persist on disk and are
reused on the next connect, export slots do not survive.

**Shutdown:** one coordination point, `shutdownAllManagers()` in
`src/lib/lifecycle.ts`, destroys every WhatsApp and Telegram manager
(per-user errors collected, never blocking the rest). It is idempotent
(repeat calls are a single effective run) and registered exactly once per
process for SIGINT/SIGTERM via `src/instrumentation.ts` (guarded on
`globalThis`, so dev HMR cannot stack handlers). Handlers clean up only —
they never `process.exit` (the CLI keeps its own exit behavior) and never
touch session files: destroy ends the in-process instance, revocation stays
an explicit platform-auth operation.

**Late-callback safety:** `disconnect()` bumps a generation counter so
torn-down WhatsApp clients cannot resurrect state via late events, and
Telegram `disconnect()` aborts any in-flight login so its callbacks cannot
repopulate cleared state. Destroy is idempotent; destroying one user never
touches another's manager, session files, or export slot.

**Cleanup policy:** no automatic deletion. Failed exports may leave
partial CSVs unreferenced (the slot only registers on success); session
directories are never cleaned by lifecycle code; there is deliberately no
`rm -rf output` anywhere. Orphan-file retention is future work, not silent
behavior.

## Web Layer (Phase 10)

### Singleton

Route Handlers run at different times but must share one manager/client.
`src/lib/whatsapp.ts` exposes `getWhatsAppManager()`, cached on
`globalThis` so Next.js dev HMR (module re-evaluation) does not leak a
`Client` per reload. Production evaluates modules once per worker, so the
global is simply the single instance. Never `new WhatsAppManager()` inside
a handler. `__resetManagerForTests()` exists for test isolation only.

The singleton is created with `showQrInTerminal: false` — the server never
prints QR to the terminal; the UI renders the raw string from the manager.

### Routes

All WhatsApp/filesystem routes declare `runtime = "nodejs"` (never Edge —
Puppeteer/`LocalAuth`/fs require Node) and `dynamic = "force-dynamic"`.

| Route | Consumes | Returns |
|---|---|---|
| `GET /api/whatsapp/status` | `manager.getStatus()` | `{ status, number, qr, error }` |
| `POST /api/whatsapp/connect` | `manager.connect()` (fire-and-forget) | `{ started, status }` |
| `GET /api/whatsapp/qr` | `manager.getQRCode()` | `{ qr: string \| null }` |
| `GET /api/groups` | `manager.getGroups()` | `{ groups: GroupSummary[] }` |
| `POST /api/export` | `manager.exportGroupById(groupId)` | `ExportResult + downloadUrl` |
| `GET /api/export/download` | last-export store | CSV bytes (`text/csv`, attachment) |

`POST /api/whatsapp/connect` does not await the connection (a QR scan may
take minutes); the frontend tracks progress by polling status
(`connecting → qr → connected`). Error mapping: unknown/invalid group ID →
404, not connected → 409, missing/invalid body → 400.

### Deterministic selection (Phase 11)

Group name is presentation; group ID is the operation identity:

```text
GET /api/groups
        ↓
GroupSummary { id, name, participantCount }
        ↓
frontend selects id (radio keyed by id; duplicate names render as separate rows)
        ↓
POST /api/export { groupId }
        ↓
manager.exportGroupById(groupId) → fetchGroupSummaryById → shared pipeline
```

`fetchGroupSummaryById` (`src/whatsapp/group.ts`) resolves the chat via
`client.getChatById` with the ID passed through untouched (opaque — never
parsed or rebuilt) and rejects non-group chats and lookup failures with
`GroupNotFoundError` (→ 404), so no `whatsapp-web.js` internals leak.
`exportGroup(name)` (CLI) and `exportGroupById(id)` (web) share
`runExportPipeline` after the group is resolved — participants, contacts,
and CSV logic exist exactly once.

### CSV download

`POST /api/export` writes the file via the manager (format unchanged:
semicolon, UTF-8 + BOM, escaping) into the caller's per-user namespace
(`output/<user-hash>/whatsapp/…`, derived from `auth.id`) and registers it
in that user's in-memory last-export slot (`src/lib/last-export.ts`).
`GET /api/export/download` serves exactly that user's file bytes — never an
arbitrary path from `output/`, never another user's file — so no
file-server traversal risk.

### Frontend

`src/app/page.tsx` (client component, no business logic, no UI framework
beyond shadcn-style primitives in `src/components/ui/` + Tailwind v4
tokens) renders **TeleZap** branding, a theme toggle (light/dark/system via
`next-themes`, persisted, no hydration flash), and Radix Tabs
(**WhatsApp** / **Telegram**, `forceMount` so polling, selection, and
export state survive tab switches).

Each tab keeps fully independent state and polls only its own status
endpoint every 2s (no WebSocket). QR renders with `react-qr-code` (small,
dependency-free SVG renderer); the backend never generates images. Exports
are guarded (requires connection + selection, disables during run, spinner
via `loading` buttons) and show loading/success/error plus a download
link. Telegram adds a privacy notice, an opt-in hidden-phone filter (list,
counts, and CSV), and skeleton loading for participants. Status uses text
badges (never color alone); all controls are labeled and keyboard
accessible. See `docs/vercel.md` for the deployment audit (persistent host
required — not serverless-safe).

### Build notes

* `serverExternalPackages: ["whatsapp-web.js"]` — Puppeteer/`LocalAuth`
  (and optional `RemoteAuth` deps like `unzipper`'s `@aws-sdk/client-s3`)
  must be plain Node requires at runtime, never webpack-bundled.
* `experimental.extensionAlias: { ".js": [".ts", ".tsx", ".js", ".jsx"] }`
  — the domain uses TypeScript ESM-style `.js` import suffixes; this lets
  webpack resolve them without touching domain code.
* `pnpm dev` / `pnpm build` / `pnpm start` are the Next.js commands;
  `pnpm cli` runs the preserved admin CLI (`tsx src/cli.ts`).

---

## Domain pipeline (CLI view)

```text
CLI (`pnpm cli`)
 │
 ▼
WhatsAppManager (single live client, explicit connection status)
 │
 ▼
Configuration / Group Discovery / Participant Extraction /
Contact Resolution / Normalization / CSV Export
 │
 ▼
whatsapp-web.js → WhatsApp Web
```

There is no database. Both the web app and the CLI consume the same
`WhatsAppManager` without duplicating session or lifecycle logic:

```text
        ┌── Next.js web app (primary)
        │
        ├── CLI (admin/dev)
        │
        ▼
  WhatsAppManager
        │
        ▼
  whatsapp-web.js
```

Phase 5 implements the full pipeline (Manager → WhatsApp Client → Group Discovery → Participant Extraction → Contact Resolution → CSV Export); all boxes are functional.

---

## Telegram Foundation (Phase 14 — auth only, no groups/export)

Independent track next to WhatsApp — no shared abstractions:

```text
Browser (Telegram section: status → QR / phone → code → 2FA → user)
   │
   ▼
Next.js Route Handlers `/api/telegram/*` (Node runtime, serializable JSON only)
   │
   ▼
getTelegramManager() — one TelegramManager per Node process (globalThis)
   │
   ▼
TelegramManager (transport × login-step state, stepwise auth, session file)
   │
   ▼
teleproto TelegramClient (server-only) → Telegram MTProto (user session)
```

Key behaviors: `connect()` resumes `.telegram_session` (or stays logged
out); `startQrLogin()` publishes auto-refreshing `tg://login?token=…`
payloads and resolves on scan; `startPhoneLogin/submitCode/submitPassword`
drive the fallback with transient-only code/password; config failures land
on `status.error` (safe messages); `429` on FloodWait, `401` on wrong auth
step, `409` when the transport is down. Disconnect preserves the session
(no logout UI by design). Build note (verified): teleproto is pure JS and
bundles without `serverExternalPackages` — no `next.config` change was
needed, unlike `whatsapp-web.js`.

### Telegram groups & participants (Phase 15, auth required, no export)

```text
GET /api/telegram/groups → TelegramGroupSummary[] { id, title, kind }
        │   (dialogs classification; broadcast/gigagroup/monoforum/left/
        │    migrated/min excluded; sorted by title, then id)
        ▼
frontend selects id (duplicate titles stay separate rows)
        ▼
GET /api/telegram/groups/:id/participants → { groupId, participants[] }
        │   (supergroup: sequential Recent pages, limit 200, guarded;
        │    basic group: GetFullChat + collocated users; refused → 403)
        ▼
TelegramParticipant[] { telegramId, firstName, lastName, username,
  phone (often "" by privacy), isAdmin, isOwner } — IDs as strings, accessHash
  server-side only.
```

### Telegram CSV export (Phase 16, group ID only, no WhatsApp changes)

```text
POST /api/telegram/export { groupId }
        ↓  manager.exportGroupById: getGroupById → getParticipantsByGroupId
        ↓  exportTelegramCsv → output/<user-hash>/telegram/telegram-<title>.csv
        ↓  per-user Telegram last-export slot (WhatsApp slot untouched)
{ groupId, groupTitle, participantCount, filename, downloadUrl }
        ↓
GET /api/telegram/export/download → caller's bytes, RFC 5987 filename
```

Filenames reuse `sanitizeFilename` with a `telegram-` namespace (same-title
cross-platform collision impossible). Both download routes share
`contentDispositionAttachment` (`filename` ASCII fallback +
`filename*=UTF-8''…`) — this also fixed the WhatsApp route's latent
ByteString failure on accented names. Failures never emit empty CSVs and
never destroy the client.

---

## Components

### Configuration

Responsible for reading:

* target group
* output path
* optional runtime configuration

`src/config.ts` parses `.env` (via dotenv) and CLI flags (`--group`, `--output` / `--group=value`). CLI takes precedence.

* Phase 1: `GROUP_NAME` logged but not required.
* **Phase 2**: `GROUP_NAME` (or `--group`) is **required** — missing value exits 1 with `Missing group name. Set GROUP_NAME in .env or pass --group "My Group".` before WhatsApp initialization.

Validation (`validateConfig`) will be enforced from Phase 2 onward.

---

### WhatsApp Client

Implemented in `src/whatsapp/client.ts`, owned at runtime by `src/whatsapp/manager.ts`.

Responsible for:

* building the `whatsapp-web.js` client via `buildClient()` (`LocalAuth` with `dataPath: ".wwebjs_auth"`, persistent, gitignored)
* legacy `createClient()` listeners for standalone use (QR via `qrcode-terminal`, no disk write, no secret logging)
* lifecycle events: `qr`, `authenticated`, `ready`, `auth_failure`, `disconnected`
* clean shutdown via SIGINT/SIGTERM
* promise helper `waitForReady(client)` (resolves on `ready`, rejects on `auth_failure`)

Session configuration lives in `buildClient()` only — both the legacy
`createClient()` and the manager's default factory use it, so there is a
single place defining `LocalAuth`/Puppeteer options.

### WhatsAppManager

Implemented in `src/whatsapp/manager.ts`.

Owns **one live client per process** and keeps explicit connection state
from the real client events. It orchestrates the existing modules
(`group.ts`, `participants.ts`, `contacts.ts`, `export/csv.ts`) without
absorbing their logic.

```text
WhatsAppManager
      │
      ├── client (single instance, LocalAuth via buildClient)
      │
      ├── group.ts         (discovery)
      │
      ├── participants.ts  (extraction)
      │
      ├── contacts.ts      (resolution)
      │
      └── export/csv.ts    (CSV output)
```

#### Public API

```ts
connect(): Promise<void>        // initialize once; concurrent calls share it; resolves on ready
disconnect(): Promise<void>     // destroy once; idempotent; back to disconnected
getStatus(): WhatsAppStatus     // { status, number, qr, error } — plain values only
getQRCode(): string | null      // raw QR string from the `qr` event (frontend renders it)
getConnectedNumber(): string | null // client.info.wid.user when connected
getLastError(): string | null
getGroups(): Promise<GroupSummary[]>
exportGroup(name, { outputFile? }): Promise<ExportResult>
attachProcessShutdownHandlers(): void
```

`ExportResult` (`groupName`, `groupId`, `participantCount`, `resolvedCount`,
`unresolvedCount`, `outputPath`) is the structured answer a future HTTP
route can return directly.

#### Connection status

```ts
type WhatsAppConnectionStatus =
  | "disconnected"  // initial, after disconnect(), or after `disconnected`
  | "connecting"    // initialize() in flight (includes post-scan, pre-ready)
  | "qr"            // raw QR available via getQRCode()
  | "connected"     // `ready` fired — groups/export usable
  | "auth_failed";  // `auth_failure` fired — see getLastError()
```

`authenticated` alone does not mean ready: it clears the pending QR and
keeps `connecting` until `ready` flips the state to `connected`. The
connected number comes from the library-provided `client.info.wid.user`
— never from manual `@c.us` parsing.

#### QR handling

The manager captures the **raw QR string** on every `qr` event. Terminal
rendering via `qrcode-terminal` still happens when `showQrInTerminal` is
true (CLI default), but programmatic access never depends on it — the
future frontend renders the string itself, and the backend never converts
QR to an image. QR is cleared on `authenticated`/`ready`.

#### Concurrency

No mutex library: a single `connectPromise` plus the client reference
guards initialization. Concurrent `connect()` calls share one attempt;
`disconnect()` nulls the reference synchronously before awaiting destroy,
so repeats are no-ops. A stale client from a failed attempt is destroyed
before a retry creates a fresh one.

#### Lifecycle (Phase 5 via manager)

```text
loadConfig → validate GROUP_NAME → manager.connect()
  → wait for ready promise + client.initialize()
  │
  ├─ qr → store raw QR + status "qr" (+ terminal QR in CLI mode)
  ├─ authenticated → clear QR, "Authenticated.", stay "connecting"
  ├─ ready → clear QR/error → status "connected" → resolve connect()
  ├─ auth_failure → status "auth_failed", record error → reject connect()
  └─ disconnected → status "disconnected", record reason
      │              (client reference kept; next connect() replaces it)
      ▼
  exportGroup(name)
      │
      ├─ discoverGroupByName → GroupSummary (same errors as CLI had)
      ├─ fetchParticipantsByGroupId → GroupParticipantSummary[] (dedup)
      ├─ resolveParticipantsWithStats → contacts + resolved/unresolved
      ├─ exportCsv → output/<sanitized>.csv (or explicit outputFile)
      └─ return ExportResult — client REMAINS connected (no destroy)
```

#### CLI flow (Phase 5 via manager)

The CLI (`src/cli.ts`) is a thin consumer: `loadConfig` → `manager.connect()`
→ `manager.exportGroup()` → log the `ExportResult` → `manager.disconnect()`
→ exit. Phase details per step:

```text
Searching for group: <name>  (manager.exportGroup)
    │
      │
      ├─ client.getChats() → filter isGroup → map to GroupSummary
      ├─ findGroupByName(exact) → single → log "Group found..." + ID + Participants
      ├─ no match → "Group "X" was not found." → destroy → exit 1
      └─ multiple → "Multiple WhatsApp groups named "X" were found..." → destroy → exit 1
              │
              ▼
          Extracting participants...
              │
              ├─ client.getChatById(groupId) → group.participants (only source, no getChats again)
              ├─ participantToSummary: id._serialized (opaque, LID-safe) + isAdmin/isSuperAdmin
              ├─ deduplicateParticipants by whatsappId (first wins, order preserved)
              ├─ empty array valid (empty group)
              ├─ missing/not-array → "Group does not expose participants as expected." → destroy → exit 1
              └─ success → "Participants extracted: N"
                      │
                      ▼
                  Resolving contacts...
                      │
                      ├─ resolveParticipantsWithStats: getContactById(opaque) sequential, cache dedup, order preserved
                      ├─ per-contact failure → warn "could not resolve <ID>" + placeholder, continue
                      └─ success → "Contacts resolved: X" / "Contacts unresolved: Y"
                              │
                              ▼
                          Exporting CSV...
                              │
                              ├─ resolveOutputPath(groupName) → output/<sanitized>.csv (or OUTPUT_FILE override)
                              ├─ exportCsv(contacts, outputPath): ; delimiter, UTF-8+BOM, correct escaping for ; " \n \r, true/false, empty preserved, order preserved, unresolved exported, header-only for empty
                              ├─ mkdir output/ if missing, path safety (no traversal)
                              └─ success → "CSV exported: <path>" → return ExportResult (client stays alive)
```

`initialize()` failures are caught (`Failed to initialize WhatsApp client: ...`, recorded in `getLastError()`, status back to `disconnected`).

#### Graceful Shutdown

`WhatsAppManager.attachProcessShutdownHandlers()` (CLI wires it in `src/cli.ts`):

* registers at most once per manager (`shutdownHandlersAttached` flag + `process.once`)
* handles `SIGINT` / `SIGTERM`: logs `Shutdown requested (SIGINT)...`, calls `disconnect()` (`client.destroy()`), exits 0
* `disconnect()` is idempotent, logs `WhatsApp client destroyed.` or `Error while destroying client: ...`
* the CLI also calls `disconnect()` before every `process.exit` after success or failure, to avoid leaking Chromium.

The legacy `registerGracefulShutdown(client)` / `destroyClientGracefully(client)`
helpers remain in `src/whatsapp/client.ts` (covered by unit tests) but the
runtime path goes through the manager.

Pure helpers `formatAuthFailureMessage`, `formatDisconnectMessage`, `formatShutdownMessage` are testable without launching the browser.

#### Persistence

`LocalAuth` writes to `.wwebjs_auth/` (and Puppeteer cache to `.wwebjs_cache/`). Both are gitignored. Repeated runs reuse the session; QR is only required on first run or after `rm -rf .wwebjs_auth .wwebjs_cache`.

---

### Group Discovery

Implemented in `src/whatsapp/group.ts` (Phase 2).

Responsible for finding the target group by **exact name**.

Input:

```text
group name (GROUP_NAME / --group)
```

Output:

```text
GroupSummary { id, name, participantCount?, isGroup }
```

The implementation verifies that the selected chat is actually a group (`chat.isGroup === true` only).

Duplicate names are handled explicitly — never silently selected.

#### Internal Model

```ts
interface GroupSummary {
  id: string;              // opaque WhatsApp group id, e.g. "1203@g.us" — never parsed
  name: string;
  participantCount?: number; // from participants or groupMetadata.participants
  isGroup: boolean;
}
```

Only group chats are considered; `isGroup === false` chats are ignored (pure `findGroupByName` filters).

Future `--group-id` selection is prepared (opaque `id` preserved) but not yet implemented — name selection is required for Phase 2.

#### Pure Selection

`findGroupByName(groups, name)`:

* exact `===` matching, not fuzzy (`"My Group"` ≠ `"My Group 2026"` ≠ `"my group"`)
* 0 matches → `GroupNotFoundError: Group "X" was not found.`
* 1 match → returns `GroupSummary`
* 2+ matches → `AmbiguousGroupError: Multiple WhatsApp groups named "X" were found...` with enumerated list: `1. My Group — 42 participants — 123@g.us`

Testable without WhatsApp; covered by 16 tests in `src/whatsapp/group.test.ts`.

#### Mapping

`chatToGroupSummary(chat)` converts whatsapp-web.js `Chat`-like objects:

* `id`: extracts `_serialized` if present, else string, as opaque
* `participantCount`: prefers `chat.participants.length`, falls back to `chat.groupMetadata.participants`, else `undefined`
* never attempts to parse IDs.

#### Async Discovery

* `fetchGroupSummaries(client)` — `await client.getChats()` → filter `isGroup` → map via `chatToGroupSummary`
* `discoverGroupByName(client, name)` — fetch + `findGroupByName` (thin wrapper for CLI)
* `logGroupSummary(group)` helper for CLI logging

All `client.getChats()` calls happen **only after** `ready` (via `waitForReady`), never before authentication.

---

### Participant Extraction

Implemented in `src/whatsapp/participants.ts` (Phase 3).

Responsible for retrieving:

```ts
group.participants
```

It produces a normalized `GroupParticipantSummary { whatsappId, isAdmin, isSuperAdmin }` via pure mapping — does not inspect messages, does not call `getChats` again.

#### Internal Model

```ts
interface GroupParticipantSummary {
  whatsappId: string;  // opaque, from participant.id._serialized (e.g. 5519@c.us, 123@lid)
  isAdmin: boolean;
  isSuperAdmin: boolean;
}
```

No `name`/`number`/`pushname` — those belong to Phase 4. WhatsApp ID is never parsed.

#### Pure Mapping

* `participantToSummary(participant)` — extracts `_serialized` (fallback to string), copies `isAdmin`/`isSuperAdmin` (default `false`), never mutates source.
* `deduplicateParticipants(list)` — by `whatsappId` only (not name/flags), keeps first occurrence, preserves WhatsApp order (deterministic).
* `extractParticipants(group)` — validates `group.participants` is array (empty array valid), maps via `participantToSummary`, deduplicates; throws `Group does not expose participants as expected.` if missing/not-array (fail clearly, not empty-silent).
* `fetchParticipantsByGroupId(client, groupId)` — `await client.getChatById(groupId)` → `extractParticipants` (only `getChatById`, not `getChats`).

Type safety: `WhatsappParticipantLike` / `GroupChatLike` isolate whatsapp-web.js type gaps; no `any` spread.

Tested with 19 tests (`src/whatsapp/participants.test.ts`) covering normal, ID opacity, LID, missing flags, order, dedup, empty, mutation-safety.

#### Integration

After `discoverGroupByName`, CLI calls `fetchParticipantsByGroupId` and logs `Participants extracted: N` (no per-participant bulk logging, usable for 1000+ members). Errors destroy client and exit 1. No CSV yet.

---

### Contact Resolution

Implemented in `src/whatsapp/contacts.ts` (Phase 4).

Responsible for resolving each `GroupParticipantSummary` through:

```ts
client.getContactById(participant.whatsappId)
```

Never `getChats`, never message scraping, never inferring phone from ID, never converting `@lid` → `@c.us`.

#### Installed API Findings (`whatsapp-web.js@1.34.7`)

From `src/structures/Contact.js` + `index.d.ts`:

* `id: ContactId { server, user, _serialized }`
* `number: string` (= `data.userid`, phone; empty for LID)
* `name?: string` (saved by user, optional)
* `pushname: string` (public pushname, type required but runtime may be undefined)
* `shortName?: string` (redundant, not used)

Limitations: no separate phone field; LID `number` may be empty; `name`/`pushname`/`number` may be `undefined`/`null` at runtime. Decision: use `number`/`name`/`pushname`, normalize missing → `""`.

#### Internal Model

```ts
interface ResolvedContact {
  whatsappId: string; // opaque participant ID (preserved, not contact.id)
  name: string;       // contact.name || ""
  pushname: string;   // contact.pushname || ""
  number: string;     // contact.number || ""
  isAdmin: boolean;   // from participant
  isSuperAdmin: boolean;
}
```

Identity never derived from name/number; `@lid` stays `@lid` even if `number` exists.

#### Pure Mappers

* `toResolvedContact(participant, contact)` — preserves `whatsappId`, normalizes `name`/`pushname`/`number` to `""`, does not mutate.
* `resolveParticipant(client, participant)` — `getContactById(whatsappId)` exactly, success → mapped, individual failure (throw/null) → `logger.warn` + placeholder retaining admin flags, only fatal missing client/method propagates.
* `resolveParticipants(client, list)` — sequential (no concurrency framework) for Puppeteer safety, preserves order, defensive `Map` cache avoids duplicate `getContactById` calls for same `whatsappId` (keeps first, deterministic), never discards participant.
* `resolveParticipantsWithStats(client, list)` — same sequential logic but returns `{ contacts, resolvedCount, unresolvedCount }` for CLI summary (counts per input occurrence, so `dup` cached counts correctly).

Type safety: `ContactLike` isolates `Contact` gaps; no `any` spread; `whatsappId` treated as opaque.

Tested with 26 tests in `src/whatsapp/contacts.test.ts` covering mapping, LID, missing fields, failure handling, ordering, lookup behavior, fatal propagation, no mutation, no `getChats`.

#### Integration

After `fetchParticipantsByGroupId`:

```text
Resolving contacts...
Contacts resolved: 41
Contacts unresolved: 1
```

Concise (no per-contact flood for 1000+). Warnings per unresolved `Contact resolution warning: could not resolve <ID>` without stack. Client destroyed after success or failure. No CSV yet.

---

### Normalization

In this codebase normalization is the `GroupParticipantSummary → ResolvedContact` boundary (see Contact Resolution). It creates a WhatsApp-free representation for the exporter.

```ts
interface ResolvedContact {
  whatsappId: string;
  name: string;
  pushname: string;
  number: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}
```
`ExportedContact` in `src/export/types.ts` is an alias with identical shape for CSV-layer compatibility.

---

### CSV Export

Implemented in `src/export/csv.ts` (Phase 5).

Responsible only for converting normalized `ResolvedContact[]` into CSV — no WhatsApp dependency.

It does not know about:

* `whatsapp-web.js`
* `Client` / `GroupChat` / `getChats` / `getChatById` / `getContactById`
* QR / authentication / LIDs beyond treating `whatsappId` as string

Input:

```ts
ResolvedContact[]  // already normalized, via import
```

Output:

```text
output/<sanitized-group-name>.csv  // e.g. output/My Gaming Group.csv, or OUTPUT_FILE override
```

#### Stable Contract

Columns in order: `WHATSAPP_ID` (`whatsappId`), `NOME` (`name`), `NOME_WHATSAPP` (`pushname`), `NUMERO` (`number`), `ADMIN` (`isAdmin`), `SUPER_ADMIN` (`isSuperAdmin`). No extra columns. Booleans `true`/`false` lowercase. Empty `→ ""` (e.g. `123@lid;;;;false;false`). Order preserved. Unresolved contacts exported normally.

#### Encoding & Delimiter

* Delimiter `;` for Brazilian Excel/LibreOffice.
* UTF-8 with BOM `EF BB BF` at start (for Excel, preserves João, Márcia, Unicode).
* Correct escaping: `;`, `"`, `\n`, `\r`, combinations quoted with doubled `""` (e.g. `João; "O Rei"` → `"João; ""O Rei"""`).

#### Inspecting Existing Dependency

`csv-writer@1.6.0` was inspected: supports `;` and `"`/`\n` quoting via `DefaultFieldStringifier` but not standalone `\r` (needsQuote checks `;`, `\n`, `"` only). Decision: keep dependency installed but implement manual `escapeField` handling `\r` at smallest boundary, preserving correct behavior without adding another library. BOM is added manually as `csv-writer` does not handle it.

#### Filename Sanitization

`sanitizeFilename(groupName)`:

* trim; empty/whitespace/`"."`/`".."` → `whatsapp-group`
* replace invalid `\/:*?"<>|\x00-\x1F\x7F` with `_`, replace `..` with `_`, trim, truncate to 100 chars, preserve Unicode.
* Examples: `My/Group` → `My_Group`, `../escape` → `__escape`, `áéíóú ç ã` preserved, long → truncated, empty → fallback.

`resolveOutputPath(groupName, outputDir="output")` joins `outputDir` + `sanitizeFilename` + `.csv`, then `path.resolve` safety check ensures result stays inside `outputDir` (prevents traversal); fallback to `whatsapp-group.csv` if not.

#### Export API

```ts
exportCsv(contacts: ResolvedContact[], outputPath: string): Promise<void>
sanitizeFilename(groupName: string): string
resolveOutputPath(groupName: string, outputDir?: string): string
```

Exporter receives data + destination, does not discover data. CLI chooses filename (`OUTPUT_FILE` override if set to non-default, else sanitized group name), creates `output/` if missing (`mkdir -p`), writes BOM+header+rows (header-only for empty list), row count = contacts+header, no filtering of unresolved.

#### Integration

After `resolveParticipantsWithStats`, CLI builds `outputPath`, calls `exportCsv`, logs `CSV exported: <path>`, destroys client. Failures `CSV export failed: ...` → destroy → exit 1.

---

## Error Strategy

The application distinguishes between fatal and recoverable failures.

### Fatal (Phases 1-5)

Examples:

* browser/client initialization failure → `Failed to initialize WhatsApp client: ...` → exit 1
* WhatsApp authentication failure → `WhatsApp authentication failed: ...` → exit 1
* missing `GROUP_NAME` → `Missing group name...` → exit 1 (before init)
* group not found → `Group "X" was not found.` → destroy → exit 1
* ambiguous group → `Multiple WhatsApp groups named "X" were found...` → destroy → exit 1
* participant extraction: missing `group.participants` → `Group does not expose participants as expected.` → destroy → exit 1
* contact resolution: missing client → `WhatsApp client is not available for contact resolution.` → destroy → exit 1 (per-participant failures are *not* fatal → warn + placeholder)
* CSV export: filesystem failure → `CSV export failed: ...` → destroy → exit 1

These terminate with a non-zero exit code and attempt `manager.disconnect()` (`client.destroy()`) before exiting. `exportGroup()` itself never destroys the client — only the CLI (or a future API shutdown path) disconnects.

### Recoverable (Phase 4)

* individual `getContactById` failure → `Contact resolution warning: could not resolve <ID>` → placeholder retaining `whatsappId`/`isAdmin`/`isSuperAdmin`, continue batch; summary `Contacts resolved/unresolved`.

Future recoverable examples remain similar for later phases.

---

## Privacy Boundary

The application handles personal information.

Sensitive runtime data should never enter:

* Git
* source code
* logs unnecessarily
* automated tests

The following must be ignored:

```text
.env
.wwebjs_auth/
.wwebjs_cache/
output/*.csv
```

---

## Design Principle

The project should follow:

> Simple pipeline, explicit responsibilities, minimal abstraction.

If a feature can be implemented clearly in one small module, do not introduce a framework or abstraction layer for it.
