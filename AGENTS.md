# AGENTS.md

## Project

WhatsApp Group Contact Exporter.

A small Next.js monolith (TypeScript) that connects to WhatsApp Web through `whatsapp-web.js`, lets the user pick a WhatsApp group in a single-page UI, resolves its participants into contacts, and exports the resulting contact list to CSV (file on the server + browser download).

A thin CLI (`pnpm cli`, `src/cli.ts`) is kept as an administrative/dev tool reusing the same domain.

The application is intentionally small and focused. Do not introduce unnecessary infrastructure, abstractions, databases, or UI beyond the single page.

---

## Primary Goal

Given a WhatsApp group, export its participants to a CSV file containing useful contact information.

The core flow is:

```text
WhatsApp Web
     │
     ▼
whatsapp-web.js
     │
     ▼
Find group
     │
     ▼
group.participants
     │
     ▼
Resolve contacts
     │
     ▼
Normalize contact data
     │
     ▼
CSV exporter
     │
     ▼
output/*.csv
```

The application should also preserve the original WhatsApp participant identifier whenever available.

---

## Non-Goals

Do NOT implement:

* a database
* CRM functionality
* lead management
* message scraping
* message history export
* automatic messaging
* contact creation inside WhatsApp
* group creation
* group modification
* AI features
* scheduling
* Docker unless there is a concrete requirement later
* unnecessary dependency injection/container architecture
* enterprise-level abstractions

This project is an exporter, not a CRM.

---

## Technology

Use:

* Node.js
* TypeScript
* pnpm
* Next.js (App Router, monolith — no separate Express/Fastify backend)
* React (single page, no UI framework)
* `whatsapp-web.js`
* `dotenv`
* a small CSV generation library such as `csv-writer`
* `tsx` for the CLI/dev tool
* `react-qr-code` for QR rendering (small, dependency-free)

Use the current stable versions compatible with the project.

Before adding a dependency, determine whether it is actually necessary.

Prefer the Node.js standard library when it is sufficient.

---

## Runtime Requirements

The application requires:

* Node.js installed locally
* Chromium/Chrome support compatible with `whatsapp-web.js`
* a WhatsApp account capable of accessing the target group
* the user to authenticate through WhatsApp Web

The first execution should allow the user to scan the WhatsApp QR code.

Authentication/session persistence should be enabled so the user does not need to scan the QR code every execution.

Use `LocalAuth` unless there is a concrete reason not to.

The authentication/session directory must be excluded from Git.

---

## Configuration

Configuration should be environment-driven where appropriate.

Provide:

```text
.env.example
```

At minimum, support:

```env
GROUP_NAME=
OUTPUT_FILE=output/contacts.csv
```

Do not hardcode the target group name into the source code.

If a configuration can be supplied through CLI arguments, prefer CLI arguments for one-off commands while retaining sensible environment-variable support.

Do not expose secrets or session information in logs.

---

## CLI

The CLI (`src/cli.ts`) is kept as an administrative/dev tool reusing `WhatsAppManager`.

```bash
pnpm cli -- --group "My Group"
```

The web app (`pnpm dev` / `pnpm start`) is the primary entrypoint. Do not
remove the CLI to simplify; keep it working while it does not harm the architecture.

---

## WhatsApp Client

Create a small isolated module responsible for WhatsApp Web initialization.

Responsibilities:

* initialize the `whatsapp-web.js` client
* configure persistent authentication
* handle QR authentication
* handle `ready`
* handle authentication failures
* handle disconnection
* expose a clean way for the application to perform the export after the client is ready

Do not spread WhatsApp client lifecycle logic throughout the application.

---

## Group Discovery

The application must be able to locate a WhatsApp group by name.

Only group chats should be considered.

Conceptually:

```ts
const chats = await client.getChats();

const group = chats.find(
  chat => chat.isGroup && chat.name === targetGroupName
);
```

Do not assume group names are globally unique.

If multiple groups have the same name:

* do not silently choose one
* report the ambiguity
* provide enough information for the user to distinguish them

Possible distinguishing information includes:

* group name
* group ID
* participant count

