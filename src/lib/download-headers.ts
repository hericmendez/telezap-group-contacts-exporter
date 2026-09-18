// ── Safe Content-Disposition for CSV downloads ──────────────────────────────
// Real-world finding: placing a Unicode filename straight into
// `Content-Disposition: attachment; filename="…"` throws
// `TypeError: Cannot convert argument to a ByteString`, because HTTP header
// values are ByteString-only. Strategy (RFC 5987 / RFC 6266):
//   attachment; filename="<ASCII-safe fallback>"; filename*=UTF-8''<percent-encoded>
// Browsers prefer filename* and fall back to filename. Shared by the
// WhatsApp and Telegram download routes — the WhatsApp route had the same
// latent bug for accented group names.

const ASCII_FALLBACK_BASENAME = "download";
const MAX_FALLBACK_LENGTH = 80;

/** Strip a filename down to ByteString-safe ASCII for the `filename` param. */
export function toAsciiFilename(filename: string): string {
  const cleaned = filename
    .replace(/["\\\r\n]/g, "")
    .split("")
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code <= 0x7e ? ch : "_";
    })
    .join("")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return `${ASCII_FALLBACK_BASENAME}.csv`;
  const truncated = cleaned.length > MAX_FALLBACK_LENGTH ? cleaned.slice(0, MAX_FALLBACK_LENGTH) : cleaned;
  return truncated || `${ASCII_FALLBACK_BASENAME}.csv`;
}

/**
 * Build a `Content-Disposition` value safe for arbitrary Unicode filenames.
 * The returned string is pure ASCII (ByteString-safe); the original name
 * travels percent-encoded in `filename*`.
 */
export function contentDispositionAttachment(filename: string): string {
  const fallback = toAsciiFilename(filename);
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
