import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { requireAppUser } from "./guard.js";
import { createSession } from "./session.js";
import { SESSION_COOKIE } from "./cookies.js";

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

function request(url: string, init?: { method?: string; headers?: Record<string, string> }): NextRequest {
  return new NextRequest(url, init);
}

describe("requireAppUser", () => {
  it("returns 401 without a session", async () => {
    const out = await requireAppUser(request("http://localhost/api/groups"));
    if (!(out instanceof NextResponse)) throw new Error("expected 401 response");
    expect(out.status).toBe(401);
    expect(await out.json()).toEqual({ error: "Unauthorized." });
  });

  it("returns 401 for forged tokens", async () => {
    const out = await requireAppUser(
      request("http://localhost/api/groups", { headers: { Cookie: `${SESSION_COOKIE}=forged` } }),
    );
    expect((out as NextResponse).status).toBe(401);
  });

  it("resolves userA vs userB sessions distinctly", async () => {
    const { createSession: create } = await import("./session.js");
    const tokenA = create("alice", "alice");
    const tokenB = create("bob", "bob");
    expect(tokenA).not.toBe(tokenB);
    const a = await requireAppUser(
      request("http://localhost/api/groups", { headers: { Cookie: `${SESSION_COOKIE}=${tokenA}` } }),
    );
    const b = await requireAppUser(
      request("http://localhost/api/groups", { headers: { Cookie: `${SESSION_COOKIE}=${tokenB}` } }),
    );
    expect(a).toEqual({ id: "alice", username: "alice" });
    expect(b).toEqual({ id: "bob", username: "bob" });
  });

  it("enforces same-origin policy on values browsers actually send", async () => {
    const { isSameOriginRequest } = await import("./guard.js");
    // No Origin (plain navigation / non-browser client): allowed, SameSite=Lax covers browsers.
    expect(isSameOriginRequest(null, "localhost:3000")).toBe(true);
    expect(isSameOriginRequest("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(isSameOriginRequest("https://evil.example", "localhost:3000")).toBe(false);
    expect(isSameOriginRequest("not-a-url", "localhost:3000")).toBe(false);
    expect(isSameOriginRequest("https://evil.example", null)).toBe(true);
  });

  it("allows authenticated same-origin mutations through the boundary", async () => {
    const token = createSession("u1", "revi");
    const cookie = { Cookie: `${SESSION_COOKIE}=${token}` };
    const same = { method: "POST", headers: cookie };
    const sameRes = await requireAppUser(request("http://localhost/api/export", same));
    expect(sameRes).toEqual({ id: "u1", username: "revi" });

    const getEvil = await requireAppUser(request("http://localhost/api/groups", { headers: cookie }));
    expect(getEvil).toEqual({ id: "u1", username: "revi" });
  });
});
