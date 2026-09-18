import * as dotenv from "dotenv";

dotenv.config();

export interface TelegramConfig {
  apiId: number;
  apiHash: string;
}

/**
 * Load Telegram MTProto credentials from the server environment.
 * Both values are server-only (never NEXT_PUBLIC_, never sent to browsers).
 * Error messages never include the values themselves.
 */
export function loadTelegramConfig(): TelegramConfig {
  const rawId = (process.env.TELEGRAM_API_ID ?? "").trim();
  const apiHash = (process.env.TELEGRAM_API_HASH ?? "").trim();

  if (!rawId) {
    throw new Error("Missing TELEGRAM_API_ID. Create an application at https://my.telegram.org and set TELEGRAM_API_ID in .env.");
  }
  const apiId = Number(rawId);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new Error("Invalid TELEGRAM_API_ID. It must be a positive integer from https://my.telegram.org.");
  }
  if (!apiHash) {
    throw new Error("Missing TELEGRAM_API_HASH. Set TELEGRAM_API_HASH in .env (server-only, never commit it).");
  }
  return { apiId, apiHash };
}
