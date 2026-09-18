import { NextResponse, type NextRequest } from "next/server";
import { getWhatsAppManager } from "../../../lib/whatsapp.js";
import { requireAppUser } from "../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/groups → serializable GroupSummary list. Requires a connection.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getWhatsAppManager(auth.id);
  try {
    const groups = await manager.getGroups();
    return NextResponse.json({ groups });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("not connected")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
