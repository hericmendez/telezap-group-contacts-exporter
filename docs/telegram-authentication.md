# Telegram Authentication Design (Phase 13 — design only, nothing implemented)

This project needs a **Telegram user account session (MTProto)**, not a bot.

```text
Telegram Bot API (bot token, limited group visibility)
        ≠
Telegram MTProto user authorization (full account surface)
```

A bot token must NOT be used: bots cannot reliably enumerate group
participants (admin-only filters, no access to many groups). The account
used must be a member of the groups to be exported.

Sources: [Telegram API docs](https://core.telegram.org/api),
[QR login](https://core.telegram.org/api/qr-login),
[`auth.signIn`](https://core.telegram.org/method/auth.signIn),
[`auth.exportLoginToken`](https://core.telegram.org/method/auth.exportLoginToken),
GramJS [`client/auth.ts`](https://github.com/gram-js/gramjs/blob/master/gramjs/client/auth.ts)
(checkPassword/SRP flow), [teleproto migration guide](https://docs.teleproto.dev/migrating-from-gramjs).

---

## 1. API credentials

Before any login, the project needs its own Telegram API application
(created once at https://my.telegram.org → "API development tools";
only app title + short name required):

```env
# .env (server-only, never committed, never sent to the browser)
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=abcdef1234567890abcdef1234567890
```

Rules:

* Both values live in `.env` / process environment, read only by Node
  Route Handlers and `TelegramManager`. No `NEXT_PUBLIC_` prefix, no
  client-component import, no API response may contain them.
* `.env.example` documents the two keys with empty values.
* `.gitignore` already excludes `.env`; Phase 14 must also exclude the
  session file (see §4).
* `TELEGRAM_API_HASH` is a server-side secret. `TELEGRAM_API_ID` is less
  sensitive but is still treated as server-only configuration.

---

## 2. Phone + code flow (fallback)

MTProto level (`auth.sendCode` → `auth.signIn`):

```text
phone number (international format)
    ↓  auth.sendCode → phone_code_hash
verification code (from Telegram chat/SMS)
    ↓  auth.signIn(phone_number, phone_code_hash, phone_code)
authorized | SESSION_PASSWORD_NEEDED (→ §3) | PHONE_CODE_INVALID/EXPIRED (retry)
```

Library level (teleproto, GramJS-compatible): the equivalent of
`client.start({ phoneNumber, phoneCode, password, onError })` drives this
loop. For the stepwise web UI, Phase 14 must use the granular primitives
instead of the blocking `start()` loop:

```ts
// conceptual — pin exact call shapes against the installed teleproto version
manager.startPhoneLogin(phoneNumber) // sends code, keeps phoneCodeHash server-side
manager.submitCode(code)             // signIn; may raise SESSION_PASSWORD_NEEDED
manager.submitPassword(password)     // SRP check (§3), password never stored
manager.cancelLogin()                // abandon pending attempt
```

State between steps (`phoneCodeHash`, pending phone) lives only in the
server-side manager — never in browser state, URLs, or logs.

---

## 3. 2FA password flow

If the account has a two-step password, sign-in returns `401
SESSION_PASSWORD_NEEDED`. The completion sequence is:

```text
account.getPassword → password settings + SRP params (srp_id, srp_B, algo)
    ↓  (client-side SRP computation, e.g. teleproto/GramJS computeCheck)
auth.checkPassword(InputCheckPasswordSRP) → auth.Authorization
```

Errors: `PASSWORD_HASH_INVALID` (wrong password → allow retry),
`SRP_ID_INVALID` / `SRP_PASSWORD_CHANGED` (re-fetch `account.getPassword`).

Hard rules:

* The password exists only as a transient argument to the single
  `submitPassword()` call. It is never persisted (not in env, file, DB,
  session, logs, or error messages).
* Show the server-provided password `hint` in the UI when available.
* After success, drop all login-step state; only the session string remains.

---

## 4. QR flow (recommended primary UI)

Same UX shape as WhatsApp, so it should be the primary login path.
MTProto level ([QR login docs](https://core.telegram.org/api/qr-login)):

```text
auth.exportLoginToken(api_id, api_hash, except_ids=[])
    ↓  auth.loginToken { token, expires }  (usually ~30 seconds)
base64url(token) → tg://login?token=... → QR shown in browser
    ↓  user scans with an already logged-in Telegram app (Settings → Devices → Link Desktop Device)
app calls auth.acceptLoginToken
    ↓  server receives updateLoginToken → exportLoginToken again
auth.loginTokenSuccess  →  authorized
(variants: auth.loginTokenMigrateTo → auth.importLoginToken on the given DC)
```

Library level: the equivalent of `signInUserWithQrCode({ apiId, apiHash },
{ qrCode: ({ token, expires }) => …, onError })`, which encapsulates the
export/poll/migrate loop.

Consequences for the design:

* **QR tokens expire (~30s).** The manager must auto-refresh: when a token
  nears expiry with no scan, export a new one and replace the pending QR.
  The existing 2s status-polling pattern fits this without WebSockets.
* The backend stores only the raw token bytes server-side and exposes to
  the browser exactly what WhatsApp exposes today: the QR payload string
  (`tg://login?token=...`), which the frontend renders. Never expose token
  internals, DC details, or migration state.
* `AUTH_TOKEN_EXPIRED` → silent refresh; `AUTH_TOKEN_INVALID` → new token;
  repeated failures → `auth_failed` with a safe message.

---

## 5. Session persistence (StringSession)

On first successful authorization, `session.save()` returns an opaque
string that restores the session without a new login. On restart, construct
`new StringSession(saved)` and `connect()` — no QR/code needed while valid.

Comparison:

| Option | Verdict |
|---|---|
| `TELEGRAM_SESSION` env var | Workable, but long opaque value in env; rotation means redeploy/editing env. |
| **Local file (recommended)** | Simplest for this self-hosted project: write the string to `.telegram_session` (gitignored, file mode `0600`), mirroring `.wwebjs_auth/`. Survives restarts, easy to revoke (delete file + logout). |
| Database-backed session | Rejected — no database exists and none is justified for one string. |

Rules (session = authentication material):

* Never in browser responses, frontend state, logs, tests, snapshots, or git.
* Read once at manager startup (or lazily on first `connect()`); rewrite the
  file whenever the library rotates the session.
* Revocation = `auth.logOut()` (best effort) + delete the file. A server-side
  `disconnect({ revoke })` may be offered to admins later; not Phase 14.

---

## 6. Recommended login state model

Transport state and login-step state are separate axes (unlike WhatsApp,
Telegram login is multi-step):

```ts
type TelegramTransport = "disconnected" | "connecting" | "connected";

type TelegramLoginStep =
  | "none"            // no login in progress
  | "qr_pending"      // QR shown, awaiting scan (auto-refreshing)
  | "awaiting_phone"  // phone-login started, code not yet sent/confirmed
  | "awaiting_code"   // code sent, awaiting user input
  | "awaiting_password"; // 2FA required, awaiting password

interface TelegramStatus {
  transport: TelegramTransport;
  authorized: boolean;
  loginStep: TelegramLoginStep;
  qr: string | null;      // tg://login?token=... payload, or null
  user: { id: string; firstName: string; username: string | null } | null;
  error: string | null;   // safe message only
}
```

`authorized === true` (verified via `users.getUsers({ id: ["me"] })` or
equivalent after connect) is the only gate for group/export operations —
not merely "transport connected". Map library errors to states, never
forward raw MTProto exceptions: `SESSION_REVOKED`/`AUTH_KEY_UNREGISTERED`
→ logged out (delete session file); `PHONE_CODE_INVALID`/`EXPIRED` →
stay in `awaiting_code` with message; `PASSWORD_HASH_INVALID` → stay in
`awaiting_password`; `FLOOD_WAIT_<s>` → error "try again in Xs", keep state.

---

## 7. What Phase 14 must NOT do with credentials

* No `NEXT_PUBLIC_TELEGRAM_*` variables.
* No API hash / session / code / password in any JSON response.
* No `console.log` of auth payloads (library debug loggers stay off / redacted).
* No real credentials in tests — all auth tests use a mocked client boundary.