If the chosen implementation needs a group ID instead of a name, support that as a more deterministic option.

---

## Participant Discovery

Do NOT scrape group messages to determine membership.

Use the group participant information exposed by `whatsapp-web.js`.

The primary source is:

```ts
group.participants
```

Each participant should be processed independently.

The exporter must preserve the participant's original WhatsApp identifier:

```ts
participant.id._serialized
```

when available.

Do not assume that every participant identifier is a traditional phone-number-based `@c.us` identifier.

WhatsApp may expose newer identifier forms such as LIDs.

The implementation must therefore treat the WhatsApp ID as an opaque identifier.

---

## Contact Resolution

For each participant:

1. obtain the participant WhatsApp ID
2. resolve the contact through `whatsapp-web.js`
3. extract the useful available fields
4. normalize them into the application's export model

Prefer:

```ts
client.getContactById(participant.id._serialized)
```

rather than manually deriving contact information from the identifier.

Do not assume that the identifier itself is always a phone number.

---

## Contact Export Model

The internal normalized representation should contain at least:

```ts
interface ExportedContact {
  whatsappId: string;
  name: string;
  pushname: string;
  number: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
}
```

The exact model may be extended if useful, but avoid speculative fields.

Potentially unavailable values must be represented safely, for example with an empty string or `null`, according to the chosen internal convention.

Do not invent contact information.

---

## CSV

The CSV should contain at least:

```text
WHATSAPP_ID
NOME
NOME_WHATSAPP
NUMERO
ADMIN
SUPER_ADMIN
```

For Brazilian/Excel-friendly usage, prefer semicolon as the field delimiter unless there is a documented reason to use commas.

The CSV implementation must correctly escape:

* quotes
* delimiters
* newlines
* names containing special characters

Do not construct CSV rows through naïve string concatenation.

Use a proper CSV library or a correctly implemented escaping function.

The generated file should be written to:

```text
output/
```

by default.

The output directory should be ignored by Git except for an optional `.gitkeep`.

---

## Encoding

CSV output must be UTF-8.

Brazilian Portuguese names and accented characters must be preserved.

If the implementation adds a UTF-8 BOM for better Excel compatibility, document that behavior.

---

## Duplicate Handling

Do not deduplicate participants by display name.

Names are not reliable identifiers.

The primary identity is the WhatsApp participant ID.

If duplicate participant IDs somehow appear in the source data, deduplicate by WhatsApp ID.

---

## Error Handling

The application should fail clearly and informatively.

Important cases:

### Group not found

Report:

```text
Group "X" was not found.
```

Do not generate an empty CSV pretending the export succeeded.

### Multiple matching groups

Report the ambiguity and require a more specific selection.

### Contact resolution failure

A single contact failing to resolve should not necessarily abort the entire export.

Prefer:

* log the failure
* preserve the participant ID
* export the remaining contacts

The final result should report how many contacts succeeded and how many failed.

### Authentication failure

Report a clear authentication error and exit with a non-zero status.

### WhatsApp disconnection

Handle the disconnect cleanly.

Do not leave hanging processes.

---

## Logging

Logs should be concise and useful.

Example:

```text
Initializing WhatsApp client...
Waiting for authentication...
WhatsApp client ready.

Searching for group: My Group
Group found: My Group
Participants: 87

Resolving contacts...
[1/87] João Silva
[2/87] Maria Souza
...

Export complete.
87 contacts processed.
85 contacts exported.
2 contacts failed.
File: output/contacts.csv
```

Do not log message contents.

Do not log authentication credentials.

Do not unnecessarily log session data.

---

## Graceful Shutdown

Handle process termination where appropriate.

The application should attempt to destroy the WhatsApp client before exiting.

Avoid leaving Chromium processes running after an error or Ctrl+C.

Web-server shutdown is coordinated centrally: `shutdownAllManagers()` in
`src/lib/lifecycle.ts` (idempotent, error-isolated per user), wired once
per process from `src/instrumentation.ts`. Never add per-route or
per-manager process handlers on the web path; never delete session files
during shutdown; never call `process.exit` from shared web code.

---

## Security and Privacy

This application processes personal contact information.

