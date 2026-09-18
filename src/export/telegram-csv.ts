import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TelegramParticipant } from "../telegram/participants.js";
import { sanitizeFilename } from "./csv.js";

// Telegram CSV export — same proven mechanics as the WhatsApp exporter
// (semicolon, UTF-8 + BOM, escaping, safe filenames) with Telegram's own
// schema. No Next.js / teleproto / manager dependencies: plain data in,
// file out. The WhatsApp exporter file (csv.ts) is intentionally untouched.

// ── Schema (frozen contract, Phase 16) ───────────────────────────────────────
//
// TELEGRAM_ID ← telegramId (exact, never transformed)
// NOME        ← firstName
// SOBRENOME   ← lastName
// USERNAME    ← username (no "@" prefix added)
// NUMERO      ← phone (no "+" added; "" when hidden by privacy)
// ADMIN       ← isAdmin ("true"/"false")
// OWNER       ← isOwner ("true"/"false")
//
// Empty domain fields stay empty. No generic messaging abstraction: this
// module mirrors the WhatsApp serializer deliberately instead of merging it.
export const TELEGRAM_CSV_HEADERS = [
  "TELEGRAM_ID",
  "NOME",
  "SOBRENOME",
  "USERNAME",
  "NUMERO",
  "ADMIN",
  "OWNER",
] as const;

const FIELD_DELIMITER = ";";
const FILENAME_PREFIX = "telegram-";
const OUTPUT_FALLBACK_BASENAME = "telegram-group";
const MAX_BASENAME_LENGTH = 100;

// ── Output path ─────────────────────────────────────────────────────────────

/**
 * Build a safe output path for a Telegram group export.
 * Reuses the shared `sanitizeFilename` (titles are untrusted input), then
 * namespaces with `telegram-` so Telegram and WhatsApp exports of
 * same-titled groups never share a file. Traversal-safe like resolveOutputPath.
 */
export function resolveTelegramOutputPath(groupTitle: string, outputDir = "output"): string {
  const trimmed = groupTitle.trim();
  // Empty/dots titles fall back to the Telegram basename (the shared
  // sanitizer would otherwise yield its own "whatsapp-group" fallback).
  const sanitized =
    !trimmed || trimmed === "." || trimmed === ".." ? OUTPUT_FALLBACK_BASENAME : sanitizeFilename(trimmed);
  const truncated =
    sanitized.length > MAX_BASENAME_LENGTH ? sanitized.slice(0, MAX_BASENAME_LENGTH).trim() : sanitized;
  const filename = `${FILENAME_PREFIX}${truncated || OUTPUT_FALLBACK_BASENAME}.csv`;
  const joined = path.join(outputDir, filename);
  const resolvedDir = path.resolve(outputDir);
  const resolvedFile = path.resolve(joined);
  if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
    return path.join(outputDir, `${FILENAME_PREFIX}${OUTPUT_FALLBACK_BASENAME}.csv`);
  }
  return joined;
}

// ── Escaping (same semantics as the WhatsApp exporter) ──────────────────────

function escapeField(value: string, delimiter: string): string {
  if (value === "") return "";
  if (value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function participantToRow(participant: TelegramParticipant): string[] {
  return [
    participant.telegramId,
    participant.firstName,
    participant.lastName,
    participant.username,
    participant.phone,
    String(participant.isAdmin).toLowerCase(),
    String(participant.isOwner).toLowerCase(),
  ];
}

// ── Exporter ────────────────────────────────────────────────────────────────

/**
 * Export Telegram participants to CSV: UTF-8 + BOM, semicolon delimiter,
 * correct escaping, deterministic row order (input order preserved).
 * Creates the output directory if missing.
 */
export async function exportTelegramCsv(
  participants: TelegramParticipant[],
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.mkdir(dir, { recursive: true });

  const headerLine = TELEGRAM_CSV_HEADERS.join(FIELD_DELIMITER);
  const rows = participants.map((p) =>
    participantToRow(p)
      .map((f) => escapeField(f, FIELD_DELIMITER))
      .join(FIELD_DELIMITER),
  );

  const csvContent = [headerLine, ...rows].join("\n") + "\n";
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = Buffer.from(csvContent, "utf8");
  await fs.writeFile(outputPath, Buffer.concat([bom, body]));
}

export const _internal = { escapeField, FIELD_DELIMITER, FILENAME_PREFIX };
