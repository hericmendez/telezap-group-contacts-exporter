import { NextResponse, type NextRequest } from "next/server";
import { getWhatsAppManager } from "../../../../lib/whatsapp.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/whatsapp/qr → raw QR string for the frontend to render.
// The backend never renders QR as an image; `qr` is null when none is pending.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getWhatsAppManager(auth.id);
  return NextResponse.json({ qr: manager.getQRCode() });
}