Therefore:

* never commit exported CSV files
* never commit WhatsApp authentication/session data
* never log unnecessary personal information
* never commit `.env`
* never include real contact data in tests
* use synthetic/fake data in fixtures

Recommended `.gitignore` entries:

```gitignore
node_modules/
.env
output/*.csv
.wwebjs_auth/
.wwebjs_cache/
```

If the actual session directory differs, update `.gitignore` accordingly.

---

## Testing

Testing should focus on logic that does not require a real WhatsApp session.

Do NOT require WhatsApp Web for normal unit tests.

Test at least:

* contact normalization
* CSV generation
* CSV escaping
* duplicate participant handling
* configuration parsing
* group selection logic
* ambiguous group detection
* failed contact resolution behavior

WhatsApp integration may have a separate smoke/manual test.

Do not attempt to fake the entire WhatsApp Web runtime unless there is a clear benefit.

---

## Architecture

Keep the architecture simple.

Recommended separation:

```text
src/
├── app/
│   ├── page.tsx            # TeleZap single page (WhatsApp / Telegram tabs)
│   ├── layout.tsx          # header, branding, next-themes provider, metadata
│   ├── globals.css         # Tailwind v4 + shadcn-compatible light/dark tokens
│   └── api/
│       ├── whatsapp/status/route.ts
│       ├── whatsapp/connect/route.ts
│       ├── whatsapp/qr/route.ts
│       ├── groups/route.ts
│       ├── export/route.ts
│       ├── export/download/route.ts
│       ├── telegram/status/route.ts
│       ├── telegram/connect/route.ts
│       ├── telegram/qr/route.ts
│       ├── telegram/qr/start/route.ts
│       ├── telegram/qr/cancel/route.ts
│       └── telegram/auth/phone|code|password/route.ts
│       ├── telegram/groups/route.ts
│       ├── telegram/groups/[id]/participants/route.ts
│       ├── telegram/export/route.ts
│       └── telegram/export/download/route.ts
├── components/
│   ├── ui/                 # shadcn-style primitives actually used (no kitchen sink)
│   ├── telezap-logo.tsx    # original bolt+node SVG mark
│   └── theme-toggle.tsx    # light/dark/system toggle (client)
├── lib/
│   ├── utils.ts            # cn() helper
│   ├── download-headers.ts # shared RFC 5987 Content-Disposition (both downloads)
│   ├── whatsapp.ts         # getWhatsAppManager(userId) registry (globalThis Map)
│   ├── telegram.ts         # getTelegramManager(userId) registry (globalThis Map)
│   ├── telegram-http.ts    # Telegram route error mapping (no secrets in messages)
│   ├── telegram-export.ts  # Telegram last-export slot, per user (isolated from WhatsApp)
│   └── last-export.ts      # last-export store for controlled download, per user
├── cli.ts                  # thin CLI reusing the manager
├── config.ts
├── whatsapp/
│   ├── manager.ts          # domain boundary (do NOT rewrite)
│   ├── client.ts
│   ├── group.ts
│   ├── participants.ts
│   └── contacts.ts
├── telegram/
│   ├── manager.ts          # Telegram domain boundary (do NOT rewrite lightly)
│   ├── client.ts           # teleproto TelegramClient factory only
│   ├── config.ts           # TELEGRAM_API_ID/HASH, server-only
│   ├── group.ts            # dialogs classification, opaque IDs, accessHash server-side
│   ├── participants.ts     # Recent pagination, role mapping, FloodWait policy
│   └── session.ts          # .telegram_session file (0600), never logged
├── export/
│   ├── csv.ts            # WhatsApp CSV (do NOT change format)
│   ├── telegram-csv.ts   # Telegram CSV (own schema, shared sanitize)
│   └── types.ts
└── utils/
    └── logger.ts
```

Web rules:

