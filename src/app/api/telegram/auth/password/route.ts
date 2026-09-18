import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { telegramErrorResponse } from "../../../../../lib/telegram-http.js";
import { requireAppUser } from "../../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/telegram/auth/password { password } → complete 2FA. The
// password is transient: function argument only, never stored, logged,
// persisted, or echoed back.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body. Expected { \"password\": \"...\" }." }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) {
    return NextResponse.json({ error: "Missing password." }, { status: 400 });
  }
  const manager = getTelegramManager(auth.id);
  try {
    await manager.submitPassword(password);
    return NextResponse.json({ verified: true, status: manager.getStatus() });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}
