import * as fs from "node:fs/promises";
import { NextResponse, type NextRequest } from "next/server";
import { getLastTelegramExport } from "../../../../../lib/telegram-export.js";
import { contentDispositionAttachment } from "../../../../../lib/download-headers.js";
import { requireAppUser } from "../../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/telegram/export/download → serve the bytes of the most recent
// Telegram export. Controlled: only the file registered by
// POST /api/telegram/export is served — never an arbitrary path.
// Filename travels RFC 5987-safe (ASCII fallback + percent-encoded UTF-8),
// so Unicode group titles never break the ByteString-only header.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const last = getLastTelegramExport(auth.id);
  if (!last) {
    return NextResponse.json(
      { error: "No Telegram export available yet. Export a group first." },
      { status: 404 },
    );
  }

  let bytes: Buffer;
  try {
    bytes = await fs.readFile(last.filePath);
  } catch {
    return NextResponse.json(
      { error: "The exported file is no longer available. Export again." },
      { status: 404 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDispositionAttachment(last.filename),
    },
  });
}
