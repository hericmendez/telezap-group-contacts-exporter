import { NextResponse, type NextRequest } from "next/server";
import { verifyPassword } from "../../../../auth/hash.js";
import { findAppUser, loadAppUsers } from "../../../../auth/users.js";
import { createSession } from "../../../../auth/session.js";
import { buildSetSessionCookie } from "../../../../auth/cookies.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/auth/login { username, password } → 200 + HttpOnly session
// cookie. Generic 401 on any credential failure (never reveals whether the
// username exists). Never returns passwords, hashes, or platform state.
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as { username?: unknown; password?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  let users;
  try {
    users = loadAppUsers();
  } catch {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }
  const user = findAppUser(users, username);
  const ok = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const token = createSession(user.id, user.username);
  const response = NextResponse.json({ authenticated: true, user: { id: user.id, username: user.username } });
  response.headers.set("Set-Cookie", buildSetSessionCookie(token));
  return response;
}
