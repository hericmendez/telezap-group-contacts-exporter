import { SESSION_TTL_MS } from "./session.js";

export const SESSION_COOKIE = "telezap_session";

function isSecureRequest(): boolean {
  return process.env.NODE_ENV === "production";
}

function cookieHeader(token: string, maxAge: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest()) parts.push("Secure");
  return parts.join("; ");
}

/** Set-Cookie value establishing the session (opaque token only). */
export function buildSetSessionCookie(token: string): string {
  return cookieHeader(token, Math.floor(SESSION_TTL_MS / 1000));
}

/** Set-Cookie value clearing the session. */
export function buildClearSessionCookie(): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureRequest()) parts.push("Secure");
  return parts.join("; ");
}
