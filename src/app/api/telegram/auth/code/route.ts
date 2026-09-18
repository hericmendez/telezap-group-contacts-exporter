import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { telegramErrorResponse } from "../../../../../lib/telegram-http.js";
import { requireAppUser } from "../../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/telegram/auth/code { code } → verify the code. The code exists
// only for this operation: never logged, persisted, or returned.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  let body: { code?: unknown };
  try {
    body = (await request.json()) as { code?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body. Expected { "code": "12345" }.' }, { status: 400 });
  }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: 'Missing code. Send { "code": "12345" }.' }, { status: 400 });
  }
  const manager = getTelegramManager(auth.id);
  try {
    await manager.submitCode(code);
    return NextResponse.json({ verified: true, status: manager.getStatus() });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}
