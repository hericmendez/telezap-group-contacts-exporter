import { NextResponse, type NextRequest } from "next/server";
import { getWhatsAppManager } from "../../../../lib/whatsapp.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/whatsapp/status → serializable connection snapshot.
// Never exposes Client/Chat/Contact/Puppeteer internals (manager contract).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getWhatsAppManager(auth.id);
  return NextResponse.json(manager.getStatus());
}
