import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifySession } from "./session.js";
import { SESSION_COOKIE } from "./cookies.js";

export interface AuthenticatedUser {
  id: string;
  username: string;
}

function readToken(request: NextRequest): string | null {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return token ? token : null;
}

/**
 * Same-origin check for cookie-authenticated mutations. Pure function so the
 * policy is unit-testable (undici forbids setting `Origin`/`Host` headers
 * from JS, but real browsers always send `Origin` on fetch POST).
 */
export function isSameOriginRequest(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return true;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost === host;
}

/**
 * Single reusable authentication boundary. Returns the authenticated user,
 * or a 401/403 NextResponse the route must return directly:
 *
 *   const auth = await requireAppUser(request);
 *   if (auth instanceof NextResponse) return auth;
 */
export async function requireAppUser(request: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Lightweight CSRF defense for cookie-authenticated mutations:
    // same-origin fetch always sends Origin; a cross-site form/post will
    // either omit it or carry the attacker's origin. SameSite=Lax is the
    // primary defense; this rejects the confused-deputy remainder.
    if (!isSameOriginRequest(request.headers.get("origin"), request.headers.get("host"))) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }
  const token = readToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const record = verifySession(token);
  if (!record) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return { id: record.userId, username: record.username };
}
