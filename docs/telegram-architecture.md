# Telegram Integration Architecture (Phase 13 design; executed in Phases 14–16)

> Note (closure): this document was the Phase 13 design. It has since been
> executed — `teleproto@1.229.0` installed, `src/telegram/` + routes + UI
> implemented per this design, with two verified deviations: no
> `serverExternalPackages` entry was needed (pure JS bundles cleanly), and
> filenames use a `telegram-` namespace (see Phase 15/16 notes at the end).
> Nothing below was rewritten; it remains the authoritative design history.

Companion: `docs/telegram-authentication.md` (flows, credentials, session,
states). This document covers the technology decision, the
`TelegramManager` boundary, groups/participants, Next.js integration,
security, and the Phase 14 plan.

Primary sources: [Telegram API](https://core.telegram.org/api),
[`channels.getParticipants`](https://core.telegram.org/method/channels.getParticipants),
[API pagination](https://core.telegram.org/api/offsets),
[`User` type](https://core.telegram.org/type/User),
[teleproto](https://npmjs.com/package/teleproto) +
[migration guide](https://docs.teleproto.dev/migrating-from-gramjs).

> Status: **no Telegram production code was added in Phase 13.**
> `WhatsAppManager` and the CSV format are untouched.

---

## 1. Technology decision: `teleproto`, not `telegram` (GramJS)

The `telegram` npm package (GramJS, last published `2.26.22`) is
**archived and no longer maintained**; its README, npm page, and repo all
point to the fork. The original Phase 13 hypothesis ("use GramJS") is
therefore revised:

* **Package:** `teleproto` (npm), MIT, TypeScript builtin, **pure
  JavaScript, no native build step** — installs on the same runtimes as
  today (Alpine/ARM/serverless-friendly).
* **Maintenance:** actively maintained fork of GramJS (2025→), currently
  `1.229.0`; versioning is `MAJOR.LAYER.PATCH` where LAYER tracks the
  Telegram TL schema layer. Recommended range for Phase 14: `^1` (accept
  newer layers/patches); re-run `tsc` after upgrades since TL shapes shift.
* **Compatibility:** largely GramJS-compatible by design — `TelegramClient`,
  `StringSession` (`teleproto/sessions`), typed `client.api.*` surface,
  same `Api.*` request classes. Migration from GramJS examples is an
  import swap.
* **Why it matters here:** tracks newer TL layers and newer auth/abuse
  flows the archived codebase stopped following (email verification on
  first sign-in, reCaptcha challenges, `SessionRevokedError`, frozen-account
  errors). For a login-heavy integration this is the deciding factor.
* **Limitations:** smaller community than GramJS had; low download counts
  so far; CJS-only distribution (fits this project — `package.json` is
  CommonJS); error handling should use `instanceof` against typed error
  classes, not message matching.

No dependency was installed in Phase 13. If Phase 14 hits a blocking
question (e.g. exact `serverExternalPackages` behavior), a minimal
isolated experiment is allowed — production code only after the decision.

---

## 2. Boundary: dedicated `TelegramManager`

```text
Next.js Route Handlers
   ├── WhatsAppManager  →  whatsapp-web.js  →  WhatsApp Web
   └── TelegramManager  →  teleproto TelegramClient  →  Telegram MTProto
```

* `TelegramManager` owns **one `TelegramClient` per authenticated app user**,
  resolved through a per-user registry cached as `globalThis.__telegramManagers`
  (same HMR-safe pattern as WhatsApp; M2/M4 — supersedes the original
  single-global design below where it conflicts).
* It stays **independent** from `WhatsAppManager`. Explicitly NOT created:
  `MessagingPlatform`, `BaseManager`, `UniversalContact`, `UniversalGroup`,
  or any abstraction unifying the two. Shared code, if any ever emerges,
  is extracted later on evidence — not anticipated now.
* Same concurrency rules as WhatsApp: one shared connect/login promise,
  idempotent disconnect, no mutex libraries.

### Proposed public API (to be validated against the installed version)

```ts
// lifecycle
connect(): Promise<void>       // transport + session restore; resolves authorized or throws
disconnect(): Promise<void>    // idempotent; keeps session file (logout is separate)

// state (plain values only, like WhatsApp getStatus)
getStatus(): TelegramStatus    // { transport, authorized, loginStep, qr, user, error }
getQRCode(): string | null     // tg://login?token=... payload for the frontend to render
getConnectedUser(): { id: string; firstName: string; username: string | null } | null

// stepwise login (browser never touches the client)
startQrLogin(): Promise<void>  // begins auto-refreshing QR loop
cancelLogin(): Promise<void>
startPhoneLogin(phone: string): Promise<void>
submitCode(code: string): Promise<void>       // may move to awaiting_password
submitPassword(password: string): Promise<void> // transient; never stored

// data
getGroups(): Promise<TelegramGroupSummary[]>
exportGroupById(groupId: string): Promise<TelegramExportResult>
```

Stepwise methods exist because Telegram login is multi-step while
WhatsApp's is event-driven — the surface differs on purpose, no forced
symmetry.

---

## 3. Group discovery: eligible kinds

`messages.getDialogs` enumerates the account's chats; each peer classifies as:

| Entity | Eligible initially? |
|---|---|
| `Chat` — small/basic group | **Yes** (participants via `messages.getFullChat`, small sizes only) |
| `Channel` with `megagroup` — supergroup | **Yes** (participants via `channels.getParticipants`) |
| `Channel` with `broadcast` — channel | **No** (subscribers are not "members"; excluded) |
| `User`, bots,_monoforums, gigagroups | **No** (monoforums explicitly unsupported by `getParticipants`) |

```ts
interface TelegramGroupSummary {
  id: string;               // opaque decimal peer id (NOT the -100… Bot API form)
  title: string;            // presentation only
  kind: "group" | "supergroup";
  participantCount?: number;
}
```

Group identity at the boundary is the opaque `id` string (64-bit IDs exist
since layer 133 — keep them as strings, never numbers). The `accessHash`
required to address a channel is **server-side only**: the manager keeps an
in-memory `Map<id, InputChannel>` populated at discovery (re-run discovery
on miss) and never exposes it.

---

## 4. Participant enumeration (the critical part — Telegram ≠ WhatsApp)

Supergroups: `channels.getParticipants({ channel, filter, offset, limit,
hash })` → `{ count, participants, users }`. Facts that shape the design:

* **Pagination is plain offset/limit** (no `offset_id` math). `hash` is an
  ETag-like optimization over returned user IDs — pass `0` to disable
  caching during export enumeration.
* **Chunk size:** request sequentially in chunks (e.g. `limit: 200`, the
  commonly accepted maximum — confirm against the installed TL layer in
  Phase 14). Never parallelize enumeration calls.
* **Permissions depend on the filter.** Ordinary members can enumerate via
  `ChannelParticipantsRecent`. Admin-only views (admins, kicked, banned,
  and similar filters) raise `403 CHAT_ADMIN_REQUIRED`. Initial scope:
  **Recent enumeration as an ordinary member**; admin-only views are out.
* **Membership is mandatory:** `406 CHANNEL_PRIVATE` when the account
  hasn't joined; `400 CHANNEL_INVALID` for bad peers. Both map to
  application 404 (same semantics as WhatsApp's unknown group).
* **Basic groups** don't use this method at all: `messages.getFullChat`
  returns `chatFull.participants` (small groups only by nature).
* Always resolve `User` details from the collocated `users` vector
  (includes `userEmpty` for inaccessible users — export as placeholder,
  same philosophy as WhatsApp's unresolved contacts).

### Rate limits

`FLOOD_WAIT_<seconds>` means "back off exactly that long". Strategy:
sequential requests only, honor the wait (surface "try again in Xs", keep
state, no tight retry loop), no retries framework in Phase 14. Frequent
reconnects during development can trigger auth floods — reuse the persisted
session instead of re-logging.

---

## 5. Participant data and privacy

From the [`User` constructor](https://core.telegram.org/type/User):
`id` (long, always), `first_name?`, `last_name?`, `username(s)?`,
`phone?`, plus flags (`bot`, `verified`, `scam`, `fake`, `deleted`,
`premium`, …). **Every human-readable field is optional.**

The load-bearing limitation: **`phone` is not guaranteed.** It is visible
essentially for mutual contacts/self; group co-members commonly expose no
phone at all. Therefore:

```ts
interface TelegramParticipant {
  telegramId: string;   // String(id) — the reliable identity, always present
  firstName: string;    // "" when absent
  lastName: string;     // "" when absent
  username: string;     // "" when absent (prefer usernames[0] if present)
  phone: string;        // "" when hidden by privacy — EXPECT THIS OFTEN
  isAdmin: boolean;     // from ChannelParticipant* subclass (creator/admin/…)
  isOwner: boolean;     // creator
}
```

Missing → `""`, exactly the convention the WhatsApp pipeline already uses.
`isAdmin`/`isOwner` derive from the `ChannelParticipant` subclass, not from
filter membership. `bot`/`deleted` users are exported as rows (never
dropped); whether to flag them is a Phase 14 detail, not a model change.

---

## 6. CSV compatibility (no change now)

The current 6-column WhatsApp CSV (`WHATSAPP_ID;NOME;…`) can carry Telegram
rows mechanically (empty `NUMERO`), but the `WHATSAPP_ID` header would be a
lie. Options for Phase 14: (a) separate Telegram CSV with honest headers
(`TELEGRAM_ID;PRIMEIRO_NOME;…;USERNAME;TELEFONE;ADMIN;DONO`), reusing the
delimiter/BOM/escaping machinery; (b) a documented cross-platform mapping.
Recommendation: **(a)** — honest headers, shared mechanics, no change to the
WhatsApp file. **Phase 13 changes nothing about CSV.**

---

## 7. Next.js integration

```text
Browser
   ↓  (polling 2s, same as WhatsApp; QR auto-refresh rides on it)
Next.js Route Handlers (runtime = "nodejs", force-dynamic)
   ↓  (plain JSON only — never client, entities, hashes, tokens)
TelegramManager (per-user registry, session file per user)
   ↓
teleproto TelegramClient (server-only imports)
   ↓
Telegram MTProto
```

* Client code must be importable **only** from server modules (Route
  Handlers / `src/lib` / `src/telegram`). No client-component import, no
  `NEXT_PUBLIC_` Telegram variables.
* Build config (Phase 14 finding): **no `serverExternalPackages` entry was
  needed** — teleproto is pure JS and the production build bundles it
  without errors, unlike `whatsapp-web.js`. No `next.config` change.
* Coexistence: teleproto (pure JS, own TCP/TLS) and whatsapp-web.js
  (Puppeteer/Chromium) share the process with no shared state; the only
  coupling is operational (two sessions, two managers). No interference is
  expected; Phase 14 validates by running both connected.

---

## 8. Security review (user session = sensitive)

| Secret | Handling |
|---|---|
| `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` | `.env` server-only; never `NEXT_PUBLIC_`, never in responses/logs/git |
| `TELEGRAM_SESSION` (file `.telegram_session`, `0600`, gitignored) | read server-side at startup; rewritten on rotation; never leaves the server |
| login code | transient `submitCode()` arg; never logged/stored; wrong codes → retry state |
| 2FA password | transient `submitPassword()` arg; never logged/stored; dropped after use |
| QR token bytes | server-side only; browser gets the render payload string, as with WhatsApp |
| errors | mapped to safe messages; no raw MTProto dumps, no stack traces to browser |

`.gitignore` additions for Phase 14: `.telegram_session` (and nothing else
Telegram-related should ever be committed). Session revocation = best-effort
`auth.logOut()` + delete file. Tests use a mocked client boundary; no real
credentials, sessions, codes, or IDs in fixtures.

---

## 9. Known limitations (researched, not implemented)

* Phone numbers often unavailable (privacy) — the exporter must be useful
  without them (username + ID carry the identity).
* Non-admin members are limited to Recent enumeration; huge supergroups may
  additionally restrict visibility — export what the account may see,
  report counts honestly.
* QR tokens expire (~30s) — auto-refresh is a requirement, not an optimization.
* 64-bit IDs — stringify at the boundary; never use JS `number`.
* `accessHash` must be managed server-side; entities cannot be rebuilt from
  the bare ID alone.
* teleproto is younger/smaller-community than archived GramJS was; pin the
  version and re-run `tsc` on upgrades (TL shapes shift).

---

## 10. Phase 14 plan (concrete sequence)

1. `pnpm add teleproto@^1` (+ `@types/node` already present); decide
   `serverExternalPackages` by building once.
2. `.env.example` (`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`), `.gitignore`
   (`.telegram_session`).
3. `src/telegram/` domain: `manager.ts` (state machine + stepwise login +
   session file), `groups.ts` (dialogs classification), `participants.ts`
   (Recent pagination), `users.ts` (User → TelegramParticipant mapping).
   Mocked unit tests, synthetic data only.
4. `src/lib/telegram.ts` per-user registry (`globalThis.__telegramManagers`).
5. Routes: `POST /api/telegram/connect`, `GET /api/telegram/status`,
   `GET /api/telegram/qr`, `POST /api/telegram/login/{phone,code,password,cancel}`,
   `GET /api/telegram/groups`, `POST /api/telegram/export { groupId }`,
   reuse of download route pattern with a Telegram last-export slot.
6. Minimal UI addition reusing existing components/patterns (no redesign):
   platform switch or second section; QR render reuse.
7. Real validation with the user's account (QR scan → groups → export →
   still connected both clients → clean shutdown), then docs/roadmap update.

---

## Phase 15 implementation notes (code matches this design)

* Lookup is discovery-based: `fetchGroupRecordById` scans the same
  `getDialogs` list (no brute force, no `getInputEntity` number parsing);
  the record keeps the live entity so `accessHash` never crosses the
  boundary and no `big-integer` import is needed for IDs (only for the
  `hash: bigInt(0)` pagination field).
* Entity classification keys on the `className` string (`"Chat"` /
  `"Channel"`) plus flags — verified present on real teleproto instances;
  migrated basic groups are excluded (their supergroup lists separately).
* Pagination: sequential Recent pages, limit 200, stop on short page, hard
  error on non-advancing offset or >500 pages, dedupe by `telegramId`.
* FloodWait fails fast with seconds (no blocking waits inside requests).
* Basic groups resolve users from the `messages.ChatFull` collocated
  `users` vector; `ChatParticipantsForbidden` → typed unavailable error.
* New direct dependency `big-integer@^1.6` (+ `@types/big-integer`) for
  exact 64-bit values; already in the tree via teleproto.
* CSV/export/download remain Phase 16 and were not implemented.

---

## Phase 16 implementation notes (export workflow complete)

* Schema frozen: `TELEGRAM_ID;NOME;SOBRENOME;USERNAME;NUMERO;ADMIN;OWNER`
  (`;`, UTF-8+BOM, lowercase booleans, empty preserved, exact IDs, no
  `@`/`+` prefixes). `src/export/telegram-csv.ts` mirrors the WhatsApp
  serializer deliberately (no generic abstraction); `csv.ts` untouched.
* `manager.exportGroupById` reuses lookup + enumeration; routes strip
  `filePath`; separate `telegram-export.ts` slot (WhatsApp slot isolated).
* Downloads: `contentDispositionAttachment` (`filename` ASCII +
  `filename*=UTF-8''`) shared by both platforms — also fixing the WhatsApp
  route's latent ByteString bug. Verified with `Fazendinha`, `Minha
  Família`, `Família ❤️`, `日本語`, `Grupo 😀`.
* UI sends `{ groupId }` only; groupName-only bodies → 400, no shim.
* No live Telegram credentials exist in this environment, so export bytes
  were verified through route-level tests with real files (BOM, headers,
  escaping) rather than a live account — same standing limitation as
  Phases 14–15.

---

## Phase M4 implementation notes (per-user physical sessions)

* Session scope derived per authenticated user:
  `.telegram_sessions/<sha256(userId)>/session` (0600, server-side only);
  legacy `.telegram_session` preserved for explicit opt-in migration
  (`pnpm telegram:migrate-session -- --user <id>`: copy + verify, source
  never deleted, idempotent).
* The M2 process-wide live-session guard was removed for Telegram after
  isolation was proven (concurrent connects, QR/phone/2FA separation,
  revocation scoping all covered by mocked tests); WhatsApp's guard had
  already been removed in M3.
* No live second Telegram account exists in this environment, so two-user
  concurrency is mocked + filesystem-proven, not live-proven — same
  standing limitation as prior phases.