* all Route Handlers using WhatsApp/Telegram/filesystem declare `runtime = "nodejs"` (never Edge) and `force-dynamic`;
* WhatsApp handlers share the manager via `getWhatsAppManager()` — never `new WhatsAppManager()` per request;
* Telegram handlers share the manager via `getTelegramManager()` — never `new TelegramManager()` per request, never instantiate `TelegramClient` outside `src/telegram`;
* handlers return plain serializable values only (no Client/Chat/Contact, no MTProto objects, no session strings, no codes/passwords);
* every `/api/*` route except login passes `requireAppUser(request)` first (`src/auth/guard.ts`) — never parse cookies in handlers;
* app sessions are opaque server-side tokens (`src/auth/session.ts`); never log tokens, hashes, or passwords; stored password hashes must stay `$`-free (Next.js expands `$VAR` in env values);
* no business logic in React components; no WebSocket; polling (2s) per platform (independent);
* UI: shadcn-style primitives in `src/components/ui` (only what is used), Tailwind v4 tokens, light/dark/system theme via `next-themes` (persisted, no flash);
* `whatsapp-web.js` stays external (`serverExternalPackages`) and patched via `patch-package`;
* Telegram and WhatsApp stay independent — no `MessagingPlatform`/`BaseManager`/universal models.
* M1 scope reminder: authenticated users still share the global platform managers/sessions/slots until M2 — do not mistake authentication for isolation.
* M5 scope reminder: managers/sessions (M2–M4) and now exports/downloads are per-user; slots stay process-local (restart invalidates downloads).

The exact structure can differ if the implementation remains simple and responsibilities remain clear.

Avoid:

* generic `BaseService`
* generic repositories
* dependency injection frameworks
* excessive interfaces
* unnecessary factories
* elaborate domain layers

This application is intentionally small.

---

## Documentation

Maintain:

### README.md

Should explain:

* what the project does
* requirements
* installation
* WhatsApp authentication
* configuration
* usage
* CSV format
* troubleshooting
* privacy considerations

### docs/architecture.md

Should explain:

* application flow
* WhatsApp client lifecycle
* group discovery
* participant resolution
* normalization
* CSV generation
* error handling

### docs/usage.md

Should contain practical examples.

### docs/roadmap.md

Should describe implemented phases and possible future work.

The roadmap must reflect the actual implementation state.

Do not mark features complete before they have been implemented and verified.

---

## Development Workflow

Before modifying code:

1. inspect the existing repository
2. inspect `package.json`
3. inspect existing documentation
4. understand the current architecture
5. identify the smallest implementation needed

After implementation:

1. run type checking
2. run tests
3. run lint if configured
4. run a manual/integration smoke test when possible
5. inspect the generated CSV
6. verify that private/session/output files are ignored by Git
7. update documentation

Do not claim success without actually running the relevant verification commands.

---

## Definition of Done

The project is complete when:

* [ ] Node.js project is initialized
* [ ] TypeScript is configured
* [ ] `whatsapp-web.js` client works
* [ ] WhatsApp authentication works
* [ ] session persists between executions
* [ ] group can be selected by name
* [ ] ambiguous group names are handled safely
* [ ] group participants are retrieved
* [ ] participants are resolved into contacts where possible
* [ ] WhatsApp IDs are preserved
* [ ] admin status is preserved
* [ ] CSV is generated correctly
* [ ] UTF-8 characters are preserved
* [ ] failed contacts do not unnecessarily abort the whole export
* [ ] output directory is Git-ignored
* [ ] WhatsApp session data is Git-ignored
* [ ] `.env` is Git-ignored
* [ ] tests cover pure application logic
* [ ] README is complete
* [ ] architecture documentation exists
* [ ] usage documentation exists
* [ ] roadmap exists
* [ ] typecheck passes
* [ ] tests pass
* [ ] manual export has been verified
* [ ] web app serves the single page (`pnpm dev` / `pnpm start`)
* [ ] API routes return serializable data only
* [ ] export via UI keeps WhatsApp connected
* [ ] CLI (`pnpm cli`) still works

---

## Agent Behavior

Do not over-engineer the project.

When faced with multiple valid implementations, prefer:

1. simplest correct solution
2. smallest dependency footprint
3. clear TypeScript
4. easy debugging
5. explicit behavior
6. good documentation

Do not introduce architecture merely because it is common in larger projects.

The project should remain understandable by reading the repository from top to bottom.
