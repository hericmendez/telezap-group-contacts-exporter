import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../lib/telegram.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/telegram/status → serializable Telegram snapshot.
// Plain values only: never the client, entities, session, hash, or tokens.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getTelegramManager(auth.id);
  return NextResponse.json(manager.getStatus());
}
