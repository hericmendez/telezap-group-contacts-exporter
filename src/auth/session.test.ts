import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createSession,
  verifySession,
  SESSION_TTL_MS,
} from "./session.js";
import { buildSetSessionCookie, buildClearSessionCookie, SESSION_COOKIE } from "./cookies.js";

const TEST_SECRET = "test-secret-stateless-32-bytes-long-1234";

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.TELEZAP_SESSION_SECRET;
  process.env.TELEZAP_SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.TELEZAP_SESSION_SECRET;
  else process.env.TELEZAP_SESSION_SECRET = savedSecret;
});

describe("stateless session (HMAC)", () => {
  it("creates valid tokens bound to users", () => {
    const a = createSession("u1", "revi");
    const b = createSession("u2", "grazi");
    expect(a).not.toBe(b);
    // token is base64url.payload.base64url(sig), not the old 64 hex
    expect(a).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifySession(a)).toMatchObject({ userId: "u1", username: "revi" });
    expect(verifySession(b)).toMatchObject({ userId: "u2", username: "grazi" });
  });

  it("verifies without any Map-stored state", () => {
    const token = createSession("u1", "revi", 1000);
    // não há Map — verify funciona só com o token e o segredo
    expect(verifySession(token, 1000 + 1000)).toMatchObject({ userId: "u1" });
    expect(verifySession(token, 1000 + SESSION_TTL_MS - 1)).not.toBeNull();
  });

  it("rejects expired tokens (TTL fixo)", () => {
    expect(verifySession("nope")).toBeNull();
    const t = createSession("u1", "revi", 1000);
    expect(verifySession(t, 1000 + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(verifySession(t, 1000 + SESSION_TTL_MS)).toBeNull();
    expect(verifySession(t, 1000 + SESSION_TTL_MS + 1000)).toBeNull();
    // sem sliding: uso não estende
    const t2 = createSession("u1", "revi", 1000);
    verifySession(t2, 2000);
    expect(verifySession(t2, 1000 + SESSION_TTL_MS)).toBeNull();
  });

  it("rejects tampered tokens", () => {
    const t = createSession("u1", "revi");
    const [payload, sig] = t.split(".");
    // payload adulterado
    const tamperedPayload = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    expect(verifySession(`${tamperedPayload}.${sig}`)).toBeNull();
    // assinatura adulterada
    const tamperedSig = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
    expect(verifySession(`${payload}.${tamperedSig}`)).toBeNull();
  });

  it("rejects tokens with wrong secret", () => {
    const t = createSession("u1", "revi");
    process.env.TELEZAP_SESSION_SECRET = "different-secret-32-bytes-long-9999";
    expect(verifySession(t)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifySession("")).toBeNull();
    expect(verifySession("no-dot")).toBeNull();
    expect(verifySession(".sig")).toBeNull();
    expect(verifySession("payload.")).toBeNull();
    expect(verifySession("not-base64!@#.sig")).toBeNull();
  });

  it("keeps A ≠ B and never leaks payload secrets", () => {
    const a = createSession("alice", "alice");
    const b = createSession("bob", "bob");
    expect(a).not.toBe(b);
    expect(verifySession(a)).toMatchObject({ userId: "alice" });
    expect(verifySession(b)).toMatchObject({ userId: "bob" });
    // token decodificado não contém senha/hash
    const payload = JSON.parse(Buffer.from(a.split(".")[0]!, "base64url").toString("utf8"));
    expect(payload).not.toHaveProperty("password");
    expect(payload).not.toHaveProperty("hash");
  });
});

describe("session cookie", () => {
  it("is HttpOnly, SameSite, Path-rooted, and opaque", () => {
    const header = buildSetSessionCookie("abc123");
    expect(header).toContain(`${SESSION_COOKIE}=abc123`);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=");
    expect(header).not.toContain("revi");
  });

  it("clears with Max-Age=0", () => {
    const header = buildClearSessionCookie();
    expect(header).toContain("Max-Age=0");
    expect(header).toContain("HttpOnly");
  });
});
