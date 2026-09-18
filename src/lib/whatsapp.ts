import { WhatsAppManager } from "../whatsapp/manager.js";

// ── Per-user manager registry ───────────────────────────────────────────────
// One WhatsAppManager per authenticated app user, cached on globalThis so
// Next.js dev HMR (module re-evaluation) cannot leak clients. The managers
// themselves are unchanged single-session instances; the registry only
// decides WHICH instance a request gets.
//
// LIMITATION (until M5 for exports; session storage isolated since M3):
// physical session storage is now per-user, so concurrent live WhatsApp
// connections no longer share LocalAuth state. Export slots and `output/`
// remain process-global (M5).
declare global {
  // eslint-disable-next-line no-var
  var __whatsappManagers: Map<string, WhatsAppManager> | undefined;
}

function registry(): Map<string, WhatsAppManager> {
  if (!globalThis.__whatsappManagers) {
    globalThis.__whatsappManagers = new Map<string, WhatsAppManager>();
  }
  return globalThis.__whatsappManagers;
}

/**
 * Return the caller's manager, creating it on first use. Creation is
 * synchronous (no browser/client is created until connect()), so concurrent
 * first calls cannot produce duplicates: the instance is inserted before
 * any await runs. The manager receives the userId and owns an isolated
 * LocalAuth session scope derived from it (M3).
 */
export function getWhatsAppManager(userId: string): WhatsAppManager {
  if (!userId || typeof userId !== "string") {
    throw new Error("getWhatsAppManager requires an authenticated userId.");
  }
  const managers = registry();
  const existing = managers.get(userId);
  if (existing) return existing;
  // Server-side: never print QR to the terminal (no TTY scan flow here);
  // the web UI renders the raw QR from getQRCode() instead.
  // The userId threads into the manager so its LocalAuth session is
  // physically isolated per app user (M3).
  const manager = new WhatsAppManager({ showQrInTerminal: false, userId });
  managers.set(userId, manager);
  return manager;
}

/** Disconnect and drop a user's manager. Unknown users are a no-op. */
export async function destroyWhatsAppManager(userId: string): Promise<void> {
  const manager = registry().get(userId);
  if (!manager) return;
  registry().delete(userId);
  await manager.disconnect();
}

/**
 * Disconnect and drop every WhatsApp manager. One user's failure never
 * blocks the others; per-user errors are collected in the result.
 */
export async function destroyAllWhatsAppManagers(): Promise<{
  destroyed: string[];
  errors: { userId: string; message: string }[];
}> {
  const destroyed: string[] = [];
  const errors: { userId: string; message: string }[] = [];
  for (const userId of [...registry().keys()]) {
    try {
      await destroyWhatsAppManager(userId);
      destroyed.push(userId);
    } catch (err) {
      errors.push({ userId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { destroyed, errors };
}

/** Test-only hook: drop all cached instances so tests stay isolated. */
export function __resetManagerForTests(): void {
  registry().clear();
}
