import * as dotenv from "dotenv";

dotenv.config();

/**
 * Administrative user provisioning (no public registration).
 *
 * Users come from the server-only `TELEZAP_USERS` environment variable:
 *
 *   TELEZAP_USERS="alice:scrypt$16384$8$1$<saltB64>$<hashB64>,bob:scrypt$…"
 *
 * Generate a hash without ever storing a password with:
 *
 *   pnpm auth:hash
 *
 * (type the password, then Ctrl-D; only the hash is printed — put the hash,
 * never the password, into `.env`). Usernames may not contain `:` or `,`.
 */

export interface AppUser {
  /** Stable identity. For local provisioning this is the username. */
  id: string;
  username: string;
  passwordHash: string;
}

function parseUsers(raw: string): AppUser[] {
  const users: AppUser[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) {
      throw new Error("Invalid TELEZAP_USERS entry (expected username:hash).");
    }
    const username = trimmed.slice(0, separator).trim();
    const passwordHash = trimmed.slice(separator + 1).trim();
    if (!username || !passwordHash) {
      throw new Error("Invalid TELEZAP_USERS entry (expected username:hash).");
    }
    if (seen.has(username)) {
      throw new Error(`Duplicate username in TELEZAP_USERS: "${username}".`);
    }
    seen.add(username);
    users.push({ id: username, username, passwordHash });
  }
  return users;
}

/** Load provisioned users. Empty/missing variable means no users configured. */
export function loadAppUsers(): AppUser[] {
  const raw = (process.env.TELEZAP_USERS ?? "").trim();
  if (!raw) return [];
  return parseUsers(raw);
}

/** Find a user by username. Returns undefined instead of distinguishing. */
export function findAppUser(users: AppUser[], username: string): AppUser | undefined {
  return users.find((u) => u.username === username);
}
