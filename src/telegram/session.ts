import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

/**
 * Local Telegram session persistence (StringSession payload).
 *
 * The session string is authentication material: it is read/written only by
 * the server, never logged, never returned by APIs, never committed.
 * No database — files are the whole mechanism.
 */
export const DEFAULT_TELEGRAM_SESSION_PATH = ".telegram_session";

/** Root directory holding one subdirectory per app user. Gitignored. */
export const TELEGRAM_SESSIONS_ROOT = ".telegram_sessions";

/** Name of the session file inside a per-user directory. */
export const TELEGRAM_SESSION_FILENAME = "session";

/**
 * Deterministic, filesystem-safe session scope for an authenticated app
 * user: `sha256("telezap:telegram-session:v1:" + userId)` hex. One-way (no
 * username in paths), collision-resistant, `[0-9a-f]` only — safe against
 * traversal even for hostile userIds.
 */
export function telegramSessionScopeForUser(userId: string, root: string = TELEGRAM_SESSIONS_ROOT): { filePath: string } {
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    throw new Error("telegramSessionScopeForUser requires a non-empty userId.");
  }
  const hex = createHash("sha256").update(`telezap:telegram-session:v1:${userId}`, "utf8").digest("hex");
  return { filePath: `${root}/${hex}/${TELEGRAM_SESSION_FILENAME}` };
}

/** Load the persisted session, or `null` when none exists yet. */
export async function loadTelegramSession(
  filePath: string = DEFAULT_TELEGRAM_SESSION_PATH,
): Promise<string | null> {
  try {
    const data = await fs.readFile(filePath, "utf8");
    const trimmed = data.trim();
    return trimmed ? trimmed : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read Telegram session file: ${filePath}`);
  }
}

/** Persist the session with owner-only permissions (0600). */
export async function saveTelegramSession(
  data: string,
  filePath: string = DEFAULT_TELEGRAM_SESSION_PATH,
): Promise<void> {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") {
    await fs.mkdir(dir, { recursive: true });
  }
  await fs.writeFile(filePath, data, { encoding: "utf8", mode: 0o600 });
  // Enforce permissions even if the file already existed with wider mode.
  await fs.chmod(filePath, 0o600);
}

/** Delete the persisted session (logout/revocation cleanup). */
export async function clearTelegramSession(
  filePath: string = DEFAULT_TELEGRAM_SESSION_PATH,
): Promise<void> {
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // best effort — a missing file is already the desired end state
  }
}
