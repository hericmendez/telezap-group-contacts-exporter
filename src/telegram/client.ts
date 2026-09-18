import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { logger } from "../utils/logger.js";

// ── Low-level teleproto boundary ────────────────────────────────────────────
// Owns TelegramClient creation only. Everything else (lifecycle, auth steps,
// session file handling) belongs to TelegramManager. Nothing here touches
// the network.

/**
 * Build a TelegramClient for a user MTProto session.
 * `sessionData` is "" for a fresh login, or the persisted StringSession
 * payload to resume. The rest of the app must never instantiate
 * TelegramClient directly — always go through this factory (or a manager
 * wrapping it).
 */
export function buildTelegramClient(
  sessionData: string,
  apiId: number,
  apiHash: string,
): TelegramClient {
  return new TelegramClient(new StringSession(sessionData), apiId, apiHash, {
    connectionRetries: 5,
  });
}

/** Log a Telegram failure without leaking secrets (class name only). */
export function logTelegramError(context: string, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  logger.warn(`Telegram ${context} failed: ${name}`);
}
