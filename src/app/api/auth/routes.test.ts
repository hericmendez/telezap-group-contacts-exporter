import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as loginPOST } from "./login/route.js";
import { GET as meGET } from "./me/route.js";
import { POST as logoutPOST } from "./logout/route.js";
import { hashPassword } from "../../../auth/hash.js";
import { __resetSessionsForTests } from "../../../auth/session.js";
import { SESSION_COOKIE } from "../../../auth/cookies.js";

let savedUsers: string | undefined;

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function cookieFrom(res: Response): string | null {
  const header = res.headers.get("Set-Cookie");
  if (!header) return null;
  const match = header.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
  return match ? match[1]! : null;
}

beforeEach(() => {
  savedUsers = process.env.TELEZAP_USERS;
  vi.stubEnv("NODE_ENV", "test");
  __resetSessionsForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  if (savedUsers === undefined) delete process.env.TELEZAP_USERS;
  else process.env.TELEZAP_USERS = savedUsers;
  vi.unstubAllGlobals();
  __resetSessionsForTests();
});

async function provision(username = "revi", password = "s3cret"): Promise<void> {
  process.env.TELEZAP_USERS = `${username}:${await hashPassword(password)}`;
}

describe("POST /api/auth/login", () => {
  it("logs in with valid credentials and sets an HttpOnly cookie", async () => {
    await provision();
    const res = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi", password: "s3cret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ authenticated: true, user: { id: "revi", username: "revi" } });
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Path=/");
    const text = JSON.stringify(body) + setCookie;
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("scrypt$");
  }, 15000);

  it("rejects wrong passwords and unknown users identically", async () => {
    await provision();
    const wrong = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi", password: "nope" }));
    const unknown = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "ghost", password: "nope" }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect(wrong.headers.get("Set-Cookie")).toBeNull();
  }, 15000);

  it("rejects missing fields and malformed bodies", async () => {
    await provision();
    expect((await loginPOST(jsonRequest("http://localhost/api/auth/login", {}))).status).toBe(400);
    expect((await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi" }))).status).toBe(400);
    const bad = new NextRequest("http://localhost/api/auth/login", { method: "POST", body: "{oops" });
    expect((await loginPOST(bad)).status).toBe(400);
  }, 15000);

  it("sets Secure in production only", async () => {
    await provision();
    vi.stubEnv("NODE_ENV", "production");
    const prod = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi", password: "s3cret" }));
    expect(prod.headers.get("Set-Cookie")).toContain("Secure");
    vi.stubEnv("NODE_ENV", "test");
    const dev = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi", password: "s3cret" }));
    expect(dev.headers.get("Set-Cookie")).not.toContain("Secure");
  }, 15000);
});

describe("GET /api/auth/me", () => {
  it("returns the user for a valid session and 401 otherwise", async () => {
    await provision();
    const login = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi", password: "s3cret" }));
    const token = cookieFrom(login)!;
    expect(token).toBeTruthy();

    const authed = new NextRequest("http://localhost/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    const meRes = await meGET(authed);
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ authenticated: true, user: { id: "revi", username: "revi" } });

    expect((await meGET(new NextRequest("http://localhost/api/auth/me"))).status).toBe(401);
    const forged = new NextRequest("http://localhost/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=forged` },
    });
    expect((await meGET(forged)).status).toBe(401);
  }, 15000);
});

describe("POST /api/auth/logout", () => {
  it("invalidates the session, clears the cookie, and leaves managers alone", async () => {
    await provision();
    const login = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi", password: "s3cret" }));
    const token = cookieFrom(login)!;
    const authed = () =>
      new NextRequest("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      });

    const out = await logoutPOST(authed());
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ authenticated: false });
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const meAfter = new NextRequest("http://localhost/api/auth/me", {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect((await meGET(meAfter)).status).toBe(401);
  }, 15000);

  it("logout touches neither platform registry", async () => {
    const { getWhatsAppManager } = await import("../../../lib/whatsapp.js");
    const { getTelegramManager } = await import("../../../lib/telegram.js");
    const { __resetManagerForTests } = await import("../../../lib/whatsapp.js");
    const { __resetTelegramManagerForTests } = await import("../../../lib/telegram.js");
    await provision();
    const wa = getWhatsAppManager("revi");
    const tg = getTelegramManager("revi");
    const login = await loginPOST(jsonRequest("http://localhost/api/auth/login", { username: "revi", password: "s3cret" }));
    const token = cookieFrom(login)!;
    await logoutPOST(
      new NextRequest("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(getWhatsAppManager("revi")).toBe(wa);
    expect(getTelegramManager("revi")).toBe(tg);
    __resetManagerForTests();
    __resetTelegramManagerForTests();
  }, 15000);
});
