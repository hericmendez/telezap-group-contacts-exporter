import { NextResponse, type NextRequest } from "next/server";
import { requireAppUser } from "../../../../auth/guard.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/auth/me → { authenticated, user } or 401. Exposes only id and
// username — never hashes, tokens, paths, or platform credentials.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAppUser(request);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ authenticated: true, user: { id: auth.id, username: auth.username } });
}
