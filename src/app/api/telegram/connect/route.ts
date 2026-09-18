import { NextResponse, type NextRequest } from "next/server";
import { getTelegramManager } from "../../../../lib/telegram.js";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/telegram/connect → start connecting (fire-and-forget).
// Progress via polling GET /api/telegram/status. Failures are recorded on
// the manager and visible as status.error. Never creates a second manager.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  const manager = getTelegramManager(auth.id);
  const current = manager.getStatus();
  if (current.authorized || current.transport !== "disconnected") {
    return NextResponse.json({ started: false, status: current });
  }
  // Intentionally not awaited: connecting may take a while.
  void manager.connect().catch(() => {});
  return NextResponse.json({ started: true, status: manager.getStatus() });
}
