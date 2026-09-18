import { logger } from "../utils/logger.js";
import { destroyAllWhatsAppManagers } from "./whatsapp.js";
import { destroyAllTelegramManagers } from "./telegram.js";

// ── Process lifecycle coordination (single point) ───────────────────────────
// One place owns "shut every platform client down": registries hold the
// managers, this module walks them. Platform sessions on disk are NEVER
// touched here — destroy means "end the in-process instance", revocation
// stays an explicit platform-auth operation.
//
// HMR safety: shutdown progress lives on globalThis so a module
// re-evaluation in development cannot start a second concurrent shutdown
// or register process handlers twice.

declare global {
  // eslint-disable-next-line no-var
  var __telezapShutdown: { started: boolean; handlersRegistered: boolean } | undefined;
}

function shutdownState(): { started: boolean; handlersRegistered: boolean } {
  if (!globalThis.__telezapShutdown) {
    globalThis.__telezapShutdown = { started: false, handlersRegistered: false };
  }
  return globalThis.__telezapShutdown;
}

export interface ShutdownSummary {
  whatsapp: { destroyed: string[]; errors: { userId: string; message: string }[] };
  telegram: { destroyed: string[]; errors: { userId: string; message: string }[] };
}

/**
 * Disconnect and drop every WhatsApp and Telegram manager. Idempotent:
 * concurrent or repeated calls share a single effective run. One user's
 * failure is recorded (userId + message, never secrets) without blocking
 * the remaining cleanup.
 */
export async function shutdownAllManagers(): Promise<ShutdownSummary> {
  const state = shutdownState();
  if (state.started) {
    return { whatsapp: { destroyed: [], errors: [] }, telegram: { destroyed: [], errors: [] } };
  }
  state.started = true;
  const whatsapp = await destroyAllWhatsAppManagers().catch((err: unknown) => ({
    destroyed: [] as string[],
    errors: [{ userId: "(registry)", message: err instanceof Error ? err.message : String(err) }],
  }));
  const telegram = await destroyAllTelegramManagers().catch((err: unknown) => ({
    destroyed: [] as string[],
    errors: [{ userId: "(registry)", message: err instanceof Error ? err.message : String(err) }],
  }));
  const totalErrors = whatsapp.errors.length + telegram.errors.length;
  logger.info(
    `Shutdown complete: ${whatsapp.destroyed.length} WhatsApp and ${telegram.destroyed.length} Telegram manager(s) destroyed` +
      (totalErrors > 0 ? `, ${totalErrors} error(s)` : "") +
      ".",
  );
  for (const entry of [...whatsapp.errors, ...telegram.errors]) {
    logger.warn(`Shutdown cleanup failed for user ${entry.userId}: ${entry.message}`);
  }
  return { whatsapp, telegram };
}

/**
 * Attach process-wide SIGINT/SIGTERM cleanup exactly once per process.
 * Safe to call repeatedly (dev HMR, tests): only the first call registers.
 * Handlers clean up clients and return; they never call process.exit —
 * exiting stays the launcher's decision (the CLI keeps its own behavior).
 */
export function registerProcessShutdownHandlers(): void {
  const state = shutdownState();
  if (state.handlersRegistered) return;
  state.handlersRegistered = true;
  const handleSignal = (signal: string): void => {
    logger.info(`Shutdown requested (${signal})...`);
    void shutdownAllManagers();
  };
  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}

/** Test-only hook: reset shutdown progress so tests stay isolated. */
export function __resetLifecycleForTests(): void {
  const state = shutdownState();
  state.started = false;
}
