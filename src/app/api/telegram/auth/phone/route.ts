import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { telegramErrorResponse } from "../../../../../lib/telegram-http.js";
import { requireAppUser } from "../../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/telegram/auth/phone { phone } → send the verification code.
// The phone number is used for this operation only and is not persisted.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  let body: { phone?: unknown };
  try {
    body = (await request.json()) as { phone?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body. Expected { "phone": "+5516999999999" }.' }, { status: 400 });
  }
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!phone) {
    return NextResponse.json({ error: 'Missing phone. Send { "phone": "+5516999999999" }.' }, { status: 400 });
  }
  const manager = getTelegramManager(auth.id);
  try {
    await manager.startPhoneLogin(phone);
    return NextResponse.json({ sent: true, status: manager.getStatus() });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}
