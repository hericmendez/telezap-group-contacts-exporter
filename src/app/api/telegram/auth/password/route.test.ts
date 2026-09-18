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
  return authedJsonRequest("http://localhost/api/telegram/auth/password", body);
}

function stubManager(impl?: (password: string) => Promise<void>) {
  const manager = {
    submitPassword: vi.fn(impl ?? (async () => {})),
    getStatus: vi.fn(() => STATUS),
  } as unknown as import("../../../../../telegram/manager.js").TelegramManager;
  mockedManager.mockReturnValue(manager);
  return manager;
}

describe("POST /api/telegram/auth/password", () => {
  it("submits the password without ever returning it", async () => {
    const manager = stubManager();
    const res = await POST(postRequest({ password: "TEST_PASSWORD" }));
    expect(res.status).toBe(200);
    expect(manager.submitPassword).toHaveBeenCalledWith("TEST_PASSWORD");
    expect(JSON.stringify(await res.json())).not.toContain("TEST_PASSWORD");
  });

  it("returns 400 for missing password", async () => {
    const manager = stubManager();
    const res = await POST(postRequest({}));
    expect(res.status).toBe(400);
    expect(manager.submitPassword).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong authentication step", async () => {
    stubManager(async () => {
      throw new Error("No pending 2FA password request.");
    });
    const res = await POST(postRequest({ password: "x" }));
    expect(res.status).toBe(401);
  });
});
