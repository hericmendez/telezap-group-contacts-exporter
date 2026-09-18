import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TELEGRAM_SESSIONS_ROOT, telegramSessionScopeForUser } from "./session.js";

// ── Legacy session migration (explicit, opt-in, non-destructive) ───────────
// Moves NOTHING automatically: an operator runs
// `pnpm telegram:migrate-session -- --user <app-user-id>` to copy the
// pre-M4 global `.telegram_session` into that user's isolated scope.
// The source is always preserved. Never assign ownership by request timing.

export const LEGACY_TELEGRAM_SESSION_PATH = ".telegram_session";

export type TelegramMigrationStatus = "migrated" | "already-migrated" | "nothing-to-migrate";

export interface MigrateTelegramSessionOptions {
  /** Authenticated app user receiving the legacy session. Required, explicit. */
  userId: string;
  legacyPath?: string;
  sessionsRoot?: string;
}

export interface MigrateTelegramSessionResult {
  status: TelegramMigrationStatus;
  /** Paths only — never session contents, tokens, or credentials. */
  legacyPath: string;
  destinationPath: string;
}

function destinationFor(userId: string, sessionsRoot: string): string {
  const scope = telegramSessionScopeForUser(userId, sessionsRoot);
  const resolvedRoot = path.resolve(sessionsRoot);
  const resolvedDest = path.resolve(scope.filePath);
  // Defense in depth: the destination must stay inside the sessions root.
  if (!resolvedDest.startsWith(resolvedRoot + path.sep) && resolvedDest !== resolvedRoot) {
    throw new Error("Migration refused: destination escapes the sessions root.");
  }
  return scope.filePath;
}

/**
 * Copy the legacy global session file into one user's isolated scope.
 *
 * - unknown/empty userId → throws (ownership must be explicit);
 * - no legacy session → `nothing-to-migrate` (destination untouched);
 * - destination holds byte-identical content → `already-migrated`;
 * - destination holds different content → throws (never overwrites);
 * - otherwise copies, verifies byte equality, preserves the source.
 */
export async function migrateTelegramSession(
  options: MigrateTelegramSessionOptions,
): Promise<MigrateTelegramSessionResult> {
  const userId = options.userId?.trim();
  if (!userId) {
    throw new Error("Migration refused: an explicit --user <app-user-id> is required.");
  }
  const legacyPath = options.legacyPath ?? LEGACY_TELEGRAM_SESSION_PATH;
  const sessionsRoot = options.sessionsRoot ?? TELEGRAM_SESSIONS_ROOT;
  const destinationPath = destinationFor(userId, sessionsRoot);

  let source: Buffer | null = null;
  try {
    source = await fs.readFile(legacyPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "nothing-to-migrate", legacyPath, destinationPath };
    }
    throw new Error(`Migration failed: cannot read legacy session at ${legacyPath}.`);
  }
  if (source.length === 0 || source.toString("utf8").trim().length === 0) {
    return { status: "nothing-to-migrate", legacyPath, destinationPath };
  }

  let existing: Buffer | null = null;
  try {
    existing = await fs.readFile(destinationPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Migration failed: cannot inspect destination at ${destinationPath}.`);
    }
  }
  if (existing) {
    if (existing.equals(source)) {
      return { status: "already-migrated", legacyPath, destinationPath };
    }
    throw new Error(
      `Migration refused: destination ${destinationPath} already exists with different contents.`,
    );
  }

  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, source, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.chmod(destinationPath, 0o600);
  } catch {
    // platform without POSIX permissions — documented posture, not fatal
  }
  const verify = await fs.readFile(destinationPath);
  if (!verify.equals(source)) {
    throw new Error(
      `Migration failed verification at ${destinationPath}. Source preserved at ${legacyPath}.`,
    );
  }
  return { status: "migrated", legacyPath, destinationPath };
}
