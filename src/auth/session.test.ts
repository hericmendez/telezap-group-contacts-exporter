import { describe, it, expect, beforeEach } from "vitest";
import {
  createSession,
  getSession,
  destroySession,
  SESSION_TTL_MS,
  __resetSessionsForTests,
  __sessionCountForTests,
} from "./session.js";
import { buildSetSessionCookie, buildClearSessionCookie, SESSION_COOKIE } from "./cookies.js";

beforeEach(() => {
  __resetSessionsForTests();
});

describe("server session store", () => {
  it("creates opaque tokens bound to users", () => {
    const a = createSession("u1", "revi");
    const b = createSession("u2", "grazi");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(getSession(a)).toMatchObject({ userId: "u1", username: "revi" });
    expect(getSession(b)).toMatchObject({ userId: "u2", username: "grazi" });
    expect(__sessionCountForTests()).toBe(2);
  });

  it("rejects unknown tokens and honors expiry", () => {
    expect(getSession("nope")).toBeNull();
    const t = createSession("u1", "revi", 1000);
    expect(getSession(t, 1000 + SESSION_TTL_MS - 1)).not.toBeNull();
    // a fresh session without sliding use expires exactly at createdAt + TTL
    const t2 = createSession("u1", "revi", 5000);
    expect(getSession(t2, 5000 + SESSION_TTL_MS)).toBeNull();
  });

  it("slides expiry on use and destroys on logout", () => {
    const t = createSession("u1", "revi", 1000);
    getSession(t, 2000);
    // still valid at original expiry because use at t=2000 extended it
    expect(getSession(t, 1000 + SESSION_TTL_MS)).not.toBeNull();
    expect(destroySession(t)).toBe(true);
    expect(getSession(t)).toBeNull();
    expect(destroySession(t)).toBe(false);
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
