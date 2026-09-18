import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../lib/telegram.js";
import { setLastTelegramExport } from "../../../../lib/telegram-export.js";
import { telegramErrorResponse } from "../../../../lib/telegram-http.js";
import { TelegramGroupNotFoundError } from "../../../../telegram/group.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportBody {
  groupId?: unknown;
  excludeHiddenPhone?: unknown;
}

// POST /api/telegram/export { groupId } → export one group's participants
// to CSV via the shared manager. Selection is by opaque ID only — a
// groupName-only body is rejected, no compat shim. The client stays
// connected. Responds with safe metadata (no filePath); the file is
// registered in the Telegram last-export slot for the download route.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body. Expected { "groupId": "123456789" }.' }, { status: 400 });
  }

  const groupId = typeof body.groupId === "string" ? body.groupId.trim() : "";
  if (!groupId) {
    return NextResponse.json({ error: 'Missing groupId. Send { "groupId": "123456789" }.' }, { status: 400 });
  }
  if (body.excludeHiddenPhone !== undefined && typeof body.excludeHiddenPhone !== "boolean") {
    return NextResponse.json({ error: 'Invalid excludeHiddenPhone. Send a boolean.' }, { status: 400 });
  }

  const manager = getTelegramManager(auth.id);
  try {
    const result = await manager.exportGroupById(groupId, {
      excludeHiddenPhone: body.excludeHiddenPhone === true,
    });
    setLastTelegramExport(auth.id, {
      filePath: result.filePath,
      filename: result.filename,
      groupId: result.groupId,
      groupTitle: result.groupTitle,
      participantCount: result.participantCount,
      createdAt: new Date().toISOString(),
    });
    const { filePath: _stripped, ...safe } = result;
    return NextResponse.json({ ...safe, downloadUrl: "/api/telegram/export/download" });
  } catch (err) {
    if (err instanceof TelegramGroupNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return telegramErrorResponse(err);
  }
}
