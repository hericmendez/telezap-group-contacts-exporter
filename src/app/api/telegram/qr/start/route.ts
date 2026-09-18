import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { telegramErrorResponse } from "../../../../../lib/telegram-http.js";
import { requireAppUser } from "../../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/telegram/qr/start → begin QR login (fire-and-forget; tokens
// auto-refresh server-side ~30s). Track via GET /api/telegram/status.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getTelegramManager(auth.id);
  try {
    const current = manager.getStatus();
    if (current.authorized) {
      return NextResponse.json({ started: false, status: current });
    }
    if (current.transport !== "connected") {
      return NextResponse.json(
        { error: "Telegram client is not connected. Call POST /api/telegram/connect first." },
        { status: 409 },
      );
    }
    if (current.loginStep !== "none") {
      return NextResponse.json(
        { error: "A Telegram login attempt is already in progress." },
        { status: 409 },
      );
    }
    // Intentionally not awaited: authorization waits on the user scan.
    void manager.startQrLogin().catch(() => {});
    return NextResponse.json({ started: true, status: manager.getStatus() });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}
