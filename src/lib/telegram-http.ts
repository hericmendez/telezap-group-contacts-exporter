import { NextResponse } from "next/server";
import { TelegramGroupNotFoundError } from "../telegram/group.js";
import { TelegramFloodError, TelegramParticipantsUnavailableError } from "../telegram/participants.js";

/**
 * Map Telegram failures to safe HTTP responses.
 * Bodies/messages are already sanitized by the domain (no secrets, no raw
 * MTProto dumps); this helper only chooses the status code.
 */
export function telegramRouteError(err: unknown): { error: string; status: number } {
  if (err instanceof TelegramGroupNotFoundError) {
    return { error: err.message, status: 404 };
  }
  if (err instanceof TelegramParticipantsUnavailableError) {
    return { error: err.message, status: 403 };
  }
  if (err instanceof TelegramFloodError) {
    return { error: err.message, status: 429 };
  }
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Telegram client is not connected")) {
    return { error: message, status: 409 };
  }
  if (message.includes("Telegram authentication is required")) {
    return { error: message, status: 401 };
  }
  if (message.startsWith("No pending")) {
    // Wrong authentication step (e.g. code without a pending request).
    return { error: message, status: 401 };
  }
  if (message.includes("rate-limiting")) {
    return { error: message, status: 429 };
  }
  return { error: message, status: 500 };
}

export function telegramErrorResponse(err: unknown): NextResponse {
  const { error, status } = telegramRouteError(err);
  return NextResponse.json({ error }, { status });
}
