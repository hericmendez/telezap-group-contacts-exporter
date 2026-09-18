import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../../../lib/telegram.js";
import { telegramErrorResponse } from "../../../../../../lib/telegram-http.js";
import { requireAppUser } from "../../../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/telegram/groups/:id/participants → participants of one group,
// identified exclusively by opaque ID. Requires authorization.
// Refused enumeration surfaces as 403 — never as a fake empty list.
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const { id } = await context.params;
  const manager = getTelegramManager(auth.id);
  try {
    const { group, participants } = await manager.getParticipantsByGroupId(id ?? "");
    return NextResponse.json({ groupId: group.id, participants });
  } catch (err) {
    return telegramErrorResponse(err);
  }
}
