import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../lib/telegram.js";
import { telegramErrorResponse } from "../../../../lib/telegram-http.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/telegram/groups → accessible groups/supergroups (deterministic
// order, duplicate titles included). Requires authorization (401 otherwise).
// Plain summaries only: opaque string ids, no accessHash, no entities.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getTelegramManager(auth.id);
  try {
    const groups = await manager.getGroups();
    return NextResponse.json({ groups });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}
