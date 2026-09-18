import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route.js";
import { getTelegramManager } from "../../../../../lib/telegram.js";
import { authedRequest, resetAuthForTests } from "../../../../../auth/test-utils.js";

vi.mock("../../../../../lib/telegram.js", () => ({
  getTelegramManager: vi.fn(),
}));

const mockedManager = vi.mocked(getTelegramManager);

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthForTests();
});

describe("POST /api/telegram/qr/cancel", () => {
  it("cancels and returns the fresh status", async () => {
    const status = {
      transport: "connected",
      authorized: false,
      loginStep: "none",
      qr: null,
      user: null,
      passwordHint: null,
      error: null,
    };
    const manager = {
      cancelLogin: vi.fn(async () => {}),
      getStatus: vi.fn(() => status),
    } as unknown as import("../../../../../telegram/manager.js").TelegramManager;
    mockedManager.mockReturnValue(manager);
    const res = await POST(authedRequest("http://localhost/api/telegram/qr/cancel", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cancelled: true, status });
    expect(manager.cancelLogin).toHaveBeenCalledTimes(1);
  });
});
