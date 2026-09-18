import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route.js";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { authedJsonRequest, resetAuthForTests } from "../../../../../auth/test-utils.js";

vi.mock("../../../../../lib/telegram.js", () => ({
  getTelegramManager: vi.fn(),
}));

const mockedManager = vi.mocked(getTelegramManager);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

const STATUS = {
  transport: "connected",
  authorized: false,
  loginStep: "awaiting_code",
  qr: null,
  user: null,
  passwordHint: null,
  error: null,
};

function postRequest(body: unknown): NextRequest {
  return authedJsonRequest("http://localhost/api/telegram/auth/phone", body);
}

function stubManager(impl?: (phone: string) => Promise<void>) {
  const manager = {
    startPhoneLogin: vi.fn(impl ?? (async () => {})),
    getStatus: vi.fn(() => STATUS),
  } as unknown as import("../../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

describe("POST /api/telegram/auth/phone", () => {
  it("sends the code for a valid phone", async () => {
    const manager = stubManager();
    const res = await POST(postRequest({ phone: "+5516999999999" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sent: true });
    expect(manager.startPhoneLogin).toHaveBeenCalledWith("+5516999999999");
  });

  it("returns 400 for missing phone", async () => {
    const manager = stubManager();
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(manager.startPhoneLogin).not.toHaveBeenCalled();
  });

  it("returns 409 when the transport is down", async () => {
    stubManager(async () => {
      throw new Error("Telegram client is not connected. Call connect() first.");
    });
    const res = await POST(postRequest({ phone: "+5516999999999" }));
    expect(res.status).toBe(409);
  });

  it("returns 429 on FloodWait", async () => {
    stubManager(async () => {
      throw new Error("Telegram is rate-limiting requests. Try again in 30s.");
    });
    const res = await POST(postRequest({ phone: "+5516999999999" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("30s") });
  });

  it("never echoes the phone back as sensitive data", async () => {
    stubManager();
    const text = JSON.stringify(await (await POST(postRequest({ phone: "+5516999999999" }))).json());
    expect(text).not.toContain("+5516999999999");
  });
});
