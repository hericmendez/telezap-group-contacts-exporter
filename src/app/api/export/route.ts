import { NextResponse, type NextRequest } from "next/server";
import { getWhatsAppManager } from "../../../lib/whatsapp.js";
import { setLastExport } from "../../../lib/last-export.js";
import { GroupNotFoundError } from "../../../whatsapp/group.js";
import { requireAppUser } from "../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportBody {
  groupId?: unknown;
}

// POST /api/export { groupId } → run the full pipeline via the shared
// manager and return the structured result. The group ID is the operation
// identity (opaque, e.g. `120363...@g.us`); the name is presentation only,
// so duplicate group names export unambiguously. The WhatsApp client stays
// connected afterwards. The produced file is registered as the "last
// export" so GET /api/export/download can serve exactly that file.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body. Expected { "groupId": "120363...@g.us" }.' }, { status: 400 });
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId. Send { "groupId": "120363...@g.us" }.' }, { status: 400 });
  }

  const manager = getWhatsAppManager(auth.id);
  try {
    const result = await manager.exportGroupById(groupId);
    setLastExport(auth.id, {
      filePath: result.outputPath,
      groupName: result.groupName,
      createdAt: new Date().toISOString(),
    });
    const { outputPath: _stripped, ...safe } = result;
    return NextResponse.json({ ...safe, downloadUrl: "/api/export/download" });
  } catch (err) {
    if (err instanceof GroupNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not connected")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
