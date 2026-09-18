import { NextResponse, type NextRequest } from "next/server";
import { buildClearSessionCookie } from "../../../../auth/cookies.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/logout → clear the cookie and return same contract.
// Não há Map para invalidar — o token stateless permanece válido até exp,
// mas sem o cookie o browser não o envia. Não toca managers/sessões de
// plataforma (logout ≠ revogação). Não há blacklist/DB neste escopo.
export async function POST(_request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.json({ authenticated: false });
  response.headers.set("Set-Cookie", buildClearSessionCookie());
  return response;
}
