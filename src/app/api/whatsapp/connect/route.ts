import { NextResponse, type NextRequest } from "next/server";
import { getWhatsAppManager } from "../../../../lib/whatsapp.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/whatsapp/connect → start connecting (fire-and-forget).
// The frontend tracks progress by polling GET /api/whatsapp/status
// (connecting → qr → connected). Never creates a second manager/client.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getWhatsAppManager(auth.id);
  const current = manager.getStatus().status;
  if (current === "connected" || current === "connecting" || current === "qr") {
    return NextResponse.json({ started: false, status: current });
  }
  // Intentionally not awaited: connecting may wait on a QR scan.
  // Failures are recorded on the manager and visible via getStatus().error.
  void manager.connect().catch(() => {});
  return NextResponse.json({ started: true, status: manager.getStatus().status });
}
