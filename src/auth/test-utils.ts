import { NextRequest } from "next/server";
import { createSession, __resetSessionsForTests } from "./session.js";
import { SESSION_COOKIE } from "./cookies.js";

/**
 * Test helpers for authenticated route tests. Sessions live in the real
 * in-memory store (reset per test file); tokens are random and synthetic.
 */
export function resetAuthForTests(): void {
  __resetSessionsForTests();
}

/** Build a request carrying a valid session cookie for a synthetic user. */
export function authedRequest(url: string, init?: RequestInit, userId = "test-user"): NextRequest {
  const token = createSession(userId, "tester");
  const headers = new Headers(init?.headers);
  headers.set("Cookie", `${SESSION_COOKIE}=${token}`);
  const { signal: _ignored, ...rest } = init ?? {};
  return new NextRequest(url, { ...rest, headers });
}

/** Build an authenticated JSON POST request. */
export function authedJsonRequest(url: string, body: unknown, userId = "test-user"): NextRequest {
  return authedRequest(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    userId,
  );
}
