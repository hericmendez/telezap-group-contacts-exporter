// ── Last-export store ───────────────────────────────────────────────────────
// Remembers, per authenticated app user, the most recent CSV produced by
// POST /api/export so that GET /api/export/download can serve exactly that
// file — never an arbitrary path from `output/`, and never another user's
// file. Same-process memory only (a restart invalidates references); no
// database.

export interface LastExport {
  filePath: string;
  groupName: string;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __telezapLastExports: Map<string, LastExport> | undefined;
}

function slots(): Map<string, LastExport> {
  if (!globalThis.__telezapLastExports) {
    globalThis.__telezapLastExports = new Map<string, LastExport>();
  }
  return globalThis.__telezapLastExports;
}

function requireUserId(userId: string): void {
  if (!userId || typeof userId !== "string") {
    throw new Error("Export slot requires an authenticated userId.");
  }
}

export function setLastExport(userId: string, entry: LastExport): void {
  requireUserId(userId);
  slots().set(userId, entry);
}

export function getLastExport(userId: string): LastExport | null {
  requireUserId(userId);
  return slots().get(userId) ?? null;
}

/** Test-only hook. */
export function __resetLastExportForTests(): void {
  slots().clear();
}
