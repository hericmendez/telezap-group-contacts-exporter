import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { getLastExport } from "../../../../lib/last-export.js";
import { contentDispositionAttachment } from "../../../../lib/download-headers.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/export/download → serve the bytes of the most recent export.
// Controlled: only the file registered by POST /api/export is served —
// never an arbitrary path from output/. Format preserved byte-for-byte
// (semicolon, UTF-8 + BOM, escaping) as written by the CSV exporter.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const last = getLastExport(auth.id);
  if (!last) {
    return NextResponse.json(
      { error: "No export available yet. Export a group first." },
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

  const filename = path.basename(last.filePath);
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // Shared helper: accented group names used to throw ByteString errors here.
      "Content-Disposition": contentDispositionAttachment(filename),
    },
  });
}
