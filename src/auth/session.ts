import { randomBytes } from "node:crypto";

// ── Server-side session store (persistent Node host, in-memory) ─────────────
// The cookie holds only an opaque random token. All state lives here, so
// logout truly invalidates and no account data ever reaches the browser.
// Dev HMR wipes the map (re-login needed) — acceptable for local dev;
// production `next start` is a single long-lived process.

export interface SessionRecord {
  userId: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

/** 7 days, sliding on every authenticated request. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sessions = new Map<string, SessionRecord>();

function sweepExpired(now: number): void {
  for (const [token, record] of sessions) {
    if (record.expiresAt <= now) sessions.delete(token);
  }
}

export function createSession(userId: string, username: string, now = Date.now()): string {
  sweepExpired(now);
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { userId, username, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  return token;
}

/** Validate a token. Refreshes expiry (sliding) on success. */
export function getSession(token: string, now = Date.now()): SessionRecord | null {
  const record = sessions.get(token);
  if (!record) return null;
  if (record.expiresAt <= now) {
    sessions.delete(token);
    return null;
  }
  record.expiresAt = now + SESSION_TTL_MS;
  return { ...record };
}

export function destroySession(token: string): boolean {
  return sessions.delete(token);
}

/** Test-only hook. */
export function __resetSessionsForTests(): void {
  sessions.clear();
}

/** Test-only hook. */
export function __sessionCountForTests(): number {
  return sessions.size;
}
