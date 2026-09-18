# Roadmap

## Phase 0 — Project Setup

Status: ✅ Complete (2026-09-13)

### Goals

Create the minimal Node.js + TypeScript project structure.

### Tasks

* [x] Initialize package.json
* [x] Configure TypeScript
* [x] Configure pnpm scripts
* [x] Add dotenv
* [x] Add whatsapp-web.js
* [x] Add CSV library (csv-writer)
* [x] Add qrcode-terminal, tsx, vitest
* [x] Configure `.gitignore`
* [x] Create `.env.example`
* [x] Create basic README
* [x] Create documentation structure
* [x] Create src/ skeleton (config, logger, whatsapp/client, whatsapp/group, export/*)

### Exit Criteria

* [x] Project installs successfully (`pnpm install`)
* [x] TypeScript compiles (`pnpm typecheck` / `pnpm build`)
* [x] Development command runs (`pnpm start`)

---

## Phase 1 — WhatsApp Client

Status: ✅ Complete — verified in Phases 9–12 (real connect, QR, `ready`, session reuse, graceful shutdown). The currently expired local session is an environment limitation, not unfinished work (2026-09-13)

### Goals

Create a reliable WhatsApp Web client with persistent authentication.

### Tasks

* [x] Create WhatsApp client module (`src/whatsapp/client.ts`)
* [x] Configure LocalAuth (`.wwebjs_auth`, gitignored)
* [x] Handle QR code (`qrcode-terminal`, no disk write)
* [x] Handle ready event (`WhatsApp client ready.`)
* [x] Handle authentication failure (`WhatsApp authentication failed: ...`, exit 1)
* [x] Handle disconnect (`WhatsApp disconnected: ...`)
* [x] Implement graceful shutdown (SIGINT/SIGTERM, idempotent, `client.destroy()`)
* [x] CLI integration (`src/index.ts` → initialize → wait for ready → remain alive)
* [x] Extract pure helpers for testing (`format*Message`, shutdown coordination)
* [x] Automated tests (vitest, no WhatsApp required)
* [x] Verify session persistence — verified with a real account in Phases 9–12 (connect → `ready` → second run reuses session without QR)

### Exit Criteria

The application can connect to WhatsApp Web and remain authenticated between executions.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (5 tests). **Manual verification completed** in later phases (see Phase 9): QR appears, scan succeeds, `ready` reached, Ctrl+C exits cleanly, second run reuses session without QR.

---

## Phase 2 — Group Discovery

Status: ✅ Complete (2026-09-13)

### Goals

Find a target WhatsApp group safely.

### Tasks

* [x] Retrieve available chats (`client.getChats()` only after `ready` via `waitForReady`)
* [x] Filter groups (`chat.isGroup === true` only)
* [x] Implement group-name selection (exact `===`, `findGroupByName`)
* [x] Handle group not found (`GroupNotFoundError: Group "X" was not found.`)
* [x] Handle duplicate group names (`AmbiguousGroupError` with enumerated IDs/participant counts)
* [x] Preserve group metadata (`GroupSummary { id, name, participantCount?, isGroup }`, opaque ID via `chatToGroupSummary`)
* [x] Integrate into CLI (`src/index.ts`: `Searching for group:` → `Group found:` → `Group ID:` → `Participants:` → destroy → exit)
* [x] Require `GROUP_NAME` / `--group` (missing → `Missing group name...` → exit 1)
* [x] Tests (16 group-selection tests, synthetic data only)
* [x] Documentation (README, architecture, usage)

### Exit Criteria

The application can deterministically select the intended group.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (21 tests). **Integration verification**: `WhatsApp ready → getChats() → findGroupByName` code path exercised via mocked client; real-WhatsApp `getChats` integration pending manual authentication (Phase 1 session persistence still pending). Not claimed as manually verified.

---

## Phase 3 — Participant Extraction

Status: ✅ Complete (2026-09-13)

### Goals

Retrieve all participants from the selected group.

### Tasks

* [x] Read `group.participants` (`fetchParticipantsByGroupId` via `client.getChatById`, not `getChats` again, no message scraping)
* [x] Extract participant WhatsApp IDs (`participant.id._serialized` opaque, LID-compatible)
* [x] Preserve opaque WhatsApp IDs (`participantToSummary` never parses)
* [x] Preserve admin status (`isAdmin`, default false)
* [x] Preserve super-admin status (`isSuperAdmin`, default false)
* [x] Deduplicate by WhatsApp ID (`deduplicateParticipants` by `whatsappId` only, preserves order, deterministic, 19 tests)
* [x] Integrate into CLI (`src/index.ts`: `Extracting participants...` → `Participants extracted: N` → destroy → exit)
* [x] Handle extraction errors (missing/not-array → `Group does not expose participants as expected.` → destroy → exit 1; empty array = valid)
* [x] Tests (19 participant tests synthetic, LID-safe, mutation-safe)

### Exit Criteria

The application produces a normalized participant collection without scraping messages.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (40 tests: 16 group + 5 client + 19 participants). **Integration verification**: `authenticated → ready → getChats → group.participants → participant extraction` exercised via mocked clients; real-WhatsApp `group.participants` integration pending manual authentication (Phase 1 session persistence still pending). Not claimed as manually verified.

---

## Phase 4 — Contact Resolution

Status: ✅ Complete (2026-09-13)

### Goals

Resolve participant IDs into contact information.

### Tasks

* [x] Inspect installed Contact API (`whatsapp-web.js@1.34.7`: `id._serialized`, `number` (=userid), `name?`, `pushname`, `shortName?`; limits documented)
* [x] Create `ResolvedContact` model (`src/whatsapp/contacts.ts`: `whatsappId, name, pushname, number, isAdmin, isSuperAdmin`)
* [x] Preserve WhatsApp ID (opaque, LID-safe, never replaced by number/shortName)
* [x] Preserve participant metadata (`isAdmin`/`isSuperAdmin` from participant)
* [x] Extract display name (`contact.name` → `name`, normalize `""`)
* [x] Extract WhatsApp/push name (`contact.pushname` → `pushname`, normalize `""`)
* [x] Extract phone number (`contact.number` → `number`, normalize `""`)
* [x] Handle unresolved contacts (placeholder with `""` fields, retains admin flags, not discarded)
* [x] Continue processing after individual failures (`warn: could not resolve <ID>`, batch sequential, deterministic)
* [x] LID-compatible lookup (`getContactById(opaqueId)` exactly, not `getChats`, not parsed)
* [x] Batch resolution (`resolveParticipantsWithStats` sequential, cache avoids duplicate lookups, order preserved)
* [x] CLI integration (`src/index.ts`: `Resolving contacts...` → `Contacts resolved/unresolved:` → destroy)
* [x] Tests (26 contact tests, synthetic, no mutation, no `getChats`)
* [x] Documentation (README, architecture, usage)

### Exit Criteria

The application can produce a normalized contact collection even when some participants cannot be fully resolved.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (67 tests: 16 group + 20 participants + 26 contacts + 5 client; plus `resolveParticipantsWithStats` stats). **Integration verification**: `authenticated → ready → getChats → group.participants → getContactById` exercised via mocked clients (opaque LID, missing fields, failures, dedup, no `getChats`); real `getContactById` over real WhatsApp pending manual authentication (Phase 1 persistence still pending). Not claimed as manually verified.

---

## Phase 5 — CSV Export

Status: ✅ Complete (2026-09-13)

### Goals

Generate a reliable Excel-friendly CSV.

### Tasks

* [x] Inspect existing dependency (`csv-writer@1.6.0`; handles `;`/`"`/`\n` but not standalone `\r` — handled manually)
* [x] Evolve `src/export/csv.ts` (not duplicate) — manual `escapeField` for `;`/`"`/`\n`/`\r`, BOM, directory creation, path safety
* [x] Define export model (import `ResolvedContact` from canonical, no duplication, exporter has no WhatsApp dep)
* [x] Define CSV headers exactly `WHATSAPP_ID,NOME,NOME_WHATSAPP,NUMERO,ADMIN,SUPER_ADMIN` in order
* [x] Implement UTF-8 output (BOM `EF BB BF` at start, `Buffer.from(...,"utf8")`)
* [x] Use semicolon delimiter (`;` for Brazilian Excel)
* [x] Correctly escape fields (`;`, `"`, `\n`, `\r`, combinations quoted with `""`)
* [x] Boolean lowercase `true`/`false`, empty `""` preserved, header-only for empty list, unresolved exported, order preserved
* [x] Create output directory when necessary (`mkdir -p` for `output/`)
* [x] Generate deterministic safe filename (`sanitizeFilename` + `resolveOutputPath`, handles `/\*?"<>|`, `..`, empty, Unicode, long truncation, traversal prevention via `path.resolve`)
* [x] Report export statistics (`Exporting CSV...` → `CSV exported: output/<sanitized>.csv`, failure → `CSV export failed: ...` → destroy → exit 1)
* [x] CLI integration (`src/index.ts`: after `resolveParticipantsWithStats` → build output path (`OUTPUT_FILE` override if non-default else sanitized group) → `exportCsv` → report → destroy)
* [x] Tests (31 CSV tests: headers/order/delimiter, rows, empty header-only, booleans, empty, LID, BOM, accented/Unicode, escaping `;`/`"`/`\n`/`\r`, filesystem dir/file/filename/traversal/fallback/long/Unicode, data integrity row count/unresolved/admin/order)
* [x] Documentation (README, architecture, usage)

### Exit Criteria

A generated CSV can be opened in Excel/LibreOffice without corrupted characters or malformed fields.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (98 tests: 16 group + 20 participants + 26 contacts + 5 client + 31 CSV). **Integration verification**: CSV exporter exercised via synthetic `ResolvedContact[]` and temp files (BOM, escaping, sanitization, traversal safety); real WhatsApp → CSV end-to-end pending manual authentication (Phase 1 persistence still pending). Not claimed as manually verified.

---

## Phase 6 — CLI and Configuration

Status: ✅ Superseded — substantive goals completed via Phase 9 (thin CLI consumer of `WhatsAppManager`, `pnpm cli -- --group/--output`, documented commands and error messages). Kept as history; not a standalone phase.

### Goals

Make the tool convenient to use.

### Tasks

* [ ] Support target group configuration
* [ ] Support output path configuration
* [ ] Add useful CLI output
* [ ] Document commands
* [ ] Add clear error messages

### Exit Criteria

A user can perform an export without modifying source code.

---

## Phase 7 — Tests and Hardening

Status: ✅ Superseded — covered and exceeded by the per-phase suites (296 tests: selection, ambiguity, normalization, duplicate IDs, CSV escaping/output, config, failed resolution, typecheck, full suite green). Kept as history; not a standalone phase.

### Goals

Verify application logic independently from WhatsApp Web.

### Tasks

* [ ] Test group selection
* [ ] Test ambiguous groups
* [ ] Test participant normalization
* [ ] Test duplicate IDs
* [ ] Test CSV escaping
* [ ] Test CSV output
* [ ] Test configuration
* [ ] Test failed contact resolution
* [ ] Run typecheck
* [ ] Run full test suite

### Exit Criteria

All automated tests pass and the application has no known basic correctness issues.

---

## Phase 8 — Manual Integration Verification

Status: ✅ Superseded — real-world workflow verified repeatedly (Phase 9 end-to-end export, Phases 10–12 browser/API/lifecycle validation, Phase 16.5 acceptance). Kept as history; not a standalone phase.

### Goals

Verify the complete real-world workflow.

### Tasks

* [ ] Authenticate with a real WhatsApp account
* [ ] Select a real group
* [ ] Export participants
* [ ] Inspect CSV
* [ ] Verify participant count
* [ ] Verify names/numbers where available
* [ ] Verify admin flags
* [ ] Verify WhatsApp IDs
* [ ] Verify session persistence
* [ ] Verify graceful shutdown

### Exit Criteria

A complete real-world export succeeds.

---

## Phase 9 — Web Backend Preparation (WhatsAppManager)

Status: ✅ Complete (2026-09-17)

### Goals

Extract persistent WhatsApp lifecycle management into a reusable service so
the project can later serve a web frontend, without implementing any HTTP
server, frontend, or new feature yet.

### Tasks

* [x] Create `WhatsAppManager` (`src/whatsapp/manager.ts`) owning a single live client
* [x] Explicit connection status (`disconnected | connecting | qr | connected | auth_failed`)
* [x] Programmatic status/QR/number access (`getStatus`, `getQRCode`, `getConnectedNumber`) with plain values only
* [x] Raw QR capture (terminal QR stays for CLI via `showQrInTerminal`, never required for programmatic use)
* [x] Connected number from library-provided `client.info.wid.user` (no manual ID parsing)
* [x] Keep `LocalAuth` session persistence (`.wwebjs_auth`, no auto-logout)
* [x] Guard against duplicate clients (shared `connectPromise`, idempotent `disconnect`)
* [x] Orchestrate existing `group`/`participants`/`contacts`/`csv` modules without absorbing them
* [x] `exportGroup()` runs the full pipeline, returns structured `ExportResult`, keeps the client alive
* [x] CLI refactored as a thin manager consumer (`src/cli.ts`, kept in Phase 10)
* [x] No HTTP server, no frontend, no Telegram, no database, no new export formats
* [x] Manager unit tests (23 tests, mocked client, no WhatsApp/network/session)
* [x] Documentation (architecture, usage, roadmap, README)

### Exit Criteria

A future HTTP API can consume `WhatsAppManager` alongside the CLI.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (121 tests: 98 existing + 23 manager). **Real verification** (existing session, no QR needed): CLI export `Fazendinha` → 2/2 resolved → `output/Fazendinha.csv` → exit 0 ✅; manager script → status `connected` + number `5516993038349` → 36 groups listed → structured export result → client stayed `connected` after export → `SIGINT` → `Shutdown requested (SIGINT)...` → clean exit, no Chromium leftovers ✅.

---

## Phase 10 — Next.js Monolith

Status: ✅ Complete (2026-09-17)

### Goals

Serve the exporter as a single-project Next.js full-stack app (App Router
page + Route Handlers + `WhatsAppManager`), reusing the Phase 9 domain
untouched. No separate Express/Fastify backend, no second frontend project.

### Tasks

* [x] Next.js 15 + React 19 + TypeScript (App Router, `src/app/`)
* [x] Singleton `WhatsAppManager` (`src/lib/whatsapp.ts`, `globalThis` so dev HMR leaks no clients)
* [x] Node runtime (`runtime = "nodejs"`, `force-dynamic`) on all WhatsApp/filesystem routes
* [x] Status endpoint (`GET /api/whatsapp/status` → serializable snapshot)
* [x] Connect endpoint (`POST /api/whatsapp/connect`, fire-and-forget, no duplicate attempts)
* [x] QR endpoint (`GET /api/whatsapp/qr` → raw string, no backend images)
* [x] Groups endpoint (`GET /api/groups` → serializable list)
* [x] Export endpoint (`POST /api/export` → `ExportResult + downloadUrl`, mapped 400/404/409)
* [x] Controlled CSV download (`GET /api/export/download`, last-export store, no generic file server)
* [x] Single-page frontend (connection status, number, QR via `react-qr-code`, group radio list, guarded export, 2s polling, no WebSocket)
* [x] Domain untouched (`src/whatsapp/*`, `src/export/*` — only `client.ts` gained the pre-existing `buildClient()` from Phase 9)
* [x] CLI preserved as admin tool (`src/index.ts` → `src/cli.ts`, `pnpm cli`)
* [x] `whatsapp-web.js` external at runtime (`serverExternalPackages`) + `.js`→`.ts` alias (`experimental.extensionAlias`); patch intact
* [x] Tests: singleton (2), API routes (13), UI page (6) — all mocked, no WhatsApp/network
* [x] Documentation (AGENTS, README, architecture, usage, roadmap)

### Exit Criteria

The project runs as one `pnpm dev` / `pnpm build` / `pnpm start` app.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅ (all routes dynamic ƒ, page static ○), `pnpm test` ✅ (144 tests: 121 existing + 23 new). **Real verification** (existing session, no QR, no `.wwebjs_auth` deletion): `pnpm start` → `POST /connect` → `connected` + number `5516993038349` → 36 groups incl. `Fazendinha` → `POST /api/export` → 2/2 resolved → download route returned BOM-prefixed CSV with `text/csv` + attachment headers → still `connected` after export → 404/400 paths verified → SIGINT → clean exit, no orphan Chromium ✅. `pnpm dev` status check ✅. `pnpm cli -- --group "Fazendinha"` → exit 0 ✅.

---

## Phase 11 — Deterministic Group Selection

Status: ✅ Complete (2026-09-17)

### Goals

> Use the WhatsApp group ID as the identity for web selection and export, eliminating ambiguity caused by duplicate group names.

Name stays presentation-only; the opaque ID (`120363...@g.us`, never parsed) drives the operation.

### Tasks

* [x] `fetchGroupSummaryById` (`src/whatsapp/group.ts`): `getChatById` with the ID untouched, reject non-groups/unknown IDs with `GroupNotFoundError` (→ 404, no internals leak)
* [x] `manager.exportGroupById(groupId, options?)`: same `ExportResult`, client stays connected
* [x] Shared `runExportPipeline` — `exportGroup(name)` (CLI) and `exportGroupById(id)` (web) resolve the group differently, then run one pipeline (no duplicated participants/contacts/CSV logic)
* [x] `POST /api/export` contract is now `{ "groupId" }` only (no `groupName` compat shim; old body → 400)
* [x] Frontend sends `{ groupId: selected.id }`; radios already keyed by ID; IDs never displayed
* [x] CLI unchanged (exact-name + ambiguity behavior preserved)
* [x] Tests: `group.test.ts` (+4 by-ID: valid, lookup failure, non-group, empty), `manager.test.ts` (+5 by-ID: valid+intact, unknown, non-group, empty, disconnected), API route (updated to `groupId`: valid, missing/empty 400, unknown/non-group 404, disconnected 409), UI page (export asserts `groupId` body + duplicate-name test selecting the 2nd `Fazendinha` by ID)
* [x] Documentation (README, architecture, usage, roadmap)

### Exit Criteria

Duplicate-named groups are individually selectable and exportable via the web UI.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (155 tests: 144 existing + 11 new). **Real verification** (existing session): `pnpm start` → connected → `POST /api/export { groupId: "120363423663114428@g.us" }` → 2/2 resolved → download 200 → still connected → `{ groupName }` body → 400, unknown ID → 404 → SIGINT clean exit, no orphan Chromium ✅. `pnpm cli -- --group "Fazendinha"` → exit 0 ✅ (no real duplicate-name group available; covered by automated tests instead of touching real data).

---

## Phase 12 — Real-World Web UX Validation & Hardening

Status: ✅ Complete (2026-09-17)

Deliberately not a feature phase: validate the app as a user would use it,
fix only demonstrated problems, no refactors, no Telegram.

### Real browser validation (Playwright + system Chromium vs `pnpm start`)

* Initial state: disconnected UI, Conectar button, gated groups, disabled export ✅
* Cold-start connect reuses `LocalAuth` (no QR), `connecting` shown, then `connected` ✅
* Number `5516993038349` displayed and equal to `GET /api/whatsapp/status` ✅
* 36 groups listed, no raw `@g.us` IDs in the UI ✅
* Select → export enabled → loading → success; `POST /api/export` body is `{ "groupId": "120363423663114428@g.us" }` ✅
* Download `Fazendinha.csv`: BOM + `WHATSAPP_ID;...` headers + 2 rows ✅
* Repeat export in the same process + 2nd download (latest file) ✅, still `connected` ✅
* Refresh reconstructs connected state from the server (no 2nd client) ✅
* API errors: `{}` → 400, `{groupId:""}` → 400, unknown ID → 404 with `Group "000@g.us" was not found.` (no internals), export-while-disconnected → 409, download-without-export → 404 ✅
* Polling: 3 status polls / 6.5s, no overlaps/failures; no page errors ✅
* Lifecycle: SIGINT → clean exit, no orphan Chromium (verified 3×); restart reuses session, exactly one `ready` per process ✅

### Bugs found (1)

* **Missing favicon** — every page load logged `Failed to load resource: 404` (`/favicon.ico`).
  Fix: dependency-free `public/favicon.ico` (16×16 ICO generated once, committed).
  Note: `src/app/icon.svg` was tried first but Next 15's metadata loader fails on it
  when the project path contains an apostrophe — `public/` avoids that loader.
  Regression test: `src/app/favicon.test.ts` (ICO header assertions).

### Not reproduced (documented, untouched)

* `qr` / `auth_failed` live flows — the existing session is valid; corrupting it
  just to manufacture these states was out of scope. Covered by manager unit
  tests + UI mocked tests (QR branch, auth-failed retry button).
* Live duplicate group names — none exist in the account (36 unique names);
  covered by automated UI test (two `Fazendinha` rows, selection by ID).

### Known non-issues (observed, kept as-is)

* Polling has no in-flight guard, but no overlap was observed (local 2s cadence, fast endpoint); out-of-order snapshots are idempotent full-state replacements. No change per conservative rule.
* The success panel always describes the *last* export (not the current selection) — coherent with the download link, which also serves the last export. No change.
* Errors intentionally triggered during validation (`400`/`404`) appear in the browser console as failed-resource entries; the UI itself shows clean contextual messages. No change.

### Verification

`pnpm typecheck` ✅, `pnpm build` ✅ (page static ○, routes dynamic ƒ), `pnpm test` ✅ (156 tests: 155 + 1 favicon regression). `pnpm install` reapplies the patch ✅.

---

## Phase 13 — Telegram Integration Architecture & Authentication Design

Status: ✅ Complete (2026-09-17)

Research/design only — **no Telegram production code added, no dependency
installed, WhatsApp behavior unchanged.** Key outcomes:

* Technology: **`teleproto`** (npm, MIT, TS, pure JS), not archived GramJS
  (`telegram@2.26.22` deprecated) — actively maintained, GramJS-compatible
  (`TelegramClient`, `StringSession`, typed `client.api.*`).
* User MTProto authorization (never a bot token); QR as primary UI flow
  (~30s token auto-refresh over existing polling), phone+code fallback,
  2FA via `account.getPassword` → `auth.checkPassword` (password transient).
* Session: `StringSession` in gitignored local file `.telegram_session`
  (`0600`); credentials/session/codes/passwords never reach browser/logs/git.
* States: transport (`disconnected|connecting|connected`) × login step
  (`none|qr_pending|awaiting_phone|awaiting_code|awaiting_password`);
  `authorized` (not transport) gates operations.
* Dedicated `TelegramManager` (`globalThis.__telegramManager`), independent
  from `WhatsAppManager`; no premature `MessagingPlatform` abstractions.
* Scope: groups (via `messages.getFullChat`) + supergroups (via
  `channels.getParticipants`, Recent filter as ordinary member, offset/limit
  pagination, `hash: 0`); channels/monoforums/bots excluded initially.
* IDs opaque decimal strings (64-bit); `accessHash` server-side only.
* Phone numbers optional by privacy design; missing → `""` convention.
* `FLOOD_WAIT` honored, sequential enumeration, no retry framework yet.
* CSV: separate honest Telegram headers reusing current mechanics (Phase 14);
  current WhatsApp format untouched.

Deliverables: `docs/telegram-architecture.md` (incl. Phase 14 plan),
`docs/telegram-authentication.md`.

**Automated verification**: `pnpm typecheck` ✅, `pnpm build` ✅, `pnpm test` ✅ (156 tests, unchanged).

---

## Phase 14 — Telegram Foundation & Authentication

Status: ✅ Complete (2026-09-17)

Auth lifecycle only — no groups, participants, contacts, or Telegram export
(explicitly out of scope and not implemented).

### Implemented

* [x] `teleproto@1.229.0` (`^1`, MIT, TS builtin, pure JS — archived GramJS rejected per Phase 13)
* [x] Server-only `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` (`.env.example`, no `NEXT_PUBLIC_`)
* [x] `.telegram_session` file (`0600`, gitignored, never logged/returned/tested)
* [x] `src/telegram/` domain: `config.ts`, `session.ts`, `client.ts` (sole `TelegramClient` factory), `manager.ts`
* [x] `TelegramManager` independent from `WhatsAppManager` (no shared abstractions): `connect/disconnect`, `getStatus/getQRCode/getConnectedUser`, `startQrLogin/cancelLogin` (abortable, auto-refresh server-side), `startPhoneLogin/submitCode/submitPassword` (transient-only secrets), session persist/rotate/revoke-handling
* [x] Transport × login-step state model; safe serializable status; FloodWait seconds surfaced; `401` wrong step / `409` transport down / `429` rate-limit
* [x] `src/lib/telegram.ts` singleton (`globalThis.__telegramManager`) + test reset
* [x] 8 routes: `status`, `connect`, `qr`, `qr/start`, `qr/cancel`, `auth/phone|code|password` (Node runtime, validated bodies, mapped errors)
* [x] Minimal Telegram UI section (status → QR/phone → code → 2FA → user; own state, WhatsApp untouched, no logout UI by design)
* [x] No `next.config` change needed (teleproto bundles cleanly — verified)
* [x] Fixed during validation: fire-and-forget config failures now land on `status.error`; `qr/start` returns `409` when transport is down (both with regression tests)

### Verification

`pnpm typecheck` ✅, `pnpm build` ✅ (8 Telegram routes dynamic ƒ), `pnpm test` ✅ (210 tests: 156 baseline + 54 new). Production (`pnpm start`): Telegram routes answer safely without config (missing-ID error on status, `409`/`400` paths), page renders both sections, no console/page errors, WhatsApp untouched, clean shutdown with no orphan processes and no session file created by tests/validation.

### Limitations (actual)

* No real Telegram login performed: no `TELEGRAM_API_ID`/`TELEGRAM_API_HASH` in the environment, and secrets must never be pasted into chat — auth flows validated via mocked tests only. Providing credentials in local `.env` unlocks live QR/phone validation later without code changes.
* QR auto-refresh relies on the library token loop (per official QR-login docs); live refresh timing unvalidated until a real scan.

---

## Phase 15 — Telegram Groups & Participants

Status: ✅ Complete (2026-09-17)

Groups + participants only. No CSV/export/download/UI-export (explicitly
Phase 16). WhatsApp untouched (no source changes in `src/whatsapp/*`).

### Implemented

* [x] Installed APIs inspected, not assumed (`Api.channels.GetParticipants`,
  `Api.messages.GetFullChat`, `Api.Chat`/`Api.Channel`/`Api.User`,
  `ChannelParticipant*`/`ChatParticipant*` variants, typed RPC errors)
* [x] `src/telegram/group.ts`: `TelegramGroupSummary { id, title, kind }`
  (opaque string ids), `entityToGroupRecord` (flags-based: Chat vs
  megagroup-Channel; broadcast/gigagroup/monoforum/left/deactivated/
  migrated/`min`/User excluded), deterministic sort (title, then id),
  `fetchGroups`/`fetchGroupRecordById` via `getDialogs` (no brute force;
  entity+accessHash stays in the server-side record)
* [x] `src/telegram/participants.ts`: `TelegramParticipant` (missing → `""`,
  bots/deleted/userEmpty kept as rows), role mapping from constructor info
  (Creator→owner+admin, Admin→admin), sequential Recent pagination
  (limit 200, `hash: bigInt(0)`), non-advance + 500-page termination guards,
  dedupe by `telegramId`, basic groups via `GetFullChat` (+ its `users`
  vector, no per-member lookup), Forbidden → typed unavailable error
* [x] FloodWait: fail fast as `TelegramFloodError { seconds }` (single call,
  no retry) → HTTP 429 with duration; membership errors → 403/404 domain
  errors, never fake empty lists
* [x] Manager: `getGroups/getGroupById/getParticipantsByGroupId` (auth gate
  → 401, plain serializable returns, server-side entity cache cleared on
  disconnect), Phase 14 auth untouched
* [x] Routes: `GET /api/telegram/groups`, `GET
  /api/telegram/groups/[id]/participants` (Node runtime, `{ groupId,
  participants }`, no accessHash/session/internals)
* [x] Minimal UI: Telegram groups list (radio by id, duplicate titles
  separate), "Carregar participantes" → count + labeled list (role marks),
  errors shown; no CSV buttons, no WhatsApp changes
* [x] New dep `big-integer@^1.6` (+types): exact 64-bit `hash`/IDs, already
  in the tree via teleproto

### Verification

`pnpm typecheck` ✅, `pnpm build` ✅ (new routes dynamic ƒ), `pnpm test` ✅
(254 tests: 210 baseline + 44 new). Production (`pnpm start`): new routes
answer 401 while logged out, WhatsApp status untouched, no session files
created, clean shutdown without orphans.

### Real validation — limitation (actual, not simulated)

* Telegram: no credentials/session in the environment (same as Phase 14) —
  live enumeration validated via mocked tests only.
* WhatsApp regression blocked: the previously working `.wwebjs_auth`
  session no longer authenticates (server shows QR on CLI start; directory
  intact, untouched by Phase 15 code which never references it). Requires a
  fresh QR scan by the account owner — out of scope to manufacture. Unit
  suite (98 WhatsApp tests) fully green; no WhatsApp source changed.

---

## Phase 16 — Telegram CSV Export & Web UI

Status: ✅ Complete (2026-09-17)

Auth (14) + groups/participants (15) extended to a full export workflow.
WhatsApp untouched except one explicitly sanctioned shared download-header
fix (see below). No unrelated features.

### Implemented

* [x] Frozen schema `TELEGRAM_ID;NOME;SOBRENOME;USERNAME;NUMERO;ADMIN;OWNER`
  (`;`, UTF-8+BOM, lowercase booleans, empty preserved, no `@`/`+` added)
* [x] `src/export/telegram-csv.ts` (Next/teleproto/manager-free; reuses
  shared `sanitizeFilename`, own `telegram-` namespace + traversal guard so
  WA/TG same-title exports never share a file; WA `csv.ts` untouched)
* [x] `TelegramManager.exportGroupById` (reuses lookup+enumeration, client
  stays connected, failures never emit empty CSV; routes strip `filePath`)
* [x] Separate `src/lib/telegram-export.ts` slot (WA slot isolated; second
  export replaces; failed exports not registered)
* [x] `POST /api/telegram/export {groupId}` (400/401/403/404/429/500 mapped,
  groupName-only rejected, metadata without `filePath`) + `GET
  /api/telegram/export/download` (slot-only, 404/200)
* [x] RFC 5987 Content-Disposition (`filename` ASCII fallback +
  `filename*=UTF-8''…`) in shared `src/lib/download-headers.ts`, applied to
  BOTH download routes — the WhatsApp route had the same latent ByteString
  bug for accented names (new regression test with `Família Silva ❤️.csv`)
* [x] UI: participants → Exportar CSV (guarded, by ID) → success + Baixar
  CSV; errors shown; no CSV buttons before auth; WA states independent
* [x] Unicode matrix tested: `Fazendinha`, `Minha Família`, `Família ❤️`,
  `日本語`, `Grupo 😀` (200s, BOM, headers, decodable `filename*`)

### Verification

`pnpm typecheck` ✅, `pnpm build` ✅ (new routes dynamic ƒ), `pnpm test` ✅
(296 tests: 254 baseline + 42 new). Production (`pnpm start`): export 401
logged out / 400 name-only / 404 no-download; browser shows Telegram
section cleanly with zero console/page errors; WhatsApp intact; clean
shutdown, no orphans, no session files created.

### Real validation — limitations (actual, not simulated)

* No Telegram credentials/session in the environment → live auth/enumerate/
  export covered by mocked tests only (same standing limitation as Phases
  14–15; local `.env` credentials would unlock it with no code changes).
* WhatsApp live regression blocked: `.wwebjs_auth` no longer authenticates
  (CLI now shows QR; directory intact, Phase 16 never references it) —
  requires a fresh owner scan. All 98 WhatsApp unit tests green.

---

## Phase 16.5 — Real-World Acceptance Testing

Status: ✅ Complete (2026-09-17) — validation only, **zero code changes**
(no defect found; a clean validation with no changes is the valid outcome).

### Executed (production `pnpm start` + Playwright/Chromium)

* Fresh start with expired `.wwebjs_auth`: `disconnected`, no crash, no
  leaks; `POST /connect` → `connecting` → `qr`; QR string on both
  `/api/whatsapp/status` and `/api/whatsapp/qr`; UI renders hint + QR SVG;
  duplicate connect refused (`started: false`); groups stay gated; Telegram
  section independent; refresh preserves QR state with one client; zero
  console/page errors (9/9 browser checks).
* Logged-out contracts: Telegram groups/participants → 401, export → 401,
  name-only export → 400, download-without-export → 404, all without
  internals.
* Lifecycle: SIGINT → port freed, **no headless-Chromium orphans** even with
  an active QR session (verified after killing the real server PID).
* Hygiene finding (tooling, not app): background servers must be stopped by
  real PID (`ss -tlnp`), not via `$!` subshell PID files — a stale server
  caused one false reading during this phase; environment left fully clean
  (no node/chromium leftovers).

### Not available (environment, not implementation)

* WhatsApp QR scan / groups / participants / export / download / Unicode
  live: expired session needs an owner scan.
* All Telegram live flows (auth, groups, participants, export, FloodWait,
  large groups, duplicates): no credentials/session in the environment.
* Covered instead by: 296 automated tests (incl. Unicode filename matrix,
  duplicate-name selection, FloodWait/403/404 mappings, slot isolation),
  plus real exports from earlier phases (incl. emoji CSVs in `output/`).

### Verification

`pnpm typecheck` ✅, `pnpm build` ✅ (page static ○, routes dynamic ƒ),
`pnpm test` ✅ (35 files, 296 tests — unchanged). `.gitignore` verified
(`.env`, `.wwebjs_auth/`, `.telegram_session`, `output/*.csv`); no real
data committed; no secrets requested or logged.

---

# Future Ideas

These are NOT part of the implemented phases.

* [x] HTTP API (done in Phase 10 — Next.js Route Handlers on `WhatsAppManager`)
* [x] Web frontend consuming the HTTP API (done in Phase 10 — single page)
* [x] Telegram support (designed Phase 13 with GramJS evaluated → `teleproto` selected; implemented Phases 14–16: auth, groups, participants, CSV export/download, UI)
* [ ] Export JSON
* [ ] Export XLSX
* [x] Select group by WhatsApp group ID (done in Phase 11 — ID is the web export identity)
* [ ] Compare two exports
* [ ] Detect newly added/removed participants
* [ ] Optional CRM integration
* [ ] Scheduled exports
* [ ] Multiple output formats
* [ ] Contact filtering
* [ ] Manual group-list refresh in the UI (list currently reloads on connect transitions only; observed in Phase 12, not a bug)

Future features must not complicate the initial implementation unnecessarily.
