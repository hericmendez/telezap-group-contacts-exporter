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
  authorized: true,
  loginStep: "none",
  qr: null,
  user: { id: "777", firstName: "T", lastName: "", username: "t" },
  passwordHint: null,
  error: null,
};

function postRequest(body: unknown): NextRequest {
  return authedJsonRequest("http://localhost/api/telegram/auth/code", body);
}

function stubManager(impl?: (code: string) => Promise<void>) {
  const manager = {
    submitCode: vi.fn(impl ?? (async () => {})),
    getStatus: vi.fn(() => STATUS),
  } as unknown as import("../../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

describe("POST /api/telegram/auth/code", () => {
  it("verifies the code without ever returning it", async () => {
    const manager = stubManager();
    const res = await POST(postRequest({ code: "TEST_CODE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ verified: true });
    expect(manager.submitCode).toHaveBeenCalledWith("TEST_CODE");
    expect(JSON.stringify(body)).not.toContain("TEST_CODE");
  });

  it("returns 400 for missing code", async () => {
    const manager = stubManager();
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(manager.submitCode).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong authentication step", async () => {
    stubManager(async () => {
      throw new Error("No pending verification code. Request a code first.");
    });
    const res = await POST(postRequest({ code: "12345" }));
    expect(res.status).toBe(401);
  });
});
