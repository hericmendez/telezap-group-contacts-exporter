import { NextRequest } from "next/server";
import { createSession, __resetSessionsForTests } from "./session.js";
import { SESSION_COOKIE } from "./cookies.js";

const TEST_SECRET = "test-secret-stateless-32-bytes-long-1234";

function ensureTestSecret(): void {
  if (!process.env.TELEZAP_SESSION_SECRET) {
    process.env.TELEZAP_SESSION_SECRET = TEST_SECRET;
  }
}

/**
 * Test helpers for authenticated route tests. Tokens are stateless HMAC
 * (nenhum Map) — resetAuthForTests é no-op, mantido para compatibilidade.
 */
export function resetAuthForTests(): void {
  ensureTestSecret();
  __resetSessionsForTests();
}

/** Build a request carrying a valid session cookie for a synthetic user. */
export function authedRequest(url: string, init?: RequestInit, userId = "test-user"): NextRequest {
  ensureTestSecret();
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
