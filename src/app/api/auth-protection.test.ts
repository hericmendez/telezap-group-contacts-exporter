import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as waStatus } from "./whatsapp/status/route.js";
import { POST as waConnect } from "./whatsapp/connect/route.js";
import { GET as waQr } from "./whatsapp/qr/route.js";
import { GET as groups } from "./groups/route.js";
import { POST as waExport } from "./export/route.js";
import { GET as waDownload } from "./export/download/route.js";
import { GET as tgStatus } from "./telegram/status/route.js";
import { POST as tgConnect } from "./telegram/connect/route.js";
import { GET as tgQr } from "./telegram/qr/route.js";
import { POST as tgQrStart } from "./telegram/qr/start/route.js";
import { POST as tgQrCancel } from "./telegram/qr/cancel/route.js";
import { POST as tgPhone } from "./telegram/auth/phone/route.js";
import { POST as tgCode } from "./telegram/auth/code/route.js";
import { POST as tgPassword } from "./telegram/auth/password/route.js";
import { GET as tgGroups } from "./telegram/groups/route.js";
import { GET as tgParticipants } from "./telegram/groups/[id]/participants/route.js";
import { POST as tgExport } from "./telegram/export/route.js";
import { GET as tgDownload } from "./telegram/export/download/route.js";
import { __resetSessionsForTests } from "../../auth/session.js";

function anon(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  __resetSessionsForTests();
  vi.clearAllMocks();
});

describe("protected routes reject anonymous requests with 401", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["GET /api/whatsapp/status", () => waStatus(anon("http://localhost/api/whatsapp/status"))],
    ["POST /api/whatsapp/connect", () => waConnect(anon("http://localhost/api/whatsapp/connect", "POST"))],
    ["GET /api/whatsapp/qr", () => waQr(anon("http://localhost/api/whatsapp/qr"))],
    ["GET /api/groups", () => groups(anon("http://localhost/api/groups"))],
    ["POST /api/export", () => waExport(anon("http://localhost/api/export", "POST", { groupId: "x" }))],
    ["GET /api/export/download", () => waDownload(anon("http://localhost/api/export/download"))],
    ["GET /api/telegram/status", () => tgStatus(anon("http://localhost/api/telegram/status"))],
    ["POST /api/telegram/connect", () => tgConnect(anon("http://localhost/api/telegram/connect", "POST"))],
    ["GET /api/telegram/qr", () => tgQr(anon("http://localhost/api/telegram/qr"))],
    ["POST /api/telegram/qr/start", () => tgQrStart(anon("http://localhost/api/telegram/qr/start", "POST"))],
    ["POST /api/telegram/qr/cancel", () => tgQrCancel(anon("http://localhost/api/telegram/qr/cancel", "POST"))],
    ["POST /api/telegram/auth/phone", () => tgPhone(anon("http://localhost/api/telegram/auth/phone", "POST", { phone: "+1" }))],
    ["POST /api/telegram/auth/code", () => tgCode(anon("http://localhost/api/telegram/auth/code", "POST", { code: "1" }))],
    [
      "POST /api/telegram/auth/password",
      () => tgPassword(anon("http://localhost/api/telegram/auth/password", "POST", { password: "x" })),
    ],
    ["GET /api/telegram/groups", () => tgGroups(anon("http://localhost/api/telegram/groups"))],
    [
      "GET /api/telegram/groups/:id/participants",
      () => tgParticipants(anon("http://localhost/api/telegram/groups/1/participants"), { params: Promise.resolve({ id: "1" }) }),
    ],
    ["POST /api/telegram/export", () => tgExport(anon("http://localhost/api/telegram/export", "POST", { groupId: "1" }))],
    ["GET /api/telegram/export/download", () => tgDownload(anon("http://localhost/api/telegram/export/download"))],
  ];

  it.each(cases)("%s", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized." });
  });
});
