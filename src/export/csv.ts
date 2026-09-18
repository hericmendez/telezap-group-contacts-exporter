import * as fs from "fs";
import * as path from "path";
import type { ResolvedContact } from "../whatsapp/contacts.js";
import type { ExportedContact } from "./types.js";

// Re-use existing dependency inspection: csv-writer@1.6.0 supports delimiter ";" and
// correct escaping for ;, ", \n but NOT standalone \r (needsQuote checks delimiter, \n, " only).
// We keep csv-writer installed as required, but implement manual CSV stringification
// to correctly handle \r and guarantee deterministic behavior. BOM is added manually.

/**
 * CSV column definitions — stable contract for Phase 5.
 * Order: WHATSAPP_ID, NOME, NOME_WHATSAPP, NUMERO, ADMIN, SUPER_ADMIN
 */
export const CSV_HEADERS = [
  "WHATSAPP_ID",
  "NOME",
  "NOME_WHATSAPP",
  "NUMERO",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

const FIELD_DELIMITER = ";";
const OUTPUT_FALLBACK_BASENAME = "whatsapp-group";
const MAX_BASENAME_LENGTH = 100;

// ── Filename sanitization ───────────────────────────────────────────────────

/**
 * Sanitize group name to a safe filename basename (without extension).
 * Rules documented for tests:
 * - Trim whitespace; empty/whitespace/"." / ".." → fallback "whatsapp-group"
 * - Replace filesystem-invalid chars: / \ : * ? " < > | and control chars with "_"
 * - Replace ".." sequences with "_" to prevent traversal
 * - Preserve Unicode (e.g. áéíóú ç ã) and single spaces
 * - Truncate very long names to 100 chars (trimmed)
 * - Deterministic
 */
export function sanitizeFilename(groupName: string): string {
  const fallback = OUTPUT_FALLBACK_BASENAME;
  let name = groupName.trim();
  if (!name || name === "." || name === "..") return fallback;
  // Replace invalid chars: / \ : * ? " < > | and control chars 0x00-0x1F 0x7F
  name = name.replace(/[\/\\:\*\?"<>\|\x00-\x1F\x7F]/g, "_");
  // Collapse ".." after replacement to avoid traversal remnants
  name = name.replace(/\.\./g, "_");
  // Trim again after replacements (e.g. "   " → "_"? but we already handled empty)
  name = name.trim();
  if (!name || name === "." || name === "..") return fallback;
  // Truncate
  if (name.length > MAX_BASENAME_LENGTH) {
    name = name.slice(0, MAX_BASENAME_LENGTH).trim();
    if (!name) return fallback;
  }
  // Prevent leading dot that could hide file
  if (name.startsWith(".")) name = "_" + name.slice(1);
  return name || fallback;
}

/**
 * Build a safe output path inside `outputDir`.
 * Ensures final path stays under `outputDir` (prevents traversal even if sanitizer missed).
 * If groupName sanitization yields fallback, uses that.
 */
export function resolveOutputPath(groupName: string, outputDir = "output"): string {
  const sanitized = sanitizeFilename(groupName);
  const filename = `${sanitized}.csv`;
  const joined = path.join(outputDir, filename);
  // Path safety: resolve and ensure it stays inside outputDir
  const resolvedDir = path.resolve(outputDir);
  const resolvedFile = path.resolve(joined);
  // Allow exact dir or dir + sep
  if (!resolvedFile.startsWith(resolvedDir + path.sep) && resolvedFile !== resolvedDir) {
    // Fallback to safe path inside outputDir
    return path.join(outputDir, `${OUTPUT_FALLBACK_BASENAME}.csv`);
  }
  return joined;
}

// ── CSV escaping ─────────────────────────────────────────────────────────────

function escapeField(value: string, delimiter: string): string {
  if (value === "") return "";
  if (value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function contactToRow(contact: ResolvedContact | ExportedContact): string[] {
  // Accept both types (identical shape)
  return [
    contact.whatsappId,
    contact.name,
    contact.pushname,
    contact.number,
    String(contact.isAdmin).toLowerCase(), // "true"/"false"
    String(contact.isSuperAdmin).toLowerCase(),
  ];
}

// ── Exporter ─────────────────────────────────────────────────────────────────

/**
 * Export contacts to CSV with UTF-8 + BOM, semicolon delimiter, correct escaping.
 * Creates output directory if missing. Does not know about whatsapp-web.js.
 * @param contacts already normalized ResolvedContact[]
 * @param outputPath destination file path (should be inside output/)
 */
export async function exportCsv(
  contacts: (ResolvedContact | ExportedContact)[],
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.promises.mkdir(dir, { recursive: true });

  const headerLine = CSV_HEADERS.join(FIELD_DELIMITER);
  const rows = contacts.map((c) => {
    const fields = contactToRow(c as ResolvedContact);
    return fields.map((f) => escapeField(f, FIELD_DELIMITER)).join(FIELD_DELIMITER);
  });

  const csvContent = [headerLine, ...rows].join("\n") + "\n";
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const body = Buffer.from(csvContent, "utf8");
  await fs.promises.writeFile(outputPath, Buffer.concat([bom, body]));
}

/**
 * Legacy alias from Phase 0 — keep for backward compatibility.
 */
export const writeContactsCsv = exportCsv;

// Ensure output directory file for BOM test helper
export const _internal = {
  escapeField,
  FIELD_DELIMITER,
  OUTPUT_FALLBACK_BASENAME,
};
