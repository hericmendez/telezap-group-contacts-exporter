// ── Telegram last-export slot ───────────────────────────────────────────────
// Per authenticated app user, separate from the WhatsApp slot by design: the
// two platforms must never overwrite or serve each other's files, and neither
// user may reach the other's entries. Same-process memory only; no database.

export interface TelegramLastExport {
  filePath: string;
  filename: string;
  groupId: string;
  groupTitle: string;
  participantCount: number;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __telezapTelegramExports: Map<string, TelegramLastExport> | undefined;
}

function slots(): Map<string, TelegramLastExport> {
  if (!globalThis.__telezapTelegramExports) {
    globalThis.__telezapTelegramExports = new Map<string, TelegramLastExport>();
  }
  return globalThis.__telezapTelegramExports;
}

function requireUserId(userId: string): void {
  if (!userId || typeof userId !== "string") {
    throw new Error("Export slot requires an authenticated userId.");
  }
}

export function setLastTelegramExport(userId: string, entry: TelegramLastExport): void {
  requireUserId(userId);
  slots().set(userId, entry);
}

export function getLastTelegramExport(userId: string): TelegramLastExport | null {
  requireUserId(userId);
  return slots().get(userId) ?? null;
}

/** Test-only hook. */
export function __resetLastTelegramExportForTests(): void {
  slots().clear();
}
