import { TelegramManager } from "../telegram/manager.js";

// ── Per-user manager registry ───────────────────────────────────────────────
// Same HMR-safe pattern as WhatsApp: one TelegramManager per authenticated
// app user, cached on globalThis. Managers stay independent single-session
// instances; the registry only decides WHICH instance a request gets.
//
// LIMITATION (until M5 for exports): Telegram session storage is now
// per-user, but export slots and `output/` remain process-global.
declare global {
  // eslint-disable-next-line no-var
  var __telegramManagers: Map<string, TelegramManager> | undefined;
}

function registry(): Map<string, TelegramManager> {
  if (!globalThis.__telegramManagers) {
    globalThis.__telegramManagers = new Map<string, TelegramManager>();
  }
  return globalThis.__telegramManagers;
}

/**
 * Return the caller's manager, creating it on first use. Creation is
 * synchronous (no client is created until connect()), so concurrent first
 * calls cannot produce duplicates: the instance is inserted before any
 * await runs.
 */
export function getTelegramManager(userId: string): TelegramManager {
  if (!userId || typeof userId !== "string") {
    throw new Error("getTelegramManager requires an authenticated userId.");
  }
  const managers = registry();
  const existing = managers.get(userId);
  if (existing) return existing;
  // The userId threads into the manager so its Telegram session file is
  // physically isolated per app user (M4).
  const manager = new TelegramManager({ userId });
  managers.set(userId, manager);
  return manager;
}

/** Disconnect and drop a user's manager. Unknown users are a no-op. */
export async function destroyTelegramManager(userId: string): Promise<void> {
  const manager = registry().get(userId);
  if (!manager) return;
  registry().delete(userId);
  await manager.disconnect();
}

/**
 * Disconnect and drop every Telegram manager. One user's failure never
 * blocks the others; per-user errors are collected in the result.
 */
export async function destroyAllTelegramManagers(): Promise<{
  destroyed: string[];
  errors: { userId: string; message: string }[];
}> {
  const destroyed: string[] = [];
  const errors: { userId: string; message: string }[] = [];
  for (const userId of [...registry().keys()]) {
    try {
      await destroyTelegramManager(userId);
      destroyed.push(userId);
    } catch (err) {
      errors.push({ userId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { destroyed, errors };
}

/** Test-only hook: drop all cached instances so tests stay isolated. */
export function __resetTelegramManagerForTests(): void {
  registry().clear();
}
