import { createHash } from "node:crypto";
import * as path from "node:path";

// ── Per-user export namespaces ──────────────────────────────────────────────
// Exports resolve to `output/<scope>/<platform>/…` where scope derives only
// from the server-side authenticated userId (never from request data).
// Deterministic, collision-resistant, filesystem-safe ([0-9a-f] only).

export type ExportPlatform = "whatsapp" | "telegram";

export const EXPORTS_ROOT = "output";

function scopeForUser(userId: string): string {
  return createHash("sha256").update(`telezap:export:v1:${userId}`, "utf8").digest("hex");
}

/**
 * Directory holding one user's exports for one platform. Falls back to the
 * legacy shared directory when no userId is present (CLI / legacy callers),
 * preserving existing behavior exactly.
 */
export function exportDirForUser(
  userId: string | null | undefined,
  platform: ExportPlatform,
  baseDir: string = EXPORTS_ROOT,
): string {
  if (!userId || typeof userId !== "string" || !userId.trim()) return baseDir;
  return path.join(baseDir, scopeForUser(userId), platform);
}
