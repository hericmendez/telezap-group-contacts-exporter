import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { requireAppUser } from "../../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/telegram/qr/cancel → abort a running Telegram login attempt.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getTelegramManager(auth.id);
  await manager.cancelLogin();
  return NextResponse.json({ cancelled: true, status: manager.getStatus() });
}
