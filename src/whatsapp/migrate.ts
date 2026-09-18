import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WHATSAPP_SESSIONS_ROOT, whatsappSessionScopeForUser } from "./client.js";

// ── Legacy session migration (explicit, opt-in, non-destructive) ───────────
// Moves NOTHING automatically: an operator runs
// `pnpm whatsapp:migrate-session -- --user <app-user-id>` to copy the
// pre-M3 global `.wwebjs_auth` session into that user's isolated scope.
// The source is always preserved. Never assign ownership by request timing.

export const LEGACY_WHATSAPP_SESSION_PATH = ".wwebjs_auth";

export type MigrationStatus = "migrated" | "already-migrated" | "nothing-to-migrate";

export interface MigrateLegacySessionOptions {
  /** Authenticated app user receiving the legacy session. Required, explicit. */
  userId: string;
  legacyPath?: string;
  sessionsRoot?: string;
}

export interface MigrateLegacySessionResult {
  status: MigrationStatus;
  /** Paths only — never session contents, tokens, or credentials. */
  legacyPath: string;
  destinationPath: string;
  filesCopied: number;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(root, "");
  return out.sort();
}

async function copyRecursive(source: string, destination: string): Promise<number> {
  const files = await listFilesRecursive(source);
  for (const rel of files) {
    const from = path.join(source, ...rel.split("/"));
    const to = path.join(destination, ...rel.split("/"));
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
  return files.length;
}

/**
 * Copy the legacy global session into one user's isolated scope.
 *
 * - unknown/empty userId → throws (ownership must be explicit);
 * - no legacy session files → `nothing-to-migrate` (destination untouched);
 * - destination already holds the same files → `already-migrated`;
 * - destination holds different files → throws (never overwrites);
 * - otherwise copies, verifies the destination listing, preserves source.
 */
export async function migrateLegacySession(
  options: MigrateLegacySessionOptions,
): Promise<MigrateLegacySessionResult> {
  const userId = options.userId?.trim();
  if (!userId) {
    throw new Error("Migration refused: an explicit --user <app-user-id> is required.");
  }
  const legacyPath = options.legacyPath ?? LEGACY_WHATSAPP_SESSION_PATH;
  const sessionsRoot = options.sessionsRoot ?? WHATSAPP_SESSIONS_ROOT;
  const scope = whatsappSessionScopeForUser(userId);
  const destinationPath = path.join(sessionsRoot, path.basename(scope.dataPath));

  // Defense in depth: the destination must stay inside the sessions root
  // even if scope computation ever changes.
  const resolvedRoot = path.resolve(sessionsRoot);
  const resolvedDest = path.resolve(destinationPath);
  if (!resolvedDest.startsWith(resolvedRoot + path.sep) && resolvedDest !== resolvedRoot) {
    throw new Error("Migration refused: destination escapes the sessions root.");
  }

  const legacyFiles = await listFilesRecursive(legacyPath);
  if (legacyFiles.length === 0) {
    return { status: "nothing-to-migrate", legacyPath, destinationPath, filesCopied: 0 };
  }

  const existingFiles = await listFilesRecursive(destinationPath);
  if (existingFiles.length > 0) {
    const same =
      existingFiles.length === legacyFiles.length &&
      existingFiles.every((file, index) => file === legacyFiles[index]);
    if (same) {
      return { status: "already-migrated", legacyPath, destinationPath, filesCopied: 0 };
    }
    throw new Error(
      `Migration refused: destination ${destinationPath} already exists with different contents.`,
    );
  }

  const filesCopied = await copyRecursive(legacyPath, destinationPath);
  const verifyFiles = await listFilesRecursive(destinationPath);
  if (verifyFiles.length !== legacyFiles.length) {
    throw new Error(
      `Migration failed verification: expected ${legacyFiles.length} files, found ${verifyFiles.length}. Source preserved at ${legacyPath}.`,
    );
  }
  // Owner-only root; file contents keep their copied modes. Best effort on
  // platforms without POSIX modes (no-op there, never fatal).
  try {
    await fs.chmod(destinationPath, 0o700);
  } catch {
    // platform without POSIX permissions — documented posture, not fatal
  }
  return { status: "migrated", legacyPath, destinationPath, filesCopied };
}
