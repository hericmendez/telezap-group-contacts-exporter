import { NextResponse, type NextRequest } from "next/server";
import { buildClearSessionCookie } from "../../../../auth/cookies.js";
import { destroySession } from "../../../../auth/session.js";
import { SESSION_COOKIE } from "../../../../auth/cookies.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/logout → invalidate the application session and clear the
// cookie. Does NOT touch WhatsApp/Telegram clients, sessions, or exports —
// logout only means this browser is no longer authenticated to TeleZap.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const response = NextResponse.json({ authenticated: false });
  response.headers.set("Set-Cookie", buildClearSessionCookie());
  return response;
}
